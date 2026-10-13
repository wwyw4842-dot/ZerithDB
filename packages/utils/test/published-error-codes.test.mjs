import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as esmUtils from "zerithdb-utils";
import { ZerithDBError as EsmError } from "zerithdb-errors";

const require = createRequire(import.meta.url);
const consumers = [
  ["ESM", esmUtils, EsmError],
  ["CJS", require("zerithdb-utils"), require("zerithdb-errors").ZerithDBError],
];

for (const [format, utils, ErrorType] of consumers) {
  const matches = (code, message) => (error) =>
    error instanceof ErrorType && error.code === code && error.message === message;

  test(`${format} package assertion error has its shared code`, () => {
    assert.throws(
      () => utils.assertDefined(null, "required by consumer"),
      matches("ASSERTION_FAILED", "required by consumer"),
    );
  });

  test(`${format} package hex error has its shared code`, () => {
    assert.throws(
      () => utils.hexToBytes("f"),
      matches("INVALID_HEX_STRING", "Invalid hex string length"),
    );
  });

  test(`${format} package timeout error has its shared code`, async () => {
    await assert.rejects(
      utils.withTimeout(() => new Promise(() => {}), 5, "consumer deadline"),
      matches("TIMEOUT_EXCEEDED", "consumer deadline"),
    );
  });
}
