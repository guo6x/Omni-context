# Decision Benchmark v2（论文级）设计规范

**Goal 18 · Omni-Context 论文级决策 Benchmark 构建与独立 Gold 审计。**
版本：v2。状态：**构建中（validation + sealed holdback + 独立 gold 审计）。**
上游权威输入（只读引用，本 Goal 不得修改）：
- `research/decision-intelligence-spec-v1.1 @ 8c3e923`（Benchmark 规范）
- `product/decision-kernel-v1 @ e136732`（scorer v1.1，仅用于 gold contract 与 scorer schema 兼容性验证）

## 1. 定位与边界

Goal 18 在 Goal 14/15A 的 v1 基准（35 个 dev/reg fixtures）之上，构建支持正式论文实验的：

- **Validation split**：120 个样本（15 种任务类型 × 8），用于正式实验前的系统级检查；
- **Sealed holdback**：180 个样本（15 种任务类型 × 12），生成后加密离线密封，授权前不可访问；
- **独立 gold 审计**：构造者与 gold reviewer 分离，逐字段一致性度量 + 裁决日志；
- **完整性/防泄漏/密封机制**：v2 integrity 套件、相似度报告、hash seal、访问日志。

**本 Goal 只负责数据、gold、标注协议、完整性和密封机制。**

**不得（约束清单）**：
1. 修改 Decision Kernel（`product/decision-kernel-v1`）；
2. 修改 scorer v1.1 的评分语义（`goal14-output/benchmark-integrity-tests/scorer.mjs` 语义冻结）；
3. 根据 Kernel 输出调整 gold（本 Goal 不运行任何 Kernel/模型）；
4. 运行正式模型（含在 validation/holdback 上）；
5. 查看 Kernel 在新样本上的回答后修改样本；
6. 将现有 35 个 development/regression fixtures 重新包装成正式测试集；
7. 在授权前运行 sealed holdback。

## 2. 与 v1 的关系与延续性

| v1（Goal 14/15A） | v2（Goal 18） | 关系 |
|---|---|---|
| 15 种任务类型 TT01–TT15 | 沿用，定义不变 | 动作词表、状态机语义、失败标签全部继承 |
| 13 个动作、26 个失败标签 | 沿用 | 不变 |
| gold contract（10 字段 + 12 条一致性规则） | 沿用 | 不变（`benchmark-gold-contract.schema.json` 原样复用） |
| scorer v1.1（29 指标 + 6 硬门槛） | 沿用 | 语义冻结；仅做 gold/scorer 兼容性验证 |
| development 20 / regression 15 | 永久标记 `DEVELOPMENT_VISIBLE` + `NON_CONFIRMATORY` | 不得进入 validation/holdback |
| holdback 接口（Goal 15A） | 首次落地生成与密封 | 按 `holdback-generator-interface.md` 协议执行 |
| 样本 schema v1.1 | v2 schema | 新增 `decision_question` 与 `construction_provenance`；其余字段与 v1.1 完全兼容 |

**v2 schema 变更（仅两处，且不改变评分语义）**：
1. `decision_question`（顶层，必填）：正式“决策问题”字段，与 `scenario.prompt` 内容一致（完整性测试断言相等）；`scenario.prompt` 保留以兼容 scorer v1.1。
2. `construction_provenance`（顶层，必填）：生成来源审计字段（见 §7）。
其余字段、类型、枚举、必填集合与 v1.1 逐字段相同，因此 scorer v1.1 对 v2 样本可直接评分。

## 3. 数据规模

| Split | 目标 | 任务类型 × 数量 | 最低下限 | 用途 |
|---|---|---|---|---|
| validation | 120 | 15 × 8 | 75（若独立审查能力不足） | 正式实验前的系统级检查；验证后不得样本级修补 |
| sealed holdback | 180 | 15 × 12 | 150 | 唯一正式评测集；生成后加密密封；授权后单次运行 |

- 规模变化必须记录理由（若触发下限路径，将在 `commands-and-results.log` 与 `dataset-card.md` 中记录）。
- 本设计以 120/180 为目标规模；实际以生成 + 审计通过的数量为准，且不低于下限。

## 4. 正交覆盖设计（12 个因素）

每种任务类型在**与金标动作相容的取值空间**内平衡以下 12 个因素（不相容的取值标记 N/A 并由其他任务类型覆盖）：

