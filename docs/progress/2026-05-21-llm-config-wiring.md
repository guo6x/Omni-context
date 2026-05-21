# 2026-05-21 - LLM Config Wiring

## 任务目标

打通桌面端 LLM 配置到 brain-server 的链路，修复无 LLM 时的 30s 超时卡顿。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/graphrag/llm-pipeline.ts` | 新增 `setConfig()`, `setEnabled()`, `getConfig()` 方法；`timeoutMs` 默认值 30s → 10s |
| `brain-server/src/graphrag/extractor.ts` | 新增 `setLlmConfig()` (更新配置 + healthCheck 后决定启停) 和 `getLlmConfig()` |
| `brain-server/src/agent/agent-loop.ts` | `InsightGenerator` 新增 `setConfig()`/`getConfig()`；`AgentLoop` 新增 `setLlmConfig()` |
| `brain-server/src/api/handlers/settings.ts` | 新文件：`POST /api/settings/llm`（应用配置）和 `GET /api/settings/llm`（回显脱敏配置） |
| `brain-server/src/api/handlers/index.ts` | 导出 `handleSettingsRoutes` |
| `brain-server/src/api/routes.ts` | 注册 `handleSettingsRoutes`；`RequestContext` 新增 `agentLoop`；`createServer` 接受可选 `agentLoop` |
| `brain-server/src/mcp-server.ts` | `start()` 中将 `agentLoop` 提前创建传给 `createServer` |
| `desktop-daemon/src/hooks/useSettings.ts` | 新增 `syncLlmToBrainServer()` 导出函数 |
| `desktop-daemon/src/app/page.tsx` | 新增 `useEffect`：`settings.llmProvider` 变更时同步到 brain-server |

## 关键实现说明

- **配置流转**：桌面端 localStorage → `syncLlmToBrainServer()` → `POST /api/settings/llm` → `extractor.setLlmConfig()` → `agentLoop.setLlmConfig()`
- **健康检查**：`setLlmConfig()` 调用时会对 `LLMExtractorPipeline.healthCheck()`（5s 超时），失败则禁用 pipeline，后续 `extract()` 跳过 LLM 层
- **超时兜底**：`extract()` 的 `timeoutMs` 从 30s 降到 10s，即使 `enabled` 误为 true 也不会卡太久
- **apiKey 脱敏**：`GET /api/settings/llm` 只回显末 4 位，不足 4 位显示 `****`
- **兼容独立启动**：brain-server 脱离桌面端时，环境变量 `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` 仍然有效
- **不落库**：配置仅存内存（extractor.config + pipeline instance），无数据库表
- **agentLoop** 同步接通：POST 配置时同时更新 `AgentLoop` 内的 `InsightGenerator`

## 自测结果

```
# brain-server type check
cd brain-server && npx tsc --noEmit
# → 无输出，通过

# desktop-daemon type check
cd desktop-daemon && npx tsc --noEmit
# → 无输出，通过
```

## 已知遗留

无。agentLoop 的 LLM 配置已顺手接通。
