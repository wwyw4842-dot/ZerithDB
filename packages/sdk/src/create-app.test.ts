import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { ZerithDBConfig } from "zerithdb-core";
import { createApp, type ZerithDBApp } from "./create-app.js";

const apps: ZerithDBApp[] = [];
let sequence = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(20);
  }
  throw new Error("timed out waiting for public SDK replicas");
}

function relay(from: ZerithDBApp, to: ZerithDBApp, peerId: string): void {
  (from.network as any).broadcast = (message: { type: string; payload: string | Uint8Array }) => {
    (to.network as any).emit("message", { ...message, from: peerId });
  };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose();
});

describe("createApp public CRUD sync entry point", () => {
  it("installs the bridge through app.db without a manual sync.getDoc call", async () => {
    const first = createApp({ appId: `zd04-sdk-public-a-${++sequence}` } as ZerithDBConfig);
    const second = createApp({ appId: `zd04-sdk-public-b-${sequence}` } as ZerithDBConfig);
    apps.push(first, second);
    relay(first, second, "first");
    relay(second, first, "second");

    const firstTodos = first.db<{ text: string }>("todos");
    const secondTodos = second.db<{ text: string }>("todos");
    first.sync.enable();
    second.sync.enable();
    await wait(60);

    const { id } = await firstTodos.insert({ text: "created through public SDK" });
    await waitFor(
      async () => (await secondTodos.findById(id))?.text === "created through public SDK"
    );
    await secondTodos.update({ _id: id } as any, { $set: { text: "edited through public SDK" } });
    await waitFor(
      async () => (await firstTodos.findById(id))?.text === "edited through public SDK"
    );
    await firstTodos.delete({ _id: id } as any);
    await waitFor(async () => (await secondTodos.findById(id)) === undefined);
  });

  it("drains and closes an immediately opened collection before DB disposal", async () => {
    const app = createApp({ appId: `zd04-sdk-dispose-${++sequence}` } as ZerithDBConfig);
    apps.push(app);
    app.db("todos");
    await app.dispose();
    apps.splice(apps.indexOf(app), 1);
    expect(() => app.sync.getDoc("after-dispose")).toThrow("Sync engine is disposed");
  });
});
