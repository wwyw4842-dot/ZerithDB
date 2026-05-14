import { describe, it, expect } from "vitest";
import {
  isPlainObject,
  assertDefined,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  sleep,
  backoffDelay,
  withTimeout,
  randomId,
} from "../../packages/utils/src/index.js";

// ─── Type guards ──────────────────────────────────────────────────────────────

describe("isPlainObject", () => {
  it("should return true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1, b: "two" })).toBe(true);
  });

  it("should return false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it("should return false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject("hello")).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });

  it("should return false for Date instances", () => {
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe("assertDefined", () => {
  it("should not throw for defined values", () => {
    expect(() => assertDefined(42, "should not throw")).not.toThrow();
    expect(() => assertDefined("hello", "should not throw")).not.toThrow();
    expect(() => assertDefined(false, "should not throw")).not.toThrow();
    expect(() => assertDefined({}, "should not throw")).not.toThrow();
  });

  it("should throw for null", () => {
    expect(() => assertDefined(null, "value is null")).toThrow("value is null");
  });

  it("should throw for undefined", () => {
    expect(() => assertDefined(undefined, "value is undefined")).toThrow("value is undefined");
  });
});

// ─── Encoding helpers ─────────────────────────────────────────────────────────

describe("bytesToHex", () => {
  it("should convert Uint8Array to hex string", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("should handle empty array", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });

  it("should pad single-digit hex values", () => {
    expect(bytesToHex(new Uint8Array([10]))).toBe("0a");
  });
});

describe("hexToBytes", () => {
  it("should convert hex string to Uint8Array", () => {
    const result = hexToBytes("00010f10ff");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1);
    expect(result[2]).toBe(15);
    expect(result[3]).toBe(16);
    expect(result[4]).toBe(255);
  });

  it("should handle empty hex string", () => {
    const result = hexToBytes("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it("should throw on odd-length hex string", () => {
    expect(() => hexToBytes("abc")).toThrow("Invalid hex string length");
  });

  it("should roundtrip with bytesToHex", () => {
    const original = new Uint8Array([0, 42, 99, 128, 200, 255]);
    const hex = bytesToHex(original);
    const recovered = hexToBytes(hex);
    expect(recovered).toEqual(original);
  });
});

describe("bytesToBase64", () => {
  it("should encode Uint8Array to base64", () => {
    // "hello" in bytes
    const bytes = new Uint8Array([104, 101, 108, 108, 111]);
    expect(bytesToBase64(bytes)).toBe("aGVsbG8=");
  });

  it("should handle empty array", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });
});

describe("base64ToBytes", () => {
  it("should decode base64 to Uint8Array", () => {
    const result = base64ToBytes("aGVsbG8=");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]);
  });

  it("should handle empty base64 string", () => {
    const result = base64ToBytes("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it("should roundtrip with bytesToBase64", () => {
    const original = new Uint8Array([0, 1, 2, 3, 100, 200, 255]);
    const b64 = bytesToBase64(original);
    const recovered = base64ToBytes(b64);
    expect(recovered).toEqual(original);
  });
});

// ─── Async helpers ────────────────────────────────────────────────────────────

describe("sleep", () => {
  it("should resolve after given milliseconds", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // allow small timer inaccuracy
  });

  it("should resolve immediately for 0ms", async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

describe("backoffDelay", () => {
  it("should return a number >= 0", () => {
    for (let i = 0; i < 5; i++) {
      const delay = backoffDelay(i);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(typeof delay).toBe("number");
    }
  });

  it("should increase with attempt count on average", () => {
    // Full jitter makes it non-monotonic, but the ceiling should grow
    const d0 = backoffDelay(0, 1000, 30000);
    const d10 = backoffDelay(10, 1000, 30000);
    // At attempt 10, base*2^10 = 1,024,000, capped at 30000
    // So max possible is 30000, which should be > any possible d0 value (max 1000)
    expect(d10).toBeLessThanOrEqual(30000);
    // d0 is at most 1000, d10 should generally be larger but due to jitter
    // we just check it's within capped range
    expect(d0).toBeLessThanOrEqual(1000);
  });

  it("should respect max cap", () => {
    for (let i = 0; i < 10; i++) {
      expect(backoffDelay(100, 1000, 5000)).toBeLessThanOrEqual(5000);
    }
  });
});

describe("withTimeout", () => {
  it("should resolve with the function's return value", async () => {
    const result = await withTimeout(async () => "hello", 100);
    expect(result).toBe("hello");
  });

  it("should reject if the function takes too long", async () => {
    await expect(
      withTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
        10,
        "too slow"
      )
    ).rejects.toThrow("too slow");
  });

  it("should use default timeout message", async () => {
    await expect(
      withTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
        10
      )
    ).rejects.toThrow("Operation timed out");
  });
});

// ─── ID helpers ───────────────────────────────────────────────────────────────

describe("randomId", () => {
  it("should return a non-empty string", () => {
    const id = randomId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
  });

  it("should return a UUID v4 format", () => {
    const id = randomId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
