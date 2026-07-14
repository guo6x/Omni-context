# 01 — 当前 Embedding 实现审计

审计基线：branch `pre-evaluation-hardening-v3.1`，HEAD `3bdb6e106832854a9bc94672fc74fafa8f7e221f`（= tag `evaluation-freeze-candidate-v1`），工作区干净。Candidate v1 未被移动或修改。

## 1. 核心代码路径

| 组件 | 位置 |
|---|---|
| EmbeddingService | `brain-server/src/embedding/service.ts` |
| 本地模型加载（Transformers.js） | `service.ts:66-88`（`env.allowRemoteModels=false`，`localModelPath=brain-server/models`，`quantized:true`） |
| 本地推理 | `service.ts:124-139`（`pooling:'mean', normalize:true`） |
| hash fallback | `service.ts:178-214` |
| Entity Embedding 写入 | `graphrag/entity-resolver.ts:167-183`（`embedBounded`，文本=`${name}: ${description}`） |
| Query Embedding | `api/handlers/mcp.ts:1238`（unified_memory_search，原文无前缀） |
| 向量存储 | `db/sqlite.ts:2112-2131`（`_syncVecEmbedding`→ sqlite-vec `vec_entities` 虚拟表 + entities.embedding BLOB 双写） |
| 向量检索 | `db/sqlite.ts:2041-2071`（`_vectorSearchNative`，vec0 KNN） |
| vec 表建表 | `db/sqlite.ts:157-162`（migration `add_vec0_virtual_table`）、`db/sqlite.ts:2153-2160`（动态维度重建） |
| JS 余弦回退 | `db/sqlite.ts:2076-2107`（sqlite-vec 不可用时） |
| 模型切换重嵌 | `api/routes.ts:294-308`（`maybeReembedOnModelChange`→`reembedAllEntities` sqlite.ts:1090） |
| Evaluation mode 守卫 | `retrieval/config.ts:59-66`（`assertEvaluationEmbeddingReady`，`OMNI_EVALUATION_MODE=1` 时禁止 hash fallback） |

## 2. 读链路（正式 run 实际路径：benchmark runner → unified_memory_search）

```
Question（benchmark/src/runner/index.mjs:194，top_k=10）
→ POST /api/mcp/tool/unified_memory_search（mcp.ts:1223）
→ ① FTS5 实体关键词检索 searchEntities（sqlite.ts:983，pool=max(10×4,16)=40）
→ ② Query Embedding（mcp.ts:1238，E5 原文无 "query: " 前缀）
   → vec_entities KNN（sqlite.ts:2041，L2 距离，pool=40）
→ ③ 时间窗实体召回 parseTimeWindow → getEntitiesByTimeWindow（mcp.ts:1260-1266）
→ 候选合并去重（mcp.ts:1248-1257）
→ ④ 图扩展：词法排序取 3 个种子 → getGraphNeighborhood depth=2（mcp.ts:1268-1282）
→ ⑤ 时间过滤 filterEntitiesByTemporal（mcp.ts:1287）
→ ⑥ LLM 重排 rerankByLlm（mcp.ts:151-214，DeepSeek listwise，输入=name+description[:120]）取 limit×2=20
→ ⑦ 词法分数过滤 memoryCandidateScore > 0（mcp.ts:1291）
→ ⑧ buildGroundingEnvelope（mcp.ts:287-346）：对 Top≤10 实体按 subject_id 各取 ≤8 条
   assertion（getAssertions，sqlite.ts:1741，按 valid_from DESC，非语义），上限 30 条 → evidence
→ Answer LLM（benchmark/src/llm-client.mjs:82-90，上下文=evidence 的 JSON 序列化）
```

## 3. 写链路

```
LoCoMo Session → POST /api/graph/extract（ingest.ts）
→ DeepSeek 抽取 entities/relationships/assertions/principles
→ resolveEntities（entity-resolver.ts:256）
   → embedBounded：仅对 Entity 生成向量，文本=`${name}: ${description}`（entity-resolver.ts:176）
→ addEntity → entities.embedding BLOB + _syncVecEmbedding → vec_entities（sqlite.ts:2112）
→ addAssertion（ingest.ts:463-471）：★ 不生成任何向量 ★
→ Principle 作为 entity 入库（同 Entity embedding 路径）
```

## 4. 二十一问逐项回答

