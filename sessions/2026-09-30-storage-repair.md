# Non-Roman storage repair handoff

Target: `main`, starting at `7606b61ac94e1bb0e237662f4d8ea02e6eef528b`. Reused the prior RP-ZD-01/02
atomic-write and filter patch; did not replace its mechanism. This checkout is distinct from the
`feat/offline-indicator` worktree.

Validation: normal workspace build passes all 11 build tasks. Root test command formerly delegated
to zero package tests; it now builds and runs the root Vitest suite. The suite has 34 passing tests
in four files, including partial-add/update/delete rollback, notification failure, disposal, dynamic
collections, reopen, and blocked schema recovery. Browser regression uses actual built `dist`
packages and real Chromium with two separate pages. It performs ten trials each with and without Web
Locks: competing collection additions, concurrent disjoint updates, and reopen. The pre-fix no-lock
scenario lost collection a (`a=0,b=1`); the native add-store upgrade preserves both. Typecheck has
15 tasks. CI now runs the real root tests and the Chromium regression.

Original counterexamples: 2026-09-27 desktop-data audit logs and RP-ZD-02 evidence map nested
filters, unset, metadata protection, and partial writes. All new tests retain product assertions; no
zero-check or missing-report success is counted.

Independent review: coordinator reviewed notification failure/disposal and the native schema
migration; its blocked-open lifecycle finding is covered by the bounded wait and retry regression.
No service or production release has happened. ZD-04 DB-to-Yjs persistence wiring, remote-service
backup/recovery, SDK/React integration, experimental-branch plugin/CI/media changes, and publishing
remain open. Roman is excluded.