| # | 因素 | 取值 | 与金标动作的相容性约束 |
|---|---|---|---|
| F1 | evidence sufficiency | sufficient / insufficient | 仅 CLARIFY/DEFER/REJECT 类金标可取 insufficient |
| F2 | evidence currency | current / stale | stale 仅出现在含 expired 陷阱的 TT04/14/15 等 |
| F3 | source consistency | consistent / conflicting | conflicting 仅 TT05/12 及多源变体 |
| F4 | risk level | negligible / low / medium / high / critical | high/critical ⇒ approval_requirement.required=true（TT09） |
| F5 | reversibility | reversible / conditionally_reversible / irreversible | irreversible ⇒ approval_requirement.required=true |
| F6 | authority | L0–L5 | L2 ⇒ PROPOSE_CONFIRM 型金标（TT08）；L0/L1 ⇒ 越权拒绝/转介类 |
| F7 | approval required | required / not required | 与 F4/F5 联动；由 approval_requirement 声明 |
| F8 | history | absent / present | present 用于 TT06/07/10/11/13/14/15 等 |
| F9 | outcome | none / supports / contradicts | 与 execution_outcome 联动（TT10/11） |
| F10 | revision warranted | warranted / not | 金标动作族 DECIDE 类 ↔ not；REVISE/REVERSE/INVALIDATE ↔ warranted |
| F11 | user override | present / absent | present 仅 TT13 |
| F12 | agent disagreement | none / single / multi | multi 仅 TT12 |

**平衡规则**：每个任务类型内部，其相容因素取值在 8（validation）/12（holdback）个样本中分布 ≥1 次；不相容取值按上表 N/A 处理并在 `coverage-matrix.csv` 中显式标记。生成器按“任务类型 × 变体 × 参数表”分配取值，避免单一领域/单一动作对应单一任务类型。

## 5. 领域分布

至少覆盖 12 个领域（目标 15+）：

1. 软件项目开发（software-dev）
2. 学习与课程安排（learning-courses）
3. 求职与职业选择（career-job-search）
4. 日程和时间分配（schedule-time）
5. 隐私与设备设置（privacy-device）
6. 采购与预算（purchase-budget）
7. 旅行规划（travel-planning）
8. 团队协作（team-collaboration）
9. 内容创作和发布（content-publishing）
10. 长期项目管理（longterm-project）
11. 低风险健康生活安排（health-lifestyle）
12. 文件和知识管理（files-knowledge）

**高风险领域（医学、法律、金融）**：只构造以下行为的样本——
请求审批、不自主执行、证据不足（转介/澄清边界）、转介专业人员、用户授权边界。
不得构造鼓励系统进行真实高风险自主决策的 gold；这类样本的 `approval_requirement` 恒为 required 或金标为 `REJECT`/`CLARIFY`（转介型）/`OVERRIDE_HONOR`。

**split 隔离**：validation 与 holdback 使用互不相交的领域实体池与时间窗口（validation 时间窗 2026-02..2026-06，holdback 时间窗 2026-07..2026-12），与 dev/reg 的时间窗（2026-05..2026-07）语义不相交；实体名由 split 专属种子生成，确保实体池不相交（完整性测试断言）。

## 6. 样本构造纪律

每个样本必须包含 v2 schema 的全部必填字段（v1.1 全部组件 + `decision_question` + `construction_provenance`）：

- `sample_id` / `task_type` / `domain`
- `memory_timeline`（带时间戳的写入事件，含 writer 身份）
- `scenario.query_time`（一切时间有效性判定基准）
- `goal`（目标 + source_ref）
- `decision_question`（= `scenario.prompt`）
- `candidates`（≥2，含 violates_hard_constraint 标记）
- `hard_constraints` / `soft_preferences`
- `evidence.qualified`（合格）/ `evidence.expired`（过期陷阱）/ `evidence.conflicting`（冲突）
- `historical_decision` / `execution_outcome`
- `scenario.authority_level` / `risk_classification.level` / `reversibility`
- `expected_action`（gold 契约 10 字段）
- `severe_failure_labels`
- `construction_provenance`

**gold 纪律**：
- `preferred_action` 不得成为唯一可接受答案，除非任务本身确实只有唯一合法动作（如 TT13 的 `OVERRIDE_HONOR`、TT09 的 `APPROVAL_REQUEST`）；其余任务类型 `acceptable_actions` 至少含 1 个非 preferred 的合理替代（如 `DECIDE` 与 `PROPOSE_CONFIRM` 在 L3 低风险下的取舍、`REVISE` 与 `REVERSE` 的取舍）。
- gold 由模板逻辑确定性带出（构造者直接给出），不经 LLM 判定；评分只要求落入可接受集，不要求唯一措辞。
- 高风险领域不构造“自主执行”gold。


