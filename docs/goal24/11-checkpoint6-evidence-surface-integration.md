# Goal24 Checkpoint 6 - Evidence Surface Integration, Forged-Coverage Closure and Security Freeze

Status: **GOAL24_CHECKPOINT6_COMPLETE** - all A-AH gate criteria PASS.

Checkpoint 7 was not started: no Approval Engine, no approval-token
cryptography, no public approval UI, no ExecutionPlan approval transition, and
no destructive-action guard. No live GitHub evidence provider was implemented
and no execution IPC was enabled.

- Base: `09147b16a284fafa3ec922c6159ac4f2c26084c4` (`origin/dev/goal24-cli-skills`, verified exact)
- Integration branch: `local/cp6-integration` (worktree
  `D:\ai_code\Omni-context-worktrees\cp6-integration`)
- Integration commits: see section 3.

## 1. Lanes integrated

All lane objects were verified present and cherry-picked in order onto the
verified base; no conflicts. Lane C adds docs and fixtures only (runtime
diff = 0).

| Lane | Requested commits | Integrated commits |
| --- | --- | --- |
| A - Evidence Core | `7e44547`, `18938d0`, `d7bce39`, `1b227256` | `1a0228ad`, `00529635`, `eb135af0`, `1755af7d` |
| B - Evidence Surface Guard | `3ec5e930`, `363c333b`, `4c5c4dc6` | `a0c777f7`, `ce8a3e80`, `88e8569b` |
| C - Evidence Security Oracle | `4dc3ec84` | `6d7bfd80` |

Lane A adds the evidence model, provider registry, qualification runtime and
coverage builder plus their tests. Lane B adds the deterministic surface guard
(guard-types / guard-policy / guard) with retrieval/clarify/defer/block control
plus tests. Lane C adds the 188-vector adversarial corpus, the 20-surface
bypass audit and the threat model; it modifies no runtime.

## 2. Pre-merge scan and diff scope

- The full base..HEAD diff touches only `brain-server/src/evidence`,
  `brain-server/tests` evidence tests/helpers, and `docs/goal24`.
- `PROCESS_EXECUTION_ADDED = NO`: the CP6 diff contains no
  `child_process`, no `spawn(`/`exec(`/`execFile` and no
  `process.env` reads in the evidence runtime. Providers V1 are deterministic
  in-memory fakes only.
- Rust (`desktop-daemon/src-tauri`) has **zero** diff lines in CP6, so the
  CP3/CP4 broker containment and GitHub read-only adapter are untouched by
  construction and re-verified by the Rust suite (see section 13).
- No GitHub write capability, no generic shell, and no approval engine appear
  anywhere in the CP6 diff.

## 3. Integration commits

- `e286de3668ace95f82d23cc4d606c7a4e843835c` feat(evidence): compose provider runtime with surface guard - the
  production facade; this commit also carries the guard-run-to-policy binding
  (strict request schema, digests, subject resolvers, server-owned stores).
- `1b0176975c558e2981e91ce12a392890bade2aab` security(evidence): close forged coverage eligibility bypass -
  unambiguous evidence-id tuple encoding, canonical claim digest hardening,
  eligibility and identity tests.
- `8bee7545f68e6ce2a521d381d55deac863a6acaf` test(evidence): execute cp6 adversarial oracle - the executable
  half of the adversarial execution map plus the map itself.
- `style(evidence): remove trailing blank line in eligibility tests` (whitespace-only follow-up).
- docs(goal24): freeze checkpoint 6 evidence surface guard (this commit;
  FINAL_HEAD_SHA reported in the completion response).

## 4. Production facade: EvidenceSurfaceRuntime

`brain-server/src/evidence/runtime.ts` is the CP6 production trust boundary. Its
only evaluation entry is:

    evaluateForCapability({
      capability_id,
      capability_version,
      normalized_inputs,
      correlation_id?
    })

