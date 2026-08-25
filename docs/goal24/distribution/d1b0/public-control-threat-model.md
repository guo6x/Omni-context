# D1B-0 public control-surface threat model

Status: `CURRENTLY_VERIFIED_INTERNAL` / contract frozen for D1B engineering. This document does not open `approve`, `verify`, a public mutation gateway, or a public execution gateway. The implementation branch is based exactly on `origin/dev/goal24-cli-skills` at `fb80b7513a58b7fc095ab90240892cedad0e8be9`.

## Authority and current snapshot

The authority chain is frozen:

`Brain trusted evidence pipeline` → `Decision Kernel` → `Approval + trusted native broker` → `trusted receipt + trusted read-back observation + deterministic evaluator`.

CLI, MCP, skills, LLM output, plugins, and external runtimes are callers or adapters. None is an authority. Storage bytes are not an API.

Current distribution facts:

- Read surface: `doctor`, `ask`, `inspect`, `history` (plus `version`/`help`).
- `approve`: `TARGET_LOCKED`, fail-closed, no network/store access.
- `verify`: `TARGET_LOCKED`, fail-closed, no caller verdict fields.
- `reopen`: `FUTURE`.
- No public mutation or execution gateway; `github.issue.close` is the sole internal production write.
- `omctx` remains `0.1.0-alpha.0`, `private: true`, zero runtime dependencies, and is not published.

The existing Brain REST/MCP APIs are authenticated product APIs for memory and decisions. They are not a public control facade and must not be aliased to one. The existing CORS allowlist is for those product APIs; the future control routes use the stricter origin policy below.

## Q1: approve abuse cases

A caller supplies only `{ "plan_id": "<id>" }`. The facade resolves a server-owned plan and verifies actor identity, authority level, decision/capability identity, normalized-input/risk/evidence/verification digests, policy version, creation/expiry, and approvability. Missing, forged, cross-subject, expired, or already-consumed plans fail closed. The caller cannot provide a capability, argv, executable, risk, evidence, receipt, or digest.

The approval authority performs an atomic single-use compare-and-set. Exactly one concurrent request can grant. A second request returns `PLAN_ALREADY_CONSUMED` or `APPROVAL_REPLAY_BLOCKED`; it cannot create a second grant. A stolen plan id is only a locator and is useless without the separate control scope, actor/authority check, and current plan binding.

## Q2: verify abuse cases

The future verify request is also the narrow `{ "plan_id": "<id>" }` schema. The resolver must find exactly one trusted outcome/receipt/verification-plan tuple for that plan. Ambiguity, missing receipt, subject mismatch, stale plan, or a different decision/receipt fails closed. The caller cannot submit `success`, `verified`, expected state, receipt JSON, observation JSON, predicate, regex, JSONPath, prompt, judge result, or verdict.

Verification uses the trusted receipt resolver, trusted observation/read-back resolver, and deterministic evaluator. Exit failure is not proof of no external effect: `nonzero`, `timeout`, `cancel`, and `unknown_after_crash` remain eligible for read-back. Brain read-back retries are bounded to 3 by default and native hard limit is 5; verify never retries the original write.

## Threat actors and mitigations

