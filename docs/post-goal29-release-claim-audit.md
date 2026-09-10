# Post-Goal29 Release Claim Audit

> Audit date: 2026-09-10
> Truth baseline: `main@d4d61f1c9b73d8a127023129adc3376ec6d7db13`
> Scope: public/release-facing narrative only. No product semantics, scientific artifacts, Holdback data, or release branch are modified.

## 1. Authoritative facts

The current release narrative must respect the repository truth chain:

`remote SHA / protected refs > checkpoint gate + manifest > execution ledger > executor report > chat memory`.

Verified facts relevant to release claims:

- Goal29 V1 feature freeze is active.
- Goal29 added no new product feature and changed no product semantics.
- Windows controlled V1 evidence is PASS: Brain 1336/0, CLI 44/0, Rust 236/0 (9 ignored), browser extension 14/0, installed Desktop E2E 11/11.
- DRG1 is SATISFIED.
- DRG2 is SATISFIED by one real, non-synthetic, approval-gated GitHub issue-close E2E with independent read-back.
- In that E2E, process exit 0 did not equal semantic success: outcome remained PENDING until trusted read-back observed CLOSED, then the deterministic evaluator returned VERIFIED.
- DRG2 satisfaction is not an automatic public release.
- `omctx@0.1.0-alpha.0` is internally verified/private and is not an npm user install today.
- `omctx reopen` remains FUTURE.
- No claim of working with any memory OS or any runtime is permitted.
- No claim of generic shell execution, LLM judge, automatic rollback, or public GitHub automation is permitted.

## 2. Findings

### MUST FIX — resolved on this branch

1. `docs/PRODUCT-VISION.md` still listed a real non-synthetic E2E as FUTURE and described DRG2 in pre-pass language.
2. `docs/index.html` still showed a pre-pass DRG2 gate card even though the authoritative DRG2 gate is PASS.

Both are synchronized on this branch without changing product semantics.

### MUST NOT SHIP AS CURRENT COPY

The following files remain historically useful but contain pre-O1 / memory-centric launch language and must not be copied into current release material without a rewrite:

- `docs/MARKETING.md`
- `docs/SOCIAL-POST-READY.md`
- `docs/DEMO_SCRIPT.md`

Examples of stale positioning include "跨所有 AI 通用", "one memory, shared across every AI", "Long-term memory for any AI", and a demo centered on cross-client shared memory rather than the current Judgment / Authority Core thesis.

These files are marked LEGACY on this branch.

### REVIEW BEFORE RELEASE, not currently proven stale

- `docs/ARCHITECTURE.md`
- `docs/MCP-INTEGRATION.md`

They primarily describe implementation/integration surfaces. Their client examples do not by themselves constitute the forbidden "works with any runtime" claim, but release-facing excerpts should be checked against current claim labels.

## 3. Current launch-safe product story

Category headline:

> Evidence-grounded decision control for long-lived AI agents.

Trust anchor:

> Local-first, read-back verified, and owned by you.

Mechanism:

> Qualify evidence before action → bind execution to the decision → read the world back → reopen/revise when reality disagrees.

Current public evidence must distinguish:

- CURRENTLY_VERIFIED user-facing capabilities;
- CURRENTLY_VERIFIED_INTERNAL runtime evidence;
- TARGET architecture;
- FUTURE capabilities.

## 4. Release sequence after Goal29

DRG2 is no longer the blocker. The remaining release work is:

1. Packaging
2. Public CLI alpha decision
3. Public demo
4. Launch package
5. Final release claim audit

No new paid model evaluation is required for this release sequence.
