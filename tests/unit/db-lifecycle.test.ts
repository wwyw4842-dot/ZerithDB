import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { DbClient } from "../../packages/db/src/db-client.js";

describe("collection lifecycle", () => {
  it("reports an upgrade blocked by an older connection and can retry after it closes", async () => {
    const appId = `blocked-${crypto.randomUUID()}`;
    const db = new DbClient({ appId });
    await db.collection("a").insert({ text: "preserved" });
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`zerithdb_${appId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await expect(db.collection("b").insert({ text: "blocked" })).rejects.toThrow(
        "Failed to insert"
      );
    } finally {
      held.close();
    }
    await db.collection("b").insert({ text: "retried" });
    expect(await db.collection("a").count()).toBe(1);
    expect(await db.collection("b").count()).toBe(1);
    await db.dispose();
  }, 10_000);

  it("committed writes survive notification failure and dispose releases every subscription", async () => {
    const closed = vi.fn();
    class BrokenChannel {
      onmessage = null;
      postMessage() {
        throw new Error("notifications unavailable");
      }
      close = closed;
    }
    vi.stubGlobal("BroadcastChannel", BrokenChannel);
    const db = new DbClient({ appId: `notifications-${crypto.randomUUID()}` });
    const col = db.collection("a");
    const notified = vi.fn();
    col.subscribe(notified);
    try {
      const { id } = await col.insert({ text: "committed exactly once" });
      expect(await col.findById(id)).toMatchObject({ text: "committed exactly once" });
      expect(await col.count()).toBe(1);
      await db.dispose();
      const calls = notified.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(notified).toHaveBeenCalledTimes(calls);
      expect(closed).toHaveBeenCalledTimes(2);
    } finally {
      await db.dispose();
      vi.unstubAllGlobals();
    }
  });
  it("adds a collection after writing and reopens both collections in any order", async () => {
    const config = { appId: `lifecycle-${crypto.randomUUID()}` };
    const first = new DbClient(config);
    const a = first.collection("a");
    await a.insert({ text: "keep" });
    await first.collection("b").insert({ text: "second" });
    await a.insert({ text: "old handle remains valid" });
    await first.dispose();
    const reopened = new DbClient(config);
    expect(await reopened.collection("b").count()).toBe(1);
    expect(await reopened.collection("a").count()).toBe(2);
    await reopened.dispose();
  });

  it("serializes two instances upgrading different collections without deleting either", async () => {
    const config = { appId: `concurrent-${crypto.randomUUID()}` };
    const first = new DbClient(config);
    const second = new DbClient(config);
    await Promise.all([
      first.collection("a").insert({ n: 1 }),
      second.collection("b").insert({ n: 2 }),
    ]);
    expect(await second.collection("a").count()).toBe(1);
    expect(await first.collection("b").count()).toBe(1);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("does not lose disjoint fields updated concurrently by separate instances", async () => {
    const config = { appId: `updates-${crypto.randomUUID()}` };
    const first = new DbClient(config),
      second = new DbClient(config);
    const { id } = await first.collection("a").insert({ left: 0, right: 0 });
    await Promise.all([
      first.collection("a").update({ _id: id }, { $set: { left: 1 } }),
      second.collection("a").update({ _id: id }, { $set: { right: 2 } }),
    ]);
    expect(await first.collection("a").findById(id)).toMatchObject({ left: 1, right: 2 });
    await Promise.all([first.dispose(), second.dispose()]);
  });
});
