# Post-CP8 Real E2E (DRG-2 Candidate) — Scope and Threat Model

Status: feature lane `local/goal24-real-e2e` (branch `dev/goal24-real-e2e`), NOT CP9.

## 1. What this lane is

One and only one objective: prove a real, non-synthetic, user-understandable
closed loop against the real GitHub external world:

`Evidence → Decision → Approval → Real External Execution → Persistent
Receipt → Independent Read-back → Trusted Outcome → Revisit Signal`

This is NOT a new security checkpoint, NOT CP9, NOT a product CLI (omctx),
NOT a launch. It is DRG-2 candidate engineering: the first production
semantic write capability (`github.issue.close`) end to end.

## 2. Frozen scope

- Exactly ONE new production write capability: `github.issue.close`
  (the only CP8 read-back mapping that is MAPPED without gaps).
- No `github.issue.create` (LOCATOR_GAP), no `github.issue.comment`
  (READBACK_CAPABILITY_GAP), no `github.issue.reopen`, no
  `github.pr.merge` (MAPPED_PARTIAL), no generic shell, no arbitrary
  gh command, no generic GitHub write.
- Reversibility: `reversible=true` (GitHub reopen exists) and
  `rollback_candidate` is recorded when a mismatch carries a rollback plan;
  NO `github.issue.reopen` production binding is added. NO automatic
  rollback, ever. If the E2E accidentally closes a wrong issue the operator
  restores it manually OUTSIDE Omni.
- Retry: read-back only, Brain default ≤ 3, native hard ≤ 5. The close write
  is NEVER retried automatically; an OPEN read-back is a MISMATCH, never a
  reason to close again.

## 3. Trust chain (all existing pipelines, nothing re-invented)

| Stage | Runtime | Authority |
| --- | --- | --- |
| Evidence | CP6 EvidenceSurfaceRuntime + harness-local trusted gh provider | provider claims (asserted), subject binding via trusted resolvers |
| Decision | decision-store (Brain) | decision_id bound into the plan |
| Plan | CP7 AuthorizationService.authorize | server-derived risk/approval/coverage; caller JSON can never carry authority keys |
| Approval | CP7 Brain grant-apply + native ApprovalAuthority | single-use, plan-bound, expiry-capped, consume-before-spawn |
| Execution | CP3 restricted Broker + new github.issue.close binding | fixed fused argv, pinned validated gh.exe, no shell, env/cwd allowlists, secret strip |
| Receipt | CP8 FileExecutionReceiptStore | exit 0 = process_succeeded ONLY |
| Read-back | CP8 ReadbackRunner + new github.issue.read readback binding | structured observation, no verified field |
| Outcome | CP8 OutcomeService + new deterministic close evaluator | VERIFIED only on exact subject + state CLOSED |
| Revisit | CP8 revisit_required derivation | boolean signal; no Revisit engine, no rollback execution |

## 4. Threat model (adversarial view)

Attackers considered: the IPC/WebView caller, the LLM, skills, prompt
injection, a forged bridge file, and the operator making mistakes.

- Caller argv/executable/cwd/env/flags injection → rejected by
  `deny_unknown_fields` input structs, fused argv construction, reserved-key
  gate, compiled cwd/env allowlists and the broker's fail-safe secret strip.
- Option injection through owner/repo/number (leading dash, newline, NUL,
  whitespace, `--repo`, path separators) → rejected by the CP4 pattern
  validators (no trimming, exact ASCII subsets).
- Wrong repo / wrong issue / zero / negative / huge number → structural
  rejection or a natural gh failure that can never become success; the
  read-back then mismatches (wrong subject) or fails.
- Fake approval / expired approval / replayed approval → the native grant is
  store-backed, single-use, expiry-capped and binding-digested; the Brain
  honors only the native-verified grant (token digest equality).
- Forged receipt / forged observation → bridge data is digest-verified
  (native receipt identity digest recomputed; observation payload digest
  recomputed); OutcomeService accepts ids only.
- "stdout says closed" / exit 0 → irrelevant: the evaluator reads ONLY the
  trusted read-back payload. exit 0 before read-back ⇒ OUTCOME PENDING.
- Nonzero / timeout / cancel with effect → read-back remains eligible;
  process metadata can never steer the verdict either way.
- Stale / future / duplicate / cross-boundary observations → freshness +
  identity binding + single-use observation ids reject them.
- Caller expectation override (expected_state / predicate / regex / JSONPath /
  judge prompts) → impossible on the strict schemas; expectation comes only
  from the trusted evaluator registry.
- Write retry attempt → plan ids are single-use (durable ledger); the harness
  executes exactly once; nothing in the outcome layer can spawn a process.
- Secret leakage → no token is read, printed or inherited; gh auth stays in
  the OS credential store (only `gh auth status` is allowed as a check).

## 5. Operator harness (dev-only, internal)

Because no user-facing surface exists to trigger the full chain, a narrow
dev-only harness runs it:

- `brain-server/scripts/goal24-real-e2e/brain-phase.ts` (tsx, two modes)
- `desktop-daemon` `goal24_real_e2e_native_phase` (#[ignore] cargo test,
  env-gated)

The harness supports exactly `github.issue.close`; it accepts no arbitrary
capability id, no arbitrary argv, no receipt JSON, no observation JSON and
no outcome verdict. Approval is a one-time human artifact file containing
exactly `APPROVE <owner>/<repo>#<number>`, consumed (deleted) by the
native phase — there is no auto-approve flag. It is explicitly NOT the
future `omctx` CLI (Narrative Track owns that surface).

## 6. Security surface at the end of this lane

`generic_execute_ipc=NO`, `public_readback_ipc=NO`,
`public_outcome_finalize_api=0`, `public_arbitrary_approval_api=0`,
`LLM_judge=NO`, `automatic_rollback=NO`,
`generic_gitHub_write=NO`, `production_write_capabilities=1`
(github.issue.close).
