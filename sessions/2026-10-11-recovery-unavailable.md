# ZD-06 safe availability gate

Target: `feat/offline-indicator`, baseline `3fbc5ecb2788b87ff12a00b7405d193f5de7d890`.
Roman, Lychee and Notion were excluded. Existing dirty worktrees were only
read; work was done in the clean `fix/zd06-crypto-boundaries` branch.

The recorded safe-disabled Auth patch was still uncommitted in an older
checkout. The real branch had two UI components invoking missing recovery
methods and no capability flag. This repair reuses that Auth refusal and adds
the matching UI unavailable state. It does not enable or rewrite recovery.

The first Auth regression attempt encountered core's stale export of a deleted
error file. Historical `38bec074` moved that file into the already-declared
`zerithdb-errors` package. A separate minimal export correction restores the
real shared error class; no test mock substitutes it. After this prerequisite,
all six desired Auth/UI safety assertions failed on the old implementation.
The inherited timing-safe suite remained unchanged.

Validation records are held by the coordinating task under
`work/zd06-evidence-20261011/`: exact baseline, 14 known crypto diagnostic
failures, original UI/Auth red runs, gate green run, typecheck and isolated
Chromium receipts. The browser uses actual source and synthetic identities,
verifies both refusal paths and stable identity/storage/signatures, and sees
two unavailable notices with no interactive recovery control or page error.
No production recovery, real user data, credential, package publication or
application deployment was involved.

The unchanged legacy crypto diagnostic has eight successful NIST arithmetic
oracle checks but 14 failing product checks. All failure evidence remains
open. See `architecture/recovery-gate.md` for the compatibility boundary and
required format/crypto review. This gate is not completion of ZD-06.

Full frozen dependency install is blocked by existing signaling-server
manifest/lock drift. Local focused tests reused installed dependency trees;
no full-workspace build/CI success is claimed. Delivery review and exact-head
CI status are tracked separately by the coordinator.
