# 02 — Branch Ancestry Audit

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12
Method: real Git ancestry only — `git merge-base`, `git merge-base --is-ancestor`,
`git rev-list --count A..B`, `git rev-list tip --not <other refs>`, `git branch -r --contains`,
`git tag --contains`, `git ls-remote --tags`.

Baseline refs for the audit: `origin/main` = 960e0cf2, `origin/product/omni-v3-unified-r1` = d89675a2,
`origin/dev/goal24-cli-skills` = 9b7d60c2.

Key topology facts (all verified with Git):

- `origin/main` is an ancestor of every other branch (behind_main = 0 for all branches; main has no commits outside any branch).
- `origin/product/omni-v3-unified-r1` is an ancestor of `origin/dev/goal24-cli-skills` (goal24 = product + 4 Goal24 doc commits).
- `pre-evaluation-hardening-v1..v3.2` and `codex/pre-evaluation-hardening-v3.2.1` are ancestors of the product baseline (ahead_of_product = 0).
- `codex/omni-context-evaluation-freeze-v1` tip == tag `omni-context-evaluation-freeze-v1` (872723b1).
- `pre-evaluation-hardening-v3.1` tip == tag `evaluation-freeze-candidate-v1` (3bdb6e10).
- `pre-evaluation-hardening-v3.2` tip == tag `evaluation-freeze-candidate-v2` (be20db60).
- `codex/omni-evaluation-candidate-v3.1-final` tip == tag `evaluation-freeze-candidate-v3.1` (17dc1d01).
- `pre-evaluation-hardening-v1` tip == tag `v0.1.1` (ad36b3cb).
- `codex/omni-cognitive-benchmark-v1`, `codex/omni-cognitive-benchmark-v1.1-pre-run-hardening`,
  `codex/omni-cognitive-benchmark-v1.1-answer-diagnostics`, `codex/omni-paper-evidence-v1`,
  `codex/omni-paper-manuscript-assets-v1` are all ancestors of `codex/omni-external-eval-and-paper-v1` (contained_by verified).
- `codex/omni-external-eval-and-paper-v1` (27bad22e) and `codex/omni-longmemeval-s-formal-v1` (9316f0dc) carry the LongMemEval-S external-eval work (9 + 4 unique commits vs all other remote refs).
- `codex/omni-evaluation-candidate-v3` (4e73e63a) carries 1 unique doc commit (v3.1 verification report, NOT FROZEN).
- `codex/omni-v3.1-strict-ablations` (c02c0739) carries 8 unique research commits (strict ablation evidence).
- `benchmark/decision-v1` (06f9a10a) carries 1 unique commit (decision capability benchmark v1 milestone; parent == product tip).
- `trae/solo-agent-F9HYOB` (ae0bd170) carries 1 unique commit (early project breadth analysis, 2026-06-06).
- `research/decision-benchmark-holdback-v2` (fd666ba9) carries 16 unique commits (Holdback / formal campaign lineage; PROTECTED).
- `dev/goal24-cli-skills` (9b7d60c2) carries 4 unique commits (active Goal24 docs; KEEP).

Audit table (ahead/behind measured against origin/main at audit time; unique = commits reachable from the branch tip but not from any other remote branch/tag):

| Branch | tip_sha (12) | ahead_main | behind_main | unique_vs_remote | equivalent remote tag | classification |
|--------|--------------|-----------|-------------|------------------|------------------------|----------------|
| benchmark/decision-v1 | 06f9a10a8a4e | 165 | 0 | 1 | — | HISTORICAL_TAG_AND_DELETE |
| codex/omni-cognitive-benchmark-v1 | 71085c46ce5f | 149 | 0 | 0 | — | SAFE_DELETE |
| codex/omni-cognitive-benchmark-v1.1-answer-diagnostics | 62b0b20f944f | 177 | 0 | 0 | — | SAFE_DELETE |
| codex/omni-cognitive-benchmark-v1.1-pre-run-hardening | 1f4c7c4b77ce | 156 | 0 | 0 | — | SAFE_DELETE |
| codex/omni-context-evaluation-freeze-v1 | 872723b10ec4 | 148 | 0 | 0 | omni-context-evaluation-freeze-v1 | SAFE_DELETE |
| codex/omni-evaluation-candidate-v3 | 4e73e63ab03f | 158 | 0 | 1 | — | HISTORICAL_TAG_AND_DELETE |
| codex/omni-evaluation-candidate-v3.1-final | 17dc1d0107b0 | 158 | 0 | 0 | evaluation-freeze-candidate-v3.1 | SAFE_DELETE |
| codex/omni-external-eval-and-paper-v1 | 27bad22ec139 | 211 | 0 | 9 | — | HISTORICAL_TAG_AND_DELETE |
| codex/omni-longmemeval-s-formal-v1 | 9316f0dc37b0 | 206 | 0 | 4 | — | HISTORICAL_TAG_AND_DELETE |
| codex/omni-paper-evidence-v1 | ad1fe8806255 | 183 | 0 | 0 | — | SAFE_DELETE |
| codex/omni-paper-manuscript-assets-v1 | 7cbc54b991c6 | 188 | 0 | 0 | — | SAFE_DELETE |
| codex/omni-v3.1-strict-ablations | c02c07394c51 | 166 | 0 | 8 | — | HISTORICAL_TAG_AND_DELETE |
| codex/pre-evaluation-hardening-v3.2.1 | 249afb39128e | 147 | 0 | 0 | — | SAFE_DELETE |
| dev/goal24-cli-skills | 9b7d60c2ee29 | 168 | 0 | 4 | — | ACTIVE_KEEP |
| main | 960e0cf2abc0 | 0 | 0 | 0 | — | PRODUCT_KEEP (promotion target) |
| pre-evaluation-hardening-v1 | ad36b3cb0f0d | 43 | 0 | 0 | v0.1.1 | SAFE_DELETE |
| pre-evaluation-hardening-v2 | c05cd310ab5d | 54 | 0 | 0 | — | SAFE_DELETE |
| pre-evaluation-hardening-v3 | cdb3490da499 | 80 | 0 | 0 | — | SAFE_DELETE |
| pre-evaluation-hardening-v3.1 | 3bdb6e106832 | 115 | 0 | 0 | evaluation-freeze-candidate-v1 | SAFE_DELETE |
| pre-evaluation-hardening-v3.2 | be20db60bef3 | 145 | 0 | 0 | evaluation-freeze-candidate-v2 | SAFE_DELETE |
| product/omni-v3-unified-r1 | d89675a2e9f6 | 164 | 0 | 0 | — | PRODUCT_KEEP (canonical product baseline) |
| research/decision-benchmark-holdback-v2 | fd666ba9cd2e | 16 | 0 | 16 | — | RESEARCH_KEEP (protected Holdback) |
| trae/solo-agent-F9HYOB | ae0bd1700b6f | 1 | 19 | 1 | — | HISTORICAL_TAG_AND_DELETE |

Classification rules applied: no branch was classified by name alone; each decision required ancestry
proof (contained_by / equivalent tag / unique-commit inspection). Branches with unique commits that
represent ended benchmark/experiment/manuscript/evaluation stages were tagged (`archive/*`) before deletion.
`research/decision-benchmark-holdback-v2` is never deleted, modified, merged, or checked out for content access.
`product/omni-v3-unified-r1` is retained as the canonical named engineering baseline (Goal24 docs declare it
authoritative; main now points to the same commit).
