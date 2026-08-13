# Goal24 Checkpoint 6, Lane A - Evidence Core + Provider Registry + Qualification Runtime

Date: 2026-08-13
Branch: `local/cp6-evidence-core`
Base: `09147b16a284fafa3ec922c6159ac4f2c26084c4` (`origin/dev/goal24-cli-skills`, verified exact after `git fetch --all --tags --prune`)
Worktree: `D:\ai_code\Omni-context-worktrees\cp6-evidence-core`

## Scope

This lane implements the Evidence Core: the Evidence Candidate / Qualified
Evidence data models, the Evidence Provider V1 contract, an internal provider
registry, and the deterministic qualification runtime that produces the
`EvidenceCoverageSnapshot` consumed unchanged by `assessEvidenceCoverage()`
(the CP2.2 wire shape).

**In scope**

- `brain-server/src/evidence/model.ts` - strict candidate / qualified
  evidence schemas, canonical JSON, claim digest, core-generated evidence
  ids, timestamp helpers, verification rank
- `brain-server/src/evidence/provider.ts` - `EvidenceProviderV1` contract,
  structured outcomes, normalized collection with `AbortSignal`
- `brain-server/src/evidence/provider-registry.ts` - internal registry with
  deterministic priority ordering
- `brain-server/src/evidence/qualification.ts` - per-candidate qualification
  (class/subject binding, verification cap, timestamps, claim integrity,
  staleness)
- `brain-server/src/evidence/coverage-builder.ts` - `buildEvidenceCoverage()`
  producing `EvidenceCoverageSnapshot` plus structured diagnostics
- `brain-server/src/evidence/errors.ts` - stable `EvidenceError` codes
- `brain-server/src/evidence/index.ts` - barrel exports
- Tests: `brain-server/tests/goal24-evidence-core.test.ts`,
  `brain-server/tests/goal24-evidence-qualification.test.ts`, deterministic
  fakes in `brain-server/tests/helpers/fake-evidence-providers.ts`

**Not in scope (explicitly not implemented)**

- Evidence Surface Guard control flow (`guard.ts` / `guard-policy.ts`) and
  the PROCEED / RETRIEVE_MORE / CLARIFY / DEFER / BLOCK decisions (Lane B)
- Decision Kernel wiring, ExecutionPlan state promotion
- GitHub live provider, HTTP / MCP providers, CLI spawn
- Tauri, Approval Engine, Outcome verification
- Any public provider registration surface (MCP / REST / Tauri IPC / LLM
  tools)

No existing runtime files were modified: everything is additive under
`brain-server/src/evidence`, `brain-server/tests` and `docs/goal24`.
`assessEvidenceCoverage()` and `execution/contracts.ts` are untouched.
`package.json` / `package-lock.json` are untouched (no new dependencies).
No `guard.ts`, `guard-policy.ts` or `orchestrator.ts` was created.

## Evidence is not memory

A Memory record is not automatically evidence. Every candidate must carry an
`evidence_class`, provider-bound provenance (the collecting provider is
recorded on the qualified evidence), an observation time (`observed_at`), a
verification level and a claim identity (`subject_key` + `claim_key`). Memory
existence is not evidence validity; Memory may become a future provider, but
only through this contract.

## Evidence candidate model

`EvidenceCandidateSchema` is a strict Zod object. Unknown fields are rejected
at parse time; in particular `evidence_id`, `claim_digest`, `shell`,
`command`, `argv` and `executable` can never become evidence authority. Text
values may mention those words; they carry no executable semantics.

Required fields:

- `evidence_class` - dotted identifier matching the capability contract
  pattern
- `subject_key` - 1..200 chars
- `claim_key` - 1..200 chars
- `claim_value` - JSON-safe value (null / boolean / finite number / string /
  array / plain object; no Date, BigInt, function, symbol, NaN, Infinity or
  cycles)
- `source_item_id` - 1..300 chars
- `source_reference` - 1..1000 chars (must not contain raw tokens,
  authorization headers, credentials or session cookies)
- `observed_at` - ISO-8601 timestamp with an explicit UTC offset
- `verification_level` - `none` | `asserted` | `verified`

Optional: `source_updated_at` (metadata only; freshness never uses it),
`note` (max 2000), `metadata` (JSON object).

## Qualified evidence

`QualifiedEvidenceSchema` is the candidate after core qualification. The core
adds `evidence_id`, `claim_digest` and `qualified_at` (set to the injected
`now`). Providers can never set any of these. All original provenance fields
(`provider_id`, `evidence_class`, `subject_key`, `claim_key`, `claim_value`,
`source_item_id`, `source_reference`, `observed_at`, optional
`source_updated_at`, `verification_level`, optional `note`) are retained.

