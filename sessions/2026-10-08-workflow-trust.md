# RP-ZD-08 workflow trust repair

Base: `feat/offline-indicator` `5bfa543a8e8996f8423a435b7734b4e980cd3b37`. Target: the same
experiment. Main `8099908c36fd1a6f386cdeddcc47fce33d995a2d` has no AI-review, approval-handler or
auto-merge entry, so no corresponding main code patch was needed. The original dirty checkout and
its three uncommitted hardening files were read/copied; no edits were made there. This checkout had
no architecture/session directories at the experimental base; this repair creates project-local
records.

The inherited six-label whitelist, artifact-independent human review policy and head-bound merge
were retained and completed with typed API binding, scoped tokens, trusted checkout,
protected-branch and trusted CI gates. Production policy is shared by all three workflows, with no
PR/artifact execution or approval API.

Validation:

- Exact old workflow source was executed with intercepted mutations. Three desired safety assertions
  failed: model APPROVE invoked `--approve`; an old-SHA bot approval plus unrelated run invoked
  merge; wrong-run artifact data created an APPROVE review and approval label on PR 999. No real
  writes occurred.
- `python3 -m unittest discover -s tests/workflow-trust -v`: 21/21 passed, no skips, including wrong
  run/identity/schema, old SHA, review permission/history, head/base races, skipped/missing CI,
  protection counts and malicious model input.
- Ruff check/format, `git diff --check`, and actionlint 1.7.12 on the three repaired workflows plus
  isolated test workflow pass. The actionlint archive hash matches its official release checksum.
- Product code and dependencies were unchanged; no broad product regression is claimed for this
  workflow-only repair.

External evidence is stored by the coordinating task in `work/zd08-evidence-2026-10-08/`: original
workflow files, adversarial fixtures, legacy-red log, candidate-green log, lint logs and read-only
GitHub settings. The red log contains simulated approval/merge calls intercepted by fixtures.

Delivery remains an unmerged experiment PR. True controlled workflow permission acceptance,
protection/activation conditions and any post-activation observation remain open. No branch
protection changes, approval submissions or real auto-merges were made. Roman, Lychee and Notion
were excluded.
