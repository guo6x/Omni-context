# Brain-Server 问题修复 — 进度与交接文档

> 来源：`docs/1.md`（外部 AI 的 13 项 review 清单）经逐行核实后的修复计划与进度。
> 用途：当前 AI 边修边更新此文档；若中途停下，后续 AI 可凭此无缝接手。
> 核实方式：逐行读取实际源码比对，而非凭清单描述。

## 状态图例
- [ ] 待修复
- [x] 已修复
- `误报` = 经核实不成立，不修
- `夸大` = 部分成立但价值低/描述有误，暂缓

---

## 一、核实结论总表

| # | 原级别 | 判定 | 是否修 | 核实要点 |
|---|--------|------|--------|----------|
| 1 | 严重 | ✅ 属实 | **修** | `runMigrations` catch 内 `throw`（sqlite.ts:294-296）会中断循环。vec0 扩展没加载时 v4 `USING vec0` 报 "no such module: vec0"，导致 v5-v9 全不执行。 |
| 2 | 中 | ✅ 属实 | 修 | `updateCache` 按插入顺序淘汰（core-memory.ts:420），`get()` 命中不刷新顺序（82-84）。名 LRU 实 FIFO。影响有限（cache=1000）。 |
| 3 | 中 | ✅ 属实 | **修** | vec0 表 `FLOAT[384]` 硬编码（sqlite.ts:141），embedding 维度动态（service.ts 返回 `embedding.length`）。非 384 模型→`_syncVecEmbedding` 被 catch 静默吞，KNN 失效。 |
| 4 | 中 | ✅ 属实 | 修 | `searchEntities` 原始输入直传 `MATCH ?`（sqlite.ts:439），特殊字符抛错→回退 LIKE。降级非瘫痪。 |
| 5 | 中 | ⚠️ 夸大 | 暂缓 | 是事务内逐条 UPDATE，但"N 次 fsync"错——事务只 COMMIT 时 fsync 一次（代码注释已说明）。仅剩 N 次 round-trip（开销小）。 |
| 6 | 中 | ✅ 属实但属增强 | 暂缓 | 三处 LLM 调用确无重试（mcp.ts:168 / llm-pipeline.ts:149 / conflict-resolver）。当前"静默降级"是设计选择，非缺陷。 |
| 7 | 中 | ✅ 属实 | 修 | `combineInputs` 每次截图 `new OCRPipeline()`+`dispose()`（extractor.ts:458-473），每次重启 Tesseract worker。 |
| 8 | 中 | ✅ 属实 | **修** | 指定 type 时 `getEntitiesByType` 全量拉取再 JS filter+slice（mcp.ts:277-282）。 |
| 9 | 低 | ✅ 属实 | 修 | `_vectorSearchFallback` 全量 `SELECT ... embedding IS NOT NULL` 入内存（sqlite.ts:845）。仅 vec 不可用时触发。 |
| 10 | 低 | ✅ 属实 | **修** | `VALID_ENTITY_TYPES`(13) 少了 `'decision'`，`EntityType`(14) 有（extractor.ts:222 vs shared-types.ts:23）。 |
| 11 | 低 | ❌ 误报 | 不修 | source/target 双索引存在，SQLite 有 OR-by-union 优化，"全表扫描"不成立。 |
| 12 | 低 | ❌ 误报 | 不修 | sqlite.ts:943 catch 实际是 `console.warn('[FTS5]...', e)`，err 有记录。清单描述与代码不符。 |
| 13 | 低 | ⚠️ 部分属实 | 暂缓 | 串行循环属实，但"无错误隔离"不实（每轮有 try/catch，28行），每次调用有超时。 |
| 建议 | — | ✅ 属实 | 修 | `mcp-server.ts` 只有 get_decision_context/save_decision/get_decision_lineage，缺 `analyze_decision`/`discuss_decision`。 |

**真实需修（按价值排序）**：#1 > #3 > #10 > #4 > #8 > #2 > #7 > #9 > 建议
**不修**：#5 #6 #11 #12 #13（误报或低价值/描述有误）

---

## 二、修复进度清单（边做边勾）

> 全部 9 项已修复，brain-server `npx tsc --noEmit` 通过。下方记录实际改法。

### [x] #1 migration v4 崩溃中断后续迁移 — `brain-server/src/db/sqlite.ts`
- 已做：`Migration` 接口加 `requiresVec?: boolean`；v4 标 `requiresVec: true`；`runMigrations` 中 `migration.requiresVec && !this.vecEnabled` 时 `continue`（跳过且**不写 migrations 表**，扩展可用时自动重试）。其余迁移失败仍 throw。
- 待验收：vec 扩展缺失时确认 notifications(v6)/temporal(v8) 等表仍建出。

