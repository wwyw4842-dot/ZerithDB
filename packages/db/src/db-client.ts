import Dexie, { type Table } from "dexie";
import { v7 as uuidv7 } from "uuid";
import type {
  ZerithDBConfig,
  Document,
  QueryFilter,
  InsertResult,
  UpdateSpec,
} from "zerithdb-core";
import { ZerithDBError, ErrorCode } from "zerithdb-core";
import { atomicAddAll, atomicDelete, atomicModify, atomicReplace } from "./idb-atomic.js";

const collectionListeners = new Map<string, Set<() => void>>();

/**
 * A handle to a single named collection within the ZerithDB local database.
 * All operations are async and backed by IndexedDB.
 */
export class CollectionClient<T extends Record<string, any> = Record<string, any>> {
  private readonly subscriptions = new Set<() => void>();
  constructor(
    private readonly table: Table<Document<T>> | TableAccess<Document<T>>,
    private readonly collectionName: string,
    private readonly namespace = "direct"
  ) {}

  private withTable<R>(run: (table: Table<Document<T>>) => Promise<R>): Promise<R> {
    return typeof this.table === "function" ? this.table(run) : run(this.table);
  }

  /** Subscribe to committed state; unsubscription also invalidates in-flight reads. */
  subscribe(
    callback: (documents: Document<T>[]) => void,
    onError: (error: unknown) => void = console.error
  ): () => void {
    const key = `${this.namespace}:${this.collectionName}`;
    let active = true,
      revision = 0;
    const refresh = () => {
      const current = ++revision;
      void this.find()
        .then((documents) => {
          if (active && current === revision) callback(documents);
        })
        .catch((error) => {
          if (active && current === revision) onError(error);
        });
    };
    const listeners = collectionListeners.get(key) ?? new Set<() => void>();
    listeners.add(refresh);
    collectionListeners.set(key, listeners);
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined")
        channel = new BroadcastChannel(`zerithdb-changes:${key}`);
      if (channel) channel.onmessage = refresh;
    } catch {
      /* Local subscriptions still work when cross-tab messaging is unavailable. */
    }
    refresh();
    const unsubscribe = () => {
      active = false;
      ++revision;
      listeners.delete(refresh);
      if (!listeners.size) collectionListeners.delete(key);
      try {
        channel?.close();
      } catch {
        /* Cleanup must remain idempotent. */
      }
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.clear();
  }

