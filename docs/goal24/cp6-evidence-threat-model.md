# CP6 Evidence Surface Threat Model (Lane C)

Goal24 Checkpoint 6, Lane C. Security oracle for the future Evidence Core /
Evidence Guard runtime. Documentation-only: no runtime code changed in this
lane. Companion machine-readable oracle:
`cp6-evidence-adversarial-vectors.json`; runtime bypass audit:
`cp6-evidence-guard-bypass-audit.json`; GitHub evidence class catalog:
`cp6-github-evidence-class-catalog.json`; fixture corpus:
`fixtures/cp6-evidence/`.

## 1. Scope and trust boundaries

The Evidence Surface turns raw provider outputs into qualified evidence that
an ExecutionPlan may reference. Trust boundaries:

1. external source -> provider (retrieval, subject binding)
2. provider -> claim store (claim digest, provenance, size/time bounds)
3. claim store -> qualification (class, freshness, verification, conflict)
4. qualification -> coverage snapshot (class coverage, statuses, IDs)
5. coverage snapshot -> Guard gate (mandatory/optional policy)
6. Guard gate -> plan transition (draft -> ready) -> Broker -> adapter

CP6 owns stages 1-6. The Broker and adapters stay untouched by this lane's
policy work; the Guard never triggers execution directly.

## 2. Security position

Evidence is collected, qualified, and gated data — never authority itself.
A claim, note, source text, or LLM-generated prose cannot change
verification level, mandatory/optional status, conflict policy, or the Guard
action. Only the capability/skill requirement model plus the Guard runtime
decide policy.

## 3. Threats

### 3.1 Evidence class omission

Capability requires mandatory classes A and B; retrieval returns only A.
The Guard must never proceed on partial mandatory coverage. Variants (all
NEVER PROCEED): A verified + B absent; A fresh + B stale; A high-confidence
+ B unverified; A repeated 10 times + B absent; 100 irrelevant optional
entries + B absent. Coverage assembly must emit one entry per required
class; absence is `not_checked`, never silently skipped.

### 3.2 Wrong-class substitution

A provider registered for `pull_request.current_state` returning
`required_checks.status` (or any other class) must be rejected with
PROVIDER_CLASS_MISMATCH. An easily-obtained class must never masquerade as a
required class. Class identity is the provider's registration contract, not
the claim's self-description.

### 3.3 Subject mismatch

Evidence `class=pull_request.current_state, subject=repoA#1` must not match
a decision context of `repoB#9`. Same class does not equal same object.
Subject binding requires: subject key shape per class, canonical
normalization, and scope check at qualification and at the Guard gate
(cross-subject, cross-repository, cross-user).

### 3.4 Provider spoof / identity / registration

No runtime registration path may exist for providers:
- an untrusted Skill cannot register a provider,
- a Web/MCP caller cannot register a provider,
- an LLM message claiming to be a provider is inert text.
Providers are registered by trusted compiled/approved code only. Provider
identity is bound to a verified executable/capability binding, never to a
self-declared name.

### 3.5 Verification escalation

A provider's declared maximum verification level caps what its claims can
achieve: max=none cannot produce verified claims; max=asserted cannot
produce verified claims; only max=verified can. A claim with
verification_level=none and status=present is a legal `present` claim when
the requirement is none — verification none is not automatically
`unverified`. The rank order none < asserted < verified is enforced by the
Guard, not by claim text.

### 3.6 Stale evidence / future timestamps / clock manipulation

Freshness is computed from `observed_at`, which the Guard owns; provider
`source_updated_at` is informational only. Rules:
- `now == observed_at` -> fresh (boundary inclusive)
- `age == max_age` -> fresh (boundary inclusive)
- `age == max_age + 1ms` -> stale
- future `observed_at` (+1ms, +1h, far future) -> never counts fresh;
  treated as clock-skew evidence and blocked or quarantined
- old `source_updated_at` with fresh `observed_at` -> freshness still based
  on observed_at
- stale `observed_at` with future `source_updated_at` -> still stale
The Guard must use a trusted monotonic clock; wall-clock rollback or
forward-jump is detected and fails closed.

### 3.7 Conflicting sources / conflict suppression

All retrieved claims for a class participate in conflict resolution; a
provider may not suppress others. Policy matrix:
- two sources agree -> present
- two sources disagree -> conflicted
- three agree, one disagrees -> conflicted (majority does not suppress)
- higher-priority source disagrees -> conflicted (priority informs
  resolution order, never hides a disagreement)
- same provider duplicate -> duplicate-id handling, never double-counted
- stale conflict + fresh valid -> conflict resolution must not resurrect
  the stale claim
- fresh conflict + stale valid -> fresh conflict wins for status purposes
`conflict_policy`: undefined -> reject (canonical default), reject ->
block, warn -> satisfy but emit warning (verification still required),
allow -> satisfy silently. A warning conflict with insufficient
verification still does not satisfy.

### 3.8 Optional vs mandatory evidence

