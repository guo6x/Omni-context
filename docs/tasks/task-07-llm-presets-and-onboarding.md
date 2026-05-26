# Task 07: LLM 服务商预设 + 首次启动引导

## 背景

当前 LLM 配置（`desktop-daemon/src/components/SettingsPanel.tsx` 504-540 行附近）只是三个裸文本框：

- apiUrl
- apiKey
- model

默认指向本地 Ollama（`http://localhost:11434/v1` + `qwen2.5:7b`）。**没装 Ollama 的用户**：

- 不知道要填什么 URL
- 不知道 model 名怎么写
- 上传文档 → 抽取返回 0 实体 → 看起来"产品坏了"
- 90% 的用户会卡在这里直接放弃

同时，首次打开应用没有 step-by-step 引导，"加载示例图谱"按钮埋在 EmptyState 里容易错过，"先配 LLM"这个关键步骤没有强引导。

## 目标

两块：

### A. LLM 服务商预设

在设置面板 LLM 配置区块上方加一个「快速预设」下拉 / 卡片选择器，覆盖常用服务商。选了之后自动填好 apiUrl + 默认 model，用户只需填 apiKey。

预设清单：

| 服务商 | apiUrl | 默认 model |
|--------|--------|------------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic（OpenAI 兼容代理） | `https://api.anthropic.com/v1` | `claude-haiku-4-5-20251001` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 通义千问 (DashScope OpenAI 兼容) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | 用户填 endpoint id |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| DeepInfra | `https://api.deepinfra.com/v1/openai` | `meta-llama/Meta-Llama-3.1-8B-Instruct` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.1-8b-instruct:free` |
| Ollama (本地) | `http://localhost:11434/v1` | `qwen2.5:7b` |
| 自定义 | —— | —— |

每个预设展示：logo（用 emoji 或简单文字标识，不下载图片避免侵权）+ 名字 + 一行价格 / 速度提示。

注意：**Anthropic 官方 API 不是 OpenAI 兼容**。如果 brain-server 现有的 LLMExtractorPipeline 只发 OpenAI 格式请求，Anthropic 那条预设要么删除，要么标注「需要 Anthropic 官方 SDK / Claude 客户端代理转换」。**先看 `brain-server/src/graphrag/llm-extractor.ts` 或对应文件**确认 LLM 调用是不是 OpenAI 兼容协议，再决定是否保留 Anthropic 预设。

### B. 首次启动引导 Wizard

第一次启动应用时（用 localStorage 标志 `omni_onboarded` 判断），弹一个 4 步引导：

1. **欢迎页**：产品定位一句话 + Logo
2. **配 LLM**：选服务商预设 → 填 API Key → 点"测试连接"（调 brain-server `/api/admin/test-llm` 或者 hook 一个轻量调用） → 通过才能下一步
3. **第一次使用**（二选一）：
   - "上传一个文件试试" → 直接打开上传弹窗
   - "加载示例图谱" → 调 `handleLoadDemo`
4. **完成**：告诉用户 "Ctrl+K 搜索 / 设置里能配置更多 / 拖文件到窗口就能上传"

引导完成后写入 `localStorage.omni_onboarded = true`。设置面板里给一个"重新启动新手引导"按钮，方便回看。

## 涉及文件

- `desktop-daemon/src/lib/llm-presets.ts`（新建）
  - 导出上面的预设清单 + 类型
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - LLM 配置区块顶部加预设选择 UI（卡片网格 4 列）
  - 选了预设后自动 update apiUrl + model（apiKey 不动）
  - 加"测试连接"按钮 + 结果显示
- `desktop-daemon/src/components/OnboardingWizard.tsx`（新建）
  - 4 步浮层组件
  - 每步独立，能 prev / next
  - 测试连接失败时 next 按钮置灰
- `desktop-daemon/src/app/page.tsx`
  - 挂 OnboardingWizard，初始化时检查 localStorage `omni_onboarded`
- `desktop-daemon/src/hooks/useSettings.ts`
  - 加 `onboarded: boolean` 状态 + setter + localStorage 持久化
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 onboarding 文案 + 预设 i18n

## 约束

- **不要把 API key 明文存到普通配置文件**。用现有的 settings 存储路径（localStorage 在 Tauri 1.x 也是磁盘文件）。**进度文档里说明 key 存储位置，提醒用户这是本地存储，不会上传**。
- "测试连接"按钮调用 brain-server `/api/admin/test-llm` 接口（如果存在）或新建一个轻量调用——**先确认这个接口存不存在**，不存在的话：
  - 选项 1：UI 端用 fetch 直连 LLM 服务商的 `/models` 接口（很多 OpenAI 兼容服务商支持），仅作 reachability 测试
  - 选项 2：调 brain-server 的某个轻量提取接口（比如 `/api/graph/extract` 配 1 字符 input），看返回是否 200
- 预设清单的 model 名字截止 2026-05 都是当时各厂商主推的便宜款，**做的时候快速到各家文档核对一下**，免得 model 名过期。
- Anthropic 那条预设根据 brain-server 实际是否支持决定保留或删除。
- 引导 Wizard 要能跳过（"我已经懂了，先关掉"），不能强制走完。但 LLM 没配的话，**全局加一条横幅警告**（"LLM 未配置，上传无法抽取实体"）。
- Wizard 第 3 步的"上传文件"分支：用户上传完就直接进第 4 步，不要等抽取完成。
- 设置面板里"重新启动新手引导"按钮就是 reset `omni_onboarded` + 主动打开 Wizard。

## 验收标准

1. ✅ 清空 localStorage 后启动应用 → 自动弹 Wizard
2. ✅ Wizard 步骤 2：选 DeepSeek → apiUrl 和 model 自动填好 → 输入 apiKey → "测试连接" 显示成功 → next 启用
3. ✅ 测试连接失败时 next 按钮置灰，并显示错误信息
4. ✅ Wizard 可以跳过，但顶部出现"LLM 未配置"警告横幅
5. ✅ Wizard 完成后再次启动应用，**不再**弹出
6. ✅ 设置面板里看到「LLM 服务商预设」区块，12+ 个卡片，点 OpenAI / Moonshot / DeepSeek 任意一个，apiUrl + model 立刻更新
7. ✅ 自定义预设点了之后清空 apiUrl + model 让用户自己填
8. ✅ 设置面板里"测试连接"按钮可重新验证
9. ✅ 设置面板里"重新启动新手引导"按钮能再次唤起 Wizard
10. ✅ 实测：配了 DeepSeek API key → 上传一个 markdown 文档 → 真的抽出实体（不是 0）
11. ✅ `cd desktop-daemon && npm run build` 无 type 错误

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

实测建议用 DeepSeek 或 SiliconFlow，便宜且稳定。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-07-llm-presets-and-onboarding.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **预设清单的最终内容**（如果有 model 名过期换掉了，写明换成了什么）
4. **关键取舍**（特别是：测试连接的实现方式、API key 存储位置、Anthropic 预设保留与否）
5. **自测结果**（11 条）
6. **遗留问题**

## 不要做的事

- 不要做账号 / 云端同步 / 多用户——本地存就够
- 不要做"自动续费提醒 / 余额查询"——这是各家厂商自己的事
- 不要把 Wizard 做成强引导（不让跳过）——用户可能已经懂了
- 不要在 Wizard 里塞太多步骤（>5 步会让用户烦）
- 不要为了预设漂亮把每家厂商的 logo 真的下载下来——版权风险
