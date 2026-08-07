# Goal 18H-R · Validation Referential Integrity 审计报告

范围：Goal 18 validation 全部 **120 样本**（holdback plaintext 未解密、未读取，遵守 Goal 18H-R 纪律）
执行：`node scripts/audit/ri-audit.mjs`（新增 RI 测试，schema_version=validation-ri-audit-v1.1）
时间：2026-08-07

## 1. 审计规则

| 规则 | 检查内容 | 严重级 |
|---|---|---|
| RI-01 | `options[].evidence_refs` 必须引用存在的 evidence ID（qualified/expired/conflicting） | ERROR |
| RI-02 | `evidence[].supports` 必须引用存在的 option/constraint/decision ID | ERROR |
| RI-03 | `evidence_refs` 与 `supports` 语义一致性（分析项，见 semantic-anomaly 报告） | INFO |
| RI-04 | qualified evidence 的 `source_ref` 指向已删除 timeline 事件（TT15 为设计陷阱，见下） | ERROR/INFO |
| RI-05 | 所有 `source_ref`（evidence/goal/constraint/preference）必须存在 | ERROR |
| RI-06 | `historical_decision.evidence_snapshot` 必须引用存在的 evidence | ERROR |
| RI-07 | 删除事件必须有对应 `source_deleted` expired artifact | WARN |
| RI-08 | `conflicting[].conflicts_with` 必须引用存在 evidence | ERROR |

## 2. 结果总览（修复后复跑）

```
violations: 55   samples_affected: 46
by_rule :  RI-03=47  RI-04=8
by_severity: INFO=55  ERROR=0  WARN=0
```

- **RI-01**：0 违规（全部 `evidence_refs` 引用有效）。
- **RI-02**：修复前 **8 个 ERROR**（全部 TT15）；修复后 **0**。
- **RI-03**：47 个 INFO（语义文档缺口，非数据缺陷，见 semantic-anomaly 报告）。
- **RI-04**：8 个 INFO（全部 TT15，判定为设计陷阱，非缺陷）。
- RI-05/06/07/08：0 违规。

## 3. RI-02：真实缺陷（已修复）

### 3.1 缺陷描述

8 个 TT15 样本（`decision-bench-v2-val-tt15-000 … 007`）中，
`evidence[ev002].supports = ["hc1"]`，但样本 `hard_constraints` 为空，
`hc1` 在 options/constraints/decisions 中均不存在 —— dangling reference。

根因：生成器 builder（`goal18-output/scripts/generator/builders-tt11-15.mjs` TT15 分支）
为「被删除来源的派生决定必须级联失效」原则写入了 `supports: ['hc1']`，
但从未把 hc1 物化进样本（v1 冻结 fixture 中该原则对应 `supports: [opt-b]`，v2 改写时遗漏）。
属**生成器级结构 Bug**：同一 builder 路径同时用于 validation 与 holdback。

### 3.2 修复（按 Goal 18H-R §12 纪律）

- 最小修复：`supports: ['hc1']` → `[]`（原则保持为背景规则，gold 未引用 hc1，
  `mandatory_constraints` 为空，评分与 reviewer 可见内容不受影响）；
- 修改前 hash（validation-set.jsonl）：`3ceddb1aaee51e28dfe20a930696b01065dcfae4d47bdac1f1dd5dc3c39e9667`
- 修改后 hash：`59e924631934a8712f05daedc269c4f27791bf86b97ed11fa5f1af0bdb3cbf34`
- 逐样本 diff：`work/ri02-fix-changes.json` + `validation-change-log.jsonl`
- 原文件归档：`archive/v1-validation-set.jsonl`（hash 同上）
- 未查看任何 Kernel 输出；未根据未来性能修改。

### 3.3 验证

- RI 审计复跑：RI-02 = 0；
- Goal 18 integrity 套件重跑：**18/18 PASS**（含 schema、gold contract、hash seals）；
- scorer v1.1 不读取 `supports` 字段（已核对 scorer.mjs），评分语义零影响；
- 覆盖矩阵因子（factorValues）不读取 `supports`，覆盖分布零影响。

## 4. RI-04：TT15 设计陷阱（非缺陷）

8 个 TT15 样本的 qualified `ev001` 声明「仍为可用选项（现行信息）」但其
`source_ref` 指向已被删除的 e001，且无 revalidation 事件。审计初版按
「只有 expired artifact 可引用已删除来源」判为 ERROR；经与 gold 交叉核对，
该模式是 **TT15 的 GHOST-CITATION 设计陷阱**（见 `validation-semantic-anomaly-report.md` §3），
复跑后降为 INFO。非 TT15 若出现该模式仍判 ERROR（当前为 0）。

## 5. 残余 INFO（无需修复，需文档化）

- RI-03 ×47：`evidence_refs` 语义未在 schema 描述（文档缺口，建议在
  `decision-benchmark-v2-set.schema.json` 的 `evidence_refs` 增加描述：
  relevant evidence，可含反对/过期/冲突项；kernel 编码时仅保留 qualified）。
- RI-04 ×8：TT15 设计陷阱，保留。

## 6. 结论

- validation 数据真实缺陷：仅 RI-02 一类（8/120，6.7%，单一任务类型）；
- 已按纪律修复并重新冻结（新 freeze：VALIDATION_GOLD_FREEZE_V1.1）；
- **Holdback 不可在本轮验证**：同一生成器路径，密封期内不得解密；
  Goal 20 前进前须裁定 holdback 处理方式（后解封审计或重建），本轮不得进入 Goal 20。