The request schema is a strict Zod object (unknown keys rejected).
`normalized_inputs` is bounded to 100 keys and 64 KiB serialized. The fields
`requirements`, `coverage`, `initial_coverage`, `provider_id(s)`,
`verification_level`, `conflict_policy`, `now`, `checked_at` and
`evidence_ids` do not exist on the request shape and any request carrying them
is rejected as `EVIDENCE_INPUT_INVALID`. Callers therefore cannot pass
requirements=[] to force PROCEED, seed fake initial coverage, select providers,
or move the clock.

The pipeline is fully server-owned:

    capability lookup -> required_evidence
      -> subject binding (trusted resolver over normalized_inputs)
      -> provider registry selection per class
      -> collection + Lane A qualification (trusted clock)
      -> coverage builder -> Lane B Guard
      -> server-owned GuardRunRecord

The returned `EvidenceSurfaceEvaluation` (guard_run_id, action, digests,
coverage, reason codes) is **not** an approval token and **not** execution
authority. Authority lives in the server-owned GuardRunStore, and only
`EvidenceEligibilityService` may materialize executable-plan coverage from it.

## 5. Trusted boundaries

- **Capability lookup**: the constructor takes a trusted
  `capabilityLookup`; the capability must exist
  (`EVIDENCE_CAPABILITY_NOT_FOUND`) and its version must equal the requested
  version (`EVIDENCE_CAPABILITY_VERSION_MISMATCH`).
  `required_evidence` is read from the capability definition only; there is no
  caller override path.
- **Subject binding**: `subject_key` is derived from (capability_id,
  normalized_inputs) through a trusted `CapabilityEvidenceSubjectResolver`
  registry (`brain-server/src/evidence/subject.ts` /
  `subject-resolvers.ts`). No resolver means
  `EVIDENCE_SUBJECT_RESOLVER_NOT_FOUND` (fail closed). Keys are bounded to 200
  chars with no NUL/control characters, and every provider candidate must carry
  exactly the guard-run subject; anything else is `EVIDENCE_SUBJECT_MISMATCH`
  and can never qualify.
- **Provider selection**: collection uses
  `EvidenceProviderRegistry.providersForClass()` only. Provider registration is
  internal; requests cannot name providers, mutate the registry, or inject
  provider objects.
- **Clock**: the trusted clock is constructor-injected (default system clock).
  Requests cannot set `now`/`checked_at`; future observed_at timestamps are
  rejected by qualification (`EVIDENCE_TIMESTAMP_INVALID`).
- **Stores**: `QualifiedEvidenceStore` (default 2000 records) and
  `GuardRunStore` (FIFO, default 100) are server-owned, bounded, in-memory
  ledgers. They are never request-populated and are not exposed publicly.
- **Outcome normalization**: provider outcomes are normalized to
  `collected`/`not_found`/`temporary_unavailable`/`permanent_unavailable`/
  `user_context_required`/`provider_error`/`collection_limit_exceeded`. Provider
  exception text is never parsed for control flow and never echoed.

## 6. Guard runs and digests

Each complete evaluation writes a core-generated
`EvidenceGuardRunRecord`: guard_run_id (`crypto.randomUUID()`), capability
id/version, subject_key, normalized_inputs_digest, requirements_digest,
started/finished timestamps, final_action, final_coverage, coverage_digest,
qualified_evidence_ids, rounds_used and reason codes.

- `requirementsDigest`: canonical JSON + SHA-256 over the exact
  `required_evidence` policy. A capability policy change therefore invalidates
  every older run (`EVIDENCE_REQUIREMENTS_CHANGED`).
- `normalizedInputsDigest`: canonical JSON + SHA-256 over the inputs, binding the
  run to the exact subject (`EVIDENCE_INPUT_BINDING_MISMATCH` on replay).
- `coverageDigest`: canonical JSON + SHA-256 over final coverage
  (`EVIDENCE_COVERAGE_INTEGRITY_FAILURE` if it no longer recomputes).
- Digests are fingerprints, **not** authorization: a caller-computed digest
  proves nothing. Authority lives in the server-owned GuardRunStore record.
