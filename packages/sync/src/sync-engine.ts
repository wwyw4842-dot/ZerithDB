import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type { ZerithDBConfig, SyncState, SyncPlugin, Document } from "zerithdb-core";
import { EventEmitter } from "zerithdb-core";
import type { DbClient, CollectionClient } from "zerithdb-db";
import type { NetworkManager } from "zerithdb-network";

type SyncEvents = {
  "state:change": SyncState;
  "update:local": { collectionName: string; update: Uint8Array };
  "update:remote": { collectionName: string; update: Uint8Array; fromPeer: string };
};

type SyncDocument = Document<Record<string, any>>;
type SyncEntry = { document?: SyncDocument; deletedAt?: number };
type Snapshot = Map<string, SyncDocument>;

const LOCAL_DB_ORIGIN = "zerithdb:local-db";
const HYDRATE_ORIGIN = "zerithdb:hydrate";
const REMOTE_ORIGIN = "remote";

interface CollectionBridge {
  readonly collectionName: string;
  readonly collection: CollectionClient<Record<string, any>>;
  readonly doc: Y.Doc;
  readonly records: Y.Map<string>;
  readonly persistence: IndexeddbPersistence;
  unsubscribe: (() => void) | null;
  ready: boolean;
  pendingDb: SyncDocument[] | null;
  dbSnapshot: Snapshot;
  applyingRemote: boolean;
  closed: boolean;
  queue: Promise<void>;
  readyPromise: Promise<void>;
}

/**
 * CRDT sync engine — manages one Yjs document per collection.
 *
 * Yjs is the transport/merge layer and IndexedDB is the public local store.
 * The collection bridge below is deliberately snapshot based: CRUD commits
 * are projected into a Y.Map, and remote Y.Map entries are atomically applied
 * back to the collection. This keeps React subscriptions on the same source
 * as direct CRUD callers and gives deletes an explicit tombstone.
 */
export class SyncEngine extends EventEmitter<SyncEvents> {
  private readonly docs = new Map<string, Y.Doc>();
  private readonly persistences = new Map<string, IndexeddbPersistence>();
  private readonly bridges = new Map<string, CollectionBridge>();
  private readonly pendingUpdates = new Map<string, Uint8Array[]>();
  private readonly plugins = new Map<string, SyncPlugin>();
  private readonly trustedPlugins = new Map<string, SyncPlugin>();
  private activePluginVersion = 1;
  private _enabled = false;
  private _disposed = false;
  private _state: SyncState = { synced: false, pendingUpdates: 0, connectedPeers: 0 };

  constructor(
    private readonly config: ZerithDBConfig,
    private readonly db: DbClient,
    private readonly network: NetworkManager
  ) {
    super();
    this.onPeerUpdate = this.onPeerUpdate.bind(this);
    this.onPeerConnected = this.onPeerConnected.bind(this);
  }

