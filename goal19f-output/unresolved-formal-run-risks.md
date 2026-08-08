# Unresolved Formal-Run Risks (Goal 19F)

Status: `FORMAL_EXPERIMENT_READY_WITH_BLOCKERS`. One blocker (B1) and several
documented risks remain; none blocks preflight infrastructure, and none was
introduced by this goal. Each risk has an owner/mitigation.

## R-B1 — Model selection and budget (RESOLVED 2026-08-07)

- Status: CLOSED. Owner decision signed: `model-and-budget-owner-decision.json`
  (schema_version 2, `approval_status=OWNER_APPROVED`, `owner.role=PROJECT_OWNER`,
  `signature.cryptographic_signature_status=NOT_REQUIRED`).
- Decided: main model `deepseek-v4-flash` (DeepSeek V4 Flash); auxiliary
  evaluator `kimi-k2.6` (Kimi 2.6, auxiliary only); budgets DeepSeek ¥200 /
  Kimi ¥20 / total hard cap ¥220; remote synthetic benchmark processing approved
  with restrictions; preferred night window 20:00–02:00 local with
  `run_any_time_if_operationally_preferable=true`.
- Remaining execution-time recordables (not blockers): provider snapshot/version,
  serving hash, max_output_tokens, timeout, per-call price — recorded at provider
  confirmation before the first formal call.

## R-ENV-1 — Product worktree cleanliness (pre-existing untracked files)

- What: the product worktree at e136732 contains pre-existing untracked files
  (`_audit-dump.csv`, `_audit-dump.json`, `experiments/decision-benchmark/ablation/`
  legacy copy). Identity is blob-pinned and `dirty=true` is recorded, but a
  formal run should execute from a clean checkout to eliminate any ambiguity.
- Mitigation: formal-run requirement — clean product worktree (move untracked
  artifacts aside or list them in the freeze manifest before the formal run).

## R-ADP-1 — Lexical retrieval stand-in (documented confound)

- What: the unified adapter ranks with the product's `memoryCandidateScore`
  (historicalMode, lexical) because the offline fixture environment has no live
  embedding service. This is a stand-in, not the product's embedding pipeline.
- Impact: formal results generalize to "retrieval = memoryCandidateScore", not
  to a specific embedding service. Because A1–A5 all use the SAME adapter, it is
  not an arm-comparison confound, but it bounds external validity.
- Mitigation: documented in `retrieval-adapter-parity-report.md`; preregistration
  amendment recommended before the formal run if embedding retrieval is intended.

## R-LLM-1 — Residual API nondeterminism at temperature 0

- What: LLM providers may still show nondeterminism (batching, serving version,
  seed support). Byte-stability was proven with the deterministic stand-in.
- Mitigation: temperature 0 fixed; seed recorded when supported; the
  determinism-sample re-evaluation check runs in the formal run; any mismatch is
  reported (not silently retried). Model identity recorded per response.

## R-API-1 — Model serving drift between runs

- What: provider model snapshots can change between the development and
  regression formal runs.
- Mitigation: snapshot date + serving version hash pinned in the authorization;
  `MODEL_IDENTITY_MISMATCH` invalidates the run (`invalid-run-policy.md`).

## R-PROMPT-1 — system.txt arm-capability block wording

- What: system.txt necessarily differs per arm (it declares the arm's
  capabilities). If the block's wording differs in ways beyond the declared
  capabilities, it could act as a prompt confound.
- Mitigation: block is generated from the same flag set as the arm matrix; all
  other prompt files byte-identical; component diff + prompt-consistency checks
  pass; the diff is inspectable per run (`prompts/A0..A5/system.txt`).

## R-DET-1 — Determinism evidence currently stand-in-only

- What: byte-stability and determinism checks ran with
  `PREFLIGHT_DETERMINISTIC_PLANNER-v0`.
- Mitigation: the formal run repeats the determinism check on the real model
  (same code path, 3 samples) and records it in `dry-run-report.json`.

## R-HOLD-1 — Holdback single-use integrity

- What: the holdback must be used exactly once at the end; accidental exposure
  would invalidate the paper's confirmatory claim.
- Mitigation: this goal and the harness never load goal18 validation/holdback
  fixtures; dataset manifests cover only development/regression; the harness
  rejects missing/mismatched fixture paths.

## R-EGR-1 — Data egress for remote models

- What: fixtures are synthetic but leave the machine if a remote provider is
  selected.
- Mitigation: documented in preregistration §4; local-only fallback;
  owner-decision requires an egress statement when remote.

## R-COST-1 — Formal run cost overrun

- What: API spend depends on tokens per sample and retries.
- Mitigation: budget formula (samples × attempts × tokens) and a hard cost cap in
  the owner decision; overrun = invalid run.

## R-SCORE-1 — Scorer identity drift

- What: scorer v1.1 is sealed, but the formal run must re-verify its identity
  hash.
- Status: pinned at commit `5cac8ae975174efc19149996d737581df2aa33c2`; all 4
  scorer/gold blobs verified blob-identical to product e136732; conformance
  19/19 pass.
- Mitigation: per-run `git-identities.json` compares against
  `3b4c7a2441bed3ad1b1019b104948f93d59d53ed5bfeaabe307a6e6a5a5ddbbb`; mismatch
  invalidates the run.

## R-BUDGET-1 — Provider pricing not yet confirmed (execution gate, not a blocker)

- What: per-call token pricing for `deepseek-v4-flash` / `kimi-k2.6` is not yet
  confirmed; validation (120) and holdback (180) cost estimates are
  therefore structural until pricing is recorded.
- Gate: estimates must be finalized within the ¥220 hard cap BEFORE the first
  formal call; if the projection exceeds ¥220, stop, report the gap, and await a
  new owner approval. No spend has occurred.