| ID | Attacker | Primary abuse | D1B control decision |
| --- | --- | --- | --- |
| A1 | Malicious same-user local process | Calls localhost, steals environment, replays or forges plan ids | Separate control scopes, fixed schemas, actor/authority binding, replay ledger, rate limits. Be honest that complete same-user account control defeats token isolation. |
| A2 | Malicious webpage / DNS rebinding | CSRF, simple POST, preflight abuse, localhost port scan, rebinding Host | Control routes reject requests with `Origin` by default, do not use browser credentials, no wildcard CORS, no redirects, loopback bind and exact route/method checks. `Referer` is never authority. |
| A3 | Malicious MCP client | Invokes write tool or attempts to masquerade as control authority | MCP is a caller; per-tool scopes and allowlists remain separate. No MCP route maps to approve/verify. |
| A4 | Malicious Skill | Supplies forged evidence, plan fields, or tool arguments | Skills cannot access authority stores; server recomputes all bindings and accepts no caller digest/evidence authority. |
| A5 | Malicious LLM output | Hallucinates approval, success, expected state, or predicate | LLM text is never a verdict or authority input. Deterministic evaluator and trusted read-back own outcome. |
| A6 | Stolen local API token | Calls control route with read token or exfiltrated secret | `READ_TOKEN_CAN_APPROVE=NO`, `READ_TOKEN_CAN_VERIFY=NO`; separate `control:approve`/`control:verify` scopes, optional Desktop-mediated confirmation. Raw tokens are never logged. |
| A7 | Replayed old valid request | Replays an approval or verification after consumption | Atomic per-plan single-use grant, durable replay ledger, bounded verify retry budget, `ALREADY_CONSUMED`/`REPLAY_BLOCKED`. |
| A8 | Stolen plan id | Approves another actor's plan or verifies another subject | Plan id is only a locator; actor, authority, subject, decision, capability, and all canonical digests are checked server-side. |
| A9 | Forged plan id | Arbitrary identifier or crafted JSON plan | Opaque id lookup only; no caller-supplied plan object, capability, argv, or binding fields; `PLAN_NOT_FOUND` on miss. |
| A10 | Cross-user process | Uses another user's port/token or shared machine | Loopback is not a cross-user proof. OS ACL/token-file hardening and separate control authorization are required; no claim of same-user or cross-user proof is made by D1B-0. |
| A11 | Malicious plugin / future runtime | Registers a generic execute or store shortcut | Plugin boundary has no authority; fixed control routes and capability registry only, no generic `POST /api/control/:anything`, no direct IPC/store access. |
| A12 | Compromised GitHub/tool CLI output | Reports false success, receipt, or subject | External output is untrusted. Native broker emits identity-bound receipt; trusted independent read-back and deterministic evaluator decide outcome. |

Cross-subject tests must fail closed for: same issue number/different repo, same issue number/different owner, different plan/same capability, different receipt/same plan, and different decision/same subject.

## Frozen control transport contract

The selected D1B transport is authenticated loopback HTTP with fixed routes and methods. Planned routes are `POST /api/control/approve` and `POST /api/control/verify`; no route is implemented in D1B-0. The listener is loopback-only, uses Bearer authentication with a dedicated control scope, rejects redirects, does not put secrets in query strings, and never passes arbitrary bodies or capability identifiers through.

Browser-shaped requests are rejected by default for control routes whenever `Origin` is present. There is no wildcard CORS and no browser credential mode. `OPTIONS` never grants access. A future explicitly trusted Desktop origin would require a separately frozen policy and tests; the existing general Brain API origin allowlist does not automatically apply.

Options B (Tauri IPC only) and D (CLI launching a Desktop helper) couple authorization to a privileged process and add process-launch/inherited-environment attack surface. Option C (named pipe/Unix socket) is deferred until a Windows ACL and Unix permission contract is independently verified. Option E (direct files, SQLite, or stores) is forbidden because it bypasses service invariants and replay protection. These decisions are machine-readable in `d1b0-architecture-decisions.json`.

## Token and actor model

The existing read token is not silently upgraded. `READ_TOKEN_CAN_APPROVE=NO` and `READ_TOKEN_CAN_VERIFY=NO`. D1B-1 and D1B-2 use separate control scopes, actor identity, and authority level. A Desktop-mediated human confirmation is recommended for grants; a short-lived challenge/ack nonce may be added only by a later frozen design. A token held by a process with complete control of the same account is not OS-level isolation; the goal is to prevent web-origin abuse, cross-plan forging, replay, authority escalation, and generic execution bypass.

## Schemas and error contract

Approval body is exactly `{ "plan_id": "<id>" }` with no additional properties. Verify body is exactly the same locator; resolution must produce one canonical trusted tuple or fail closed. The caller supplies no identity, decision, capability, digest, receipt, observation, expected state, predicate, regex, JSONPath, prompt, judge result, or verdict.

Frozen error semantics cover: `CONTROL_AUTH_REQUIRED`, `CONTROL_SCOPE_INSUFFICIENT`, `PLAN_NOT_FOUND`, `PLAN_EXPIRED`, `PLAN_NOT_APPROVABLE`, `PLAN_ALREADY_CONSUMED`, `APPROVAL_REPLAY_BLOCKED`, `APPROVAL_AUTHORITY_INSUFFICIENT`, `VERIFICATION_NOT_AVAILABLE`, `RECEIPT_NOT_FOUND`, `VERIFICATION_SUBJECT_MISMATCH`, `OUTCOME_ALREADY_FINALIZED`, `READBACK_FAILED`, `CONTROL_ORIGIN_REJECTED`, and `CONTROL_RATE_LIMITED`.

