// Diagnostic only: this deliberately exits 1 while the legacy defects remain.
// It never uses user keys, storage or the AuthManager recovery entry points.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("../../packages/wasm-crypto/src/wasm-base64.ts", import.meta.url),
  "utf8"
);
const bytes = Buffer.from(source.match(/wasmBase64\s*=\s*"([^"]+)"/)[1], "base64");
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha256,
  "a3ece930491cd693f44598bc55366a844127bb1c0ab3fe86c228c456872c066f",
  "Legacy artifact changed; review the fixture before running it against another artifact"
);
const assembly = readFileSync(
  new URL("../../packages/wasm-crypto/assembly/index.ts", import.meta.url)
);
const assemblySha256 = createHash("sha256").update(assembly).digest("hex");
assert.equal(
  assemblySha256,
  "87eab654769fc2da391ca52ceaa037c637b759ea2e9f1f29b0182e336bdb21b3",
  "Legacy arithmetic source changed; review the source reconstruction before reuse"
);

// Independent carryless polynomial multiplication/reduction, not log tables.
// NIST FIPS 197-upd1 section 4.2: x^8+x^4+x^3+x+1; 0x57*0x13=0xfe.
function referenceMultiply(a, b) {
  let polynomial = 0;
  for (let i = 0; i < 8; i++) if ((b >>> i) & 1) polynomial ^= a << i;
  for (let i = 14; i >= 8; i--) if ((polynomial >>> i) & 1) polynomial ^= 0x11b << (i - 8);
  return polynomial;
}
const nist = [
  [0x57, 2, 0xae],
  [0x57, 4, 0x47],
  [0x57, 8, 0x8e],
  [0x57, 0x10, 7],
  [0x57, 0x20, 0x0e],
  [0x57, 0x40, 0x1c],
  [0x57, 0x80, 0x38],
  [0x57, 0x13, 0xfe],
];
for (const [a, b, expected] of nist) assert.equal(referenceMultiply(a, b), expected);

// Source-level reconstruction is labelled separately from actual WASM results.
const exp = new Uint8Array(256),
  log = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
  exp[i] = x;
  log[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11b;
}
exp[255] = exp[0];
const legacyMultiply = (a, b) => (!a || !b ? 0 : exp[(log[a] + log[b]) % 255]);
let mismatches = 0;
const examples = [];
for (let a = 0; a < 256; a++)
  for (let b = 0; b < 256; b++) {
    const got = legacyMultiply(a, b),
      expected = referenceMultiply(a, b);
    if (got !== expected) {
      mismatches++;
      if (examples.length < 5) examples.push({ a, b, got, expected });
    }
  }

const checks = [];
try {
  await WebAssembly.instantiate(bytes, {
    env: {
      abort() {
        throw Error("WASM abort");
      },
    },
  });
  checks.push({ id: "loader-imports", pass: true });
} catch (error) {
  checks.push({ id: "loader-imports", pass: false, error: String(error) });
}
// Fixed seed is ONLY a diagnostic import to get past the earlier loader failure.
// These instances are never returned to application code; it is not secure RNG.
async function diagnosticInstance() {
  return (
    await WebAssembly.instantiate(bytes, {
      env: {
        abort() {
          throw Error("diagnostic abort");
        },
        seed: () => 42,
      },
    })
  ).instance.exports;
}
checks.push({
  id: "finite-field-all-products",
  pass: mismatches === 0,
  sourceReconstruction: true,
  productsChecked: 65536,
  mismatches,
  examples,
  uniqueNonzeroExpElements: new Set(exp.slice(0, 255)).size,
});
const vectorInputs = [
  [0x53, 0xa7, 1, 2],
  [0x53, 0xa7, 1, 3],
  [0x53, 0xa7, 2, 3],
  [0x03, 0x01, 1, 2],
  [0x5a, 0x91, 1, 2],
  [0xff, 0x01, 1, 3],
  [0x80, 0x13, 5, 7],
  [0x37, 0x57, 9, 11],
  [0xa4, 0x02, 13, 17],
  [0x01, 0x55, 31, 255],
];
for (const [constant, coefficient, x1, x2] of vectorInputs) {
  const wasm = await diagnosticInstance();
  const points = [x1, x2].map((coordinate) => [
    coordinate,
    constant ^ referenceMultiply(coefficient, coordinate),
  ]);
  const ptr = wasm.alloc(4);
  new Uint8Array(wasm.memory.buffer).set(points.flat(), ptr);
  const out = wasm.recoverSecret(ptr, 2, 1);
  const recovered = new Uint8Array(wasm.memory.buffer)[out];
  checks.push({
    id: `linear-polynomial-${checks.length - 1}`,
    pass: recovered === constant,
    coefficients: [constant, coefficient],
    points,
    expected: constant,
    recovered,
    actualWasm: true,
  });
}
{
  const wasm = await diagnosticInstance();
  const size = 70000,
    ptr = wasm.alloc(size);
  checks.push({
    id: "allocation-capacity",
    pass: ptr + size <= wasm.memory.buffer.byteLength,
    pointer: ptr,
    requestedBytes: size,
    memoryBytes: wasm.memory.buffer.byteLength,
    nextPointer: wasm.alloc(1),
    actualWasm: true,
  });
}
{
  const wasm = await diagnosticInstance();
  const ptr = wasm.alloc(3);
  new Uint8Array(wasm.memory.buffer).set([3, 90, 255], ptr);
  const out = wasm.splitSecret(ptr, 3, 2, 3);
  const shares = new Uint8Array(wasm.memory.buffer, out, 12).slice();
  wasm.freeAll();
  const input = wasm.alloc(8);
  new Uint8Array(wasm.memory.buffer).set([...shares.slice(0, 4), ...shares.slice(8, 12)], input);
  const recoveredPtr = wasm.recoverSecret(input, 2, 3);
  const recovered = [...new Uint8Array(wasm.memory.buffer, recoveredPtr, 3)];
  checks.push({
    id: "legacy-two-of-three",
    pass: JSON.stringify(recovered) === "[3,90,255]",
    expected: [3, 90, 255],
    recovered,
    diagnosticSeed: 42,
    actualWasm: true,
  });
}
const report = {
  scope: "synthetic legacy diagnostic; not recovery approval",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  artifact: { sha256, bytes: bytes.length, assemblySha256 },
  standard: "https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf#page=17",
  referenceOracle: {
    nistVectorsPassed: nist.length,
    arithmetic: "carryless product followed by polynomial long division",
  },
  precondition:
    "Only direct diagnostic instantiation supplies fixed env.seed=42; original public loader remains unchanged and fails independently.",
  checks,
  failed: checks.filter((check) => !check.pass).length,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failed ? 1 : 0;