  private changed(): void {
    const key = `${this.namespace}:${this.collectionName}`;
    for (const refresh of collectionListeners.get(key) ?? []) refresh();
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`zerithdb-changes:${key}`);
        channel.postMessage(null);
      }
    } catch {
      /* Notification failure cannot turn a committed write into failure. */
    } finally {
      try {
        channel?.close();
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Insert a new document into the collection.
   * Automatically assigns `_id`, `_createdAt`, and `_updatedAt`.
   */
  async insert(document: T): Promise<InsertResult> {
    const now = Date.now();
    const id = uuidv7();
    const doc: Document<T> = {
      ...document,
      _id: id,
      _createdAt: now,
      _updatedAt: now,
    };

    try {
      await this.withTable((table) => table.add(doc));
      this.changed();
      return { id };
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_WRITE_FAILED,
        `Failed to insert into collection "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Insert multiple documents in a single atomic operation.
   */
  async insertMany(documents: T[]): Promise<InsertResult[]> {
    const now = Date.now();
    const docs = documents.map((doc) => ({
      ...doc,
      _id: uuidv7(),
      _createdAt: now,
      _updatedAt: now,
    })) as Document<T>[];

    try {
      await this.withTable((table) => atomicAddAll(table, docs));
      this.changed();
      return docs.map((d) => ({ id: d._id }));
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_WRITE_FAILED,
        `Failed to bulk insert into collection "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Find documents matching a filter.
   * All filter fields are ANDed together.
   *
   * @example
   * ```typescript
   * const active = await todos.find({ done: false });
   * const high = await todos.find({ priority: { $gte: 3 } });
   * ```
   */
  async find(filter: QueryFilter<T> = {}): Promise<Document<T>[]> {
    try {
      const all = await this.withTable((table) => table.toArray());
      return all.filter((doc) => this.matchesFilter(doc, filter));
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_READ_FAILED,
        `Failed to query collection "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Find a single document by its `_id`.
   */
  async findById(id: string): Promise<Document<T> | undefined> {
    try {
      return await this.withTable((table) => table.get(id));
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_READ_FAILED,
        `Failed to get document "${id}" from "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Update documents matching a filter.
   * Returns the number of updated documents.
   */
  async update(filter: QueryFilter<T>, spec: UpdateSpec<T>): Promise<number> {
    try {
      const now = Date.now();
      const count = await this.withTable((table) =>
        atomicModify(
          table,
          (doc) => this.matchesFilter(doc, filter),
          (doc) => this.applyFieldUpdate(doc, spec, now)
        )
      );
      this.changed();
      return count;
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_WRITE_FAILED,
        `Failed to update documents in "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Delete documents matching a filter.
   * Returns the number of deleted documents.
   */
  async delete(filter: QueryFilter<T>): Promise<number> {
    try {
      const count = await this.withTable((table) =>
        atomicDelete(table, (doc) => this.matchesFilter(doc, filter))
      );
      this.changed();
      return count;
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_DELETE_FAILED,
        `Failed to delete documents from "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Delete every document in the collection.
   */
  async clearAll(): Promise<void> {
    try {
      await this.withTable((table) => table.clear());
      this.changed();
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_DELETE_FAILED,
        `Failed to clear collection "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Atomically replace this collection with a trusted sync snapshot.
   *
   * This is intentionally a narrow primitive for the sync engine.  It keeps
   * document ids and timestamps from the remote replica, while ensuring a
   * failed write aborts the entire replacement instead of exposing a partial
   * local state to subscribers.
   */
  async applySyncSnapshot(documents: readonly Document<T>[]): Promise<void> {
    if (!Array.isArray(documents)) throw new Error("Sync snapshot must be an array");
    for (const document of documents) {
      if (!document || typeof document !== "object" || typeof document._id !== "string") {
        throw new Error("Sync snapshot contains an invalid document");
      }
    }
    try {
      await this.withTable((table) => atomicReplace(table, documents));
      this.changed();
    } catch (err) {
      throw new ZerithDBError(
        ErrorCode.DB_WRITE_FAILED,
        `Failed to apply sync snapshot to "${this.collectionName}"`,
        { cause: err }
      );
    }
  }

  /**
   * Count documents matching a filter.
   */
  async count(filter: QueryFilter<T> = {}): Promise<number> {
    const docs = await this.find(filter);
    return docs.length;
  }

  private applyFieldUpdate(doc: Document<T>, spec: UpdateSpec<T>, updatedAt: number): Document<T> {
    const next = {
      ...doc,
      ...(spec.$set ?? {}),
    } as Record<string, any>;
    for (const key of Object.keys(spec.$unset ?? {})) {
      if (key === "_id" || key === "_createdAt" || key === "_updatedAt") continue;
      delete next[key];
    }
    next._id = doc._id;
    next._createdAt = doc._createdAt;
    next._updatedAt = updatedAt;
    return next as Document<T>;
  }

  private matchesFilter(
    doc: Record<string, any>,
    filter: QueryFilter<T> | Record<string, any>
  ): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      if (!this.matchesCondition((doc as Record<string, any>)[key], condition)) return false;
    }
    return true;
  }

  private matchesCondition(fieldValue: unknown, condition: unknown): boolean {
    if (condition === null || typeof condition !== "object") {
      return fieldValue === condition;
    }
    if (Array.isArray(condition)) {
      return Array.isArray(fieldValue) && JSON.stringify(fieldValue) === JSON.stringify(condition);
    }

    const record = condition as Record<string, unknown>;
    const keys = Object.keys(record);
    const operatorKeys = keys.filter((key) => key.startsWith("$"));
    if (operatorKeys.length === 0) {
      if (fieldValue === null || typeof fieldValue !== "object" || Array.isArray(fieldValue))
        return false;
      return this.matchesFilter(fieldValue as Record<string, any>, record);
    }
    if (operatorKeys.length !== keys.length) {
      throw new Error("Filter mixes operators with nested fields");
    }
    const known = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin"]);
    for (const key of operatorKeys) {
      if (!known.has(key)) throw new Error(`Unknown filter operator "${key}"`);
    }
    if ("$eq" in record && fieldValue !== record["$eq"]) return false;
    if ("$ne" in record && fieldValue === record["$ne"]) return false;
    if ("$gt" in record && !((fieldValue as any) > (record["$gt"] as never))) return false;
    if ("$gte" in record && !((fieldValue as any) >= (record["$gte"] as never))) return false;
    if ("$lt" in record && !((fieldValue as any) < (record["$lt"] as never))) return false;
    if ("$lte" in record && !((fieldValue as any) <= (record["$lte"] as never))) return false;
    if ("$in" in record) {
      if (!Array.isArray(record["$in"])) throw new Error('Filter operator "$in" requires an array');
      if (!(record["$in"] as unknown[]).includes(fieldValue)) return false;
    }
    if ("$nin" in record) {
      if (!Array.isArray(record["$nin"]))
        throw new Error('Filter operator "$nin" requires an array');
      if ((record["$nin"] as unknown[]).includes(fieldValue)) return false;
    }
    return true;
  }
}

type TableAccess<T> = <R>(run: (table: Table<T>) => Promise<R>) => Promise<R>;
const databaseQueues = new Map<string, Promise<unknown>>();

/** Add one store without redeclaring (and accidentally deleting) another tab's stores. */
async function ensureCollection(databaseName: string, collectionName: string): Promise<void> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await openSchema(databaseName, collectionName);
    if (current.objectStoreNames.contains(collectionName) && current.version >= 10) {
      current.close();
      return;
    }
    // Legacy Dexie version(1) uses native version 10. A lower version makes a
    // rollback run its old schema upgrade and delete stores it does not declare.
    const version = Math.max(10, current.version + 1);
    current.close();
    try {
      const upgraded = await openSchema(databaseName, collectionName, version);
      const exists = upgraded.objectStoreNames.contains(collectionName);
      upgraded.close();
      if (exists) return;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "VersionError") throw error;
    }
  }
  throw new Error("Collection schema changed repeatedly; retry the operation");
}

function openSchema(
  databaseName: string,
  collectionName: string,
  version?: number
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let blocked = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            blocked
              ? "Database schema upgrade blocked by an older client; close it and retry"
              : "Database schema open timed out; close older clients and retry"
          )
        ),
      5_000
    );
    const request =
      version === undefined ? indexedDB.open(databaseName) : indexedDB.open(databaseName, version);
    request.onblocked = () => {
      blocked = true;
    };
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      if (!request.result.objectStoreNames.contains(collectionName)) {
        const store = request.result.createObjectStore(collectionName, { keyPath: "_id" });
        store.createIndex("_createdAt", "_createdAt");
        store.createIndex("_updatedAt", "_updatedAt");
      }
    };
    request.onerror = () => fail(request.error ?? new Error("Failed to open database schema"));
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
  });
}

/** Serialize schema changes with CRUD, including other same-origin tabs. */
class ZerithDBDexie {
  readonly name: string;
  private disposed = false;

  constructor(appId: string) {
    this.name = `zerithdb_${appId}`;
  }

  async useTable<T, R>(name: string, run: (table: Table<T>) => Promise<R>): Promise<R> {
    if (this.disposed) throw new Error("Database client is disposed");
    const execute = async () => {
      await ensureCollection(this.name, name);
      const database = new Dexie(this.name);
      try {
        await database.open();
        // Finish this operation before another context upgrades the schema.
        database.on("versionchange", () => false);
        return await run(database.table<T>(name));
      } finally {
        database.close();
      }
    };
    const lockAndExecute = async (): Promise<R> =>
      typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request(this.name, execute)
        : await execute();
    const pending = (databaseQueues.get(this.name) ?? Promise.resolve()).then(
      lockAndExecute,
      lockAndExecute
    );
    databaseQueues.set(this.name, pending);
    try {
      return await pending;
    } finally {
      if (databaseQueues.get(this.name) === pending) databaseQueues.delete(this.name);
    }
  }

  close(): void {
    this.disposed = true;
  }
}

/**
 * Internal database client. Wraps Dexie and manages collection instances.
 * Use via {@link ZerithDBApp.db} — not instantiated directly.
 */
export class DbClient {
  private readonly dexie: ZerithDBDexie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly collections = new Map<string, CollectionClient<any>>();

  constructor(config: ZerithDBConfig) {
    this.dexie = new ZerithDBDexie(config.appId);
  }

  collection<T extends Record<string, any>>(name: string): CollectionClient<T> {
    if (!this.collections.has(name)) {
      if (!name || typeof name !== "string") throw new Error("Collection name must be nonempty");
      const table: TableAccess<Document<T>> = (run) => this.dexie.useTable(name, run);
      this.collections.set(name, new CollectionClient<T>(table, name, this.dexie.name));
    }
    return this.collections.get(name) as CollectionClient<T>;
  }

  async dispose(): Promise<void> {
    for (const collection of this.collections.values()) collection.dispose();
    this.collections.clear();
    this.dexie.close();
  }
}
