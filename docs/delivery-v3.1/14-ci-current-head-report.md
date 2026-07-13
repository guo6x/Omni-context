# 14 — Current HEAD CI report

Status: `FIXED`

Qualification commit `d5a667a318bb39446b472dd885a73e497334ab02` completed Continuous Integration #24 successfully:

https://github.com/guo6x/Omni-context/actions/runs/29273086507

All nine enforced jobs are `success`: `secret-scan`, `dependency-audit`, `brain-server`, `desktop-web`, `desktop-rust`, `browser-extension`, `mobile`, `benchmark-scripts`, and `windows-smoke`.

The preceding evidence commit exposed a genuine CI race in `failed-tasks.test.ts`: one test left a fire-and-forget retry job mutating the shared batch during the next test. Run #23 failed Brain at that assertion. Commit `d5a667a318bb39446b472dd885a73e497334ab02` waits for the async job terminal state, records HTTP/status diagnostics on timeout, passed the focused file 10 consecutive times, passed Brain 243/243 locally, and then passed the real Brain CI job. The failure was fixed rather than ignored or rerun unchanged.

The candidate manifest/report child receives its own current-HEAD run before the candidate tag is created. Its final URL is recorded in the annotated candidate tag and final handoff because committing that URL into the same commit is self-referential.

Evidence: `evidence/14-current-head-ci.log`, `evidence/14-brain-flake-reproduction-fix.log`, `evidence/16-brain-full-regression.log`.
