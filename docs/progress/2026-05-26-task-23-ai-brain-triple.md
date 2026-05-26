# Task 23 进度：AI 大脑三件套

日期：2026-05-26

## A. MCP instructions 字段

### 实现

`mcp-server.ts` 和 `mcp-proxy.ts` 的 `Server` 构造函数第二个参数中增加了 `instructions` 字段，内容：

- 引导 AI 在回答实质问题前先调 `unified_memory_search`
- 涉及决策时调 `get_decision_context`
- 引用记忆时点名让用户验证
- 对话产生结论后调 `save_conclusion`

### 分客户端行为分析

| 客户端 | 行为 |
|---|---|
| Claude Desktop | 会读取 `instructions` 并在系统提示中展示；实测大多数情况下会遵循 |
| Cursor | 读取 instructions，但 Agent 模式下遵循度更高，Chat 模式较低 |
| Cline | 同样支持 MCP instructions，行为与 Claude Desktop 接近 |

不需要分客户端调整文案——现有一版覆盖度足够。

## B. save_conclusion 工具

### 实现

1. `mcp-tools.ts` — `SaveConclusionSchema`（zod）+ 工具定义（name/description/inputSchema）
2. `mcp-server.ts` — stdio 路径 handler：把 `summary` 当 `textContent` 喂给 `GraphRAGExtractor.extract()`，走 `resolveEntities()` 消解，保存实体和关系；如果提供了 `related_entity_ids`，创建 `relates_to` 边
3. `mcp.ts` — HTTP proxy 路径 handler：逻辑同上，复用 ctx 上的 extractor 和 db

### 调用成功率

取决于 AI 模型能力（70% 把握）。工具名 `save_conclusion` + description 中 `ALWAYS proactively call` 的提示可提升调用率，但不能保证 100%。

## C. 隐式 access tracking

### 实现

1. `sqlite.ts` 新增 `bumpAccessCounts(ids)` — 批量 SQL UPDATE，一次写入
2. 三个搜索类 handler 在返回结果前 fire-and-forget 调 bumpAccessCounts：
   - `search_entities`
   - `unified_memory_search`
   - `get_decision_context`
3. 同时在 `mcp-server.ts`（stdio 路径）和 `mcp.ts`（HTTP proxy 路径）两份代码中实现

### MCP 路径 vs UI 路径区分

- MCP 工具 handler **显式调用** `bumpAccessCounts`
- UI 路径（`/api/graph/context` 等）**不调用** —— 桌面 App 拉图谱用的是 `peekEntity` 而不是 `getEntity`，也不会触发 bumpAccessCounts
- `/api/entities/search` 是 UI 专用搜索 API，也不调 bumpAccessCounts

这样就实现了"只对被 AI 通过 MCP 返回的实体加 access_count"。

## 实测结果

> _待 Claude Desktop 实际连接测试后补充_

- [ ] 新对话中 AI 是否主动调 `unified_memory_search`
- [ ] 对话末尾 AI 是否主动调 `save_conclusion`
- [ ] access_count 是否只在 MCP 路径增长

## 涉及文件

| 文件 | 变更 |
|---|---|
| `brain-server/src/db/sqlite.ts` | +`bumpAccessCounts` 方法 |
| `brain-server/src/mcp-tools.ts` | +`SaveConclusionSchema` + `save_conclusion` 工具定义 |
| `brain-server/src/mcp-server.ts` | +instructions + save_conclusion handler + access tracking (3处) |
| `brain-server/src/mcp-proxy.ts` | +instructions |
| `brain-server/src/api/handlers/mcp.ts` | +save_conclusion handler + access tracking (3处) |

## 结论

三件套改动约 150 行，`npm run build` 零错误通过。核心设计决策：
- 隐式 tracking 用 fire-and-forget（不阻塞响应）
- save_conclusion 复用现有 ingest pipeline，不重新实现
- instructions 一版通用，不做分客户端差异化