- Retrieval budget: 0..10 rounds (default 3), per-round timeout 100 ms..24 h
  (default 5 s); an aborted/timed-out collection can never satisfy coverage.

## 7. EvidenceEligibilityService

`brain-server/src/evidence/eligibility.ts` is the only source of authoritative
coverage for a future executable plan:

    materializeEvidenceForExecutablePlan({
      guard_run_id,
      capability_id,
      capability_version,
      normalized_inputs
    })

Callers can never pass a coverage snapshot. The service re-validates the
server-owned run end to end: (1) run exists; (2) final_action == proceed;
(3) capability id/version match; (4) capability still exists; (5) current
requirements digest matches; (6) inputs digest matches; (7) trusted subject
resolver output matches; (8) coverage digest recomputes; (9) every
evidence_id/conflict id traces to a run-qualified record
(`EVIDENCE_LINEAGE_MISSING`); (10) `assessEvidenceCoverage` still reports
mandatory_satisfied=true. It returns coverage + lineage only - it does not set
plan state, spawn, or approve anything (Checkpoint 7 concerns).

## 8. Forged coverage closure

A caller-constructed `EvidenceCoverageSnapshot` (status=present,
verification_level=verified, evidence_ids=["fake"]) may satisfy the pure
contract-level `assessEvidenceCoverage` - that is expected and documented. It
can never obtain executable-plan eligibility: the eligibility service accepts
no snapshot, and every coverage id must resolve to a server-owned qualified
record from a proceed guard run whose digests and subject still match.

- requirements=[] attack: structurally impossible (no request field; schema
  rejects unknown keys).
- initial fake coverage: structurally impossible (no request field).
- fake provider selection: structurally impossible (internal registry only).
- fake clock: structurally impossible (no request field; constructor-injected
  clock).
- No self-asserted `trusted`/`guarded` field was added, no HMAC/JWT
  crypto theater, and no approval token was introduced.

## 9. Evidence identity and claim digests

- `evidence_id` = SHA-256 over a **length-prefixed UTF-8 tuple** (32-bit
  big-endian byte length + bytes per field: provider_id, evidence_class,
  subject_key, source_item_id, claim_digest). Length-prefixing removes NUL
  delimiter ambiguity entirely; every identity component additionally rejects
  NUL and control characters (`invalid_identity_component`).
- `claim_digest` = canonical JSON (stable key sort, array order preserved) +
  SHA-256. NaN, Infinity, undefined, BigInt, class instances and cyclic
  objects are rejected fail-closed.
- Providers cannot pre-choose or spoof evidence ids: candidates carrying
  `evidence_id` or `claim_digest` are rejected by the strict candidate schema.
- Duplicate id + identical content is idempotent in the qualified store;
  duplicate id + different content is `EVIDENCE_LINEAGE_CONFLICT`; tombstoned ids
  can never re-enter.

## 10. Adversarial oracle and bypass closure

- `docs/goal24/checkpoint6-adversarial-execution-map.json` maps **188** vectors:
  AUTOMATED 104, COVERED_BY_EXISTING_TEST 58, MANUAL 0, NOT_APPLICABLE 26,
  UNMAPPED 0, FAILED 0.
- `brain-server/tests/goal24-cp6-adversarial-oracle.test.ts` is the executable
  half (31 tests). Map-integrity tests re-verify counts against the vector
  source, the per-vector test-name binding, and zero unmapped/manual/failed.
  The oracle never executes a process and never performs network access.
- `docs/goal24/checkpoint6-bypass-closure.json` disposes all **20** Lane C
  surfaces: potential_before 2, blocks_before 1, potential_after 0,
  blocks_after 0. Original Lane C conclusions are not rewritten; the file adds
  the integration disposition per surface.

## 11. No process execution / no live provider / no writes

- Evidence provider V1: deterministic fake providers only. The GitHub evidence
  class catalog (`cp6-github-evidence-class-catalog.json`) remains a roadmap for
  CP8/demo.