| # | 问题 | 结论 |
|---|---|---|
| 1 | Query/Passage 是否同模型 | 是，同一个 EmbeddingService 实例（e5-small） |
| 2 | 是否使用 E5 前缀 | **否**。Query 和 Passage 均为裸文本（service.ts:125 直接对原文推理；调用方 mcp.ts:1238 / entity-resolver.ts:176 均未加前缀） |
| 3/4 | 是否 Pooling、哪种 | 是，mean pooling + attention mask（service.ts:126；transformers.js `mean_pooling`，pipelines.js:1261-1262） |
| 5 | L2 Normalization | 是（service.ts:127 `normalize:true` → `result.normalize(2,-1)`） |
| 6 | SQLite 距离函数 | sqlite-vec vec0 默认 **L2 距离**；向量已归一化，L2 与 cosine 单调等价 |
| 7 | 距离与排序方向 | 正确：`ORDER BY v.distance` 升序，similarity=1/(1+distance) 单调（sqlite.ts:2059,2069） |
| 8 | 输出维度 | 384（e5-small hidden_size=384，config.json 实测） |
| 9 | vec 表是否硬编码维度 | 建表 migration 硬编码 FLOAT[384]（sqlite.ts:162），但运行时检测维度不符会自动 DROP+重建（sqlite.ts:2028-2030, 2153-2160）——**重建即清空向量索引** |
| 10 | 最大输入长度 | 512 token（tokenizer_config `model_max_length:512`） |
| 11 | 超长截断 | transformers.js feature-extraction pipeline 默认 `truncation:true`（pipelines.js:1244-1247），尾部截断 |
| 12 | 中英文是否同处理 | 是，同一 pipeline，无语言分支；SentencePiece 多语 tokenizer |
| 13 | 空/零/NaN 向量 | 正式库无法直接验证（见 §5）；旧副本库 382/382 向量非零非 NaN。代码上 embedding 失败时实体**无向量**（entity-resolver.ts:177-179 仅 warn），不会写零向量 |
| 14 | 多少 Entity 有向量 | 正式库不可直接验证（DB 未保留）。代码路径上每个新建实体都会尝试嵌入；正式 server.log 无嵌入失败告警 → 推断 ≈396/396（含 182 Principle） |
| 15 | 多少 Assertion 有向量 | **0/423。Assertion 完全没有 Embedding**（assertions 表无 embedding 列；addAssertion 不调用 EmbeddingService） |
| 16 | 只嵌 Entity 却用 Assertion 回答？ | **是，完全属实**。最终 evidence 唯一来源是 assertion（mcp.ts:334-336），但 assertion 仅按 Top 实体的 subject_id 挂载（每实体 ≤8 条、按 valid_from 降序、与查询无关），整条语义检索链从未接触 assertion 文本 |
| 17 | 新事实向量是否及时更新 | Entity 创建/合并时即嵌入（同步于 ingest 流程）；描述更新复用旧向量的风险存在（entity-resolver 只在 `!entity.embedding` 时生成，line 174） |
| 18 | 合并/失效后旧向量 | 软合并实体通过 `json_extract(metadata,'$.merged_into') IS NULL` 在 KNN JOIN 时排除（sqlite.ts:2058）；confirmMerge 会重定向向量引用（entity-resolver.ts:458+）；vec_entities 中旧行 DELETE+INSERT（sqlite.ts:2123-2127） |
| 19 | pending 状态下被调用？ | 不会产生错误结果：`embed()` 首行 `await ensureInitialized()`（service.ts:94），懒加载完成后才推理。Manifest 中 `status=pending` 只表示健康检查时模型尚未加载（getStatus() 在 initialized=false 时返回 pending，service.ts:219-221），语义易误读但无功能影响 |
| 20 | Embedding 失败是否静默降级 | **默认是**：模型加载失败→hash fallback（service.ts:82-85），且 UMS 中向量检索失败仅 warn 后继续纯关键词（mcp.ts:1244-1246）。但评测模式 `OMNI_EVALUATION_MODE=1` 会显式抛错（config.ts:59-66），benchmark runtime 设置了该变量（conversation-runtime.mjs:102） |
| 21 | 正式 run 是否用了 hash fallback | **没有**。证据：①正式 server.log 两次 "[EmbeddingService] 本地模型加载完成"；②评测模式守卫开启，hash fallback 会中断 run，而 run 0 errors；③manifest `available:true` |

## 5. 证据保存缺口（重要）

正式 run 的 `conversation-1/brain.db`（sha256 `13766bb6…`）**未在磁盘保留**：run 目录 `benchmark/runs/2026-07-13T16-54-49-815Z-1b9d6c9a` 已不存在，`.gitignore` 排除 `*.db`，评测证据目录只归档了 hash 与统计摘要。因此本审计中所有"正式库内向量级"指标（向量覆盖率、库内 KNN 复现）均为代码推断 + results.jsonl 反推（见 03/04 报告），无法在原库上直接复算。旧的 `../benchmark/results/conv-1.db`（7月11日）经检查是 **768 维向量、无 assertions 表**的旧 schema 产物，不能作为正式 pipeline 副本。

**建议**：Candidate v2 流程必须把 brain.db 一并归档（或至少归档 entities/assertions/向量的 dump）。
