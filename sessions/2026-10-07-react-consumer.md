# ZD-04 React consumer follow-up

Base: delivery branch `fix/rp-zd-03-schema-rollback` at PR #9 merge
`4d4fcfac155d1cc097e7e83c5400e3633368c4ca`. Independent owned worktree `zerith-zd04-react`; user
dirty main/offline checkouts untouched.

The exact old built React package crashes in Chromium with `db.collection is not a function`; its
hook additionally passed a bare string to collection.delete and its provider did not release the
SDK. Fix public `app.db` binding, `_id` delete filter, app/collection snapshot ownership, error
propagation and StrictMode-safe lifecycle disposal.

Evidence: `pnpm exec tsc --noEmit -p packages/react/tsconfig.json`, `pnpm test` (11 builds, 49/49
tests in 8 files), and `pnpm test:browser` (cross-context Web Locks/fallback 10 trials each, legacy
schema rollback plus 4 React consumer scenarios) pass. New five-test ownership/lifetime regression
covers late results and errors, collection/app switches, delete identity, failed-read recovery and
StrictMode cleanup.

Seven local package tarballs (core/auth/db/network/sync/sdk/react) installed with React18.3.1 into a
new separate consumer.
`ZERITH_CONSUMER_ROOT=<isolated consumer> node tests/browser/react-consumer.cjs` passes the same 4
cases on Chromium153.0.8010.12; no workspace symlinks or real user profile/data are used by the
installed consumer. Acceptance bundler uses the published `simplepeer.min.js` browser bundle; no
claim of universal bundler compatibility or real cross-device sync. Registry authentication, actual
app release and 30-minute/24-hour observation remain open.

Coordinator retains logs under `work/zerith-react-*` and tarballs under
`outputs/zerith-react-consumer`. Rollback: revert this mechanism commit; no schema/data migration.
