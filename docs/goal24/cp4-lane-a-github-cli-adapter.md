# Goal24 Checkpoint 4, Lane A - GitHub CLI Read-Only Adapter Core

Date: 2026-08-13
Branch: `local/cp4-github-adapter-core`
Base: `8238c350e56bcbf486a2e484287bcad66fda6174` (`origin/dev/goal24-cli-skills`, verified exact after `git fetch --all --tags --prune`)

## Scope

This lane implements the Rust core of the GitHub CLI adapter on top of the
frozen CP3 `ExecutionBinding` contract and the existing `Broker`. Exactly five
READ-ONLY capabilities are implemented. CP4 enables no writes, no production
execute IPC, and no process execution outside the broker.

**CP4 DOES NOT ENABLE WRITES.**

## Capabilities

| Binding ID | Capability ID | gh invocation (fixed by compiled code) |
| --- | --- | --- |
| `github-cli.repo.inspect` | `github.repo.inspect` | `gh repo view <owner/repo> --json=<hardcoded fields>` |
| `github-cli.issue.search` | `github.issue.search` | `gh issue list --repo=<owner/repo> [--search=<query>] [--state=<state>] [--limit=<n>] --json=<hardcoded fields>` |
| `github-cli.issue.read` | `github.issue.read` | `gh issue view <number> --repo=<owner/repo> --json=<hardcoded fields>` |
| `github-cli.pr.read` | `github.pr.read` | `gh pr view <number> --repo=<owner/repo> --json=<hardcoded fields>` |
| `github-cli.pr.checks.read` | `github.pr.checks.read` | `gh pr view <number> --repo=<owner/repo> --json=<hardcoded fields incl. statusCheckRollup>` |

Hardcoded `--json` field lists (callers can never provide them):

- repo.inspect: `nameWithOwner,description,visibility,isPrivate,isArchived,defaultBranchRef,url,viewerPermission`
- issue.search: `number,title,state,stateReason,url,createdAt,updatedAt,author,labels`
- issue.read: `number,title,body,state,stateReason,url,author,labels,createdAt,updatedAt,closedAt`
- pr.read: `number,title,body,state,url,author,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt,updatedAt`
- pr.checks.read: `number,title,state,url,headRefName,statusCheckRollup`

`github.pr.checks.read` extracts checks in Rust from the machine-readable
`statusCheckRollup` of `gh pr view --json`. The `gh pr checks` subcommand is
deliberately not used: its non-zero "pending" exit semantics would require a
broker-wide exit-code change, which this lane must not make.

## Input schema (strict)

Every capability parses `normalized_inputs` into a `#[serde(deny_unknown_fields)]`
Rust struct. Unknown keys, missing keys and wrong JSON types all fail with
`GH_INPUT_INVALID`. Callers cannot supply an executable, flags, argv, cwd or env.