## Core-generated evidence id

Providers do not choose `evidence_id`. The core builds a stable id:

```text
evidence_id = SHA-256 hex(
    provider_id  '\0'
    evidence_class '\0'
    subject_key  '\0'
    source_item_id '\0'
    claim_digest
)
```

- deterministic, lowercase hex
- two providers sharing a `source_item_id` can never collide (provider_id is
  bound)
- identical duplicate candidates deduplicate to the same id
- a provider cannot pre-choose or spoof the final id

## Claim digest (canonical JSON)

Providers never announce their own claim digest. The core computes:

```text
claim_digest = SHA-256 hex(canonicalJson(claim_value))
```

`canonicalJson` is a deterministic canonicalization: object keys are stably
sorted, array order is preserved, and null / boolean / finite number / string
use their canonical JSON form. Non-JSON-safe input is rejected with
`EVIDENCE_CLAIM_INVALID`; `JSON.stringify` insertion order can never change a
digest.

## Verification rank

`VERIFICATION_RANK = { none: 0, asserted: 1, verified: 2 }` (canonical, same
ordering as the CP2.2 contracts).

`verification_level=none` is a legal qualified state and is distinct from
`status=unverified`. A structurally and provenance-valid candidate with
`verification_level=none` produces `status=present, verification_level=none`
when the requirement's `verification_requirement` is `none`. Later
`assessEvidenceCoverage()` decides whether that is enough for a requirement
that asks for `asserted` / `verified`. `status=unverified` means the core
could not recognize the candidate's integrity / provider legitimacy /
provenance (or collection limits were exceeded).

## Evidence Provider V1 contract

```ts
interface EvidenceProviderV1 {
  readonly metadata: EvidenceProviderV1Metadata;
  collect(request: EvidenceCollectRequest): Promise<EvidenceProviderResult>;
}
```

`EvidenceProviderV1MetadataSchema` (strict):

- `provider_id` - lowercase identifier (`a-z`, digits, `-` separators)
- `version` - semantic `major.minor.patch`
- `supported_classes` - 1..100 unique class ids
- `priority` - integer 0..10000 (higher wins; ties broken by provider_id)
- `max_verification_level` - hard cap on what the provider may claim
- `description` - optional

`EvidenceCollectRequest` carries `evidence_class`, `subject_key` and an
optional `AbortSignal`. Providers return raw candidates plus a structured
outcome. They never return `EvidenceCoverageEntry`, and never decide
`present` / `verified` / `not conflicted` - coverage status is core-only.

## Provider outcomes

- `collected` - candidates returned
- `not_found` - the subject/source does not exist
- `temporary_unavailable` - transient failure (retry allowed)
- `permanent_unavailable` - the provider can never serve this class
- `user_context_required` - the provider needs user-supplied context

`EvidenceProviderResultSchema` is strict: `{ outcome, candidates (<= 10000),
diagnostics (<= 1000) }`; each diagnostic is `{ code, message }`. Business
semantics never depend on exception text.

## Provider error normalization and cancellation

`collectFromProvider()` is the fail-closed collection edge:

- an already-aborted signal throws `EVIDENCE_COLLECTION_ABORTED`
- an `AbortError`, or a result returned after the signal aborted, throws
  `EVIDENCE_COLLECTION_ABORTED`
- any other thrown provider exception is normalized to
  `temporary_unavailable` with a single `EVIDENCE_PROVIDER_ERROR` diagnostic
  whose message never echoes the original exception text (secrets cannot
  leak)
- a structurally invalid provider result is treated the same as a thrown
  provider exception

This lane implements cancellation, not network timeouts; the Guard (Lane B)
owns timeout orchestration and passes the signal.

## Internal provider registry

`EvidenceProviderRegistry`:

- `register(provider)` - validates metadata; `provider_id` is unique, and a
  re-registration of the same id - even a different instance or version - is
  rejected with `EVIDENCE_PROVIDER_DUPLICATE`
- `get(providerId)`
- `list()` - deterministic order: priority descending, then `provider_id`
  ascending
- `providersForClass(classId)` - validates the class id, filters by declared
  `supported_classes`, returns the same deterministic order

The registry is internal-only: it is not exposed over MCP, REST, Tauri IPC or
an LLM tool, so external content can never dynamically register a provider.
CP6 providers are trusted application code. Future plugin / provider loading
requires a separate security checkpoint.

