# 任务 01：打通 LLM 配置链路

> 这是一份独立任务说明。你（执行此任务的 AI）拿到它即可开始，无需额外上下文。
> 项目根目录：`omni-context-release/`。

## 背景

Omni-Context 的知识图谱抽取分两层：正则抽取 + LLM 语义抽取。LLM 这层的**配置链路是断的**：

- 桌面端「设置 → LLM 配置」里填的 apiUrl / apiKey / model 只写进了浏览器 localStorage，**从未传给 brain-server**。
- brain-server 里 `new GraphRAGExtractor()`（见 `brain-server/src/api/routes.ts` 和 `brain-server/src/mcp-server.ts`）都是**无参调用**，extractor 只能从环境变量 `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` 读配置。
- 桌面端 `desktop-daemon/src-tauri/src/brain_server.rs` 启动 brain-server 时只传了 `HOST` / `PORT`，没传 LLM 环境变量。

结果：打包后的桌面 App 里，设置面板的 LLM 配置完全是装饰，LLM 抽取只会用硬编码默认值。

另有一个体验 bug：`LLMExtractorPipeline` 的 `enabled` 只要 apiUrl 非空就为 true（而 apiUrl 永远有默认值），所以没有可用 LLM 时，每次抽取都会发一次 fetch 并**等满 30 秒超时**才降级。

## 关于 LLM 服务（重要）

- **主力场景是云端 OpenAI 兼容 API**（DeepSeek、GPT-4o、通义千问等），通过 `apiUrl` + `apiKey` 调用。本地 Ollama 只是次要选项。
- 实现和自测都**以云端 API 为准**，不要假设本地 Ollama、不要硬编码 localhost 行为。
- `LLMExtractorPipeline` 现有代码已支持云端（`Authorization: Bearer` 头 + `/chat/completions` 端点 + `response_format: json_object`），**不要破坏这一点**。

## 目标

让桌面端设置里的 LLM 配置真正生效，并消除无 LLM 时的卡顿。

## 设计方向

配置以桌面端 localStorage 为唯一真相源，由桌面端同步给 brain-server；brain-server 端只存内存、不落库。

1. **brain-server 新增接口**：
   - `POST /api/settings/llm`，body `{ apiUrl, apiKey, model }`，把配置应用到 extractor。
   - `GET /api/settings/llm`，返回当前生效配置；**apiKey 必须脱敏**（只回显是否已设置，或只回显末 4 位）。
   - 配置只存内存，不落库、不加 settings 表。
2. **`GraphRAGExtractor` 增加 `setLlmConfig({ apiUrl, apiKey, model })`**：重建内部的 `LLMExtractorPipeline`。
3. **桌面端同步配置**：在 brain-server 就绪后（app 启动时），以及用户在设置面板改动 LLM 配置后，把 localStorage 里的 LLM 配置 `POST` 给 `/api/settings/llm`。合适的接入点在 `desktop-daemon/src/hooks/useSettings.ts` / `src/app/page.tsx` / `src/components/SettingsPanel.tsx` 之间自行判断。
4. **修无 LLM 卡顿**：`setLlmConfig` 时做一次 `healthCheck()`（`LLMExtractorPipeline` 已有该方法，5s 超时）。健康检查失败则把 pipeline 标记为 disabled，`extract()` 直接跳过 LLM 层。同时把 `extract()` 的 30s 超时降到 10s 作为兜底。

## 涉及文件（参考，不限于）

- `brain-server/src/graphrag/extractor.ts` — 加 `setLlmConfig`
- `brain-server/src/graphrag/llm-pipeline.ts` — `enabled` 逻辑 / 超时
- `brain-server/src/api/handlers/` — 新增 settings handler
- `brain-server/src/api/routes.ts` — 注册新路由，并让 handler 能访问到 extractor 实例
- `desktop-daemon/src/` — 启动时 + 设置变更时 POST 配置

## 约束

- 不引入新依赖；不落库、不加 settings 表。
- brain-server 脱离桌面端独立运行时，**环境变量 fallback 必须仍然有效**。
- `GET /api/settings/llm` 返回的 apiKey 必须脱敏。
- 遵循现有代码风格，不做需求之外的重构、不加多余的抽象层和注释。
- 对 internal code 做简化假设，只在系统边界（HTTP 入参）做校验。

## 验收标准

- 桌面端设置里改了 LLM 配置（云端 API）→ brain-server 实际用新配置抽取。
- 没有可用 LLM 时，上传文件 / 抽取不会卡 30 秒。
- `npx tsc --noEmit` 在 `brain-server` 和 `desktop-daemon` 两个目录都通过。
- brain-server 独立启动（通过环境变量 `LLM_API_URL` 指向云端 API）仍能正常用 LLM 抽取。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-llm-config-wiring.md`，内容包含：

1. 任务目标
2. 改动的文件清单（每个文件一句话说明改了什么）
3. 关键实现说明 / 取舍
4. 自测结果（跑了哪些命令、结果如何）
5. 已知遗留 / 未做的部分 —— 注意 `brain-server/src/agent/agent-loop.ts` 也有同样的 LLM 配置断链问题，若顺手可一并接通，否则明确记入遗留。

（这份进度文档不需要发给任何人，留在仓库里即可。）