- `owner`, `repo`: trimmed; non-empty; max 100 chars; rejects `.`, `..`,
  leading `-`, control characters, whitespace, `/` and `\`. This is a
  deliberately small safety subset, not a full GitHub naming simulation.
- `number` (issue.read / pr.read / pr.checks.read): positive integer.
- `query` (issue.search, optional): max 1024 chars; only NUL is rejected.
  Everything else (spaces, CR/LF, leading dashes, `--web`, `| whoami`,
  Unicode) remains one data value.
- `state` (issue.search, optional): strict enum `open` | `closed` | `all`.
- `limit` (issue.search, optional): 1..=100; when omitted, gh's own default
  (30) applies and no `--limit` element is emitted.

## argv rules

- `Vec<OsString>` built exclusively by compiled binding code. No `join(" ")`,
  no splitting, no shell parsing, no `cmd /C` / PowerShell / bash / sh.
- User strings always become a single fused argv element:
  `--repo=<owner/repo>`, `--search=<query>`, `--state=<state>`,
  `--limit=<n>`, `--json=<fields>`; positional `owner/repo` and `<number>` are
  plain elements.
- Callers can never add flag names, subcommands, JSON fields, `--jq`,
  `--template`, `--web` or `--hostname`.
- The broker additionally rejects NUL-containing argv elements
  (`reject_nul_args`) before spawn.

## Output parsers (fail closed)

Each parser takes a `BrokerExecutionResult` and first gates on:

1. `cancelled == false` and `timed_out == false` (else `GH_CLI_FAILED`)
2. `exit_code == Some(0)` and `success == true`. `exit_code == Some(4)` maps
   to `GH_AUTH_NOT_READY` (gh's documented "auth required" exit); every other
   non-zero exit maps to `GH_CLI_FAILED`. English stderr text is never parsed
   for classification.
3. `stdout_truncated == false` (else `GH_OUTPUT_TRUNCATED`; partial JSON is
   never parsed)

Then `serde_json::from_str` parses one strict JSON document (trailing data is
rejected; failures map to `GH_JSON_INVALID`). Output structs use camelCase
wire names and ignore extra gh fields for forward tolerance; missing required
fields fail closed with `GH_JSON_INVALID`. Raw stderr is never semantic output.

Declared adapter error codes: `GH_EXECUTABLE_NOT_READY`, `GH_INPUT_INVALID`,
`GH_CLI_FAILED`, `GH_JSON_INVALID`, `GH_OUTPUT_TRUNCATED`, `GH_AUTH_NOT_READY`,
`GH_REPOSITORY_NOT_FOUND`, `GH_ISSUE_NOT_FOUND`, `GH_PR_NOT_FOUND`.

`GH_REPOSITORY_NOT_FOUND` / `GH_ISSUE_NOT_FOUND` / `GH_PR_NOT_FOUND` are
declared but never emitted in CP4: gh reports not-found as generic exit
code 1, indistinguishable without parsing English stderr. They are reserved
for a future structured semantic probe.

## Executable trust model

- The adapter constructor takes a trusted absolute `gh.exe` path that can only
  come from trusted compiled bootstrap/discovery code. It validates: absolute,
  canonicalizable, exists, regular file, extension exactly `.exe` on Windows
  (`.cmd`/`.bat`/`.ps1` and extension-less paths are rejected).
- Discovery is pure filesystem enumeration (no `Command::new`, no `where`, no
  `gh --version`). Candidate order: `TRUSTED_BOOTSTRAP`, `STANDARD_INSTALL`
  (Program Files / LocalAppData installer locations), `PATH_DISCOVERY`.
  PATH scanning only records concrete absolute `...\gh.exe` candidates and
  never outranks the higher-priority sources. No developer-machine paths are
  hardcoded into product logic.
- The broker's resolver re-validates and fingerprints the executable before
  every spawn; a bare `gh` is never handed to the broker and OS PATH lookup
  never happens at spawn time.
- `ExecutionPlan.normalized_inputs` cannot carry `gh path`, `executable`,
  `binary`, `command`, `argv`, `cwd` or `env`; unknown keys are rejected.

## cwd policy

The adapter owns an injected `github_cli_work_root` (created and canonicalized
at construction). `derive_cwd()` ignores inputs entirely and always returns
the work root; `allowed_cwd_roots()` contains only that root. All GitHub reads
use explicit `--repo`/`owner/repo`, never the current git repository.

## env policy

The broker clears the environment and rebuilds it from its minimal base
(`SystemRoot`, `TEMP`, `TMP` on Windows) plus the binding allowlist. The
GitHub CLI binding allowlists only `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`
(what gh needs to find its own user config). Not allowlisted: `PATH`,
`HTTP_PROXY`/`HTTPS_PROXY`, and all token/host/repo/config variables
(`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GH_HOST`, `GH_REPO`,
`GH_CONFIG_DIR`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `SSH_*`, `AWS_*`,
`AZURE_*`, `GOOGLE_*`). The broker's fail-safe secret strip still runs.
Proxy support is deliberately absent in CP4 rather than widening the network
trust surface.

## Auth boundary

This lane never runs `gh auth login`, never handles tokens, never passes
`--show-token` and never reads token material. Auth readiness is checked by
Integration / Lane C against the real environment. A future auth probe must go
through a fixed broker semantic path, never around the broker. Note the CP3
broker also refuses execution when `GITHUB_TOKEN` is present in its own
environment (fail closed).

## Production IPC

No Tauri command exposes execution. `execute_ipc_enabled` stays `false`.
`commands.rs` and `tauri.conf.json` are untouched. The adapter registers
bindings only from compiled code (`GitHubCliAdapter::register_all`); CP4
Integration decides the wiring later.

## Broker contract touches (disclosed, additive only)

Two strictly additive, non-semantic changes were required to compile a
sibling adapter module against the frozen contract:

1. `desktop-daemon/src-tauri/src/execution_broker/mod.rs`: one token added to
   the existing re-export so `OutputLimits` (already the trait's return type)
   is nameable outside the private `policy` module:
   `pub use policy::{ExecutionBinding, OutputLimits, DEFAULT_OUTPUT_MAX_BYTES};`
2. `desktop-daemon/src-tauri/src/main.rs`: the new module must be declared
   somewhere to compile; added
   `#[cfg_attr(not(test), allow(dead_code))] mod github_cli;` with the same
   pattern CP3 used for `execution_broker`. No invoke handler, no wiring, no
   runtime effect.