## Qualification algorithm

`qualifyCandidate(rawCandidate, context)` is pure and deterministic; the
context carries the provider metadata, requested class/subject, the
requirement (for freshness) and the injected `now`. Checks run in order and
fail closed:

1. Strict schema parse - `invalid_candidate_schema`; the rejection keeps a
   deterministic `ref:<sha256>` diagnostic reference instead of a real
   evidence id
2. Class binding - candidate class must equal the requested class and must be
   in the provider's `supported_classes`, otherwise `class_mismatch`
   (`EVIDENCE_PROVIDER_CLASS_MISMATCH` semantics). A provider can never
   smuggle a different, higher-value class through `collect`.
3. Subject binding - `subject_key` must match the requested subject,
   otherwise `subject_mismatch`
4. Verification cap - if the candidate's `verification_level` ranks above
   `provider.max_verification_level`, reject with
   `verification_escalation` (`EVIDENCE_PROVIDER_VERIFICATION_ESCALATION`);
   self-promotion is never accepted
5. Timestamp validity - unparseable `observed_at` ->
   `invalid_observed_at`; `observed_at > now` -> `future_observed_at`
   (a future timestamp can never achieve permanent freshness through a
   negative age)
6. Claim integrity - the core computes `claim_digest` itself;
   non-JSON-safe claims -> `claim_invalid`
7. Freshness - see below; a stale candidate is still qualified and carries a
   `stale` issue so the builder can apply status precedence

`QUALIFICATION_ISSUE_CODES` is the stable set:
`invalid_candidate_schema`, `class_mismatch`, `subject_mismatch`,
`verification_escalation`, `invalid_observed_at`, `future_observed_at`,
`claim_invalid`, `stale`.

## Freshness

Freshness uses `observed_at` (when the provider actually observed the state),
never `source_updated_at`. The clock is injected as `now`; there is no
`Date.now()` inside qualification.

For `requirement.freshness_policy.max_age_ms`:

- `age = now - observed_at`
- `age == max_age_ms` -> fresh (boundary is inclusive)
- `age > max_age_ms` -> stale
- no `freshness_policy` -> age alone never makes evidence stale

## Conflict model

The core never uses an LLM to decide whether two natural-language claims
contradict. Conflict is a structural comparison: candidates with the same
`evidence_class` + `subject_key` + `claim_key` but different
`claim_value` canonical digests conflict. Multiple providers with the same
claim digest are corroboration, not conflict.

For a conflicted entry, the deterministic partition is: within each
`claim_key`, the primary is the candidate from the highest provider priority
(ties broken by lexical `evidence_id`); the primary and all candidates with
its digest go to `evidence_ids`, all disagreeing candidates go to
`conflict_evidence_ids`. The two lists are disjoint and sorted, satisfying
`EvidenceCoverageEntrySchema`.

## Coverage snapshot builder

`buildEvidenceCoverage(requirements, providerResults, now, { limits })`
returns `{ snapshot, diagnostics, diagnostics_truncated }`. The snapshot is
parsed through `EvidenceCoverageSnapshotSchema`, so invalid outputs can never
escape.

- requirements are validated against `EvidenceRequirementSchema` and must be
  unique by `class_id`
- provider batches are validated structurally; a malformed result shape is a
  build input error, while a malformed individual candidate is a
  per-candidate qualification rejection (the class degrades to `unverified`,
  not a build crash)
- batches are processed in canonical provider order; the class subject is the
  subject of the first canonical batch, and batches collected for other
  subjects are reported and their candidates fail subject binding
- every requirement (mandatory AND optional) yields exactly one entry; no
  required class can be omitted
- `checked_at` on every entry is the injected `now`, never a
  provider-supplied timestamp

## Status precedence

Deterministic precedence (fixed semantics):

1. no candidate at all -> `missing`
2. candidates exist but none qualify -> `unverified` (retains rejected
   evidence ids / diagnostic references)
3. qualified candidates exist but all are stale -> `stale` (`stale_since` =
   earliest `observed_at + max_age_ms`)
4. fresh qualified candidates disagree -> `conflicted`
5. fresh qualified candidates agree -> `present`

Stale candidates never override fresh candidates: a stale disagreement plus a
fresh valid candidate resolves to the fresh candidate. For `present`, the
entry's `verification_level` is the highest qualified level among the fresh
agreeing candidates (a low-level source never downgrades a verified source;
conflicts are never masked by taking the max).

## Collection bounds

Provider flooding fails closed before qualification. Defaults
(`DEFAULT_EVIDENCE_COLLECTION_LIMITS`):