  /** Enable P2P sync. Local CRUD changes are projected after hydration. */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this.network.on("message", this.onPeerUpdate);
    this.network.on("peer:connected", this.onPeerConnected);
    this.updateState({ synced: true });
    for (const bridge of this.bridges.values()) {
      void bridge.readyPromise.then(() => {
        if (!this._enabled) return;
        this.flushPending(bridge.collectionName);
        // A restart can restore an update from y-indexeddb after the in-memory
        // pending queue was lost. Sending the current state repairs that gap.
        this.broadcastUpdate(bridge.collectionName, Y.encodeStateAsUpdate(bridge.doc));
      });
    }
  }

  /** Disable sync without disconnecting from peers. */
  disable(): void {
    this._enabled = false;
    this.network.off("message", this.onPeerUpdate);
    this.network.off("peer:connected", this.onPeerConnected);
    this.updateState({ synced: false });
  }

  get state(): Readonly<SyncState> {
    return this._state;
  }

  /**
   * Register application-bundled plugin code in the local trust registry.
   *
   * The registry stores objects, never URLs or peer-provided module source.
   * A lower revision cannot replace a newer trusted revision for the same ID.
   */
  trustPlugin(plugin: SyncPlugin): void {
    this.validatePlugin(plugin);
    const current = this.trustedPlugins.get(plugin.id);
    if (current && current.version > plugin.version) {
      throw new Error("Cannot replace a trusted sync plugin with an older revision");
    }
    this.trustedPlugins.set(plugin.id, plugin);
  }

  /** Activate a plugin that was registered by local application code. */
  registerPlugin(plugin: SyncPlugin): void {
    // Validate and compare before mutating the trust registry. A stale local
    // registration must not leave an identifier available for later loading.
    this.validatePlugin(plugin);
    if (plugin.version < this.activePluginVersion) {
      throw new Error("Stale sync plugin revision");
    }
    this.trustPlugin(plugin);
    this.plugins.set(plugin.id, plugin);
    this.activePluginVersion = Math.max(this.activePluginVersion, plugin.version);
  }

  /** Activate a trusted local plugin by identifier; URLs are intentionally unsupported. */
  async loadPlugin(pluginId: string): Promise<void> {
    const plugin = this.trustedPlugins.get(pluginId);
    if (!plugin) throw new Error("Untrusted sync plugin");
    this.registerPlugin(plugin);
  }

  /** Advertise a locally trusted, newer protocol revision to connected peers. */
  proposeUpgrade(pluginId: string, version: number): void {
    const plugin = this.trustedPlugins.get(pluginId);
    if (
      !plugin ||
      plugin.version !== version ||
      !Number.isSafeInteger(version) ||
      version <= this.activePluginVersion
    ) {
      throw new Error("Untrusted or stale sync plugin upgrade");
    }
    this.network.broadcast({
      type: "sync-upgrade-offer",
      payload: JSON.stringify({ pluginId, version }),
    });
  }

  /**
   * Get or create a persisted Yjs document for a collection. Calling this
   * method also installs the CRUD bridge; applications do not need to mutate
   * a Y.Map directly for local writes to sync.
   */
  getDoc(collectionName: string): Y.Doc {
    if (this._disposed) throw new Error("Sync engine is disposed");
    const existing = this.docs.get(collectionName);
    if (existing) return existing;

    const doc = new Y.Doc({ guid: `${this.config.appId}:${collectionName}` });
    const persistence = new IndexeddbPersistence(
      `zerithdb_sync_${this.config.appId}_${collectionName}`,
      doc
    );
    const records = doc.getMap<string>("records");
    this.docs.set(collectionName, doc);
    this.persistences.set(collectionName, persistence);

    const bridge: CollectionBridge = {
      collectionName,
      collection: this.db.collection(collectionName),
      doc,
      records,
      persistence,
      unsubscribe: null,
      ready: false,
      pendingDb: null,
      dbSnapshot: new Map(),
      applyingRemote: false,
      closed: false,
      queue: Promise.resolve(),
      readyPromise: Promise.resolve(),
    };
    this.bridges.set(collectionName, bridge);

    // A CRUD commit notifies this callback in the same tab and through the
    // collection's BroadcastChannel in another tab.
    bridge.unsubscribe = bridge.collection.subscribe((documents) => {
      bridge.pendingDb = documents as SyncDocument[];
      if (bridge.ready && !bridge.applyingRemote) {
        void this.enqueue(bridge, () => this.reconcileDbToDoc(bridge));
      }
    });

    // Remote Yjs transactions are projected into IndexedDB. Transactions
    // generated by this bridge are already reflected in the DB and must not
    // loop back through the observer.
    records.observe((_event, transaction) => {
      if (transaction.origin === LOCAL_DB_ORIGIN || transaction.origin === HYDRATE_ORIGIN) return;
      if (bridge.ready && !bridge.applyingRemote) {
        void this.enqueue(bridge, () => this.reconcileDocToDb(bridge));
      }
    });

    bridge.readyPromise = persistence.whenSynced.then(() =>
      this.enqueue(bridge, () => this.hydrateBridge(bridge))
    );

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || origin === HYDRATE_ORIGIN) return;
      // Do not enqueue the initial y-indexeddb hydration. Once the bridge is
      // ready, any local CRUD that happened while it was opening is projected
      // by the collection subscription and will create a fresh update.
      if (!bridge.ready) return;
      if (!this._enabled) {
        const pending = this.pendingUpdates.get(collectionName) ?? [];
        pending.push(update);
        this.pendingUpdates.set(collectionName, pending);
        return;
      }
      void this.broadcastUpdate(collectionName, update);
    });
    return doc;
  }

  /** Apply a remote CRDT update and hydrate the public collection. */
  async applyRemoteUpdate(
    collectionName: string,
    update: Uint8Array,
    fromPeer: string
  ): Promise<void> {
    let finalUpdate: Uint8Array | null = update;
    try {
      for (const plugin of this.plugins.values()) {
        if (!plugin.onBeforeApplyUpdate) continue;
        finalUpdate = await plugin.onBeforeApplyUpdate(collectionName, finalUpdate, fromPeer);
        if (!finalUpdate || !(finalUpdate instanceof Uint8Array)) return;
      }
    } catch {
      // A plugin failure must not apply unverified peer data or alter local state.
      return;
    }
    const doc = this.getDoc(collectionName);
    Y.applyUpdate(doc, finalUpdate, REMOTE_ORIGIN);
    await this.bridges.get(collectionName)?.queue;
    this.emit("update:remote", { collectionName, update: finalUpdate, fromPeer });
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this.disable();
    for (const bridge of this.bridges.values()) {
      bridge.closed = true;
      bridge.unsubscribe?.();
      bridge.unsubscribe = null;
      await bridge.queue.catch(() => undefined);
    }
    for (const persistence of this.persistences.values()) await persistence.destroy();
    for (const doc of this.docs.values()) doc.destroy();
    this.bridges.clear();
    this.docs.clear();
    this.persistences.clear();
    this.pendingUpdates.clear();
  }

  // ─── CRUD/Yjs bridge ──────────────────────────────────────────────────────

  private enqueue(bridge: CollectionBridge, task: () => Promise<void>): Promise<void> {
    const next = bridge.queue.then(
      () => (bridge.closed ? undefined : task()),
      () => (bridge.closed ? undefined : task())
    );
    bridge.queue = next.catch(() => undefined);
    return next;
  }

  private async hydrateBridge(bridge: CollectionBridge): Promise<void> {
    if (bridge.closed) return;
    const localDocuments = bridge.pendingDb ?? ((await bridge.collection.find()) as SyncDocument[]);
    if (bridge.closed) return;
    const resolved = this.resolveSnapshot(bridge, localDocuments);

    bridge.applyingRemote = true;
    try {
      await this.replaceCollectionIfChanged(bridge, resolved);
    } finally {
      bridge.applyingRemote = false;
    }

    bridge.doc.transact(() => this.writeSnapshot(bridge, resolved), HYDRATE_ORIGIN);
    bridge.dbSnapshot = toSnapshot(resolved);
    bridge.pendingDb = resolved;
    bridge.ready = true;
  }

  private async reconcileDbToDoc(bridge: CollectionBridge): Promise<void> {
    if (bridge.closed || !bridge.ready || bridge.applyingRemote) return;
    const localDocuments = bridge.pendingDb ?? ((await bridge.collection.find()) as SyncDocument[]);
    const current = toSnapshot(localDocuments);
    const changed = !snapshotsEqual(current, bridge.dbSnapshot);
    if (!changed) return;

    bridge.doc.transact(() => {
      const previous = bridge.dbSnapshot;
      for (const id of previous.keys()) {
        if (current.has(id)) continue;
        const previousDocument = previous.get(id);
        const deletedAt = Math.max(Date.now(), previousDocument?._updatedAt ?? 0);
        bridge.records.set(id, JSON.stringify({ deletedAt } satisfies SyncEntry));
      }
      for (const [id, document] of current) {
        const existing = readEntry(bridge.records.get(id));
        if (existing?.document && compareDocuments(existing.document, document) >= 0) continue;
        const tombstone = existing?.deletedAt;
        if (tombstone !== undefined && tombstone >= document._updatedAt) continue;
        bridge.records.set(id, JSON.stringify({ document } satisfies SyncEntry));
      }
    }, LOCAL_DB_ORIGIN);
    bridge.dbSnapshot = current;
  }

  private async reconcileDocToDb(bridge: CollectionBridge): Promise<void> {
    if (bridge.closed || !bridge.ready || bridge.applyingRemote) return;
    const localDocuments = bridge.pendingDb ?? ((await bridge.collection.find()) as SyncDocument[]);
    const resolved = this.resolveSnapshot(bridge, localDocuments);
    const current = toSnapshot(localDocuments);

    if (!snapshotsEqual(current, toSnapshot(resolved))) {
      bridge.applyingRemote = true;
      try {
        await this.replaceCollectionIfChanged(bridge, resolved);
      } finally {
        bridge.applyingRemote = false;
      }
    }
    bridge.pendingDb = resolved;
    bridge.dbSnapshot = toSnapshot(resolved);

    // If the local DB had a newer edit than a remote value, publish the
    // deterministic winner back into Yjs so both peers converge.
    if (!entriesMatchSnapshot(bridge, resolved)) {
      bridge.doc.transact(() => this.writeSnapshot(bridge, resolved), LOCAL_DB_ORIGIN);
    }
  }

  private resolveSnapshot(
    bridge: CollectionBridge,
    localDocuments: readonly SyncDocument[]
  ): SyncDocument[] {
    const resolved = toSnapshot(localDocuments);
    for (const [id, raw] of bridge.records) {
      const entry = readEntry(raw);
      if (!entry) continue;
      const local = resolved.get(id);
      if (entry.document) {
        if (!local || compareDocuments(entry.document, local) > 0) resolved.set(id, entry.document);
      } else if (entry.deletedAt !== undefined) {
        if (!local || local._updatedAt <= entry.deletedAt) resolved.delete(id);
      }
    }
    return [...resolved.values()].sort((a, b) => a._id.localeCompare(b._id));
  }

  private writeSnapshot(bridge: CollectionBridge, documents: readonly SyncDocument[]): void {
    const desired = new Map(documents.map((document) => [document._id, document]));
    for (const [id, raw] of bridge.records) {
      const entry = readEntry(raw);
      if (entry?.document && desired.has(id)) continue;
      if (entry?.deletedAt !== undefined && !desired.has(id)) continue;
      bridge.records.delete(id);
    }
    for (const document of documents) {
      const existing = readEntry(bridge.records.get(document._id));
      if (!existing?.document || compareDocuments(existing.document, document) !== 0) {
        bridge.records.set(document._id, JSON.stringify({ document } satisfies SyncEntry));
      }
    }
  }

  private async replaceCollectionIfChanged(
    bridge: CollectionBridge,
    documents: readonly SyncDocument[]
  ): Promise<void> {
    const current = bridge.pendingDb ?? ((await bridge.collection.find()) as SyncDocument[]);
    if (!snapshotsEqual(toSnapshot(current), toSnapshot(documents))) {
      await bridge.collection.applySyncSnapshot(documents);
    }
  }

  private flushPending(collectionName: string): void {
    const pending = this.pendingUpdates.get(collectionName);
    if (!pending?.length) return;
    this.pendingUpdates.delete(collectionName);
    void this.broadcastUpdate(collectionName, Y.mergeUpdates(pending));
  }

  private async broadcastUpdate(collectionName: string, update: Uint8Array): Promise<void> {
    if (!this._enabled) return;
    let finalUpdate: Uint8Array | null = update;
    try {
      for (const plugin of this.plugins.values()) {
        if (!plugin.onBeforeSendUpdate) continue;
        finalUpdate = await plugin.onBeforeSendUpdate(collectionName, finalUpdate);
        if (!finalUpdate || !(finalUpdate instanceof Uint8Array)) return;
      }
    } catch {
      // A failed local transform is dropped rather than sent in raw form.
      return;
    }
    this.emit("update:local", { collectionName, update: finalUpdate });
    this.network.broadcast({
      type: "sync-update",
      payload: this.encodeMessage(collectionName, finalUpdate),
    });
  }

  private onPeerConnected(): void {
    if (!this._enabled) return;
    for (const bridge of this.bridges.values()) {
      if (bridge.ready)
        void this.broadcastUpdate(bridge.collectionName, Y.encodeStateAsUpdate(bridge.doc));
    }
  }

  // ─── Network framing ──────────────────────────────────────────────────────

  private onPeerUpdate(msg: { type: string; payload: Uint8Array | string; from: string }): void {
    if (msg.type === "sync-upgrade-offer") {
      this.handleUpgradeOffer(msg);
      return;
    }
    if (msg.type !== "sync-update") return;
    const payload = typeof msg.payload === "string" ? base64ToBytes(msg.payload) : msg.payload;
    const decoded = this.decodeMessage(payload);
    if (decoded === null) return;
    void this.applyRemoteUpdate(decoded.collectionName, decoded.update, msg.from);
  }

  private handleUpgradeOffer(msg: {
    type: string;
    payload: Uint8Array | string;
    from: string;
  }): void {
    const payload =
      typeof msg.payload === "string" ? msg.payload : new TextDecoder().decode(msg.payload);
    try {
      const offer = JSON.parse(payload) as {
        pluginId?: unknown;
        version?: unknown;
        pluginUrl?: unknown;
      };
      // URL fields are explicitly rejected, even when a peer also sends a valid ID.
      if (
        offer.pluginUrl !== undefined ||
        typeof offer.pluginId !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(offer.pluginId) ||
        typeof offer.version !== "number" ||
        !Number.isSafeInteger(offer.version) ||
        offer.version < 1 ||
        offer.version <= this.activePluginVersion
      ) {
        return;
      }
      const plugin = this.trustedPlugins.get(offer.pluginId);
      if (!plugin || plugin.version !== offer.version) return;

      // Activation and acknowledgement are synchronous local registry operations.
      this.registerPlugin(plugin);
      this.network.sendTo(msg.from, {
        type: "sync-upgrade-accept",
        payload: JSON.stringify({ pluginId: plugin.id, version: plugin.version }),
      });
    } catch {
      // Malformed, stale, unknown, or executable offers are ignored atomically.
    }
  }

  private validatePlugin(plugin: SyncPlugin): void {
    if (
      !plugin ||
      !/^[A-Za-z0-9_-]+$/.test(plugin.id) ||
      !Number.isSafeInteger(plugin.version) ||
      plugin.version < 1 ||
      (plugin.onBeforeApplyUpdate !== undefined &&
        typeof plugin.onBeforeApplyUpdate !== "function") ||
      (plugin.onBeforeSendUpdate !== undefined && typeof plugin.onBeforeSendUpdate !== "function")
    ) {
      throw new Error("Invalid trusted sync plugin");
    }
  }

  private encodeMessage(collectionName: string, update: Uint8Array): string {
    const nameBytes = new TextEncoder().encode(collectionName);
    if (nameBytes.length > 255) {
      throw new Error(`Collection name is ${nameBytes.length} UTF-8 bytes; maximum is 255`);
    }
    const combined = new Uint8Array(1 + nameBytes.length + update.length);
    combined[0] = nameBytes.length;
    combined.set(nameBytes, 1);
    combined.set(update, 1 + nameBytes.length);
    return bytesToBase64(combined);
  }

  private decodeMessage(bytes: Uint8Array): { collectionName: string; update: Uint8Array } | null {
    try {
      if (bytes.length < 1) return null;
      const nameLen = bytes[0];
      if (nameLen === undefined || bytes.length < 1 + nameLen) return null;
      return {
        collectionName: new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.slice(1, 1 + nameLen)
        ),
        update: bytes.slice(1 + nameLen),
      };
    } catch {
      return null;
    }
  }

  private updateState(partial: Partial<SyncState>): void {
    this._state = { ...this._state, ...partial };
    this.emit("state:change", this._state);
  }
}

