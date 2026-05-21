# 任务 03：修正 LLM 管线的 token 预算

> 实测发现 LLM 抽取管线对真实大小的文档完全不工作。根因是参数设置，不是逻辑。
> 本任务只改两个常量 + 加一条诊断日志，不要扩大范围。
> 项目根目录：`omni-context-release/`。

## 背景（实测证据）

用户使用云端推理模型（DeepSeek `deepseek-v4-flash`）。推理模型在产出正文前会先消耗大量
token 做推理。实测一个 4000 字符的技术文档：

- `max_tokens=2048`（管线当前默认值）→ `finish_reason=length`，2048 token **全部被推理吃光**，
  `content` 为空 → `JSON.parse` 失败 → 抽取静默返回 0 实体。**LLM 抽取层等于死的。**
- `max_tokens=8000` → 正常，`finish_reason=stop`，抽出 24 个合理实体（推理用了 5363 token，
  输出 JSON 约 1667 token）。
- `max_tokens=16000` → 模型接受，不报错。

DeepSeek 实测单次抽取耗时 0.7–3.6 秒。

## 改动

**文件**：`brain-server/src/graphrag/llm-pipeline.ts`

1. `DEFAULT_LLM_CONFIG` 里 `maxTokens` 从 `2048` 改为 `16000`。
   理由：推理模型光推理就可能用掉 5000–8000 token，必须给正文留足空间。16000 对推理模型和
   普通模型都安全（普通模型用不满）。

2. `DEFAULT_LLM_CONFIG` 里 `timeoutMs` 从 `10000` 改回 `30000`。
   理由：任务 01 当初降到 10s 是为了缓解「无 LLM 时每次卡 30s」，但那个问题已由 healthCheck
   门控彻底解决（不健康就禁用、extract 直接跳过）。所以超时可以放回宽松值，给慢模型和大文档留余地。

3. 在 `LLMExtractorPipeline.extract()` 解析响应处，增加一条诊断日志：当
   `data.choices?.[0]?.finish_reason === 'length'` 时，`console.warn` 明确提示
   「LLM 输出被 max_tokens 截断，抽取结果可能不完整」。这样以后再遇到截断能一眼看出原因。

## 约束

- 只改上述三处，不重构、不改其它逻辑。
- 遵循现有代码风格。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 通过。
- `maxTokens` 默认值为 16000，`timeoutMs` 默认值为 30000。
- `finish_reason === 'length'` 时有明确的 warn 日志。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-llm-token-budget.md`，内容包含：
任务目标、改动文件清单、自测结果（命令+结果）、已知遗留。