No broker semantics, gates, resolver, runner or policy behavior changed.
`Cargo.toml` and `Cargo.lock` are untouched (no new dependencies).

## Tests (pure; no process spawn, no network, no remote state changes)

52 tests in `src/github_cli/tests.rs`, covering:

- strict inputs: unknown-key rejection, missing keys, owner/repo slash,
  backslash, control char, NUL, leading dash, empty, `.`/`..`, >100 chars,
  trim behavior; number 0 / negative / non-integer; limit 0 and 101; state
  enum strictness; query >1024 and NUL rejection
- one-value argv safety: spaces, leading `-label:bug`, `--web`,
  `--repo evil`, `; calc.exe`, `| whoami`, CRLF and Unicode queries each stay
  a single `--search=<value>` element; adversarial queries can never become
  flags or commands
- exact argv snapshots for all five capabilities; no `--web` / `--jq` /
  `--template` / `--hostname` anywhere; field lists are compile-time constants
- parsers: valid JSON for all five shapes; null description / missing
  defaultBranchRef / extra-field tolerance; `statusCheckRollup` extraction;
  invalid, truncated and trailing-garbage JSON; nonzero exit; exit code 4 ->
  `GH_AUTH_NOT_READY`; timed_out / cancelled / stdout_truncated fail closed;
  missing required fields; stderr text never treated as semantics
- discovery: bare `gh` rejected, missing file rejected, `.cmd`/`.bat`/`.ps1`/
  extension-less rejected, `.exe` regular file accepted, PATH scan produces
  only absolute `...\gh.exe`, ordering TRUSTED_BOOTSTRAP < STANDARD_INSTALL <
  PATH_DISCOVERY
- adapter: relative/missing/non-.exe gh rejected; registration of exactly the
  five binding IDs; `execute_ipc_enabled == false`; binding metadata
  (binding_id/adapter_id/capability_id, single absolute executable candidate,
  env allowlist, work-root-only cwd roots, broker-default output limits);
  `derive_cwd` ignores hostile `cwd`/`path` inputs; binding-level unknown-key
  rejection; `discover_and_new` never spawns and never hands a bare `gh` to
  the broker

## Verification

- `cargo fmt` / `cargo fmt --check`: PASS
- `cargo check`: PASS (only the pre-existing `clipboard.rs` dead-code warning
  from the base)
- `cargo clippy --all-targets`: PASS (zero warnings in `github_cli`; only
  pre-existing base warnings in `clipboard.rs`, `commands.rs`, `mcp_helper.rs`,
  `brain_server.rs`, `udp_listener.rs`, `main.rs`)
- `cargo test`: 116 passed, 0 failed, 1 ignored (the pre-existing broker
  child-protocol fixture); 52 of the tests are new `github_cli` tests
- `cargo audit` (standalone `cargo-audit`, frozen advisory DB): 5
  vulnerabilities, 17 allowed warnings - identical to the CP3 baseline; zero
  new crates (`Cargo.toml`/`Cargo.lock` unchanged)
- `npm run verify:controlled`: PASS; the controlled-files snapshot was
  regenerated for the disclosed `main.rs` declaration (the repo's sanctioned
  workflow, same as CP3)
- `git diff --check`: PASS

## Known limitations and residual risks

- The adapter core compiles and its bindings register, but nothing executes
  them in production yet (no IPC wiring). Execution-path integration,
  real-environment gh/auth checks and network behavior are CP4 Integration /
  Lane C territory.
- Not-found classification (`GH_REPOSITORY_NOT_FOUND` etc.) is reserved; CP4
  reports `GH_CLI_FAILED` for gh exit code 1.
- Discovery validation checks path shape/existence, not binary provenance;
  the broker's fingerprint re-check remains the pre-spawn control (CP3
  TOCTOU residual risk applies unchanged).
- The controlled-files snapshot hashes raw on-disk bytes, so it is sensitive
  to line-ending checkout state; it was regenerated against this worktree's
  state and verified green.
- The broker-wide rule "non-zero exit => generic failure" is intentionally
  unchanged (see `gh pr checks` note above).

## Scientific firewall

`research/decision-benchmark-holdback-v2`, `science/*`, formal benchmark,
Gold and paper were not read or modified. No remote branch was pushed.