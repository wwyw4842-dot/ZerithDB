import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthManager } from "./auth-manager";
import { ZerithDBError as PublicError } from "zerithdb-core";
import { ZerithDBError as SharedError } from "zerithdb-errors";

describe("unavailable social recovery", () => {
  let writes: ReturnType<typeof vi.fn>;
  let removes: ReturnType<typeof vi.fn>;
  let values: Map<string, string>;
  let auth: AuthManager;

  beforeEach(() => {
    values = new Map();
    writes = vi.fn((key: string, value: string) => values.set(key, value));
    removes = vi.fn((key: string) => values.delete(key));
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: writes,
      removeItem: removes,
    });
    auth = new AuthManager({ appId: "synthetic-recovery-disabled-test" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("advertises that recovery is unavailable", () => {
    expect(auth.recoverySupported).toBe(false);
  });

  it("preserves the shared structured error class on the public core export", () => {
    expect(PublicError).toBe(SharedError);
  });

  it("rejects both operations while signed out without storage or WASM access", async () => {
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    const changed = vi.fn();
    auth.on("identity:change", changed);
    await expect(auth.generateRecoveryShards(2, 3)).rejects.toMatchObject({
      code: "AUTH_KEY_GENERATION_FAILED",
    });
    await expect(auth.recoverIdentity(["AfQ=", "AgY="])).rejects.toMatchObject({
      code: "AUTH_VERIFY_FAILED",
    });
    expect(auth.identity).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(instantiate).not.toHaveBeenCalled();
  });

  it("preserves an existing synthetic identity, signature and persisted bytes", async () => {
    const identity = await auth.signIn();
    const input = new TextEncoder().encode("synthetic recovery refusal");
    const signature = await auth.sign(input);
    const digest = () =>
      createHash("sha256")
        .update(JSON.stringify([...values]))
        .digest("hex");
    const before = digest();
    const changed = vi.fn();
    auth.on("identity:change", changed);
    writes.mockClear();
    await expect(auth.generateRecoveryShards(2, 3)).rejects.toThrow("not available");
    await expect(auth.recoverIdentity(["AfQ=", "AgY="])).rejects.toThrow("not available");
    expect(auth.identity).toBe(identity);
    expect(digest()).toBe(before);
    expect(await auth.sign(input)).toBe(signature);
    expect(await auth.verify(input, signature, identity.publicKey)).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("rejects before reading any supplied share or validating parameters", async () => {
    const shards = new Proxy([] as string[], {
      get() {
        throw new Error("must not inspect supplied shares");
      },
    });
    await expect(auth.recoverIdentity(shards)).rejects.toThrow("not available");
    await expect(auth.generateRecoveryShards(NaN, Infinity)).rejects.toThrow("not available");
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });
});