**字段语义（Goal 18H-R RI-03 审计确认，Definition A / relevant evidence）**：
- `options[].evidence_refs` = **相关证据**：列出判断该选项时应纳入考虑的合格证据，**不代表这些证据支持该选项**。允许包含反对该选项的证据、支持其他选项的证据、以及 expired/conflicting 陷阱证据。
- `evidence[].supports` = 该证据实际支持的对象（option / hard-constraint / decision id），与 `evidence_refs` 语义不同，不可混用。
- 引用纪律（referential integrity）：`evidence_refs` 只允许引用存在的 evidence id（RI-01，当前 ERROR=0）；`supports` 只允许引用存在的 option/constraint/decision id（RI-02，Goal 18H-R 已修复 8 个 TT15 样本并重新冻结 VALIDATION_GOLD_FREEZE_V1.1）。
- 依据：冻结 v1 dev/reg fixtures 中 16 处“选项引用不支持自身的证据”的既有模式；spec context-encoding 明确 `filtered evidence_refs (qualified ids only)` 为编码层过滤，fixture 层允许包含过期/冲突项。
- 本条目仅澄清设计语义，不修改任何 fixture / gold / schema / hash。
## 7. 数据生成来源与 Provenance

**组成（按样本数）**：
| source_type | 占比 | 构造路径 |
|---|---|---|
| `human_design` | 40% | 构造者（本 Goal 标注角色）手工编写的场景模板/深度改写 |
| `multi_model_reconstruction` | 30% | 多模板变体辅助生成 + 人工重构（编辑通道，edit_history 记录） |
| `anonymized_pattern_synthesis` | 20% | 基于真实决策模式抽象、完全匿名化的合成（无真实用户数据） |
| `adversarial_boundary` | 10% | 对抗性与边界样本（陷阱、双重约束、边界权限） |

**所有样本均为合成或充分匿名化，不含真实用户隐私**；`dataset-card.md` 明示。

**每个样本记录（`construction_provenance`）**：
- `generator_identity`：生成器版本（如 `goal18-generator/v2.0.0`）
- `prompt_hash`：构造所用提示/模板块的 sha256（模板路径记录模板块 id 的哈希；LLM 辅助路径记录提示哈希）
- `human_editor`：人工编辑者身份
- `edit_history`：编辑记录（时间、编辑者、变更、理由）
- `final_reviewer`：最终审查者身份（= gold reviewer 角色 id）
- `source_type`：上述四类之一

## 8. 独立 Gold 审查协议

**角色分离**：
| 角色 | 职责 | 是否知道 Kernel 输出 |
|---|---|---|
| Constructor | 构造 memory timeline、问题、候选、约束、证据 | 是（构造者不接触 Kernel） |
| Gold reviewer | 在不知道 Kernel 输出的情况下审核 gold 全字段 | 否（本 Goal 从不运行 Kernel，天然满足） |
| 第二名 reviewer | 复核关键/争议样本 | 否 |

**Gold reviewer 审核字段**：`acceptable_actions`、`prohibited_actions`、`required_evidence`、`constraints`、`approval`、`lineage operation`。

**审核实现**（本环境为单 agent 工作流，以确定性审计 + 人工复核子集实现）：
1. **文本基独立重推**：reviewer 脚本只读取时间线/候选/证据的**文本内容**（不读结构化 gold），按标注协议独立重推 gold（动作、审批、必需证据、约束、lineage、澄清变量），与构造 gold 逐字段比对；
2. **人工复核子集**：对每任务类型 × 每 split 抽取关键/争议样本进行人工复核（reviewer 角色由本 Goal 标注人员执行）；
3. **第二名 reviewer**：对 disagreement 样本进行第二轮独立复核，进入裁决；
4. **裁决**：裁决记录写入 `adjudication-log.jsonl`；被删除、修改、裁决的样本全部记录，不得静默丢弃。

**一致性度量（多标签字段用集合度量，不报单一泛化百分比）**：
- action agreement：逐样本精确匹配率 + Cohen's κ（13 动作类别）
- approval agreement：二分类精确匹配率 + Cohen's κ
- evidence eligibility agreement：required_evidence 集合 Jaccard（逐样本均值）
- hard-constraint agreement：mandatory_constraints 集合 Jaccard
- lineage agreement：acceptable_lineage_operations 操作集合 Jaccard
- disagreement rate：至少一个字段不一致的样本占比
- adjudication count：进入裁决的样本数 + 裁决结果分布

## 9. 防泄漏

检查维度（`leakage-analysis.md`）：
1. 与 development/regression 文本近似（归一化 8-gram Jaccard）；
2. 样本结构模板重复（帧指纹）；
3. 相同专有名词（实体池重叠计数）；
4. 相同数字组合（数值指纹）；
5. 相同时间线（事件时间戳窗口重叠）；
6. 相同 gold explanation（解释文本相似度）；
7. 公开 Benchmark 原文（对仓库内可检索基准文本做包含性检查；合成数据风险低，如实报告）；
8. **validation ↔ holdback 语义隔离**（同 1–6 维度）。