- GitHub write bindings remain **0**; the 5 CP4 read-only bindings are
  unchanged.
- `execute_ipc_enabled` remains `false`
  (`desktop-daemon/src-tauri/src/execution_broker/mod.rs:258`); generic execution
  IPC stays disabled.

## 12. Tests

- brain-server: `npm run typecheck` PASS; `npx vitest run` **54 files,
  957 tests, 0 failed**; `npm run build` PASS; `npm run lint` 0 errors,
  10 pre-existing warnings.
- CP6 evidence suites: core 29, qualification 34, guard 41, runtime 33,
  eligibility 16, identity 10, adversarial oracle 31 (all PASS).
- desktop-daemon: `npm run build` PASS; `npm run verify:controlled` OK.
- Rust: `cargo fmt --check` PASS; `cargo check` exit 0 (1 pre-existing
  dead-code warning); `cargo clippy --all-targets` exit 0 (pre-existing
  warnings only); `cargo test` 124 passed / 0 failed / 6 ignored;
  `cargo audit --db D:\environment\advisory-db-offline --no-fetch --stale` 5
  pre-existing RUSTSEC vulnerabilities + 17 warnings - CP6 has zero Rust diff.
- `git diff --check` clean.

## 13. CP3/CP4/CP5 invariants

- Broker containment: unchanged (zero Rust diff); generic_shell false, generic
  execute IPC false, output limits and Job Object preserved.
- GitHub read-only adapter: 5 bindings unchanged; `pr.checks.read` still uses
  `gh pr view --json statusCheckRollup`.
- Skill Registry / Importer (CP5): all suites pass inside the 957-test run;
  evidence providers cannot be registered by untrusted skills (no public
  registration surface).

## 14. Environment and audit

See `docs/goal24/checkpoint6-environment.json`: Node v22.23.2, npm 10.9.8,
rustc/cargo 1.97.1, cargo-audit 0.22.2 (offline advisory DB, 1216
advisories). Environment policy followed: D: first, no new environment on C:,
no system PATH change, dirty cp21 worktree untouched.

- npm audit (`--omit=dev --audit-level=critical`): 16 findings (1 critical,
  4 high, 8 moderate, 3 low), all pre-existing transitive findings; CP6 adds no
  dependency. Evidence-runtime reachable: UNKNOWN=0, FIX_BEFORE_CP6=0,
  BLOCKS_CP6=0 (runtime uses only node:crypto + zod).
- cargo audit: pre-existing only (see section 12); zero Rust diff in CP6.

## 15. V1 limitations (honest)

- `QualifiedEvidenceStore` and `GuardRunStore` are **memory-only**: guard-run
  lineage does not survive a Brain Server restart. After restart, eligibility
  fails closed and evidence must be recollected. No persistent evidence
  authorization is claimed.
- No live GitHub evidence provider exists yet; all provider tests use
  deterministic fakes.
- `EvidenceEligibilityService` returns authoritative coverage + lineage only; it
  does not transition plan state and is not an approval mechanism.
- The lower-level pure APIs (`buildEvidenceCoverage`, `runEvidenceGuard`,
  `assessEvidenceCoverage`) remain internal composable primitives and are
  documented as non-authoritative.
- Approval enforcement for the Rust Broker remains a Checkpoint 7 concern and
  is unchanged.

## 16. Freeze artifacts

- `docs/goal24/11-checkpoint6-evidence-surface-integration.md` (this file)
- `docs/goal24/checkpoint6-security-gate.json` - gate result PASS, criteria A-AH
  with per-criterion evidence
- `docs/goal24/checkpoint6-manifest.json` - lanes, facade, eligibility, digests,
  identity, stores, closure counts
- `docs/goal24/checkpoint6-environment.json` - toolchain, audits, policy and
  firewall statements
- `docs/goal24/checkpoint6-adversarial-execution-map.json` - 188 vectors mapped
- `docs/goal24/checkpoint6-bypass-closure.json` - 20 surfaces disposed