function readEntry(raw: string | undefined): SyncEntry | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as SyncEntry;
    if (!value || typeof value !== "object") return null;
    if (
      value.document &&
      typeof value.document._id === "string" &&
      Number.isFinite(value.document._createdAt) &&
      Number.isFinite(value.document._updatedAt)
    ) {
      return { document: value.document };
    }
    if (Number.isFinite(value.deletedAt)) return { deletedAt: value.deletedAt };
  } catch {
    // Corrupt Yjs values are ignored; the local snapshot remains authoritative.
  }
  return null;
}

function toSnapshot(documents: readonly SyncDocument[]): Snapshot {
  return new Map(documents.map((document) => [document._id, document]));
}

function compareDocuments(left: SyncDocument, right: SyncDocument): number {
  if (left._updatedAt !== right._updatedAt) return left._updatedAt - right._updatedAt;
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson === rightJson ? 0 : leftJson > rightJson ? 1 : -1;
}

function snapshotsEqual(left: Snapshot, right: Snapshot): boolean {
  if (left.size !== right.size) return false;
  for (const [id, document] of left) {
    const other = right.get(id);
    if (!other || compareDocuments(document, other) !== 0) return false;
  }
  return true;
}

function entriesMatchSnapshot(
  bridge: CollectionBridge,
  documents: readonly SyncDocument[]
): boolean {
  const desired = new Map(documents.map((document) => [document._id, document]));
  for (const [id, raw] of bridge.records) {
    const entry = readEntry(raw);
    const document = desired.get(id);
    if (!document || !entry?.document || compareDocuments(entry.document, document) !== 0)
      return false;
    desired.delete(id);
  }
  return desired.size === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
