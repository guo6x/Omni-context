# Goal24 Checkpoint 4 — Lane B: GitHub Read-Only Semantic Capability Catalog

- Lane: `B — GITHUB CAPABILITIES`
- Base SHA: `8238c350e56bcbf486a2e484287bcad66fda6174` (`origin/dev/goal24-cli-skills`)
- Status: `LANE_B_COMPLETE`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp4-github-capabilities`
- Local branch: `local/cp4-github-capabilities` (no push)

## Scope

This lane defines the Brain Server semantic capability layer for the five
GitHub read-only capabilities. A capability is **WHAT** the system may do,
never **HOW** it is transported.

Explicitly out of scope for this lane:

- Rust GitHub CLI Adapter (Lane A owns transport binding).
- Skill Registry runtime (Checkpoint 5).
- GitHub writes (roadmap only; not defined).
- Evidence Guard runtime (Checkpoint 6).

## Capabilities defined

All five definitions share:

- `version = "1.0.0"`
- `required_authority = "L0"`
- `risk_level = "low"`
- `reversible = false`
- `side_effect_class = "read_only"`
- `rollback_capability = undefined`
- `verification_capability = undefined`
- `required_evidence = []` (these are read-only evidence acquisition
  operations themselves; no fabricated evidence loop)

| Capability id | Inputs |
| --- | --- |
| `github.repo.inspect` | `owner`, `repo` |
| `github.issue.search` | `owner`, `repo`, `query?`, `state?: open\|closed\|all`, `limit?: 1..100` (default 30) |
| `github.issue.read` | `owner`, `repo`, `number` (positive integer) |
| `github.pr.read` | `owner`, `repo`, `number` (positive integer) |
| `github.pr.checks.read` | `owner`, `repo`, `number` (positive integer) |

`github.pr.checks.read` intentionally does not carry `required_only` in this
first version to reduce parallel coupling with Rust Lane A; it can be added
in a later revision of the shared contract.

## Transport firewall

The semantic definitions contain no `gh`, CLI command, argv, executable,
shell, or adapter path vocabulary, and no `adapter_id` such as
`github-cli`. Transport binding is exclusively a Rust Adapter concern. A
serialization-level test asserts this firewall over the full catalog.

## Input safety subset

The Brain Server runtime and the Rust Adapter share the same conservative
subset, declared machine-readably in
`docs/goal24/cp4-github-readonly-contract.json` for a 1:1 conformance check.

- `owner`: 1..39 chars, `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`
- `repo`: 1..100 chars, `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`
- Both reject: `/`, `\`, NUL, C0 control characters, a leading dash, empty
  values, and whitespace.
- `query`: at most 1024 characters; NUL and C0 control characters are
  rejected. GitHub search syntax (for example `-label:bug`, `--web`,
  `; calc.exe`) is carried as semantic data and is never parsed as
  structure.
- `state`: `open` | `closed` | `all`.
- `limit`: integer 1..100; the runtime materializes the default of 30.
  Floats and numeric strings are rejected.
- `number`: positive integer; `0`, negatives, floats, and strings are
  rejected.
- Unknown input keys are rejected everywhere (strict Zod objects).

This subset is claimed only as the *Omni-Context GitHub CP4 safe subset*, not
as complete coverage of all present and future GitHub naming rules.

## Normalization API

`brain-server/src/capabilities/github-inputs.ts` exports:

- `GitHubOwnerSchema`, `GitHubRepoNameSchema`
- `GitHubRepoInspectInputSchema`
- `GitHubIssueSearchInputSchema`
- `GitHubIssueReadInputSchema`
- `GitHubPrReadInputSchema`
- `GitHubPrChecksReadInputSchema`
- `normalizeGitHubCapabilityInput(capabilityId, unknownInput)` — returns a
  canonical JSON-safe plain object; rejects unknown capability ids (including
  the roadmap write ids) and never produces argv, commands, or repo CLI
  selectors.

`brain-server/src/capabilities/github-readonly.ts` exports the static
catalog `GITHUB_READONLY_CAPABILITIES` (a plain array export, not a
registration runtime).

## Verification

- `npm run typecheck` — PASS
- `npm test` (full vitest) — PASS (42 files, 580 tests; lane tests:
  `tests/goal24-github-capabilities.test.ts`, 101 tests)
- `npm run build` — PASS
- `npm run lint` — PASS (0 errors; only pre-existing warnings in untouched files)
- `git diff --check` — PASS

## Declarations

- Write capability defined: NO (`github.issue.create`, `github.issue.comment`,
  `github.issue.close`, `github.pr.merge` remain roadmap-only).
- Adapter transport encoded in capability: NO.
- Catalog runtime added: NO (static export only).
- Skill Registry started: NO.
- Holdback / science / benchmark / gold / paper touched: NO.
- Remote branch pushed: NO.
- Stale worktree `.worktrees/goal24-cp21` touched: NO.
