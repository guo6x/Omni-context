# 03 — 错误归因分析（正式 Conv1 run）

数据源（只读）：`docs/delivery-v3.1/evidence/benchmark-conv1/results.jsonl`（199 题全量，含每题最终 30 条 assertion evidence 及 source_span）+ LoCoMo Conv1 官方 reference evidence（经 split-guarded loader 只读 Conv1）。
脚本：`evidence/error-attribution.mjs`；结果：`evidence/error-attribution-summary.json` / `error-attribution-detail.json`。

## 1. 方法与限制

正式 brain.db 未保留（见报告 01 §5），无法逐题检查候选池。替代方法：

- **Gold→内部证据映射**：把每题 reference evidence（dia_id）的对话原文与 assertion 的 `source_span` 做归一化子串匹配（高置信）或 token 集合匹配（Jaccard≥0.5 / containment≥0.7，中置信）。
- **"库内存在"代理**：全 199 题最终 evidence 的并集共 **295 条唯一 assertion**（占库中 423 条的 70%），以此作为抽取覆盖的**下界代理**——gold 在并集中匹配不到 ≠ 一定没抽出来，但匹配得到一定抽出来了。
- 分类是全量自动分类（88 道答错可答题全部覆盖，超出任务书要求的每类 10 题抽样），非人工抽样。

## 2. 分类结果（88 道答错的可答题）

| 类别 | 含义 | 数量 | 占比 |
|---|---|---:|---:|
| A | gold 在全部 retrieved assertion 并集中都找不到 → **抽取/写入缺失**（下界） | 17 | 19% |
| C/D/E | gold 已被抽取（在并集中），但没进本题最终上下文 → **检索/重排/挂载丢失** | 33 | 38% |
| C/D/E-partial | 多 evidence 题只有部分 gold 进上下文 | 13 | 15% |
| F | gold 已在最终上下文，Answer 仍答错 | 24 | 27% |
| G? | 答案与 reference 词面高度重合仍判 0（疑似 Judge 误判，需人工复核） | 1 | 1% |

分类别分布：temporal 错误以 CDE(11)+F(7) 为主；single_hop 以 CDE(7)+CDE-partial(10) 为主；open_domain 是 F(16)+CDE(13)+A(8)；multi_hop 三类均摊。另有 12 道 adversarial 答错（对抗题范畴，不参与上述归因）。

## 3. 漏斗指标（149 道可映射的可答题）

| 指标 | 值 | 说明 |
|---|---:|---|
| Extraction Coverage（代理下界） | **0.785** | gold 至少 1 条能在 assertion 并集中匹配到 |
| Vector Coverage | Entity ≈100%，**Assertion 0%** | 代码结构性事实（报告 01） |
| Final Context Recall(any) | **0.483** | gold 至少 1 条进入最终 30 条 evidence |
| Final Context Recall(full) | 0.389 | gold 全部进入 |
| Candidate Recall@K | 无法测量 | 候选池未落盘，正式库缺失 |

分类别 Final Context Recall(any)：temporal 0.486 / single_hop 0.548 / multi_hop **0.273** / open_domain 0.486。

**检索层内部损失 = 0.785 → 0.483，损失 30.2 个百分点**，是漏斗中最大的单段损失。注意这一段混合了：实体向量召回失败、LLM 重排丢弃、以及"assertion 按 subject 挂载（每实体≤8条、按时间排序、与查询无关）"的结构性丢失，无法在无 DB 的情况下细分。

## 4. Answer Conditional Accuracy（条件正确率）

| 条件 | n | 正确 | 正确率 |
|---|---:|---:|---:|
| gold **全部**在最终上下文 | 58 | 33 | **0.569** |
| gold 部分在上下文 | 72 | 34 | 0.472 |
| gold 完全不在上下文 | 77 | 27 | 0.351 |

两个关键推论：

1. **检索完美也只能到 ~0.57**：即使把 Final Context Recall 提到 100%，按当前 Answer+Judge 条件正确率外推，answerable accuracy 上限约 0.55–0.60（现状 0.40）。Answer 层失败的主因可从 F 类样例看出：上下文是 UUID+`relates_to`+短 source_span 的 JSON（报告 09），Answer 模型经常在证据在场时输出 "unknown" 或错日期。
2. **gold 不在上下文时还有 0.35 "正确"**：其中包含蒙对、判松（Judge 用同模型）与 reference 本身宽松的成分，提示 Judge 偏松。

## 5. Judge Disagreement

既有人工复核（`delivery-v3.1/evidence/benchmark-conv1/judge-manual-review.json`，15 题分层抽样）：**agreement 0.80，3/15 不一致**，方向包括"该判错的判对"（如对 abstention 给分）。自动筛出的词面高重合误判仅 1 例。综合估计 Judge 噪声 ≈ ±10–20%，且与 Answer 同模型（deepseek-v4-flash）存在同源偏置。

## 6. 核心问题：换理想 Embedding 理论上最多挽救多少题？

上界推算（全部按对 embedding 最有利的假设）：

- CDE + CDE-partial 共 46 题是"库里有但没进上下文"。其中 embedding 向量召回只是三个丢失环节之一（实体 KNN → LLM 重排 → assertion 挂载）。dialog 级测评（报告 04）显示：更强 embedding + 修正用法能把 R@10 提升 2–10 个百分点（相对现状 e5-small 无前缀）；即使按 20 个百分点的乐观口径折算，46 题中可挽救约 9–15 题。
- 再乘 Answer 条件正确率 0.57 → **净增正确题约 5–9 题 ≈ answerable binary accuracy +3～6 个百分点（0.40 → 0.43~0.46）**。
- A 类（17 题）、F 类（24 题）与 Judge 噪声跟 embedding 无关，换任何模型都救不了。

结论：**Embedding（模型+用法）对当前低分的贡献是次要但非零的，检索层结构问题（assertion 无向量、非语义挂载）和 Answer 上下文序列化问题比 embedding 模型本身更大。** "Evidence Precision 低"主要反映 evidence 是"实体挂载的 30 条时间倒序 assertion"这一结构，而非向量质量。
