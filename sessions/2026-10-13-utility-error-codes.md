# Shared utility error codes

Target `feat/offline-indicator`; baseline is C0's actual merge
`1d9e081adc7e805ee0449aaaad01e28d612842ac`. Product changes only add the three
string ErrorCode members already referenced by utils: `ASSERTION_FAILED`,
`INVALID_HEX_STRING`, and `TIMEOUT_EXCEEDED`. Existing codes, the shared error
class, utility behavior/messages, module formats and public configuration stay
unchanged. Crypto, recovery capability, Auth, UI and installed applications are
untouched.

The centralization commit `38bec074064e37d5ee6b3458dfa193321bda162b` changed the
three utility throws to use these members but omitted them from its new shared
enum. On the exact current baseline, the original utils build fails with the
three TS2339 errors. New literal-code assertions produce four real failures
(null, undefined, odd hex length and deadline expiration), while the other 20
source cases pass. That baseline includes all 13 original core and two original
base64 tests; their files remain byte-for-byte unchanged.

With the three enum additions, the original errors/utils builds and utils
`typecheck` succeed. The same three source test files report 24 tests passing,
zero failures/errors/skips. This includes nine new utility contract cases and
15 original cases. A Node test then imports and requires the actual package
names through their declared exports after building: six additional ESM/CJS
consumer cases pass and confirm shared class identity, literal code and message.
This consumes workspace-built packages, not an npm publication or actual user
application installation. Node 24.16.0/pnpm 10.24.0 use a private HOME and the
coordinating task's package-only dependency cache.

The focused CI runs the unchanged frozen workspace install and those build,
typecheck and 24+6 tests on Node 20 and 24.16.0. Every command has normal failure
semantics; explicit Bash preserves failures through tee, the job is limited to
15 minutes, and report validation rejects missing, empty, failed or skipped
results. Existing original build/test failure evidence is retained under the
coordinator's `work/zerith-utils-errors-evidence-20261013/`.

The full workspace test discovery issue remains open: running each package's
script from its directory inherits root include patterns and can report zero
files despite existing tests. The focused tests deliberately execute explicit
files from the repository root; they do not repair or replace the original
runner. No complete-workspace build/test success is claimed. CLI's independent
NodeNext import fix belongs to its separate change, and the next full workspace
run follows integration of both mechanisms.

Rollback is a source revert; it changes no stored data and restores the known
undefined utility codes/build failure. No migration or live rollback occurs.
