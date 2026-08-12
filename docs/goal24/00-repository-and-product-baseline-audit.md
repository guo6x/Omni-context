# Goal24 — Repository & Product Baseline Audit

Date: 2026-08-12
Status: BASELINE AUDIT COMPLETE
Scope: repository hygiene + Goal24 engineering start only. No scientific artifact, benchmark, Gold, scorer, raw output, Holdback, or paper freeze is modified by this document.

## Canonical engineering start

- Repository: `guo6x/Omni-context`
- Goal24 development branch: `dev/goal24-cli-skills`
- Goal24 base branch: `product/omni-v3-unified-r1`
- Base SHA: `d89675a2e9f60cf8b7f9221dd19ca224b9a103e9`
- Base identity: engineering product baseline; NOT an official frozen experiment product.
- `main` remains unchanged at `960e0cf2abc0c3859a7dbb45eac2555f12035ffd` and is not used as the Goal24 base.

Why this base: `product/omni-v3-unified-r1` explicitly records itself as the engineering product baseline and contains six product-only commits after `17dc1d0`, including unified business dispatch, embedding migration design, clean-room hardening, privacy/device security, and final product-risk/build reports.

## Branch hygiene audit

### Safe branch-pointer deletions

The following branches are strictly contained by a later branch or are exactly preserved by an existing tag. Deleting these branch refs does not delete reachable commits.

1. `pre-evaluation-hardening-v1`
2. `pre-evaluation-hardening-v2`
3. `pre-evaluation-hardening-v3`
4. `pre-evaluation-hardening-v3.1`
5. `pre-evaluation-hardening-v3.2`
   - all are ancestors of `codex/pre-evaluation-hardening-v3.2.1`

6. `codex/omni-cognitive-benchmark-v1`
7. `codex/omni-cognitive-benchmark-v1.1-pre-run-hardening`
   - both are ancestors of `codex/omni-cognitive-benchmark-v1.1-answer-diagnostics`

8. `codex/omni-paper-evidence-v1`
9. `codex/omni-paper-manuscript-assets-v1`
   - both are ancestors of `codex/omni-external-eval-and-paper-v1`

10. `codex/omni-context-evaluation-freeze-v1`
   - branch tip is exactly `872723b10ec4ae99b8272606a183155837104332`
   - existing tag `omni-context-evaluation-freeze-v1` points to the same commit

### Preserve / do not delete yet

These refs have unique history, active meaning, or require a separate owner decision:

- `main`
- `product/omni-v3-unified-r1`
- `dev/goal24-cli-skills`
- `benchmark/decision-v1`
- `codex/omni-cognitive-benchmark-v1.1-answer-diagnostics`
- `codex/pre-evaluation-hardening-v3.2.1`
- `codex/omni-evaluation-candidate-v3`
- `codex/omni-evaluation-candidate-v3.1-final`
- `codex/omni-v3.1-strict-ablations`
- `codex/omni-external-eval-and-paper-v1`
- `codex/omni-longmemeval-s-formal-v1`
- `research/decision-benchmark-holdback-v2`
- `trae/solo-agent-F9HYOB`

Several of these branches are diverged rather than simple ancestors; they must not be deleted merely because their names look old.

## Tag audit relevant to cleanup

Existing tags observed:

- `v3.0.0`
- `v0.1.1`
- `omni-context-evaluation-freeze-v1` -> `872723b...` (keep)
- `evaluation-freeze-candidate-v2` -> `be20db6...`
- `evaluation-freeze-candidate-v1` -> `3bdb6e1...`
- `evaluation-freeze-candidate-v3.1` -> `17dc1d0...`

Important: the product baseline itself records `evaluation-freeze-candidate-v3.1` as misleading/deprecated. Goal24 must not move or repurpose scientific freeze tags.

## Main-branch policy

Do NOT fast-forward or force-update `main` during Goal24 baseline work. `main` is materially older than the product baseline. Moving it should be a separate release/integration decision after Goal24 regression, desktop packaging, and security checks pass.

## Scientific separation

Goal24 is post-evaluation product engineering. It must not:

- reopen Holdback;
- alter frozen benchmark fixtures or Gold;
- alter frozen scorers or formal raw outputs;
- rewrite scientific history;
- present product regression results as confirmatory evidence.

Any Goal24 regression fixtures are engineering evidence only.

## Cleanup action still requiring a branch-delete-capable client

The connected GitHub tool used for this audit can inspect/create branches but does not expose branch-ref deletion. The ten safe deletions above should therefore be executed later through GitHub UI or `git push origin --delete <branch>` after one final fetch/prune check.
