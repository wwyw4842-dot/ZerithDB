# Social recovery availability

This guard belongs to `feat/offline-indicator`, based on
`3fbc5ecb2788b87ff12a00b7405d193f5de7d890`. Main `8099908c` has no
`wasm-crypto` package. Do not merge the experimental feature set into main to
deliver this guard.

`AuthManager.recoverySupported` is false. Both recovery methods always reject
with the existing structured Auth error codes, before reading shares, accessing
WASM, generating an identity, emitting identity changes or writing storage.
The setup/restore components mount an unavailable notice when capability is not
explicitly true. Their interactive children are not mounted, so users cannot
enter or copy shards or start recovery. The component props and original
interactive implementation are retained for a later independently reviewed
implementation. The capability alone cannot enable the Auth methods.

The Auth guard was inherited from an uncommitted local repair. It was absent
from the actual delivery branch, whose components called missing methods.
Earlier coordination records that described this guard must not be interpreted
as evidence of a committed or released feature.

The required core prerequisite corrects its stale error re-export to the
already-declared `zerithdb-errors` dependency. Historical commit `38bec074`
moved the error class there but left core pointing at the deleted file. No
second error class or new error code is introduced.

## Crypto work remains open

This change does not alter the embedded WASM, AssemblyScript arithmetic,
loader, random source, allocator or base64 share bytes. It does not make
recovery safe or validate old shares. `packages/wasm-crypto` remains a private,
unvalidated low-level package; the public Auth methods never call it.

The diagnostic command below uses only synthetic bytes and deliberately exits
1 while the 14 known failures remain. It pins the original artifact and
assembly source hashes. A fixed seed is supplied only to direct diagnostic
instances to get past the independent missing-import failure, never to the
application loader. The source-table reconstruction and actual WASM results
are labelled separately.

1. The public loader omits the required `env.seed` import.
2. Generator 2 under polynomial `0x11b` spans only 51 nonzero elements. The
   source-table reconstruction disagrees with independent carryless polynomial
   multiplication for 62,220 of 65,536 pairs. The independent oracle passes
   eight published arithmetic vectors from
   [NIST FIPS 197, section 4.2](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf#page=17).
3. Ten additional independently constructed linear-polynomial recovery vectors
   all fail in the unchanged WASM. These are not a claim to have recovered the
   historical plan's original ten-vector fixture.
4. `alloc(70000)` returns 1024 with only 65,536 memory bytes; the next pointer
   is 71024. The diagnostic performs no out-of-bounds host write.
5. The diagnostic legacy 2-of-3 split/recover returns zero bytes.

Unversioned shares contain only `[x, y...]`; they do not carry threshold, total,
version or provenance. Silently replacing arithmetic cannot identify or safely
migrate previously corrupted shares. Required follow-up: a documented format
and migration/rejection decision, independent cryptographic review, CSPRNG and
failure handling, input and memory bounds, isolated/concurrent calls, and
cross-implementation vectors. Only then can synthetic identity recovery and
authorized real-key acceptance be considered. Preserve existing identity and
old evidence until then.

## Verification

From the repository root, using the isolated, locked test harness:

```sh
npm ci --prefix tests/recovery-harness --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix tests/recovery-harness
npm test --prefix tests/recovery-harness
npm run browser --prefix tests/recovery-harness
node scripts/diagnostics/zd06-legacy-vectors.mjs
```

The last command is a diagnostic red suite, not a passing CI test and not
part of the normal unit suite. Treat its nonzero exit and failed fields as
unresolved defects, never as successful recovery acceptance.

The browser command requires Playwright Chromium (install with
`npx --no-install playwright install chromium` from `tests/recovery-harness`).
It uses a fresh browser context, a loopback-only fixture,
actual Auth and UI source, and synthetic keys. No user profile or external
site is accessed. It checks missing controls, refused calls, stable identity,
persisted bytes and signature, and zero identity/callback events. This is
component acceptance, not an end-to-end release of an application route.

The experimental branch has pre-existing dependency-lock drift in
`infra/signaling-server`; a frozen full-workspace install fails. Local evidence
initially used existing installed dependencies. The dedicated recovery workflow
now installs only `tests/recovery-harness/package-lock.json` and runs the actual
errors/core/auth/UI sources; aliases select dependency locations, not substitute
implementations. This focused workflow does not replace the original full
workspace checks or resolve their lockfile drift. Its status must be checked on
the exact review head before merge.

Rollback: reverting this guard changes no stored data. Keep the unavailable
behavior until the crypto gate is met; reverting must not be used to enable
the unvalidated recovery implementation.
