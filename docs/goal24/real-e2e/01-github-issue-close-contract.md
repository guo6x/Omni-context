# Post-CP8 Real E2E — github.issue.close Contract

## 1. Capability declaration (Brain)

Source: `brain-server/src/capabilities/github-write.ts`

- id: `github.issue.close`
- version: `1.0.0`
- inputs (canonical, strict): `owner` (CP4 safe subset 1..39), `repo`
  (CP4 safe subset 1..100), `number` (integer ≥ 1). Unknown keys are
  rejected; no argv/executable/cwd/env/shell/flags fields exist.
- side_effect_class: `reversible_write`
- risk_level: `medium`
- required_authority: `L2`
- reversible: `true`
- approval: REQUIRED (CP7 V1 policy: only read_only+low+L0 is approval-free;
  this write is none of those).
- required_evidence (CP6, both mandatory):
  - `repository.current_state` (verification_requirement asserted,
    max_age 24h) — repository identity exists and is observable
  - `issue.current_state` (verification_requirement asserted, max_age 5m) —
    the exact issue exists AND its current state
- verification_capability: `github.issue.read`
- rollback_capability: `github.issue.reopen` (declared for rollback-candidate
  metadata only; NO production reopen binding is added in this lane).

### Policy choice justification (medium / L2 / reversible_write)

The existing taxonomy (L0 read-only → L3 highest) has no write example yet.
Closing an issue mutates shared, publicly visible tracker state; it is
reversible (reopen) and low blast radius. `reversible_write` matches the
taxonomy exactly. `medium` (not `low`) because the effect is external and
shared — a wrong close is user-visible. `L2` (not `L1`) because the mutation
is owner-visible on a public repository and CP7 grants require
actor_authority ≥ required_authority (an owner at L3 satisfies L2; an L2
requirement keeps elevated, explicit human approval mandatory while staying
below the L3 reserved band). Approval is mandatory under the fixed CP7
policy either way.

## 2. Native execution binding (Rust)

Source: `desktop-daemon/src-tauri/src/github_cli/close_binding.rs`

- binding_id: `github-cli.issue.close`; adapter: `github-cli`
- executable: the shared validated pinned `gh.exe` (trusted operator config
  `OMNI_GITHUB_CLI_EXE` → standard install → PATH discovery; bare `gh` never
  accepted).
- argv (the ONLY construction path, fused elements):
  `gh issue close <number> --repo=<owner>/<repo>`
- no shell ever; cwd = adapter-owned work root; env = minimal allowlist
  (USERPROFILE/APPDATA/LOCALAPPDATA) + broker fail-safe secret strip;
  GH_TOKEN/GITHUB_TOKEN are never inherited and their presence in the
  broker environment blocks execution.
- risk policy compiled: medium/L2/reversible_write — any plan whose risk
  snapshot differs is rejected (PlanRejectedRiskPolicy) before spawn;
  approval cannot be opted out (PlanRejectedApprovalPolicy); missing grant
  → PlanRejectedApproval.

## 3. Read-back binding (Rust)

Source: `desktop-daemon/src-tauri/src/github_cli/readback.rs`

- capability: `github.issue.read` (read_only/low/L0, enforced at
  registration by the CP8 runner).
- argv: identical to the CP4 read template
  (`gh issue view <number> --repo=<owner>/<repo> --json=ISSUE_VIEW_FIELDS`).
- parse: strict single-JSON-document parse of bounded, redacted stdout;
  malformed → empty-object payload + parser_status malformed; truncated →
  never reported as complete.
- subject_key: `issue:<owner>/<repo>#<number>` (CP6 canonical shape).

## 4. Verification plan (Brain)

- verification_capability_id: `github.issue.read`
- verification_inputs: the EXACT same canonical inputs
  `{ owner, repo, number }` (immutable after approval via the CP7 binding
  digest + receipt verification_plan_digest).

## 5. Deterministic evaluator (Brain)

Source: `brain-server/src/outcome/evaluators/github-issue-close-evaluator.ts`

- evaluator_id `github-issue-close-evaluator`, capability
  `github.issue.close`, verification capability `github.issue.read`.
- expectation derived ONLY from the approved plan: subject
  `issue:<owner>/<repo>#<number>`, assertions
  `{ owner, repo, number, state: 'CLOSED' }`.
- evaluate: payload.number === number AND payload.state === 'CLOSED' ⇒
  verified; exact number with any other state ⇒ mismatch (case-sensitive,
  no aliasing); non-conforming payload ⇒ inconclusive. Process metadata
  (exit code, timeout, cancel) is ignored by design.
- no LLM judge; no caller predicate/regex/JSONPath/judge prompt can exist
  on the strict schemas.

## 6. Write-enablement prerequisites (CP8 gate, all PASS)

- approval policy PASS (CP7 fixed V1 policy; binding digest; durable
  single-use grants; consume-before-spawn)
- native execution binding PASS (close binding above, CP3 containment)
- trusted receipt PASS (CP8 FileExecutionReceiptStore, digest integrity,
  crash recovery)
- complete readback mapping PASS (issue.close = MAPPED in the CP8 catalog)
- deterministic evaluator PASS (close evaluator above)
- subject locator PASS (exact owner/repo#number from approved inputs;
  no stdout-derived locator)
- no unresolved verification gap (none for issue state via github.issue.read)

## 7. Revisit / reversibility

- VERIFIED ⇒ revisit_required=false; MISMATCH/INCONCLUSIVE/
  VERIFICATION_FAILED ⇒ true (CP8 derivation).
- rollback_candidate is recorded only as metadata; no Revisit engine, no
  automatic rollback, no automatic write retry in this lane.