Approve uses per-plan strict single-use plus a token burst limit. Verify uses a per-plan bounded retry budget plus a token limit and local/global guard. Audit records include timestamp, actor/scope (never raw token), plan/decision ids, action, result, failure reason, and local transport context. Authorization headers, raw secrets, sensitive inputs, GitHub tokens, and approval secrets are never logged.

## Forbidden direct access

`omctx`, MCP clients, skills, plugins, LLM output, and external runtimes must not read or modify ApprovalStore files, AuthorizationStore files, execution ledger, ReceiptStore files, OutcomeStore files, SQLite databases, or native replay ledgers. These are authority persistence owned by their service. Storage bytes are not a public authority API.

## Dependency freshness and reachability

RustSec was freshly refreshed successfully (database revision `a7bfe16948bf6f3ee25bdee4822209f87da21b80`, updated 2026-08-24) and `cargo audit` completed against the Windows target lockfile. Five advisory entries were found: `h2@0.3.27` is reachable through Desktop reqwest but not a control facade; `quick-xml@0.30.0` and `@0.39.3` have no Windows target path and only appear in Linux xcb/wayland build paths. Fresh path evidence is retained in `cargo-tree-windows.txt`, `path-hyper-014-windows.txt`, `path-quick-xml-030-linux.txt`, and `path-quick-xml-039-linux.txt`.

Brain npm audit found 28 findings and Desktop found 9. The machine-readable classification records all paths and evidence. Brain runtime findings are memory/model/ingest/storage dependencies outside control routes; install/build and test findings are marked `BUILD_ONLY` or `DEV_ONLY`. Desktop is Next `output: export`, so findings are build-only. No finding is unknown, a D1B blocker, or a fix-before-D1B control dependency. This is not a claim that all dependency advisories are harmless; it is a scoped control-surface classification with follow-up upgrades tracked separately.

## Generic escape and current entry-point audit

The full-text audit covered `execute`, `approve`, `grant`, `verify`, `readback`, `receipt`, `outcome`, `spawn`, `shell`, `child_process`, `Command::new`, `invoke`, Tauri commands, HTTP route methods, MCP tools, public API, and IPC. Relevant current entry points are:

- `packages/omctx/src/commands/locked.js`: approve/verify are fail-closed and perform no I/O.
- `brain-server/src/api/routes.ts` and `src/security/auth.ts`: authenticated fixed REST/MCP product routes, including bounded read history; no control route.
- `desktop-daemon/src-tauri/src/execution_broker/` and fixed GitHub bindings: internal broker only.
- `brain-server/src/outcome/` and `src/approval/`: trusted internal services; no arbitrary receipt/observation/outcome/approval endpoint.
- Real-E2E harness scripts: dev-only and not registered in production.

No arbitrary shell endpoint, arbitrary executable endpoint, arbitrary argv endpoint, arbitrary capability execution endpoint, arbitrary receipt submit, arbitrary observation submit, arbitrary outcome finalize, or arbitrary approval grant surface was found. The attack-surface inventory records the non-control product mutation routes separately so they cannot be mistaken for D1B control availability.

## D1B implementation split and prerequisites

**D1B-1 — Public Approval Control Path.** Implement `approve` only after this gate is reviewed on authoritative dev. Required preconditions are selected transport, separate token/scope model, browser-origin policy, exact request schema, actor/authority binding, single-use/replay semantics, audit schema, rate-limit model, and dependency blockers equal to zero. `verify` remains locked.

**D1B-2 — Public Verification/Read-back Path.** Do not implement together with D1B-1. Start only after D1B-1 authoritative PASS. Required preconditions are a unique locator, trusted receipt resolver, trusted observation resolver, deterministic evaluator, cross-subject binding, read-back retry semantics, outcome persistence semantics, zero caller verdict fields, and dependency blockers equal to zero.

The machine-readable prerequisites and gate are `d1b0-architecture-decisions.json`, `public-control-attack-surface.json`, `trust-boundaries.json`, `dependency-audit-classification.json`, and `d1b0-readiness-gate.json`.

