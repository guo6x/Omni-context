# 任务 02：修复 LLM 配置链路的两个阻断性 bug

> 这是对任务 01（`task-01-llm-config-wiring.md`）的修正。任务 01 已完成主体改动，
> 但验收发现两个 bug，会让 LLM 配置在最常见的场景下不生效。本任务只修这两个 bug，不要扩大改动范围。
> 项目根目录：`omni-context-release/`。

## Bug 1：健康检查守卫导致 LLM 被永久禁用

**文件**：`brain-server/src/graphrag/llm-pipeline.ts`

**现状**：`healthCheck()` 第一行是 `if (!this.enabled) return false;`。
而 `GraphRAGExtractor.setLlmConfig()` 的流程是：`setConfig()` → `healthCheck()` → `setEnabled(结果)`。

**问题**：一旦某次配置健康检查失败，`enabled` 被置为 false。之后用户**改对了配置重新 POST**，
`healthCheck()` 会因为 `enabled` 仍是 false 而直接返回 false、根本不发网络请求 → LLM 永久禁用，
只能重启 brain-server 才能恢复。

**修复**：把那个守卫的判断条件从「是否 enabled」改成「是否有 apiUrl」。
守卫的本意是「没配 apiUrl 就别做网络请求」，用 `if (!this.config.apiUrl) return false;` 即可，
既保留原意，又不会阻止「改对配置后重新启用」。

## Bug 2：启动时配置同步竞态，正常启动后配置根本没同步

**文件**：`desktop-daemon/src/app/page.tsx`

**现状**：同步 LLM 配置的 useEffect 只依赖 `settings.llmProvider`：
```ts
useEffect(() => {
  syncLlmToBrainServer(settings.llmProvider);
}, [settings.llmProvider]);
```

**问题**：app 启动时 brain-server 还没起来，`syncLlmToBrainServer` 的 fetch 静默失败且不重试。
`settings.llmProvider` 之后不再变化，于是**正常启动后配置一直没同步到 brain-server**，
要等用户手动改一次设置才会触发同步。这让任务 01 对「打开就用」的场景完全无效。

**修复**：让同步同时依赖 brain-server 就绪状态。`MainApp` 里已经有 `useOmniContext()` 返回的
`status`，其中 `status.brain_server_running` 表示 brain-server 是否在线。把 useEffect 改成：
```ts
useEffect(() => {
  if (status.brain_server_running) {
    syncLlmToBrainServer(settings.llmProvider);
  }
}, [settings.llmProvider, status.brain_server_running]);
```
这样 brain-server 起来的那一刻会触发一次同步，用户改配置也会触发同步。

## 约束

- 只修这两个 bug，不做其它改动、不重构。
- 遵循现有代码风格。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 和 `desktop-daemon` 两个目录都通过。
- 逻辑自查：先 POST 一个错误的 LLM 配置（healthCheck 失败），再 POST 一个正确的配置，
  第二次必须能重新启用 LLM（healthCheck 真的发出网络请求）。
- 逻辑自查：app 启动后、用户不碰设置，brain-server 一就绪就会收到一次 LLM 配置同步。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-llm-config-fixes.md`，内容包含：
任务目标、改动文件清单（每文件一句话）、关键说明、自测结果（命令+结果）、已知遗留。
