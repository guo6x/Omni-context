# AI Remote Verify — minimal no-Codex execution pilot

This is a narrowly scoped **GitHub Actions** test runner for `guo6x/Omni-context`. It does not deploy, publish, merge, call AI/media APIs, or run Codex CLI.

## How to trigger after this workflow reaches the default branch

**Through the already-connected GitHub app:** create a GitHub Issue in this repository with the title **exactly** `[AI-RUN] benchmark`. The Issue body is ignored. The Workflow only schedules its benchmark job when the actor is `guo6x` or `chatgpt-codex-connector[bot]`; it never executes issue contents. Check that the connector-created Issue has one of these actors before depending on this path.

**Manual fallback:** open GitHub Actions → **AI Remote Verify - Benchmark** → Run workflow.

GitHub only processes issue-triggered workflows from the default branch, so an open draft PR is intentionally inert until reviewed and merged. Do not auto-merge this PR.

## Fixed actions

1. Check out `main` without persisting credentials.
2. Use Node.js 22 on a standard Ubuntu runner.
3. `cd benchmark && npm ci --ignore-scripts --no-fund --no-audit`
4. `cd benchmark && npm test`

No user-specified command, remote URL, branch, file path, or external secret is interpreted as executable input. The job is limited to 8 minutes and has `contents: read` GitHub token permissions. The two official actions are pinned to immutable commit SHAs.

## Observing the actual outcome

After a request, use GitHub Actions workflow runs and job steps/logs, not merely the existence of a run or an empty commit status. Report:

- repository, source issue number and URL (or manual trigger),
- run ID and URL, main commit SHA,
- queued / in_progress / completed and the exact recorded conclusion,
- meaningful failing step/log excerpt when available.

Treat empty, absent, queued, timed-out, or unreadable status as **UNKNOWN / INCOMPLETE**, never PASS. Do not automatically create a duplicate request on uncertainty.

## Guardrails

- No production changes, deployments, secrets, notifications, media calls, or paid models.
- Issue-based triggers are intentionally constrained to a single deterministic suite.
- Runners execute checked-out project code and dependencies; do not add secrets to the workflow or permit arbitrary PR refs without a new security review.
- This repository is public: standard GitHub-hosted Actions usage is currently free under GitHub's public-repository rules. GitHub plan/abuse and usage policies still apply. The job has a short timeout.
- This pilot is **not** a persistent local-Windows installed-app acceptance test and should not be presented as one.
- It is **not** yet a separately installed private Site/MCP plugin; it uses the existing connected GitHub plugin to submit and observe requests.

## Future extensions

Only after one end-to-end verified run: add explicit approved suites for other repositories, duplicate request suppression, optional private task-center evidence links, and (if connector eligibility/authorization permits) a dedicated Site MCP tool. Never accept arbitrary shell as tool input.