### [x] #3 vec_entities 维度硬编码 — `brain-server/src/db/sqlite.ts`
- 已做：新增字段 `vecDimension`(默认384)/`vecDimensionResolved`；`_resolveVecDimension()` 从 `sqlite_master` 的建表 SQL 正则 `\[(\d+)\]` 读真实维度（避免重启误判）；`_syncVecEmbedding` 写入前比对维度，不符则 `_recreateVecTable(dim)` 按实际维度重建。旧向量来自旧模型本就不可比较，重建为空表可接受。
- 待验收：用 1536 维 API 模型（如 OpenAI text-embedding-3-small）实测 KNN 能命中。无法本机跑模型，需接手者实测。

### [x] #10 VALID_ENTITY_TYPES 补 'decision' — `brain-server/src/graphrag/extractor.ts:222`
- 已做：Set 加 `'decision'`，与 `EntityType` 对齐。

### [x] #4 FTS5 查询转义 — `brain-server/src/db/sqlite.ts` searchEntities
- 已做：新增 `_toFtsQuery()`——按空白拆词，每词包双引号 phrase（内部 `"` 翻倍），词间隐式 AND。`searchEntities` 改用它，空输入跳过 FTS 直接 LIKE 回退。

### [x] #8 search_entities 类型过滤下推 SQL — `brain-server/src/api/handlers/mcp.ts:277`
- 已做：`Database.searchEntities` 加第三参 `type?`，FTS 与 LIKE 两条 SQL 都加 `AND type = ?`；mcp.ts handler 改为 `searchEntities(query, limit, type)`，删掉 getEntitiesByType 全量+JS filter。

### [x] #2 CoreMemory LRU 修复 — `brain-server/src/memory/core-memory.ts`
- 已做：`get()` 命中缓存时 `delete(key)`+`set(key,cached)` 刷新 Map 顺序，使 `updateCache` 真正按 LRU 淘汰。

### [x] #7 OCRPipeline 复用 — `brain-server/src/graphrag/extractor.ts`
- 已做：新增成员 `ocrPipeline: OCRPipeline | null`，`combineInputs` 改为 `this.ocrPipeline ??= new OCRPipeline()` 复用（worker 懒创建后常驻），不再每张截图 new+dispose。注：worker 随进程生命周期常驻，daemon 场景可接受。

### [x] #9 向量回退内存上限 — `brain-server/src/db/sqlite.ts`
- 已做：`_vectorSearchFallback` 的 SELECT 加 `ORDER BY access_count DESC, last_accessed DESC LIMIT 5000`（CANDIDATE_CAP），用召回换内存安全。

### [x] 建议 analyze_decision / discuss_decision 同步到 stdio MCP — `brain-server/src/mcp-server.ts`
- 背景：schema 早已 import、tools[] 也已广播，但 callTool 缺 case → Claude Desktop 看得到工具却调用报错。
- 已做：switch 加 `analyze_decision`/`discuss_decision` 两个 case；新增私有方法 `_retrieveDecisionContext`/`_buildAnalysisPrompt`/`_callLlmDecision`，镜像 HTTP handler（沿用本文件已有的内联复制风格）。LLM 未配置时抛 `McpError(InvalidRequest, 'LLM_NOT_CONFIGURED')`。

---

## 三、验证方式
- 改完后在 `brain-server/` 跑 `npm run build`（tsc）确认无类型/编译错误。
- 涉及 DB schema 的（#1 #3）最好删掉测试库重新初始化跑一遍迁移。
- #3 需要用非 384 维模型（如 OpenAI text-embedding-3-small=1536）实测 KNN。

## 四、进度日志
- 2026-05-28：完成 13 项逐行核实，确认 9 真 / 2 夸大 / 2 误报；建立本文档与任务清单。开始按价值修复。
- 2026-05-28：9 项真实问题全部修复完毕（#1 #2 #3 #4 #7 #8 #9 #10 + 建议），`brain-server` `npx tsc --noEmit` 编译通过。**尚未运行时验证**：建议接手者跑 ① 删测试库重新初始化跑迁移（验 #1）② 用 1536 维 API embedding 模型验 #3 KNN ③ Claude Desktop 连 stdio MCP 调用 analyze_decision 验「建议」。改动仅限 brain-server，未碰前端/打包。
- 待办（已评估为不修，留作记录）：#5 #6 #11 #12 #13。如未来要做，#6（LLM 重试）价值相对最高。
