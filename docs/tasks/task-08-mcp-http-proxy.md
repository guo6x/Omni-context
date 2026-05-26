# Task 08: MCP HTTP 代理薄壳

## 背景

排查发现当前 MCP 接入方式有三个深层问题：

1. **DB 隔离** —— MCP 客户端 spawn `mcp-server.js` 时 CWD 不是桌面 App 安装目录，`DB_PATH` fallback 到客户端工作目录下的 `./data/omni-context.db`，跟桌面 App 用的 `%LOCALAPPDATA%\omni-context\data\omni-context.db` 不是同一个库。AI 通过 MCP 看到空数据。
2. **LLM 配置不共享** —— 桌面 App 设置面板里的 API key 存在 desktop-daemon localStorage，MCP spawn 的 node 进程读不到，会用默认 Ollama → 大概率 fail。
3. **双进程并发写同一个 DB** —— 如果硬把 DB_PATH 指向同一个文件，桌面 App 和 MCP spawn 的两个 brain-server 同时跑 AgentLoop / 写向量索引，并发风险。

解决方案：**不让 MCP 客户端各自 spawn 完整 brain-server**，改成 spawn 一个**轻量代理**（mcp-proxy.js），代理把 MCP stdio 协议的工具调用翻译成 HTTP 请求，统一打到桌面 App 已经在跑的 brain-server（localhost:3001）。

对 AI 客户端无感（还是标准 MCP stdio 接入），但服务端单点：

```
Claude Desktop ──MCP stdio──► spawn(node mcp-proxy.js) ─HTTP─┐
Cursor         ──MCP stdio──► spawn(node mcp-proxy.js) ─HTTP─┤
Cline          ──MCP stdio──► spawn(node mcp-proxy.js) ─HTTP─┤
                                                              ▼
桌面 App ──► brain-server (localhost:3001) ──► 一份 SQLite + 一份 LLM 配置
```

## 目标

新增 `brain-server/src/mcp-proxy.ts`，编译产物 `brain-server/dist/mcp-proxy.js`，**完整支持 MCP stdio 协议**，把所有工具调用 / 资源读取 / 工具列表请求**全部代理到 HTTP**。

成功标准：

1. Claude Desktop 配置里 args 指向 `mcp-proxy.js` 时，工具调用能正常返回数据
2. 桌面 App 里抓的实体 / 上传的文档，通过 MCP 代理能查到（**同一份 DB**）
3. 桌面 App 没开 / brain-server 没在 3001 时，代理给 MCP 客户端返回有意义的错误（"Omni-Context 桌面应用未启动，请先打开主窗口"），不要 crash 或挂起
4. 工具列表跟原 `mcp-server.js` 完全一致（不要"少几个工具"）

## 涉及文件

### 新建

- `brain-server/src/mcp-tools.ts`
  - 把目前 `brain-server/src/mcp-server.ts` 里所有 MCP 工具定义（Zod schemas + name + description + 处理逻辑入口）抽出来到一个共享模块
  - 每个工具加一个 `httpEndpoint: { method, path, bodyMapper?: (args) => any }` 字段，说明这个工具对应 brain-server HTTP API 的哪个端点 / 用什么参数
  - 例如 `record_capture` → `{ method: 'POST', path: '/api/graph/extract', bodyMapper: (args) => ({ screenshot, clipboard, ... }) }`
  - 例如 `search_entities` → `{ method: 'GET', path: '/api/entities/search', bodyMapper: (args) => ({ query: args.query }) }`（GET 的话 bodyMapper 返回的是 query string）

- `brain-server/src/mcp-proxy.ts`
  - `#!/usr/bin/env node` shebang
  - 用 `@modelcontextprotocol/sdk` 的 `Server` + `StdioServerTransport`
  - 注册 `ListToolsRequestSchema` → 直接从 `mcp-tools.ts` 拿工具元数据返回
  - 注册 `CallToolRequestSchema` → 根据工具名查 `mcp-tools.ts` → 拿 httpEndpoint → 发 fetch 到 `http://localhost:3001<path>`
  - 注册 `ListResourcesRequestSchema` / `ReadResourceRequestSchema` → 同样代理（如果原 mcp-server.js 暴露了 resources）
  - 错误处理：
    - HTTP 连接失败（ECONNREFUSED）→ 返回 MCP 错误 "Omni-Context 桌面应用未启动 (brain-server unreachable at localhost:3001)"
    - HTTP 4xx/5xx → 把响应体内容包装成 MCP `McpError` 返回
  - **不要在代理里搞业务逻辑**——所有逻辑留在 brain-server 主体。代理只做协议翻译。

### 修改

- `brain-server/src/mcp-server.ts`
  - 改为从新的 `mcp-tools.ts` 导入工具定义，避免代码重复
  - 保留 stdio + HTTP 双模启动逻辑（独立场景仍可用，例如 CLI 调试）
  - 这个文件**不删**，作为 fallback 和命令行调试用

- `brain-server/package.json` 的 `main` 字段或 `bin` 字段（如果有）
  - 不需要改 `main`（仍指 mcp-server.js）

- `scripts/build-desktop-only.js`
  - 不需要改——`brain-server/dist/` 整个会被复制，mcp-proxy.js 会一并打包

### brain-server HTTP API 端点核对

执行前**先把 mcp-server.ts 里所有工具列出来**，对照 brain-server/src/api/handlers/index.ts 看每个工具是不是有对应的 HTTP 端点。如果有工具调用的逻辑**只在 mcp-server.ts 里实现**（HTTP API 没有同等接口），**先把这个逻辑搬到 HTTP handlers 里**，再让代理调用——这样代理才能完整代理。

