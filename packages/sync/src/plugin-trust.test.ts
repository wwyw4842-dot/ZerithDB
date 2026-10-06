import { describe, expect, it, vi } from "vitest";
import { SyncEngine } from "./sync-engine.js";

describe("SyncEngine trusted plugin negotiation", () => {
  it("never executes peer URLs and accepts one newer trusted revision", async () => {
    let incoming: ((message: { type: string; payload: string; from: string }) => void) | undefined;
    const network = {
      connectedPeerCount: 0,
      on: (event: string, callback: typeof incoming) => {
        if (event === "message") incoming = callback;
      },
      off: vi.fn(),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
    };
    const engine = new SyncEngine(
      { appId: `zd05-${crypto.randomUUID()}` },
      {} as any,
      network as any
    );
    engine.enable();

    const sendOffer = (payload: string) => {
      incoming?.({ type: "sync-upgrade-offer", payload, from: "peer" });
    };
    (globalThis as { __remotePluginExecuted?: boolean }).__remotePluginExecuted = false;
    sendOffer(
      JSON.stringify({
        pluginUrl:
          'data:text/javascript,globalThis.__remotePluginExecuted=true;export default {id:"evil",version:99}',
        version: 99,
      })
    );
    sendOffer("{broken");
    sendOffer(JSON.stringify({ pluginId: "missing", version: 2 }));
    expect(network.sendTo).not.toHaveBeenCalled();
    expect((globalThis as { __remotePluginExecuted?: boolean }).__remotePluginExecuted).toBe(false);

    await expect(engine.loadPlugin("https://example.com/plugin.js")).rejects.toThrow("Untrusted");

    const plugin = { id: "bundled", version: 2 };
    engine.trustPlugin(plugin);
    engine.proposeUpgrade("bundled", 2);
    expect(network.broadcast).toHaveBeenCalledWith({
      type: "sync-upgrade-offer",
      payload: JSON.stringify({ pluginId: "bundled", version: 2 }),
    });

    sendOffer(JSON.stringify({ pluginId: "bundled", version: 3 }));
    expect(network.sendTo).not.toHaveBeenCalled();
    sendOffer(JSON.stringify({ pluginId: "bundled", version: 2 }));
    expect(network.sendTo).toHaveBeenCalledTimes(1);
    expect(() => engine.proposeUpgrade("bundled", 2)).toThrow("stale");
    expect(network.sendTo).toHaveBeenCalledWith("peer", {
      type: "sync-upgrade-accept",
      payload: JSON.stringify({ pluginId: "bundled", version: 2 }),
    });

    // Replays and stale revisions cannot trigger another activation/acknowledgement.
    sendOffer(JSON.stringify({ pluginId: "bundled", version: 2 }));
    expect(network.sendTo).toHaveBeenCalledTimes(1);
    expect(() => engine.registerPlugin({ id: "bundled", version: 1 })).toThrow("Stale");
    expect(() => engine.registerPlugin({ id: "stale", version: 1 })).toThrow("Stale");
    await expect(engine.loadPlugin("stale")).rejects.toThrow("Untrusted");
    expect(() => engine.trustPlugin({ id: "bad id", version: 3 })).toThrow("Invalid");

    delete (globalThis as { __remotePluginExecuted?: boolean }).__remotePluginExecuted;
    await engine.dispose();
  });

  it("fails closed when a local plugin transform rejects or drops an update", async () => {
    const network = {
      connectedPeerCount: 0,
      on: vi.fn(),
      off: vi.fn(),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
    };
    const db = { collection: vi.fn() };
    const engine = new SyncEngine(
      { appId: `zd05-${crypto.randomUUID()}` },
      db as any,
      network as any
    );
    engine.registerPlugin({
      id: "dropper",
      version: 1,
      onBeforeSendUpdate: () => "raw" as any,
      onBeforeApplyUpdate: () => "raw" as any,
    });
    engine.enable();

    await (engine as any).broadcastUpdate("todos", new Uint8Array([1, 2, 3]));
    expect(network.broadcast).not.toHaveBeenCalled();
    await engine.applyRemoteUpdate("todos", new Uint8Array([1, 2, 3]), "peer");
    expect(db.collection).not.toHaveBeenCalled();
    await engine.dispose();
  });

  it.each([
    ["null", () => null],
    [
      "throw",
      () => {
        throw new Error("plugin failure");
      },
    ],
  ])("keeps %s transforms fail-closed on send and apply", async (_label, transform) => {
    const sendNetwork = {
      connectedPeerCount: 0,
      on: vi.fn(),
      off: vi.fn(),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
    };
    const sendEngine = new SyncEngine(
      { appId: `zd05-send-${crypto.randomUUID()}` },
      {} as any,
      sendNetwork as any
    );
    sendEngine.registerPlugin({
      id: `send-${_label}`,
      version: 1,
      onBeforeSendUpdate: transform as any,
    });
    sendEngine.enable();
    await (sendEngine as any).broadcastUpdate("todos", new Uint8Array([1, 2, 3]));
    expect(sendNetwork.broadcast).not.toHaveBeenCalled();
    await sendEngine.dispose();

    const applyNetwork = {
      connectedPeerCount: 0,
      on: vi.fn(),
      off: vi.fn(),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
    };
    const db = { collection: vi.fn() };
    const applyEngine = new SyncEngine(
      { appId: `zd05-apply-${crypto.randomUUID()}` },
      db as any,
      applyNetwork as any
    );
    applyEngine.registerPlugin({
      id: `apply-${_label}`,
      version: 1,
      onBeforeApplyUpdate: transform as any,
    });
    applyEngine.enable();
    await applyEngine.applyRemoteUpdate("todos", new Uint8Array([1, 2, 3]), "peer");
    expect(db.collection).not.toHaveBeenCalled();
    await applyEngine.dispose();
  });
});
