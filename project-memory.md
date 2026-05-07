# 📋 Omni-Context v2.0 — 项目记忆文档

## 当前状态
- **项目阶段**: 架构优化 → ✅ 全部 P0/P1/P2 已完成（P2-2 延期）
- **已完成模块**: 全部核心模块已重构
- **当前任务**: 集成测试 + 生产环境部署验证
- **下一步计划**: 端到端测试、性能基准测试、Tauri v2 升级规划

## 架构决策

### ✅ 已确定
1. **Schema 统一**: Migration 系统是唯一真理源，schema.sql 已废弃
2. **万物皆实体**: principles、evidence 等全部通过 entities 表 + type 字段区分
3. **Embedding 策略**: 本地优先（transformers.js），API 备选，哈希回退兜底
4. **向量维度**: 384 维（all-MiniLM-L6-v2 模型）
5. **向量搜索**: sqlite-vec 原生 KNN（Float32），回退到 JS 内存余弦
6. **全文检索**: FTS5 虚拟表 + unicode61 分词，回退到 LIKE
7. **3D 可视化**: react-force-graph-3d，支持 2D/3D 切换
8. **进程管理**: Rust LazyLock<Mutex> 替代 unsafe，Tauri 退出时自动清理
9. **Migration 版本**: 当前最新 v5（FTS5 虚拟表）
10. **知识提取**: 正则 + LLM 双层提取（正则先行，LLM 语义增强）
11. **记忆衰减**: 艾宾浩斯遗忘曲线 + 赫布学习规则强化
12. **OCR 管线**: tesseract.js 本地 + 云端 API 回退

### ⏳ 待决定
1. Tauri v2 升级的时间窗口（计划 v3.0）

## 技术栈
- **前端**: Next.js 14 + React 18 + TailwindCSS 3.4 + react-force-graph-3d
- **后端**: Node.js + TypeScript + SQLite (node-sqlite3) + sqlite-vec
- **桌面**: Tauri 1.5 (Rust)
- **Embedding**: @xenova/transformers (all-MiniLM-L6-v2, 384 维)
- **OCR**: tesseract.js（可选安装）
- **协议**: MCP (Model Context Protocol)

## 重要约定
- 文件不超过 300 行
- Migration 版本递增：当前最新 v5
- 所有新实体自动生成 embedding
- 向量同步：addEntity/updateEntity 自动同步到 vec_entities
- FTS 同步：addEntity/updateEntity/deleteEntity 自动同步到 fts_entities
- 错误不允许静默吞噬
- UNIQUE 约束冲突是预期行为，可跳过

## 已完成的修复清单

### 全部修复 (P0 + P1 + P2)
| 编号 | 问题 | 状态 | 文件 |
|------|------|------|------|
| P0-1 | sqlite-vec 原生向量搜索 | ✅ | sqlite.ts, math.ts, sqlite-vec.d.ts |
| P0-2 | Schema 双轨统一 | ✅ | sqlite.ts, schema.sql, handlers/index.ts |
| P0-3 | Rust unsafe 消除 | ✅ | brain_server.rs |
| P0-4 | Brain Server 进程泄漏 | ✅ | main.rs |
| P1-1 | GraphRAG LLM 提取器 | ✅ | llm-pipeline.ts, extractor.ts |
| P1-2 | 三层记忆系统统一 | ✅ | mcp-server.ts (unified_memory_search) |
| P1-3 | Embedding 生成管线 | ✅ | embedding/service.ts, mcp-server.ts |
| P1-4 | cosineSimilarity 去重 | ✅ | utils/math.ts |
| P1-5 | FTS5 全文检索 | ✅ | sqlite.ts (Migration v5 + searchEntities) |
| P2-1 | 3D 知识图谱可视化 | ✅ | GraphViewer.tsx |
| P2-2 | Tauri v2 升级 | ⏸️ | 延期至 v3.0（破坏性变更） |
| P2-3 | 记忆衰减调度器 | ✅ | memory/decay-scheduler.ts, mcp-server.ts |
| P2-4 | 错误静默吞噬 | ✅ | mcp-server.ts |
| P2-5 | OCR 管线 | ✅ | ocr/pipeline.ts, tesseract.d.ts |
| 额外 | 原始语法 Bug | ✅ | sqlite.ts (5 处 Promise + SQL 引号) |
| 生态升级 | MCP 与 API 融合 | ✅ | mcp-server.ts (同时启动 HTTP 供插件使用) |

## 新增文件
- `brain-server/src/utils/math.ts` — 公共数学工具
- `brain-server/src/embedding/service.ts` — Embedding 生成服务
- `brain-server/src/graphrag/llm-pipeline.ts` — LLM 知识提取管道
- `brain-server/src/memory/decay-scheduler.ts` — 记忆衰减调度器
- `brain-server/src/ocr/pipeline.ts` — OCR 文本提取管道
- `brain-server/src/types/xenova-transformers.d.ts` — transformers.js 类型
- `brain-server/src/types/sqlite-vec.d.ts` — sqlite-vec 类型
- `brain-server/src/types/tesseract.d.ts` — tesseract.js 类型

## 关键接口

### EmbeddingService
```typescript
const service = new EmbeddingService({ mode: 'local' });
const result = await service.embed("文本内容");
```

### MemoryDecayScheduler
```typescript
const scheduler = new MemoryDecayScheduler(db, { autoStart: true });
const report = await scheduler.runDecayCycle();
```

### LLMExtractorPipeline
```typescript
const pipeline = new LLMExtractorPipeline({ apiUrl: 'http://localhost:11434/v1' });
const result = await pipeline.extract("原始文本");
```

### OCRPipeline
```typescript
const ocr = new OCRPipeline({ engine: 'local' });
const result = await ocr.extractText(base64Image);
```

### MCP 新增工具
```
unified_memory_search - 三层记忆融合检索
get_decay_report - 记忆衰减报告
```

## 环境变量
```
# 数据库
DB_PATH=./data/omni-context.db

# Embedding
EMBEDDING_MODE=local|api
EMBEDDING_LOCAL_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=sk-xxx
EMBEDDING_API_MODEL=text-embedding-3-small

# LLM 提取器
LLM_API_URL=http://localhost:11434/v1
LLM_API_KEY=
LLM_MODEL=qwen2.5:7b

# OCR
OCR_ENGINE=local|api
OCR_API_URL=
OCR_API_KEY=
```
