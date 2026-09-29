import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { atomicAddAll, atomicModify, atomicDelete } from "../../packages/db/src/idb-atomic.js";

describe("transaction failure recovery", () => {
  it("rolls back earlier inserts when a later document cannot be cloned", async () => {
    const db = new Dexie(`atomic-${crypto.randomUUID()}`);
    db.version(1).stores({ items: "id" });
    try {
      await expect(
        atomicAddAll(db.table("items"), [{ id: "a" }, { id: "b", invalid: () => {} }])
      ).rejects.toThrow();
      expect(await db.table("items").toArray()).toEqual([]);
    } finally {
      await db.delete();
    }
  });

  it("rolls back earlier updates and deletes when a later cursor callback fails", async () => {
    const db = new Dexie(`atomic-${crypto.randomUUID()}`);
    db.version(1).stores({ items: "id" });
    try {
      const original = [
        { id: "a", value: 0 },
        { id: "b", value: 0 },
      ];
      await db.table("items").bulkAdd(original);
      await expect(
        atomicModify(
          db.table("items"),
          () => true,
          (row: any) => {
            if (row.id === "b") throw new Error("second update failed");
            return { ...row, value: 1 };
          }
        )
      ).rejects.toThrow("second update failed");
      expect(await db.table("items").toArray()).toEqual(original);
      await expect(
        atomicDelete(db.table("items"), (row: any) => {
          if (row.id === "b") throw new Error("second delete failed");
          return true;
        })
      ).rejects.toThrow("second delete failed");
      expect(await db.table("items").toArray()).toEqual(original);
    } finally {
      await db.delete();
    }
  });
});
