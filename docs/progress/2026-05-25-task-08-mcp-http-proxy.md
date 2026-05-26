# MCP HTTP 代理薄壳任务进度报告 (2026-05-25)

## 1. 任务目标
- 实现无状态的 MCP 代理进程 `mcp-proxy.js`，避免多进程并发读写同一个 SQLite DB 以及由于开发与编译目录隔离引发的 AI 读到空库问题。
- 将所有业务逻辑和大模型、向量计算后置于桌面客户端已经在 3001 端口起起来的 `brain-server` HTTP API。
- 保证 15 个工具和资源读取列表的完整性，并在 3001 连接断开时实现防 crash 的温和报错。

---

## 2. 改动文件清单
- **[NEW]** [mcp-tools.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/mcp-tools.ts): 统一和导出 15 个 MCP 工具的描述、参数 inputSchema 以及 zodSchema。
- **[NEW]** [mcp.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/api/handlers/mcp.ts): 在后端实现了 15 个 MCP 工具执行核心逻辑与对应的资源读取 Handler，并在 index.ts 中导出。
- **[NEW]** [mcp-proxy.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/mcp-proxy.ts): 轻量无状态的 stdio MCP 代理中转程序，支持 30s 超时和离线友好错误反馈。
- **[MODIFY]** [index.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/api/handlers/index.ts): 导出 `handleMcpRoutes` 路由组。
- **[MODIFY]** [routes.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/api/routes.ts): 挂载 `handleMcpRoutes`，同时将 `MemoryDecayScheduler` 作为通用实例挂载于 `RequestContext`。
- **[MODIFY]** [mcp-server.ts](file:///d:/AI_code/Omni-context/omni-context-release/brain-server/src/mcp-server.ts): 重构以复用 `mcp-tools.ts` 中定义的元数据和 Zod Schema，消除冗余，同时保留原先的独立运行/单机 stdio 模式。

---

## 3. 工具 → HTTP 端点映射表

| MCP Tool | HTTP Endpoint | Method | Payload / Response |
| :--- | :--- | :--- | :--- |
| `record_capture` | `/api/mcp/tool/record_capture` | POST | `{ arguments: RecordCaptureSchema }` |
| `get_core_context` | `/api/mcp/tool/get_core_context` | POST | `{ arguments: {} }` |
| `search_entities` | `/api/mcp/tool/search_entities` | POST | `{ arguments: SearchEntitiesSchema }` |
| `add_entity` | `/api/mcp/tool/add_entity` | POST | `{ arguments: AddEntitySchema }` |
| `get_entity` | `/api/mcp/tool/get_entity` | POST | `{ arguments: GetEntitySchema }` |
| `add_relationship` | `/api/mcp/tool/add_relationship` | POST | `{ arguments: AddRelationshipSchema }` |
| `get_graph_neighborhood` | `/api/mcp/tool/get_graph_neighborhood` | POST | `{ arguments: GetGraphNeighborhoodSchema }` |
| `extract_from_capture` | `/api/mcp/tool/extract_from_capture` | POST | `{ arguments: ExtractFromCaptureSchema }` |
| `list_entities` | `/api/mcp/tool/list_entities` | POST | `{ arguments: ListEntitiesSchema }` |
| `update_entity` | `/api/mcp/tool/update_entity` | POST | `{ arguments: UpdateEntitySchema }` |
| `get_stats` | `/api/mcp/tool/get_stats` | POST | `{ arguments: {} }` |
| `vector_search` | `/api/mcp/tool/vector_search` | POST | `{ arguments: VectorSearchSchema }` |
| `unified_memory_search` | `/api/mcp/tool/unified_memory_search` | POST | `{ arguments: UnifiedMemorySearchSchema }` |
| `get_decision_context` | `/api/mcp/tool/get_decision_context` | POST | `{ arguments: GetDecisionContextSchema }` |
| `get_decay_report` | `/api/mcp/tool/get_decay_report` | POST | `{ arguments: {} }` |

### MCP 资源端点

| Resource Action | HTTP Endpoint | Method | Description |
| :--- | :--- | :--- | :--- |
| List Resources | `/api/mcp/resources` | GET | 获取所有知识图谱、核心原则、统计及各类型实体资源的 URI 列表 |
| Read Resource | `/api/mcp/resources/read` | POST | 传入 `{ uri }` 请求资源具体 JSON 文本数据 |

---

## 4. HTTP API 缺哪些端点 / 补了哪些
- **原本缺失**：原本 `brain-server` 的 HTTP API 没有任何对应 MCP 工具调用的端点。例如原本并没有统一的 `/api/mcp/tool/:name`、`/api/mcp/resources` 或 `/api/mcp/resources/read`。一些工具涉及复杂的 embedding 计算（如 `add_entity`），或者图谱结合冲突检测的原则消解算法（如 `extract_from_capture`），这些只保存在了原本 `mcp-server.ts` 的内部 switch-case 逻辑中，HTTP 侧并无等效端点。
- **已补齐**：在 `brain-server/src/api/handlers/mcp.ts` 中，我们为上述所有的 15 个工具和资源读取操作创建了专有的 HTTP API 端点。这些端点完美对齐了原本 stdio 服务器中的所有业务实现，包括自动 embedding 序列、并发模型调用控制、及 FTS5 记忆多级检索。

---

## 5. 关键取舍
1. **错误处理策略**：
   - 代理 `mcp-proxy.ts` 在转发时拦截所有网络异常和 ECONNREFUSED 错误，并对外抛出语义化的 `McpError`，而**绝不直接 crash**。这保证了即使后端服务暂时挂掉，AI 客户端的 stdio 通道依旧保持连接，避免了客户端报错崩溃。
2. **超时机制**：
   - 为所有的 fetch 请求包装了 30 秒的 `AbortController`。若由于网络波动或本地 LLM 载入耗时过长导致阻塞，30s 后会主动超时断开，返回友好的报错，避免代理挂死。
3. **mcp-server.ts 走共享模块**：
   - 彻底移除了 `mcp-server.ts` 原来臃肿的 `listTools` 静态配置，将其重构为直接 map 共享的 `mcp-tools.ts` 数组。这种方案最大化地重用了架构配置，降低了维护成本。

---

## 6. 自测结果
1. **编译运行验证**：
   - `npm run build` 和 `npx tsc --noEmit` 均 100% 通过。
2. **工具列表接口 (tools/list)**：
   - 运行：`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/mcp-proxy.js`
   - 正常解析并输出 aligned 良好的 15 个工具 Schema。
3. **离线保护**：
   - 关闭 3001，向代理发起 tools/call 会捕获到：`Omni-Context 桌面应用未启动，请先打开主窗口 (brain-server unreachable at localhost:3001)`，且进程保持存活。
4. **在线转发**：
   - 成功调用 `get_stats`、`add_entity`（自动完成 embedding 计算并存入 SQLite）、`search_entities` 和 `vector_search` 语义近似检索，功能表现与重构前无二致。
5. **资源读取**：
   - 正确返回了动态和静态资源列表，并能完整读取具体 URI 内容。

---

## 7. 遗留问题
- **MCP resources 的完整代理**：
  - 针对 resources 的 list 和 read 操作，已做到了 100% 代理转发。
- **流式响应 / 取消请求**：
  - 目前标准 MCP 工具调用协议是完整的 Req-Res 模式，本版本暂不支持中途 Cancel 的主动推送或流式输出，后续如果有复杂流式需要，将在此设计上做长轮询或特定端点支持。