- `maxProvidersPerClass` = 16
- `maxCandidatesPerProviderClass` = 100
- `maxCandidatesTotal` = 500
- `maxClaimJsonBytes` = 16384
- `maxDiagnostics` = 100

Any violation emits `EVIDENCE_COLLECTION_LIMIT_EXCEEDED` and blocks
qualification for that class with `status=unverified` - silent truncation can
never make required evidence appear satisfied. Diagnostics are truncated at
`maxDiagnostics` with an explicit `diagnostics_truncated` flag.

## Determinism

The same `(requirements, providerResults, now, limits)` input always produces
the same snapshot: canonical batch ordering (provider priority desc, then
provider_id asc), core-generated ids, canonical claim digests, and sorted id
lists / conflict partitions. Batch input order does not change the output.

## Secret handling

- provider exception text is withheld (`EVIDENCE_PROVIDER_ERROR`)
- core diagnostics never print `claim_value`; only digests / metadata / issue
  codes
- `source_reference` must not contain raw tokens, authorization headers,
  credentials or session cookies (bounded to 1000 chars)

## Integration with assessEvidenceCoverage

The builder output is the CP2.2 `EvidenceCoverageSnapshot` and is consumed
unchanged. Tests feed builder output directly into
`assessEvidenceCoverage()` and verify: mandatory missing -> block, mandatory
stale -> block, mandatory unverified -> block, undeclared conflict policy ->
reject / block, `conflict_policy=warn` -> tolerated warning, optional missing
-> non-blocking. No assessment logic is duplicated.

## CP6 DOES NOT USE LLMs TO DECIDE WHETHER EVIDENCE IS VALID

Validity is structural: strict schema, class/subject binding, provider
verification cap, timestamp validity, claim digest integrity, freshness and
digest-based conflict detection. No LLM call, no semantic conflict
classification, no natural-language validity judgment exists in this lane.

## No process execution

No runtime code in this lane uses `child_process`, `spawn`, `exec`,
`execFile`, `Command::new`, `powershell`, `cmd.exe` or `sh -c`. Only
deterministic fake providers exist for tests.

## Tests

- `brain-server/tests/goal24-evidence-core.test.ts` - 29 tests: strict
  candidate / provider / result schemas, executable-shaped field rejection,
  length bounds, non-JSON-safe claims, claim digest key-order invariance,
  evidence id determinism / no cross-provider collision, registry duplicate
  and ordering rules, collection normalization, abort semantics
- `brain-server/tests/goal24-evidence-qualification.test.ts` - 34 tests:
  fresh -> present; none + none -> present with verification_level none;
  none + verified -> present/none but `assessEvidenceCoverage` blocks;
  verification escalation -> unverified; unsupported class fail closed;
  future observed_at -> unverified; age == max fresh / age == max + 1 stale;
  no candidate -> missing; only invalid -> unverified; two agreeing providers
  -> present; two conflicting providers -> conflicted with disjoint
  partition; stale disagreement + fresh valid -> fresh wins; duplicate source
  item handling; deterministic ids / digests / priority; every requirement
  covered; optional requirement gets an entry; all collection-bounds
  fail-closed cases; provider exception normalization; abort / cancel
  respected; direct `assessEvidenceCoverage` integration cases

Fakes live in `brain-server/tests/helpers/fake-evidence-providers.ts` and
are fully deterministic (no timers, no randomness, no process execution).

## Verification gates

- `npx tsc --noEmit` - PASS
- `npx vitest run` - PASS (49 files, 826 passed, 0 failed; 63 new CP6 tests)
- build (`tsc` emit) - PASS
- lint - PASS (0 errors; only pre-existing warnings outside this lane)
- `git diff --check` - PASS
- static no-execution scan of `brain-server/src/evidence` - PASS
- `npm audit` - not run; no dependency changes

## Known limitations

- Guard-level timeout / cancellation orchestration, retrieve_more /
  clarify / defer, and Decision Kernel wiring are Lane B; CP6 only exposes
  the `AbortSignal` contract and the snapshot
- The class subject is taken from the first canonical batch; collecting one
  class for multiple subjects requires separate builds (a later
  guard/subject-management concern)
- Provider trust is registration-time trust of application code; dynamic
  plugin/provider loading is a separate security checkpoint
- `source_reference` content is provider-supplied; the core bounds its length
  but cannot verify its secret-free content
- This lane ships only deterministic fake providers; the GitHub live
  provider, HTTP / MCP providers and CLI spawning belong to later lanes