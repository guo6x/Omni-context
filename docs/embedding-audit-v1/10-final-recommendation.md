# 10 — 最终结论与推荐

## 八个必答问题

### 问题1：`multilingual-e5-small` 是否被正确使用？

**PARTIAL**。Pooling（mean+attention mask）、L2 归一化、截断、padding 全部正确；唯一且关键的缺失是 E5 强制的 `query:`/`passage:` 前缀（全链路裸文本）。实测代价：R@1 相对 -22%、MRR@10 相对 -12%、temporal R@10 -10.8pts（报告 02/04）。

### 问题2：Embedding 和检索问题占低分的比例？

**检索层整体（含结构问题）约 40%—55%；其中 embedding 模型+用法本身约 10%—20%。**

估计方法：88 道答错可答题的全量自动归因（报告 03）：检索层丢失（CDE 类）52%、抽取缺失 19%、Answer 层 27%、Judge ~1%（另有人工复核显示 Judge 噪声 ±10-20%）。CDE 的 52% 中，代码审计与消融显示大部分来自结构问题（assertion 无向量、按 subject 时间倒序挂载、重排对象错位），纯 embedding 份额用消融上限折算为全部错误的 10-20%。
不确定性来源：①正式 brain.db 缺失，"库内存在"用 199 题 evidence 并集代理（下界）；②gold→assertion 映射为文本匹配（高/中置信两级）；③Judge 噪声未从 F 类中剥离。

### 问题3：主要瓶颈排序（按证据强度）

1. **Assertion 文本序列化 / 检索底座结构**（0.785→0.483 的 30pts 上下文损失 + F 类 24 题的 UUID-JSON 上下文；报告 03/09）
2. **Answer 模型/上下文格式**（gold 全在场也只有 0.569 正确率；与 #1 的生成侧是同一个修复）
3. **Embedding 模型+用法**（e5-small 无前缀 → e5-large 前缀：R@10 0.613→0.807，但要乘系统结构因子）
4. **Extraction（Predicate 坍缩 + 覆盖缺口）**（86% relates_to；A 类 17 题）
5. **Reranker**（对象错位，暂不值得单独升级；报告 08）
6. **Judge**（agreement 0.80，同模型偏置，排最后但影响可信度）

### 问题4：是否放弃 Candidate v1 并创建 Candidate v2？

**CONDITIONAL（建议创建 v2，但 v1 原样保留）**。v1 的结果、标签、数据完整可审计，作为"结构修复前"的基线有存档价值，不应覆盖或移动。当且仅当完成最小修复集（见下"最小执行计划"）后创建 Candidate v2 重跑 Conv1；同时 v2 流程必须修复 v1 的证据保存缺口（归档 brain.db 与候选池快照）。

### 问题5：推荐哪个 Embedding 模型？

```
Primary Recommendation: intfloat/multilingual-e5-large（Xenova/multilingual-e5-large int8 ONNX）+ 正确 query:/passage: 前缀
Fallback Recommendation: intfloat/multilingual-e5-base（Xenova/multilingual-e5-base int8 ONNX）+ 前缀
```

理由：e5-large 在 150 题 Conv1 检索消融中全类别第一（R@10 0.807 / temporal 0.973 / multi_hop 0.818），MIT 许可，与现网同家族（改配置+重嵌即可），CPU 延迟 32ms 在 2.6s 的检索管线中可忽略，RSS 0.43GB 可接受。**未选 bge-m3**：dense-only int8 在本任务全面落后 e5-large（R@10 0.707 vs 0.807），RSS 2.1GB，混合检索头在 transformers.js 下不可用；其中文/长文本优势与 LoCoMo 无关，若未来主打中文长文档场景可重新评估。Fallback e5-base 用于安装包体积敏感的发行版（+160MB vs +440MB），仍比现状 +9pts R@10。

### 问题6：是否需要额外 Reranker？

