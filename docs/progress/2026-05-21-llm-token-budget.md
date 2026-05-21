# 2026-05-21 - LLM Token Budget

## 任务目标

修正 LLM 抽取管线的 token 预算参数，解决推理模型因 max_tokens 不足导致抽取静默失败的问题。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/graphrag/llm-pipeline.ts:29` | `maxTokens` 2048 → 16000（推理模型需 5k-8k token 推理，2048 不够） |
| `brain-server/src/graphrag/llm-pipeline.ts:29` | `timeoutMs` 10000 → 30000（healthCheck 门控已解决无 LLM 卡顿，超时恢复到宽松值） |
| `brain-server/src/graphrag/llm-pipeline.ts:151` | 新增 `finish_reason === 'length'` 时的 warn 日志，一眼识别截断 |

## 自测结果

```
brain-server: npx tsc --noEmit → 通过
```

## 已知遗留

无。
