# Review and merge workflow trust

The AI review, approval label and auto-merge workflows belong to the `feat/offline-indicator`
experiment. On 2026-10-08, main `8099908c` contains none of these three entries. This repair stays
on the experiment; it does not import experimental product code or activate automation on main.

The existing uncommitted hardening was carried into an isolated checkout and completed in
`.github/scripts/workflow_trust.py`:

- AI output can create one advisory issue comment and the existing six safe type labels. JSON types
  and sizes are checked. Model verdicts never submit GitHub reviews. A `/review` command requires a
  current write/maintain/admin permission from a human. PR text is passed as data, never
  interpolated into shell code.
- The approval label is only an annotation derived from independent human reviews fetched from
  GitHub. Artifact contents and `/approve` commands have no authority. The latest decisive review
  per human is selected by ID across all pages. Approval must be on the current head; an outstanding
  request for changes remains a block until superseded or dismissed. Bots, the PR author and readers
  cannot qualify.
- The merge workflow runs only from `workflow_run`; a PR-controlled review event cannot receive its
  write token. API records must bind repository ID/name, workflow path/ID, run ID/attempt, event, PR
  number, head repository and current SHA. Only the linked PR is inspected. Missing links, malformed
  schemas and stale input fail with a nonzero exit code.
- Auto-merge requires stale-approval dismissal, the configured approval count, strict required
  checks tied to GitHub Actions, a current successful CI check suite, all seven expected CI jobs,
  and no newer CI run. Missing reports or skipped jobs do not pass. Drafts, blocked labels,
  conflict/unknown merge state, incomplete file lists and changes under `.github/` require manual
  handling. The PR head/base are fetched again before a `--match-head-commit` merge; no admin bypass
  or branch deletion is used.
- Privileged workflows check out their own `github.workflow_sha`, disable persisted credentials,
  load no artifacts or PR code, and use only the scoped `github.token`. PAT fallback is removed. The
  AI/label tokens have `pull-requests: read`; they cannot invoke approval endpoints through this
  code.

The read-only `Workflow trust policy` test workflow runs production policy with intercepted API
calls. Its successful mock merge is a policy test, not a real GitHub merge or proof of production
token permissions.

## Activation conditions and limits

Read-only GitHub inspection on 2026-10-08 reported default workflow permission `read`,
`can_approve_pull_request_reviews=false`, and no protection on main or `feat/offline-indicator`.
Only CI and Auto Label were registered. Auto-merge therefore refuses current configuration. No
approval review, branch protection change or real auto-merge was performed during this repair.

`workflow_run` entries must exist on the default branch to execute. A separate reviewed decision to
activate these entries, protected-branch setup, and a controlled real workflow/permission acceptance
remain required. The current branch's CI does not target `feat/offline-indicator`; the new isolated
policy test does, without secrets or write permissions. If a real run lacks the required PR links or
uses a merge SHA instead of the linked head, the policy refuses it; that schema must be investigated
without weakening identity checks.

Reviews submitted after CI completion do not trigger the merge workflow. A new CI completion is
needed, or a maintainer can merge manually. This avoids a PR-sourced write workflow.

Other experimental workflows were only inspected: `ci-failure-reporter.yml` still has PAT fallback
and resolves a comment target by branch name; `level-labeler-handler.yml` still trusts
artifact-selected labels. These files are not approval or merge authority in this policy and are
outside this patch's assigned file scope. They need separate historical/activation review.

Rollback: revert the workflow-policy commit on the experiment. Prefer disabling automation rather
than reactivating the old approval/artifact behavior. There are no database, public API or
product-code changes.

References:
[workflow identity context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts),
[workflow_run behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
