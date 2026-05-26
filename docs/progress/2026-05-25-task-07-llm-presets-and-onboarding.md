# Task 07 进度文档: LLM 服务商预设 + 首次启动引导

## 1. 任务目标
降低新用户配置大模型门槛，提供常用 OpenAI 兼容服务商的一键快速预设；实现高品质、步骤清晰的新手启动引导向导（Onboarding Wizard）；解决因云端大模型 API 连接失败造成的零实体抽取和体验卡死，同时实现全局“LLM 未配置”的红/橙色警告横幅引流。

## 2. 改动文件清单
- **[llm-presets.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/lib/llm-presets.ts)**: 新建文件。配置并导出含有 11 个大模型服务商的预设数据，包含推荐模型名、API URL、成本及速度标识。
- **[OnboardingWizard.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/OnboardingWizard.tsx)**: 新建文件。实现 4 步式的玻璃拟态引导窗口组件，提供连接成功验证和跳过功能。
- **[useSettings.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/hooks/useSettings.ts)**: 在行为设置中引入 `onboarded`（并同步对账 `localStorage.omni_onboarded`）。
- **[SettingsPanel.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/SettingsPanel.tsx)**: 渲染快速预设卡片选择网格，内置后端“测试连接”功能，并在 behavior tab 增加“重新启动新手引导”选项。
- **[page.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/app/page.tsx)**: 挂载 Wizard，并当未配置大模型时渲染警告横幅。
- **[zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts)** & **[en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts)**: 录入中英文 onboarding 相关词条。

## 3. 预设清单的最终内容
- **OpenAI**: `https://api.openai.com/v1` - `gpt-4o-mini`
- **DeepSeek**: `https://api.deepseek.com/v1` - `deepseek-chat`
- **硅基流动 (SiliconFlow)**: `https://api.siliconflow.cn/v1` - `Qwen/Qwen2.5-7B-Instruct`
- **Moonshot (Kimi)**: `https://api.moonshot.cn/v1` - `moonshot-v1-8k`
- **智谱 GLM**: `https://open.bigmodel.cn/api/paas/v4` - `glm-4-flash`
- **通义千问**: `https://dashscope.aliyuncs.com/compatible-mode/v1` - `qwen-plus`
- **火山方舟 (Doubao)**: `https://ark.cn-beijing.volces.com/api/v3` - `请填入 endpoint id`
- **DeepInfra**: `https://api.deepinfra.com/v1/openai` - `meta-llama/Meta-Llama-3.1-8B-Instruct`
- **Groq**: `https://api.groq.com/openai/v1` - `llama-3.1-8b-instant`
- **OpenRouter**: `https://openrouter.ai/api/v1` - `meta-llama/llama-3.1-8b-instruct:free`
- **Ollama**: `http://localhost:11434/v1` - `qwen2.5:7b`
- **自定义**

## 4. 关键取舍
* **“测试连接”的执行机制**：
  * *取舍*：若在前端通过浏览器 fetch 直接访问大模型服务商的 API 进行测试连接，会由于 CORS 跨域安全机制而遭到拦截。因此，我们通过 `POST /api/settings/llm` 调用 Node.js 服务端接口在后端代理执行测试。后端通过调用 `healthCheck()`（即发 GET 请求至 `/models` 并附带 API Key）校验连通性。该实现极其健壮安全。
* **API Key 的保存与本地安全性**：
  * *取舍*：大模型 API Key 统一持久化至本地现有的 `localStorage` 中。在客户端加载时动态通过 IPC 调用同步进 Tauri 后端内存，且仅发往用户自定义配置的特定 API 端点，无需也不存在任何云端中转服务器的上传流程。
* **Anthropic 预设的排除**：
  * *取舍*：由于 `brain-server` 的 LLM 管道默认使用 OpenAI 的聊天数据格式发送请求（`/chat/completions`），而 Anthropic 的原生 API 格式与其不兼容，为了防止用户配置后遭遇报错，我们排除了 Anthropic 的官方 API 预设，转而提供 11 个完全兼容 OpenAI 规格的头部服务商。

## 5. 自测结果
1. ✅ **首次弹出 Wizard**：清空 localStorage 启动应用，Onboarding 窗口能够完美展现在屏幕中央。
2. ✅ **一键预设**：点击 “DeepSeek” 或 “硅基流动” 卡片，其 apiUrl 和模型名称自动补全。
3. ✅ **测试成功进入下一步**：输入正确的配置并点击测试连接，测试成功后，向导的“下一步”按钮允许点击。
4. ✅ **测试失败置灰**：若测试连通性未通过，显示具体的报错，且“下一步”按钮被禁止点击。
5. ✅ **警告横幅引流**：跳过向导且 LLM 未配置时，主页面顶部出现橙色警告横幅，点击直接快速拉起设置。
6. ✅ **持久化标志**：完成向导后，localStorage 正确标记 `omni_onboarded = true`，再次打开不再展现向导。
7. ✅ **设置面板更新**：设置页完美集成预设网格，在 behavior tab 里点击“启动新手引导”可重新展现。
8. ✅ **NextJS 构建成功**：执行 `npm run build`，生产环境顺利构建并生成静态资源。

## 6. 遗留问题
无。
