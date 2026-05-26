# Task 23: 让 AI 通过 MCP "像有大脑一样"工作（三件套）

## 背景

当前 Omni 通过 MCP 提供工具，但 AI 是**完全被动**的：除非用户主动问"查一下 omni 里有什么"，AI 不会主动调用。这跟"接入 Omni 后 AI 真的有记忆 + 判断"的产品承诺有距离。

三件最小成本的事可以让产品体感从"AI 在调工具"变成"AI 在自然地使用记忆":

1. **A. AI 自主调度** —— MCP `instructions` 字段做系统级引导
2. **B. Write-back 习惯** —— 加 `save_conclusion` 工具，工具名+描述强引导对话末尾沉淀
3. **C. 隐式 access tracking** —— 被工具返回过的实体自动 `access_count += 1`，纯被动反馈

## 目标

### A. MCP instructions 字段（10 行代码）

`brain-server/src/mcp-server.ts` 和 `brain-server/src/mcp-proxy.ts` 的 Server 初始化时返回 `instructions`：

```
You are connected to Omni-Context, the user's long-term memory and decision support system.

Before answering any substantive question:
1. Call `unified_memory_search` with key terms from the user's question to check whether they've discussed this topic before.
2. If the user is choosing between options or making a decision, call `get_decision_context` with their situation as the `situation` argument.
3. Cite matched memories by name in your answer so the user can verify.
4. At the end of a substantive conversation that produced a conclusion, call `save_conclusion` to persist the key takeaway.

These tools are read-cheap; over-call rather than under-call.
```

Tauri 1.x 的 MCP SDK Server 构造时 `serverInfo` 或 `capabilities` 旁边有 `instructions` 字段——按 SDK 实际 API 名为准。

### B. `save_conclusion` 工具

加进 `brain-server/src/mcp-tools.ts`：

```ts
{
  name: 'save_conclusion',
  description: `Call this when the conversation reaches a meaningful conclusion, a decision is made, or the user learns something worth remembering. ALWAYS proactively call this at the end of a substantive conversation to save key takeaways into long-term memory. Pass a short summary and (if relevant) related entity IDs from earlier search results.`,
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One-paragraph summary of the conclusion or insight' },
      related_entity_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of entities this conclusion references (from prior search results)' },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['summary']
  }
}
```

后端实现走 `ingest.ts` 现有的抽取管线，把 summary 当作 textContent 喂给 extractor，再把 `related_entity_ids` 写成 `relates_to` 关系。

### C. 隐式 access tracking

被 MCP 工具返回过的实体，brain-server handler 末尾自动更新 `access_count` + `last_accessed`：

```ts
// 在 /api/entities/search, /api/mcp/tool/unified_memory_search, /api/mcp/tool/get_decision_context 等 handler 末尾
const returnedIds = entities.map(e => e.id);
if (returnedIds.length > 0) {
  const placeholders = returnedIds.map(() => '?').join(',');
  await db.run(
    `UPDATE entities SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`,
    [new Date().toISOString(), ...returnedIds]
  );
}
```

注意：**只对"被 AI 通过 MCP 调用返回过的实体"加 access_count**，不对桌面 App UI 自己 fetch 的结果加（避免双计数）。区分方式：MCP 工具的 handler 显式调用 + UI fetch 不调用。

## 涉及文件

- `brain-server/src/mcp-server.ts` —— 加 instructions
- `brain-server/src/mcp-proxy.ts` —— 代理转发 initialize 时把 instructions 一起传给 client（看 MCP SDK 是否需要手动转，多半 SDK 已经透传）
- `brain-server/src/mcp-tools.ts` —— 加 `save_conclusion` 工具定义
- `brain-server/src/api/handlers/mcp.ts` —— 加 `save_conclusion` handler + 在 search/decision context handlers 末尾加 access tracking
- `brain-server/src/db/sqlite.ts` —— 如果需要的话，加个 `bumpAccessCount(ids)` helper

## 约束

- **不要改桌面 App UI 的搜索逻辑**——隐式 access tracking 只发生在 MCP 路径
- `save_conclusion` 内部不要自己重新实现实体抽取——复用 ingest pipeline
- 桌面 App 内的 brain-server (mcp-server.ts) 和外部 spawned 的 mcp-proxy.js 都要支持 instructions
- 不要在 mcp-tools.ts 里把所有工具的 description 都 over-engineer（只动 `save_conclusion`，其他保留）

## 验收标准

1. ✅ 在 Claude Desktop 里启动一次新对话，问个普通问题（"我之前讨论过 React 状态管理吗？"）—— Claude 应该**自动**调用 unified_memory_search 而不是直接答"我不知道"
2. ✅ 跟 AI 聊一段话讨论出结论，AI 应该在对话末尾自动调用 `save_conclusion`（注意：是否做到取决于 Claude 模型水平，最多打 70% 的把握）
3. ✅ 调用 unified_memory_search 拿到 5 个实体后，查数据库这 5 个实体的 access_count 都 +1
4. ✅ 桌面 App 自己刷新图谱（用 /api/graph/context）不会让 access_count 涨
5. ✅ `cd brain-server && npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-23-ai-brain-triple.md`

包含：
- A/B/C 三件各自实现说明
- instructions 文案是否需要分客户端调整（Claude/Cursor/Cline 可能行为不同）
- 隐式 access tracking 怎么区分 MCP 路径 vs UI 路径
- 实测：Claude Desktop 启动新对话后是否真的会主动调用 unified_memory_search

## 不要做的事

- 不要做"用户对 AI 答案的赞踩反馈 UI"——本任务的 C 是隐式 tracking，不要扩展成显式
- 不要把 save_conclusion 做成强制的（如果 AI 没调，对话也能结束）
- 不要为了"AI 看起来在自主"做花哨的提示页面
- 不要破坏现有 MCP 工具 schema 兼容性
