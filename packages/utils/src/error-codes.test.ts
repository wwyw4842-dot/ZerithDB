import { describe, expect, it } from "vitest";
import { ZerithDBError } from "zerithdb-errors";
import { assertDefined, hexToBytes, withTimeout } from "./index";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the utility to throw");
}

describe("shared utility error codes", () => {
  it.each([null, undefined])("labels absent value %s", (value) => {
    const error = thrownBy(() => assertDefined(value, "value is required"));
    expect(error).toBeInstanceOf(ZerithDBError);
    expect(error).toMatchObject({
      code: "ASSERTION_FAILED",
      message: "value is required",
    });
  });

  it("labels an odd-length hex string", () => {
    const error = thrownBy(() => hexToBytes("f"));
    expect(error).toBeInstanceOf(ZerithDBError);
    expect(error).toMatchObject({
      code: "INVALID_HEX_STRING",
      message: "Invalid hex string length",
    });
  });

  it("labels an expired deadline", async () => {
    const error = await withTimeout(
      () => new Promise<never>(() => {}),
      5,
      "deadline reached"
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ZerithDBError);
    expect(error).toMatchObject({
      code: "TIMEOUT_EXCEEDED",
      message: "deadline reached",
    });
  });

  it.each([0, false, ""])("keeps defined value %s valid", (value) => {
    expect(() => assertDefined(value, "unused message")).not.toThrow();
  });

  it("keeps valid hex conversion", () => {
    expect(hexToBytes("00Ff")).toEqual(new Uint8Array([0, 255]));
  });

  it("keeps a result that settles before its deadline", async () => {
    await expect(withTimeout(() => Promise.resolve("ready"), 5)).resolves.toBe("ready");
  });
});
