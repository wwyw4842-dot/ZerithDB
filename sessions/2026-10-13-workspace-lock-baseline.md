# Reconcile the experimental workspace lock

Target: `feat/offline-indicator`, exact baseline
`c73fca46470caa5675efd2f39d2b187c2da7bb80`. This change updates only the lock and
its regression check. It does not merge the experimental branch into main,
enable social recovery, modify crypto/Auth/UI, install an application or
change customer data.

The first complete frozen install failed at signaling-server's eight fixed
OpenTelemetry dependencies. Checking all 27 workspace manifests found six
missing importers (both examples, datadog, errors, svelte and refs), three
missing Monaco/Prism entries in web, shared errors links in core/network/sdk/
utils, and two core config specifiers recorded as `workspace:*` instead of
`*`. The config links themselves are unchanged. pnpm also requires the db/sdk
optional zod peer importer entries: a separately retained minimalization
attempt without them failed frozen validation. No manifest was changed.

The generated resolver candidate was not accepted wholesale. Existing record
order is retained and new records appended; the final ordering-only adjustment
was followed by another frozen install. Existing importer
versions, all 1,116 package records and all 1,117 snapshot records are retained;
312 package records and 316 snapshots supply the missing dependency closures.
All 178 original importer versions stay intact, including TypeScript 5.9.3 and
AssemblyScript 0.27.37. No previously locked version is upgraded. New importer
closures can contain additional versions required by their manifests/peers.
The preservation guard compares the exact old records and original version
strings, with four deliberately bad in-memory inputs proving that removals,
record mutations and a version replacement fail. pnpm itself remains the YAML
and resolution validator; the guard is not a general YAML parser.

## Actual local validation

Node 24.16.0 and repository-pinned pnpm 10.24.0, including the subprocess pnpm
chain. HOME, registry config, cache, store and temporary directories are private
to the task. Husky setup is disabled; pnpm's default dependency build-script
policy remains unchanged and is recorded in the install logs.

- Original frozen install: exit 1, `ERR_PNPM_OUTDATED_LOCKFILE`, eight missing
  signaling dependencies. The signaling-only intermediate patch then exposed
  the missing errors importer; that failed evidence is retained.
- Complete repaired frozen install: exit 0 over all 27 workspace projects.
  The original-command prerequisite: exit 0, 1.311 seconds with the populated
  private store. Final source-freeze check: exit 0, 1.087 seconds.
  The preceding first complete install took 20.061 seconds, exit 0. The lock
  remained unchanged.
- `pnpm build`: exit 1. Turbo reports 8 successful of 9 started tasks, zero
  cached; 14 further command tasks did not start. utils DTS compilation uses
  nonexistent `ErrorCode.ASSERTION_FAILED`, `INVALID_HEX_STRING` and
  `TIMEOUT_EXCEEDED` members. This source defect is not fixed by a lock update.
- `pnpm typecheck`: exit 2. Turbo reports 8 successful of 17 started tasks,
  including four cache hits; nine further command tasks did not start.
  cli's `src/commands/init.ts` relative import lacks the extension required by
  NodeNext. Other running tasks were interrupted by the first failure; their
  cancellation is not an independent product diagnosis.
- `pnpm test`: exit 1 at the utils build dependency. Turbo reports 9 successful
  of 15 started tasks, including four cache hits; seven further command tasks
  did not start. Only refs completed a reported test suite: one file, 15 tests
  passed, no reported skips. Four packages (core, cli, auth, utils) use the
  original `--passWithNoTests` and completed with zero test files. db, graphql
  and datadog test tasks started but were interrupted, with no final suite
  report. This is not full test-suite acceptance, and successful Turbo task
  counts must not be mistaken for test counts.

The unchanged recovery refusal remains in place. The original build produced
no tracked WASM/source differences. Full-workspace build/typecheck/test defects
remain open. A narrow CI gate checks the stale-lock counterexample, the
preservation guard, and the complete frozen install on Node 20 and 24.16.0; it
does not replace the original project CI or turn these failed commands green.
At preparation time GitHub Actions billing/spending restrictions prevent new
jobs from starting elsewhere in this delivery queue. No new run or Linux pass
is claimed here; exact-head CI and independent review are required before
merge.

Evidence is retained by the coordinating task in
`work/zerith-build-evidence-20261013/`: baseline source hashes, all resolver and
install failures, static manifest diff, record-retention proof, raw original
command logs, planned and observed task coverage, and the frozen source
manifest. The first author version of the preservation diagnostic did not
recognize inline `{}` snapshot mappings; its failure and source are retained
separately. Correcting that parser did not alter product code or relax pnpm.

Rollback is a source revert of this lock/guard change. It does not alter any
stored identity or database, and restores the known non-installable lock; it
is not an application/data rollback or a recovery implementation.

## Independent CI review correction

The lock/closure and original command evidence passed independent review. The
review found that a successful `tee` could hide a failed guard or install under
GitHub's implicit shell. The job now explicitly uses `bash`, whose GitHub
invocation includes `-e -o pipefail`; local producer-exit controls (42 and 43)
propagate through the successful `tee`, and the following sentinel never runs.
A 15-minute job timeout bounds dependency network work. The old baseline gate
requires exact c73f, a nonzero exit and `ERR_PNPM_OUTDATED_LOCKFILE`, without
assuming which of its multiple stale importers fails first. This correction
changes no lock bytes and does not rerun the large install or failed suites.