常见工具映射猜测（实际以代码为准）：

| MCP Tool | HTTP Endpoint | Method |
|----------|--------------|--------|
| `record_capture` | `/api/graph/extract` | POST |
| `add_entity` | `/api/entities` | POST |
| `update_entity` | `/api/entities/:id` | PATCH/PUT |
| `delete_entity` | `/api/entities/:id` | DELETE |
| `search_entities` | `/api/entities/search` | GET |
| `get_entity` | `/api/entities/:id` | GET |
| `merge_entities` | `/api/entities/:id/merge` | POST |
| `add_archival_memory` | `/api/memory/archival` | POST |
| `search_archival` | `/api/memory/archival/search` | POST |
| `get_core_memory` | `/api/memory/core` | GET |
| `set_core_memory` | `/api/memory/core` | POST/PUT |
| `compress_archival` | `/api/memory/archival/compress` | POST |
| `get_graph_context` | `/api/graph/context` | GET/POST |
| `extract_from_text` | `/api/graph/extract` | POST |

实际可能更多 / 更少，**执行 AI 必须完整核对一遍**，缺的端点要补到 HTTP handlers。

## 约束

- **MCP 协议规范严格遵守**。代理对外暴露的工具 schema（Zod / JSON Schema）必须跟原 mcp-server.ts 完全一致，否则客户端解析会出错。
- **fetch 实现**：Node 18+ 自带 `fetch`，但保险起见用 `globalThis.fetch ?? (await import('node-fetch')).default` 兜底。`brain-server/package.json` 不需要新增 `node-fetch` 依赖（Node 18+ 已经够了，本项目最低要求确认是 Node 18+）。
- **超时**：每个 HTTP 请求带 30 秒超时（AbortController），避免代理被挂死。
- **错误信息要中英文都友好**——MCP 客户端会把错误内容直接展示给用户。
- **不能在代理里读 LLM 配置 / API key**。所有 LLM 调用都发生在桌面 App 的 brain-server 里。
- **不能在代理里开 SQLite**。代理无状态，纯 stdio↔HTTP 翻译。
- **不要为了"性能"在代理里加缓存**——MVP 不做。
- brain-server 主体的 HTTP API 已经允许 CORS（之前修过），代理对外只通过 stdio，对内通过 HTTP——CORS 不是问题，但调试时如果直接 curl 测代理的 stdio 模式比较麻烦，可以加一个 `node mcp-proxy.js --help` 输出帮助信息。

## 验收标准

1. ✅ `cd brain-server && npm run build` 产出 `dist/mcp-proxy.js`，文件可执行
2. ✅ 桌面 App 正常打开（brain-server 在 3001）的前提下：
   - 手动 spawn 一次代理：`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp-proxy.js` —— 返回完整工具列表 JSON
   - 调用一个工具：`echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_entities","arguments":{"query":"GraphRAG"}}}' | node dist/mcp-proxy.js` —— 返回真实搜索结果
3. ✅ 桌面 App 关掉（端口 3001 没人监听）：
   - 同样的 tools/call 请求 → 代理返回 MCP error "Omni-Context 桌面应用未启动"
   - 代理进程**不 crash**，能继续接收下一个请求
4. ✅ 工具列表完整性：跟原 mcp-server.js 暴露的工具数量、名称、schema 一一对应（拿 `mcp-server.js` stdio 直接打一遍 `tools/list`，diff 两边输出）
5. ✅ 真实 Claude Desktop 集成测试：
   - 桌面 App 里上传一篇 markdown（配好 LLM，能抽到几个实体）
   - 用 Task 02 改完后的"一键接入 Claude Desktop"按钮接入
   - 重启 Claude Desktop
   - 在 Claude Desktop 里问"用 omni-context 找一下我之前关于 GraphRAG 的笔记" → Claude 调用 search_entities → 返回桌面 App 里抓的实体
6. ✅ `cd brain-server && npx tsc --noEmit` 无错误
7. ✅ 原 mcp-server.ts 重构（用共享 mcp-tools.ts）后仍能独立跑

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\brain-server
npm run build

# 调试代理
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp-proxy.js
```

整体集成测试需要重打桌面 App：

```powershell
cd D:\AI_code\Omni-context\omni-context-release
node scripts/build-desktop-only.js
```

然后装新版桌面 App，再做 Claude Desktop 验证。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-08-mcp-http-proxy.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **完整的工具 → HTTP 端点映射表**（这是这个任务最重要的产出，后续维护要看）
4. **HTTP API 缺哪些端点 / 补了哪些**
5. **关键取舍**（特别是：错误处理策略、超时、是否真的把 mcp-server.ts 重构走共享模块）
6. **自测结果**（上面 7 条）
7. **遗留问题**（比如：MCP resources 是否完整代理、流式响应 / 取消请求是否支持）

## 不要做的事

- **不要删掉 `mcp-server.ts`**，保留作为命令行调试 / 独立部署的入口
- **不要让代理也跑 AgentLoop / decay scheduler**——那是 brain-server 的事
- **不要把代理塞到 desktop-daemon 里**——它是 brain-server 的 sibling 模块，应该跟 `mcp-server.ts` 放一起
- **不要加鉴权**（localhost stdio + localhost HTTP，本机使用够安全）
- **不要为了"工具调用更快"在代理里缓存结果**——状态都在 brain-server，缓存会引入 stale data
- **不要为了 LLM 调用方便在代理里读用户 API key**——这是这次重构的核心目的之一，必须避免
