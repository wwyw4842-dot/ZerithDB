import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "zerithdb-core";
import type { ZerithDBConfig, Document } from "zerithdb-core";
import { DbClient } from "zerithdb-db";
import type { NetworkManager } from "zerithdb-network";
import { SyncEngine } from "./sync-engine.js";

type Message = { type: string; payload: Uint8Array | string; from: string };
type BusEvents = { message: Message };

class TestNetwork extends EventEmitter<BusEvents> {
  static readonly peers = new Set<TestNetwork>();
  readonly connectedPeerCount = 1;
  constructor(readonly id: string) {
    super();
    TestNetwork.peers.add(this);
  }
  broadcast(message: { type: string; payload: Uint8Array | string }): void {
    for (const peer of TestNetwork.peers) {
      if (peer !== this) peer.emit("message", { ...message, from: this.id });
    }
  }
  async dispose(): Promise<void> {
    TestNetwork.peers.delete(this);
  }
}

const active: Array<{ sync: SyncEngine; db: DbClient; network: TestNetwork }> = [];
let sequence = 0;

async function createReplica(label: string) {
  const appId = `zd04-${label}-${++sequence}`;
  const config = { appId } as ZerithDBConfig;
  const db = new DbClient(config);
  const network = new TestNetwork(label);
  const sync = new SyncEngine(config, db, network as unknown as NetworkManager);
  sync.getDoc("todos");
  await wait(35);
  sync.enable();
  active.push({ sync, db, network });
  return { sync, db, network, appId };
}

async function waitFor(check: () => Promise<boolean>, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(20);
  }
  throw new Error("timed out waiting for replica convergence");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function docsEqual(left: Document[], right: Document[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

afterEach(async () => {
  for (const { sync, db, network } of active.splice(0)) {
    await sync.dispose();
    await db.dispose();
    await network.dispose();
  }
  TestNetwork.peers.clear();
});

describe("SyncEngine CRUD bridge", () => {
  it("projects insert/update/delete to a second replica and notifies subscribers", async () => {
    const first = await createReplica("first");
    const second = await createReplica("second");
    const firstTodos = first.db.collection<{ text: string }>("todos");
    const secondTodos = second.db.collection<{ text: string }>("todos");
    const snapshots: Document[] = [];
    const unsubscribe = secondTodos.subscribe((documents) => snapshots.push(...documents));

    const { id } = await firstTodos.insert({ text: "one" });
    await waitFor(async () => (await secondTodos.findById(id))?.text === "one");

    await secondTodos.update({ _id: id } as any, { $set: { text: "two" } });
    await waitFor(async () => (await firstTodos.findById(id))?.text === "two");

    await firstTodos.delete({ _id: id } as any);
    await waitFor(async () => (await secondTodos.findById(id)) === undefined);
    expect(snapshots.length).toBeGreaterThan(0);
    unsubscribe();
  });

  it("queues offline writes, resolves a deterministic conflict, and restores after restart", async () => {
    const first = await createReplica("offline-first");
    const second = await createReplica("offline-second");
    const firstTodos = first.db.collection<{ text: string }>("todos");
    const secondTodos = second.db.collection<{ text: string }>("todos");

    const { id } = await firstTodos.insert({ text: "base" });
    await waitFor(async () => (await secondTodos.findById(id))?.text === "base");

    first.sync.disable();
    second.sync.disable();
    await firstTodos.update({ _id: id } as any, { $set: { text: "first-offline" } });
    await secondTodos.update({ _id: id } as any, { $set: { text: "second-offline" } });
    first.sync.enable();
    second.sync.enable();

    await waitFor(async () => {
      const left = await firstTodos.findById(id);
      const right = await secondTodos.findById(id);
      return Boolean(left && right && left.text === right.text && left.text !== "base");
    });
    const winner = await firstTodos.findById(id);
    expect(winner?.text === "first-offline" || winner?.text === "second-offline").toBe(true);

    const expected = await firstTodos.find();
    const firstApp = active.find((item) => item.sync === first.sync);
    await first.sync.dispose();
    await first.db.dispose();
    await first.network.dispose();
    if (firstApp) active.splice(active.indexOf(firstApp), 1);
    const config = { appId: first.appId } as ZerithDBConfig;
    const restartedDb = new DbClient(config);
    const restartedNetwork = new TestNetwork("restarted");
    const restartedSync = new SyncEngine(
      config,
      restartedDb,
      restartedNetwork as unknown as NetworkManager
    );
    active.push({ sync: restartedSync, db: restartedDb, network: restartedNetwork });
    restartedSync.getDoc("todos");
    await wait(50);
    expect(docsEqual(await restartedDb.collection("todos").find(), expected)).toBe(true);
    await restartedSync.dispose();
    await restartedDb.dispose();
    await restartedNetwork.dispose();
    active.splice(
      active.findIndex((item) => item.sync === restartedSync),
      1
    );
  });

  it("rolls back a failed sync snapshot without exposing partial rows", async () => {
    const config = { appId: `zd04-rollback-${++sequence}` } as ZerithDBConfig;
    const db = new DbClient(config);
    const collection = db.collection<{ text: string }>("todos");
    const inserted = await collection.insert({ text: "stable" });
    const before = await collection.find();
    const broken = {
      ...before[0],
      text: (() => "cannot be cloned") as unknown as string,
    } as any;

    await expect(collection.applySyncSnapshot([broken])).rejects.toThrow();
    expect(await collection.find()).toEqual(before);
    expect(await collection.findById(inserted.id)).toEqual(before[0]);
    await db.dispose();
  });
});
