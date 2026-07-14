# 08 — Reranker 评估：比 Embedding 更值得升级吗？

## 1. 现有重排/加权机制盘点

| 机制 | 存在？ | 位置 | 说明 |
|---|---|---|---|
| LLM Reranker | ✓ | `mcp.ts:151-214` `rerankByLlm` | DeepSeek listwise，temperature 0，输入=`(type) name: description[:120]`，超时/失败降级为词法排序截断 |
| Cross Encoder | ✗ | — | 无 |
| 规则重排 | ✓ | `mcp-retrieval.ts:55-115` `scoreCandidate` | 词法命中（名称=12/含=6/tag=4/描述=2）+ 相似度×3 |
| Temporal Boost | 部分 | 同上 :91-96 | 只有惩罚没有加权：过期 -6、失效 -20 |
| Graph Score | ✗ | — | 图扩展节点无来源加权 |
| Source Score | ✗ | — | 无 |
| Stale Penalty | ✓ | config.ts:23 `stalePenalty:6` | |
| Conflict Penalty | ✓ | config.ts:25 `pendingConflictPenalty:4` | |

## 2. 结构性问题：Reranker 重排的对象不是证据

`rerankByLlm` 重排的是**实体**（name+description 前 120 字符），而最终证据是**assertion**（按 Top 实体 subject_id 时间倒序挂载，`mcp.ts:302-305`）。也就是说：

1. 重排器看不到 assertion 的 source_span——它在对"目录"排序，而不是对"内容"排序；
2. 实体排对了，挂上来的 8 条 assertion 仍可能不含答案（每实体只取最新 8 条，与查询无关）；
3. 换成再强的 cross-encoder，只要它仍作用在实体层，收益都被挂载环节封顶。

## 3. 证据：瓶颈在挂载/候选层，不在重排算法本身

- 报告 03：Extraction Coverage 0.785 → Final Context Recall 0.483，损失 30 个百分点发生在"候选→最终上下文"整段；无候选池快照，无法把这 30 个百分点在 KNN/重排/挂载三个环节间精确切分，但挂载环节的结构缺陷（非语义、每实体≤8条、时间倒序）是代码可证的。
- 报告 04：dialog 级 R@20（0.727/0.740）比 R@10 高约 10 个百分点——候选池里确实有更多正确证据可供重排器挽救，说明"宽召回+强重排"在这个数据上有真实空间。
- CDE 类错误 46 题中典型样例（"What is Caroline's relationship status?" → 答 unknown）说明证据既没被实体路径带进来、重排也无从补救。

## 4. 回答任务书问题

1. **Candidate Pool 中正确 Evidence 比例**：不可精确测量（池未落盘）；用 R@20 口径估计约 0.73–0.74（dialog 级理想底座）。
2. **正确 Evidence 常进候选但被重排丢弃？** 部分成立，但更大的丢失在 assertion 挂载环节（结构性，非分数问题）。
3. **Candidate Recall 高但 Final Recall 低 → 主要问题不是 Embedding**：成立。0.785（库内）/ ~0.73（池级估计）→ 0.483（final）。
4. **是否应增加专用 Reranker（如 BGE-reranker-v2-m3）**：**LATER**。在 assertion 没有向量、重排对象错位的现状下，先上 cross-encoder 是给错误的层加精度。等 assertion 级向量检索落地后，再评估 cross-encoder（bge-reranker-v2-m3 ONNX 量化约 600MB、CPU 单对推理 ~30-80ms，对 40 候选 ≈ 1.5-3s/query，本机可跑但延迟敏感）。
5. **BGE-M3 Dense 升级 vs Reranker 升级哪个收益大**：都小于"assertion 文本入向量 + Answer 上下文序列化修复"。二者之间：Dense 升级（含前缀修复）成本低得多（模型换配置 + 全量重嵌 ~400 条文本），先做 Dense。
6. **是否先修 Predicate/Assertion 序列化**：**是**（见报告 09/10 的排序）。
