# Product Baseline — Identity Statement (产品基线身份声明)

> **Status: ENGINEERING STARTING POINT — NOT A FROZEN PRODUCT**
> **状态：工程起点 — 不是冻结产品**

This document is the canonical identity statement for the product baseline branch
`product/omni-v3-unified-r1`. Every other document in this repository that discusses
the baseline, freeze tags, or benchmark status must be read together with this statement.

本文档是产品基线分支 `product/omni-v3-unified-r1` 的权威身份声明。仓库中任何涉及基线、
冻结标签或基准测试状态的其他文档，都必须与本声明合并理解。

---

## 1. Starting commit (起始提交)

| Item | Value |
|---|---|
| Commit | `17dc1d0107b0474de84058205a91b302ba290a74` (`17dc1d0`) |
| Subject | `fix(retrieval): prioritize semantic core evidence` |
| Authored | 2026-07-16 10:06:47 +0800 |
| Branch created from it | `product/omni-v3-unified-r1` |

`17dc1d0` is the **engineering starting point** of the product integration branch. It is
the commit at which the product baseline work begins, selected because it contains the
retrieval/evidence-selection engineering changes that the product line is being built on.

`17dc1d0` 是产品集成分支的**工程起点**。产品基线工作从该提交开始。

## 2. What 17dc1d0 is NOT (不是什么)

`17dc1d0` is **NOT**:

- an official frozen experiment product (不是正式实验冻结产品);
- a validated benchmark result (不是经过验证的基准测试结果);
- a performance claim (不是性能声明);
- a release artifact (不是发布产物).

The annotated tag `evaluation-freeze-candidate-v3.1` currently points at `17dc1d0` with
the message "Omni-Context Candidate v3.1 freeze". This is **incorrect and deprecated**.
The evaluation documents explicitly record the opposite:

- `docs/candidate-v3.1-review/13-freeze-recommendation.md`: "Do not freeze Candidate v3.1 …
  `evaluation-freeze-candidate-v3.1` must not be created."
- `docs/candidate-v3.1-review/14-final-status.md`: "`OMNI-CONTEXT CANDIDATE V3.1 NOT FROZEN`"
- `docs/candidate-v3.1-review/evidence/candidate-v3.1-freeze-manifest.json`: `"status": "NOT_FROZEN"`,
  `"targeted_gate_passed": false`, `"tag": null`.

See [Tag remediation proposal](./tag-remediation-proposal.md) for the remediation plan.
No remote tag is deleted in this round.

当前指向 `17dc1d0` 的标签 `evaluation-freeze-candidate-v3.1` 携带 "Candidate v3.1 freeze"
信息，这与评测文档记录完全相反（v3.1 明确 NOT FROZEN），属于**错误使用**，已废弃，
修复方案见 tag-remediation-proposal.md。本轮不删除任何远端标签。

## 3. Original Targeted-7 gate FAILED (原 Targeted-7 门禁失败)

The original Targeted-7 evaluation gate **FAILED** and the baseline does not claim it passed.

原 Targeted-7 评测门禁**失败**，本基线不声称其通过：

| Line | Record | Source |
|---|---|---|
| v3.0 | `FAILED_TARGETED_GATE` — 7/7 completed but two mandatory final-context evidence conditions failed | `docs/candidate-v3-review/08-targeted-7-results.md`, `docs/candidate-v3-review/evidence/targeted-7-validation.json` |
| v3.1 | gate not passed — 5/7 completed, 1 provider error, partial score 0.6783, `targeted_gate_passed: false` | `docs/candidate-v3.1-review/evidence/candidate-v3.1-freeze-manifest.json` |

Consequences recorded in the evidence:

- Development-35 was **not authorized** (`development_35_run: false`).
- Ablations were **not run** (`ablation_run: false`).
- A failed gate must never be presented as a valid benchmark result.

## 4. Current selector has NO formal performance proof (当前 selector 无正式性能证明)

The evidence selector present at `17dc1d0` (`brain-server/src/retrieval/evidence-selector.ts`)
has **no formal performance proof**:

- No authorized Development-35 candidate run.
- No valid formal dataset run (Formal 250 / Comparison 70 / LoCoMo were not run).
- No ablation evidence (pairwise comparisons were not authorized).
- Partial/rerun numbers that exist in the evidence are explicitly marked partial and gated.

Any future claim about retrieval performance must come from a **new, authorized benchmark**
run on this product baseline, not from the archived evaluation evidence.

`17dc1d0` 处的证据选择器（`brain-server/src/retrieval/evidence-selector.ts`）**没有任何正式性能证明**。
任何未来的性能声明必须来自本产品基线上新的、经授权的基准测试运行。

## 5. Branch policy (分支策略)

- `product/omni-v3-unified-r1` is the product integration branch.
- It starts at `17dc1d0` and does **not** inherit the (incorrect) freeze identity of the tag
  that happens to point at that commit.
- No formal benchmark is run in this round; no performance improvements are claimed.
- The test-pass counts of archived delivery reports (e.g., "272/329 tests pass", "229/229")
  are **engineering regression evidence only** and are **not** product end-to-end validation.
- The old papers are not modified in this round.

## 6. Required outputs (本轮输出)

- `product-baseline-manifest.json` — machine-readable baseline identity.
- `docs/unified-dispatch-design.md` — unified business dispatch layer design (Phase 2).
- `docs/embedding-migration-plan.md` — embedding v3 migration plan (Phase 3).
- `docs/privacy-and-device-security.md` — privacy and device security design (Phase 5).
- `build-and-test-report.md` — engineering build/test report.
- `docs/unresolved-product-risks.md` — unresolved product risks.
