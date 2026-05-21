# 2026-05-21 - LLM Config Fixes

## 任务目标

修复任务 01 引入的两个阻断性 bug：healthCheck 守卫导致 LLM 永久禁用，以及启动时配置同步竞态。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/graphrag/llm-pipeline.ts:201` | `healthCheck()` 守卫条件从 `!this.enabled` 改为 `!this.config.apiUrl`，避免一次失败后永久禁用 |
| `desktop-daemon/src/app/page.tsx:145-148` | LLM 同步 useEffect 增加 `status.brain_server_running` 依赖，脑脑就绪时触发同步 |

## 关键说明

- **Bug 1**：原来 `healthCheck()` 第一行检查 `this.enabled`，但 `setLlmConfig()` 的流程是先调用 `healthCheck()` 再 `setEnabled(结果)`。一旦失败一次，后续永远无法恢复。
- **Bug 2**：原来 useEffect 只依赖 `settings.llmProvider`，启动时 brain-server 未就绪所以 fetch 静默失败。`llmProvider` 不变就不会再触发。改为同时依赖 `status.brain_server_running`，brain-server 上线瞬间触发同步。

## 自测结果

```
brain-server: npx tsc --noEmit → 通过
desktop-daemon: npx tsc --noEmit → 通过
```

## 已知遗留

无。