**LATER**。当前重排器作用在实体目录上而证据是 assertion，结构错位未修复前，cross-encoder 是给错误的层加精度（报告 08）。assertion 级向量检索落地后重新评估 bge-reranker-v2-m3。

### 问题7：是否值得完整重跑 Conversation 1？

**ONLY AFTER** 完成最小修复集（assertion 序列化+入向量、Answer 上下文可读化、E5 前缀、模型升级）后作为 Candidate v2 重跑。只换 embedding 就重跑 199 题，预期收益 +3~6pts，不足以支付一次正式 run 的成本与解读混乱。

### 问题8：升级后预计改善（保守区间）

仅"e5-large + 前缀"（不动结构）：
- 检索侧 Recall@10（理想底座口径）：0.613 → 0.807（消融实测）；传导到 Final Context Recall 预计 0.48 → 0.55~0.62
- Answerable Binary Accuracy：0.40 → **0.43~0.47**（+3~7pts，乘 0.57 条件正确率）
- Binary Accuracy（含对抗）：0.482 → 0.50~0.53
- Evidence Precision：0.45 → 0.46~0.52（弱改善；主要由挂载结构决定）
- Single-hop：0.219 → 0.26~0.33；Multi-hop：0.385 → 0.40~0.50（多跳主要卡在多证据同现，模型升级帮助有限）
- 延迟：检索 P50 +26ms（2588→~2614ms，+1%）；内存：+~0.4GB 常驻
- 若同时完成 assertion 序列化+入向量与 Answer 上下文修复（推荐路径），answerable accuracy 保守估计 0.40 → **0.50~0.58**（上限受 Answer 条件正确率 0.57 与 Judge 噪声约束）

## 决策矩阵

| 方案 | 检索质量 | 中文 | 英文 | 长文本 | CPU延迟 | 内存 | 集成风险 | 推荐度 |
|---|---|---|---|---|---|---|---|---|
| e5-small 现状 | 差（R@10 0.613） | 中 | 中 | 512tok | 6ms 优 | 0.65GB | 零（现状） | ★☆☆☆☆ |
| e5-small 修正实现 | 中下（0.633） | 中 | 中 | 512tok | 6ms 优 | 0.65GB | 极低（一行+重嵌） | ★★☆☆☆（最低成本止血） |
| multilingual-e5-large | **优（0.807）** | 良 | 优 | 512tok | 32ms 良 | 0.43GB | 低（同家族+维度迁移） | **★★★★★（主推荐）** |
| BGE-M3 | 中（0.707） | 优（未测） | 良 | 8192tok | 26ms 良 | **2.1GB 差** | 中（CLS/无前缀用法分叉） | ★★☆☆☆ |
| e5-base（第4候选） | 良（0.707） | 良 | 良 | 512tok | 14ms 优 | 0.20GB | 低 | ★★★★☆（Fallback） |

## 下一步最小执行计划（Candidate v2 前置，按依赖排序）

1. **EmbeddingService 增加 usageProfile**（queryPrefix/passagePrefix/pooling 按模型配置；`embedding_model` meta 扩展为 `model@usage_version` 触发重嵌）——修复前缀缺失，兼容未来模型切换。
2. **Assertion 序列化入向量**：按报告 09 §5 模板生成 assertion 文本，新建 `vec_assertions`，检索链增加 assertion 级 KNN（与实体 KNN 并联进候选池）。
3. **Answer 上下文可读化**：evidence JSON → 人类可读行（speaker 名、日期、source_span、原始谓词），id 保留供引用。
4. **模型切换到 Xenova/multilingual-e5-large**（配置项 `EMBEDDING_LOCAL_MODEL` 已支持；打包体积敏感则 e5-base）。
5. **评测基建补课**：run 目录归档 brain.db + 候选池快照进 results.jsonl（修复本轮暴露的不可复算问题）。
6. 以上完成后创建 `evaluation-freeze-candidate-v2`，重跑 Conv1 全量 199 题；v1 标签与结果原样保留。
7. （之后再议）predicate 保留原始短语、Judge 换异源模型、cross-encoder 重排。
