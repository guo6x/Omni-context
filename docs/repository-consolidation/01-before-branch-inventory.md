# 01 — Before: Remote Branch Inventory

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12 (execution start)
Source: `git branch -r` + `git ls-remote --heads origin` after `git fetch --all --tags --prune` (2026-08-12).

Remote branches BEFORE (23, excluding origin/HEAD):

| # | Branch | Tip SHA | Last commit date | Last commit subject |
|---|--------|---------|------------------|---------------------|
| 1 | benchmark/decision-v1 | 06f9a10a8a4e91ab1f9d28876352676563ebf002 | 2026-08-05 22:33:51 +0800 | feat(benchmark): decision capability benchmark v1 (deterministic, no model evaluation) |
| 2 | codex/omni-cognitive-benchmark-v1 | 71085c46ce5f832bd2048f4e7b77c2cdee8f0f66 | 2026-07-15 00:29:18 +0800 | feat(benchmark): prepare Cognitive Benchmark v1 for review |
| 3 | codex/omni-cognitive-benchmark-v1.1-answer-diagnostics | 62b0b20f944f7e9a2c58f02ce1c65bb43dfbf841 | 2026-07-17 07:18:15 +0800 | docs(evaluation): record LoCoMo authorization status |
| 4 | codex/omni-cognitive-benchmark-v1.1-pre-run-hardening | 1f4c7c4b77ce6ea5f80e41de3c4a1e07373bce08 | 2026-07-15 10:17:31 +0800 | ci(security): support pinned gitleaks allowlist syntax |
| 5 | codex/omni-context-evaluation-freeze-v1 | 872723b10ec4ae99b8272606a183155837104332 | 2026-07-14 21:22:51 +0800 | docs(freeze): create Omni-Context Evaluation Freeze v1 |
| 6 | codex/omni-evaluation-candidate-v3 | 4e73e63ab03fda5928f4e9de0f0d12d713c65e62 | 2026-07-15 19:11:57 +0800 | docs(v3.1): add final verification report — NOT FROZEN |
| 7 | codex/omni-evaluation-candidate-v3.1-final | 17dc1d0107b0474de84058205a91b302ba290a74 | 2026-07-16 10:06:47 +0800 | fix(retrieval): prioritize semantic core evidence |
| 8 | codex/omni-external-eval-and-paper-v1 | 27bad22ec13921e0e80428192aedfd8751b8419b | 2026-07-18 03:27:50 +0800 | docs(external-eval): freeze LongMemEval v4 formal pipeline |
| 9 | codex/omni-longmemeval-s-formal-v1 | 9316f0dc37b02144b900d2f4612aaf92a0bd8a11 | 2026-07-18 03:32:25 +0800 | archive(longmemeval-s-v1): mark LONGMEMEVAL_FORMAL_PIPELINE_READY_FOR_AUTHORIZATION_V4 after v4 integrity repair |
| 10 | codex/omni-paper-evidence-v1 | ad1fe8806255e420e65398ae67df0a50474356d4 | 2026-07-17 08:31:06 +0800 | docs(paper): make evidence validation deterministic |
| 11 | codex/omni-paper-manuscript-assets-v1 | 7cbc54b991c636a2bc088b17c2acc89064f60344 | 2026-07-17 09:13:20 +0800 | paper: add manuscript claim and number audits |
| 12 | codex/omni-v3.1-strict-ablations | c02c07394c51e95143ba590975bab2f655d7ae57 | 2026-07-17 19:49:55 +0800 | docs(research): archive paired scenario score evidence |
| 13 | codex/pre-evaluation-hardening-v3.2.1 | 249afb39128e1f7646bd6eced516cff23b9f08f5 | 2026-07-14 20:23:25 +0800 | docs(sealing): seal Candidate v2 evidence |
| 14 | dev/goal24-cli-skills | 9b7d60c2ee29e6e53cacfeebecfc3f4f86f9da4e | 2026-08-12 17:53:33 +0800 | docs(goal24): complete checkpoint 1 current code map |
| 15 | main | 960e0cf2abc0c3859a7dbb45eac2555f12035ffd | 2026-07-10 22:15:49 +0800 | feat: 桌面端/移动端 bug 修复 + 主动洞察系统 + README 工具列表 |
| 16 | pre-evaluation-hardening-v1 | ad36b3cb0f0d0a4769d443a65283b4bbf11df9dc | 2026-07-12 22:47:07 +0800 | 交付: 评测前加固工程完整交付 - 25份报告 + package-all隐私修复 |
| 17 | pre-evaluation-hardening-v2 | c05cd310ab5d061fb78191933d0c486cb38277a6 | 2026-07-13 01:09:39 +0800 | docs: final freeze readiness v2 — all 15 P0 FIXED, 229/229 tests pass |
| 18 | pre-evaluation-hardening-v3 | cdb3490da499054696799964395cfeeec5b74837 | 2026-07-13 14:09:30 +0800 | docs(task15): all 5 E2E targets PASS, branch READY FOR FREEZE CANDIDATE |
| 19 | pre-evaluation-hardening-v3.1 | 3bdb6e106832854a9bc94672fc74fafa8f7e221f | 2026-07-14 02:16:27 +0800 | docs(freeze): create evaluation candidate v1 |
| 20 | pre-evaluation-hardening-v3.2 | be20db60bef32a886fddde4986013cf40a1e8ec5 | 2026-07-14 19:04:08 +0800 | docs(delivery): finalize Candidate v2 readiness |
| 21 | product/omni-v3-unified-r1 | d89675a2e9f60cf8b7f9221dd19ca224b9a103e9 | 2026-08-05 15:55:05 +0800 | docs(product-baseline): final reports — build-and-test-report + unresolved-product-risks, manifest phase status |
| 22 | research/decision-benchmark-holdback-v2 | fd666ba9cd2ecac2bbeea69979271f82c55f66b9 | 2026-08-12 10:08:26 +0800 | feat(benchmark): Goal20 V3-R1 RERUN-1 raw-output freeze + formal scoring (GOAL20_VALIDATION_V3_R1_FORMAL_INVALID; A5 UDR 0.0930>0.05; Goal21 not started; owner review required) |
| 23 | trae/solo-agent-F9HYOB | ae0bd1700b6ff8c39d17b4eecc81507503239856 | 2026-06-06 06:04:16 +0000 | feat: 项目深度广度分析 |

Pre-existing remote tags (6, untouched by this task): v0.1.1, v3.0.0, omni-context-evaluation-freeze-v1, evaluation-freeze-candidate-v1, evaluation-freeze-candidate-v2, evaluation-freeze-candidate-v3.1.
`origin/HEAD` (symref to main) excluded from the inventory.
`origin/main` = 960e0cf2 at audit time (unchanged since the previous audit; the old main SHA from the task background was still current).
`origin/product/omni-v3-unified-r1` = d89675a2 (engineering product baseline).
`origin/dev/goal24-cli-skills` = 9b7d60c2 (active Goal24 development line).
`origin/research/decision-benchmark-holdback-v2` = fd666ba9 (protected Holdback lineage).
`origin/benchmark/decision-v1` = 06f9a10a (single commit on top of product baseline: decision capability benchmark v1 milestone).
