# Goal 18H-R · Validation Freeze 影响报告

## 1. 旧 freeze（Goal 18，已被取代）

| 项 | 值 |
|---|---|
| manifest | `goal18-output/validation-manifest.json`（validation-manifest-v2） |
| validation-set.jsonl sha256 | `3ceddb1aaee51e28dfe20a930696b01065dcfae4d47bdac1f1dd5dc3c39e9667` |
| validation-gold.jsonl sha256 | `763da3c34446e269c9735545c8ba427910ca33d687c8fb3ed7e0ea3f7e18baed`（未变） |
| manifest sha256 | `1cffe23134959b3f0a276360a82a99d6e91d8ccfc3f3e93b5a99c7d116a2e7d7` |
| 归档 | `goal18h-output/archive/v1-*`（set/manifest/fixture-sha 三件，hash 已记录） |

## 2. 修改内容（唯一一次授权修改）

- 8 个 TT15 样本 `evidence[ev002].supports`：`["hc1"]` → `[]`（RI-02 dangling ref）；
- 逐字段 diff、理由、adjudication 记录见 `validation-change-log.jsonl` 与
  `work/ri02-fix-changes.json`；
- 未改 gold、未改 schema、未改 holdback、未改抽样（45 样本 ID 不变）。

## 3. 新 freeze（VALIDATION_GOLD_FREEZE_V1.1）

| 项 | 值 |
|---|---|
| freeze_id | `VALIDATION_GOLD_FREEZE_V1.1` |
| validation-set.jsonl sha256 | `59e924631934a8712f05daedc269c4f27791bf86b97ed11fa5f1af0bdb3cbf34` |
| validation-gold.jsonl sha256 | `763da3c34446e269c9735545c8ba427910ca33d687c8fb3ed7e0ea3f7e18baed`（不变） |
| manifest sha256 | `01e5efed8b5a1fd9062672157060cfaf2aa903d5fe8bd98fe6518df3b4353af7` |
| 绑定文件 | `goal18-output/validation-manifest.json`（含 revision/supersedes 记录） |
| integrity 套件 | **18/18 PASS**（含 schema、gold contract、hash seal T15） |
| RI 审计 | ERROR=0（RI-02 修复；RI-03/RI-04 为 INFO 文档项/设计陷阱） |

## 4. 影响评估

- **评分语义**：scorer v1.1 不读取 `supports`，零影响；
- **gold**：零改动（validation-gold.jsonl hash 不变）；
- **覆盖矩阵**：factorValues 不读取 `supports`，12 因素分布零变化；
- **人审包**：v2 包由修复后 fixture 重建（45 样本哈希变化，见 manifest-v2.json）；
- **holdback**：密封状态未触碰；同一生成器路径存在 RI-02 同类风险，
  但密封期内不得解密验证 —— 见 readiness 报告的 GLOBAL 裁定。

## 5. Goal 20 输入指引

- 正式 Validation 的唯一输入应为 **VALIDATION_GOLD_FREEZE_V1.1** 绑定的
  validation-set/gold + manifest（`goal18-output/validation-manifest.json`）；
- 人类盲审完成后的最终 freeze（`VALIDATION_GOLD_FREEZE_V2`）另行由
  Goal 18H 流程签发；
- **在 holdback 的 RI-02 风险裁定（解封审计或重建）完成前，不得进入 Goal 20。**
