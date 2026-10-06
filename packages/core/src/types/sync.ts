export interface SyncUpdate {
  collectionName: string;
  update: Uint8Array;
  origin: string | null;
}

export interface SyncState {
  synced: boolean;
  pendingUpdates: number;
  connectedPeers: number;
}

export interface AwarenessState {
  peerId: string;
  did: string;
  cursor?: { line: number; column: number };
  [key: string]: unknown;
}

/**
 * An application-bundled sync protocol extension.
 *
 * Plugin code is never supplied by a peer. A caller must register the exact
 * object with the local trust registry before it can be activated or
 * advertised during a protocol upgrade.
 */
export interface SyncPlugin {
  id: string;
  version: number;
  onBeforeApplyUpdate?: (
    collectionName: string,
    update: Uint8Array,
    fromPeer: string
  ) => Uint8Array | null | Promise<Uint8Array | null>;
  onBeforeSendUpdate?: (
    collectionName: string,
    update: Uint8Array
  ) => Uint8Array | null | Promise<Uint8Array | null>;
}
