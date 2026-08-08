# Goal 18HB · Holdback V2 完整性总报告（Integrity Report）

- 状态：**HOLDBACK_V2_SEALED（机器侧全部检查 PASS）→ 终端状态 HOLDBACK_V2_READY_WITH_CUSTODY_PENDING**
- 生成日期：2026-08-08（Asia/Shanghai）
- 对象：Holdback V2 = 180 samples = 15 task types × 12，独立新 seed
- 范围：本报告为 §二十 完整测试矩阵的合并记录；单项证据见各审计输出文件。

## 0. 关键身份与哈希

| 项 | 值 |
|---|---|
| Generator 版本 | `goal18-generator/v2.1.0` |
| Generator commit | `cd53eaea538ac2992012e21e94370e918b166dde`（branch `research/decision-benchmark-holdback-v2`，无 uncommitted generator） |
| Schema（decision-benchmark-v2-schema.json） | `aad31f90203322b2f71c586f21379eb991b5faa1ceeddf4185b92577293264f4` |
| Holdback V2 plaintext 聚合哈希 | `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` |
| Gold projection 哈希 | `80ab80ecb4784f783a4ba38d5511f5f10d16452b130a006a724c39d40209e45b` |
| Sealed artifact（holdback-v2-sealed.bin） | `4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3` |
| Seed hash（raw seed 永不公开） | `c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1` |
| RI audit JSON | `18102cccc081342ea58dacbd761b4e56bd7e80fd25c2e926eac052f468fe7cad` |
| Integrity suite（integrity.test.mjs） | `47f643b1e9f1b067faef0f296ef4c8908f375748b73252c96353f7824bb644b1` |
| Public manifest | `4e4239d4170b56286eb33cd832e66c3aa1c2c2ba3bb7053e050af7c7a4319d7a` |
| Access log | `472294af320c20d335366e4f81a6374248d15bed1a09a987c228103d5705818c` |

## 1. §二十 完整测试矩阵

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | Schema validation | PASS | T1（set/gold join 与 holdback 全量 180 条通过 v2 schema）；schema hash 见上 |
| 2 | RI-01（options[].evidence_refs 存在性） | PASS（0 dangling） | `holdback-v2-referential-integrity.json`（RI audit v2.1） |
| 3 | RI-02（evidence.supports 存在性） | PASS（0 dangling） | 同上；`supports=["hc1"]` 类缺陷 = 0（含 TT15） |
| 4 | RI-03（evidence_refs 语义，采用 Goal 18H-R 正式定义 relevant-evidence） | PASS（77 INFO，均已记录） | 同上；语义 = relevant evidence（含支持/反对/中性），与 schema/UI/scorer 一致 |
| 5 | RI-04（provenance validity） | PASS（12 INFO，均为 TT15 设计陷阱，逐条 exception justification） | 同上；`qualified_evidence_with_invalid_only_provenance = 0` 例外仅限 schema 定义的 GHOST-CITATION 陷阱 |
| 6 | Lifecycle 测试 | PASS | T4（时间线有序/窗口/supersedes）、T5（evidence validity vs query_time） |
| 7 | Lineage 测试 | PASS | T9（lineage operation consistency）、T3（parent/target 引用解析） |
| 8 | Approval/authority 测试 | PASS | T7（approval consistency，含 override-supersedes-approval 边界）、T8（risk/reversibility consistency） |
| 9 | Gold contract 测试 | PASS | T6（GOLD-C1..C12 + action/task 映射 + coded reason）、T10（P0 failure labels）、T18（acceptable-action discipline） |
| 10 | Coverage 测试 | PASS | `holdback-v2-coverage.mjs`：180 = 15×12；plan mismatches = 0；分布未被破坏 |
| 11 | Duplicate 测试 | PASS | T12（within-split < 0.5）+ overlap audit（见下） |
| 12 | Leakage 测试 | PASS | `holdback-v2-leakage.mjs`：`gold_leakage_findings = 0`（2817 个可见字段值） |
| 13 | Encoding 测试 | PASS | T1 全量 UTF-8 JSON 解析（含 BOM 剥离），无 NUL/损坏编码 |
| 14 | Deterministic generator 测试 | PASS | 3 次 dummy 运行 byte-identical（SHA-256 `4a1f820ee7b651af8445da5bad967d948ba1136b30818fbd8d7d5da7e1524158`）；正式 seed 仅生成一次 |
| 15 | Hash verification | PASS | T15（post-seal）+ `verify-seal-v2.mjs`（34/34 checks） |
| 16 | Seal decrypt-on-dummy test only | PASS | `dummy-seal-decrypt-test.mjs`（5/5：round-trip byte-identical + wrong-seed 拒绝）；正式 V2 **未做** test decrypt |
| 17 | Public manifest validation | PASS | `verify-seal-v2.mjs`（schemaVersion/status/sample_count/hash 格式/生成器绑定） |
| 18 | 正式 Holdback V2 不 test decrypt | 遵守 | 正式 ciphertext 未解密；解密路径仅用 dummy 材料验证 |

## 2. 重叠与泄漏（§十 / §十一）

- Overlap audit（`holdback-v2-overlap.mjs`，27,900 对 vs dev 20 / reg 15 / validation 120）：
  - `exact_overlap = 0`（exact sample hash、normalized scenario hash、timeline hash 均为 0 命中）；
  - decision_question_hash 命中 10 对（全部 TT15）、option_set_hash 命中 10 对（TT03/04/09）——模板层身份重合诊断（详见报告）；场景/时间线全部不同，非样本复制；
  - near-duplicate 诊断：6 对 hb↔val（全部 TT15，max 8-gram Jaccard 0.529），仅诊断、不判失败。
- Leakage audit（`holdback-v2-leakage.mjs`）：`gold_leakage_findings = 0`。
- 旧 Holdback：仅使用公开 manifest/retirement record 元数据；未解密、未读取 V1 plaintext/custody。

## 3. Integrity suite 运行记录

| 阶段 | 结果 | 说明 |
|---|---|---|
| Pre-seal（正式 fixtures，work 副本） | 17/18 | 唯一失败 T15（seal 产物尚未存在，符合预期） |
| Post-seal（custody plaintext 只读，`HOLDBACK_V2_FIXTURES` 指向离线副本） | **18/18** | T15 验证 manifest/sealed/access log 全部一致 |
| verify-seal-v2 | **PASS（34/34）** | manifest 字段、custody plaintext/gold/seed 哈希、sealed 结构与哈希、access log、仓库无 plaintext、未解密正式 V2 |

## 4. 结论

- 旧 Holdback：`RETIRED_BEFORE_EVALUATION`（从未打分/从未用于模型选择/从未用于 prompt tuning）。
- Holdback V2：`SEALED_PRE_VALIDATION`；plaintext 仅存于离线 custody；仓库仅保留 ciphertext + manifest + hashes。
- 未运行任何 Kernel / 模型 / scorer evaluation；未访问 V1 plaintext；raw seed 未打印/未入库/未入日志。
- 剩余人工步骤：physical two-person custody handoff（Custodian A / Witness B）→ 之后才可进入 Goal 22 授权流程；Goal 20 仍由人工评审门控（见 `goal20-gate-status.json`）。