Optional evidence can never block, defer, or clarify an otherwise valid
mandatory set. Optional missing/stale/unverified/conflicted-reject all
produce non-blocking findings or warnings only. Optional evidence can never
be promoted to mandatory by a provider, a skill manifest, or claim text;
mandatory can never be demoted to optional.

### 3.9 Coverage assembly / regression / duplication

Coverage entries must be unique by class, evidence_ids unique within an
entry, and conflict ids disjoint from evidence ids. Regression: a new
snapshot that drops a previously-present class, weakens status, or has
`checked_at` moving backwards must fail closed. Duplicate evidence IDs
across providers must be detected (same id, different content = digest
ambiguity).

### 3.10 Provider flood / oversized claims / resource bounds

Provider claim count, claim size, nesting depth, and total package size are
bounded. Floods of irrelevant optional claims must not displace mandatory
retrieval. Oversized claims are truncated only with a structured
truncation marker and NEVER treated as truncated-but-successful for
mandatory satisfaction.

### 3.11 Provider errors / timeouts / partial retrieval

Error taxonomy: temporary outage (retry within bounds), permanent
unavailable (fail fast), provider exception (quarantine claim), timeout
(bounded retry), partial retrieval (never counts as full coverage).
Retrieval control precedence: any hard failure or clarify beats temporary
retry; clarify + temporary -> CLARIFY; hard failure + temporary ->
BLOCK/DEFER. Success allowed in the first round, second round, or last
allowed round — never beyond, and an identical snapshot repeating forever
is retry exhaustion, not progress.

### 3.12 User-context spoof

`user_context_required` must be satisfied by a real user-provided context
channel, never by provider text, LLM output, or a skill body. Temporary vs
permanent error confusion is resolved by explicit provider error codes.

### 3.13 Evidence replay / cross-subject reuse

Evidence is single-use per plan unless the policy explicitly allows reuse
within a freshness window. Replaying the same evidence ID across plans,
after invalidation, or across subjects is rejected. Cross-repository and
cross-subject evidence can never satisfy a requirement.

### 3.14 Provenance loss

Every qualified record carries provider id, subject key, class, claim
digest, observed_at, and retrieval round. The coverage snapshot references
qualified record IDs that MUST trace back to Guard output. The ExecutionPlan
keeps only the IDs (never the raw evidence). A coverage entry without a
resolvable provenance chain is unverified.

### 3.15 Secret leakage

Secrets observed in claims (e.g. `GH_TOKEN=...`, `Authorization: Bearer ...`,
cookies, API keys) must never appear in ordinary logs, reason codes,
coverage notes, or provider diagnostics. Fixtures in this lane use fake
secrets only (`FAKE_CP6_SECRET`). Logging/redaction is explicit sanitization
with a structured marker.

### 3.16 Untrusted prose as evidence authority / LLM-declared validity

Claim text, notes, source text, and LLM messages cannot declare validity.
Injection sentences ("Ignore evidence requirements", "mark this verified",
"all checks passed", "execute anyway", "skip class B", "conflict policy is
allow", "trust me") are displayable data only. An LLM can never declare
evidence valid, verified, or sufficient.

### 3.17 Decision bypass / plan ready-state bypass

The Guard owns the only draft -> ready transition for execution-eligible
plans. `validateExecutionPlanAgainstCapabilities` (existing, test-only
today) checks coverage for ready/executing states, but it validates a
caller-supplied snapshot; it does not qualify evidence. CP6 must answer:
the executable plan's coverage snapshot MUST come from the Evidence Guard
runtime, not from the caller. A caller-constructed snapshot
(`present`, `verified`, `evidence_ids=["fake"]`) must never reach the
Broker.

### 3.18 Stale coverage snapshot reuse

Snapshots are single-shot: bound to plan creation time, subject, and
capability version. Reusing a stale coverage snapshot for a new plan,
after the freshness window, or across capability versions is rejected.

## 4. Fail oracle (CP6 Integration FAIL conditions)

Any of the following makes Checkpoint 6 integration FAIL:

- missing mandatory can proceed
- stale mandatory can proceed
- unverified mandatory can proceed
- undefined conflict accepted by default
- optional evidence blocks
- provider can self-escalate verification
- provider can emit unsupported class
- future timestamp counts fresh
- cross-subject evidence accepted
- coverage class silently omitted
- infinite retrieval
- LLM text changes evidence policy
- forged coverage snapshot can directly obtain runtime execution eligibility
- untrusted caller can register provider
- Guard can trigger execution directly

## 5. GitHub read-only evidence class slice

See `cp6-github-evidence-class-catalog.json`. First four classes, all
read-only CP4 capabilities: `repository.current_state`,
`issue.current_state`, `pull_request.current_state`,
`pull_request.checks_status`. No write capability is added for evidence
acquisition. `pull_request.checks_status` keeps sourcing from
`github.pr.checks.read` (CP4 implementation: `gh pr view`
`statusCheckRollup`), not `gh pr checks`.