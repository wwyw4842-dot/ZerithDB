import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { NetworkManager } from "./network-manager.js";

vi.mock("simple-peer", () => ({ default: class extends EventEmitter {
  connected = true;
  addStream = vi.fn();
  removeStream = vi.fn();
  destroy = vi.fn(() => this.emit("close"));
  constructor(readonly options: { streams: MediaStream[] }) { super(); }
} }));

function media(id: string) {
  const track = { id: `${id}-audio`, kind: "audio", label: "microphone", enabled: true, muted: false, readyState: "live", stop: vi.fn() };
  const stream = Object.assign(new EventTarget(), { id, getTracks: () => [track] });
  return { stream: stream as unknown as MediaStream, track };
}

describe("NetworkManager media ownership", () => {
  it("publishes to existing and future peers, mutes selected tracks, and removes without stopping caller tracks", async () => {
    const manager = new NetworkManager({ appId: "media" }, {} as never);
    const internal = manager as any;
    internal.createPeer("existing", true);
    const { stream, track } = media("camera");
    const metadata = manager.addMediaStream(stream, { kind: "microphone", label: "fixture" });
    expect(metadata).toMatchObject({ streamId: stream.id, peerId: manager.peerId, kind: "microphone", audioMuted: false });
    expect(internal.peers.get("existing").addStream).toHaveBeenCalledWith(stream);
    internal.createPeer("later", true);
    expect(internal.peers.get("later").options.streams).toEqual([stream]);
    manager.setMediaTrackEnabled("audio", false, stream.id);
    expect(track.enabled).toBe(false);
    expect(manager.getLocalMediaStreamMetadata()[0].audioMuted).toBe(true);
    manager.removeMediaStream(stream.id);
    expect(internal.peers.get("existing").removeStream).toHaveBeenCalledWith(stream);
    expect(manager.getLocalMediaStreamMetadata()).toEqual([]);
    expect(track.stop).not.toHaveBeenCalled();
    await manager.dispose();
    expect(() => manager.addMediaStream(stream)).toThrow("disposed");
  });

  it("emits one remote removal and cleans stream listeners when the peer disconnects", async () => {
    const manager = new NetworkManager({ appId: "media" }, {} as never);
    const internal = manager as any;
    internal.createPeer("remote", true);
    const stream = media("remote-stream").stream;
    const added = vi.fn(), removed = vi.fn();
    manager.on("media:stream", added);
    manager.on("media:stream:removed", removed);
    const peer = internal.peers.get("remote");
    peer.emit("stream", stream);
    peer.emit("stream", stream);
    expect(added).toHaveBeenCalledTimes(1);
    peer.emit("close");
    stream.dispatchEvent(new Event("inactive"));
    expect(removed).toHaveBeenCalledExactlyOnceWith({ peerId: "remote", streamId: stream.id });
    await manager.dispose();
  });
});