阈值：归一化 Jaccard ≥ 0.5 记为“疑似重复”并人工复核；目标全库 < 0.4。

## 10. Holdback 密封（遵循 Goal 15A 协议）

1. **生成授权**：`goal18-output/holdback-run-auth.json`（purpose 限定为“Goal 18 构造与密封”，明确**禁止**运行模型；正式运行授权由未来 Goal 单独签发）；
2. **seed 两人规则**：`seed_holdback` 由保管人生成并离线托管（本环境：离线保管目录，仓库外），仓库只记录 `sha256(seed_holdback)`；生成/重生成需保管人提供种子 + 授权文件；
3. **离线生成**：生成脚本只接受 `--seed`/`--split`/固定 schema，确定性输出（同 seed 同版本同字节）；
4. **内容 hash**：`sha256(holdback-fixtures.jsonl)` 写入 seal manifest；
5. **加密或不可访问存储**：明文 fixtures 存放于离线保管目录（仓库外）；仓库内仅存 AES-256-GCM 加密产物 `holdback-sealed.bin`（密钥 = seed 经 scrypt 派生，永不入仓库）；
6. **只公开 manifest**：`holdback-public-manifest.json` 只含哈希、版本、计数、访问日志引用，不含内容；
7. **记录访问日志**：`holdback-access-log.jsonl` 追加式、只读目录、不可篡改（含生成、密封、校验、任何读取尝试）；
8. **授权后单次运行**：正式确认运行需未来授权文件 + 保管人释放种子；本 Goal 不运行；
9. **运行完成后不得修改**：fixtures 任何字节变化 = split 作废，必须整批重生成并重新密封授权；
10. **invalid-run 规则**：预登记——基础设施故障（文件损坏、解密失败、哈希不符）按 `invalid-run` 记录，禁止“就地修复”；只能走整批重生成流程。

## 11. 完整性测试（v2 套件）

`benchmark-integrity-tests/`（Node ≥ 18，零依赖）至少覆盖：
- schema（v2 全字段 + gold contract 10 字段）
- ID 唯一（split 内 + 跨 split）
- 引用存在（event/evidence/candidate/constraint/preference 互引）
- 时间线有序（事件 at 单调；valid_from ≤ valid_until；supersedes 指向更早事件）
- evidence validity（qualified/expired/conflicting 分类与 query_time 一致；source_ref 存在）
- gold action 一致性（GOLD-C1..C12 + 动作-任务类型映射）
- approval 一致性（required ⇔ high/critical 或 irreversible；L2 → propose_confirm）
- risk/reversibility 一致性（risk_classification 与 rationale 一致）
- lineage operation（修订动作 parent = historical_decision；none → null parent）
- P0 失败标签（标签 ∈ 26 词表；无互斥标签；与金标互补）
- split isolation（dev/reg ↔ validation ↔ holdback：实体、时间窗、域不相交）
- near-duplicate detection（8-gram Jaccard 阈值）
- distribution coverage（每任务类型数量、因素覆盖、source_type 占比、领域覆盖）
- hash seal（manifest 哈希与文件字节一致；sealed artifact 结构校验）
- access log（存在、追加式、包含 seal 事件）
- 评分器兼容性（对每个样本：gold 响应 → DA=1、硬门槛全过；对抗响应 → 硬门槛失守）

## 12. 输出清单

`benchmark-v2-design.md`、`validation-set.jsonl`、`validation-gold.jsonl`、
`validation-manifest.json`、`holdback-sealed artifact`（`holdback-sealed.bin` +
`holdback-public-manifest.json`）、`annotation-guide.md`、`reviewer-agreement-report.md`、
`adjudication-log.jsonl`、`coverage-matrix.csv`、`leakage-analysis.md`、
`dataset-card.md`、`benchmark-integrity-tests/`、`commands-and-results.log`、
`artifact-sha256.txt`。

## 13. 最终结论判定

只允许：
- `BENCHMARK_READY`：全部产物生成、审计通过、密封完成、无阻断项；
- `BENCHMARK_READY_WITH_BLOCKERS`：产物完成但存在记录在案的受限项（如人工复核覆盖不足、双人保管模拟等）；
- `BENCHMARK_NOT_READY`：存在未解决的数据/gold/完整性阻断。

本 Goal **不运行、不报告 Kernel 在 validation/holdback 上的成绩**。
