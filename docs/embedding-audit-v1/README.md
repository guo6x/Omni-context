# Embedding 与检索质量专项审计 v1（2026-07-14）

审计对象：branch `pre-evaluation-hardening-v3.1`，HEAD `3bdb6e10`（= `evaluation-freeze-candidate-v1`）。
核心问题：Conv1 低分中 Embedding 的责任占比，以及是否/如何替换 `Xenova/multilingual-e5-small`。

| 报告 | 内容 | 一句话结论 |
|---|---|---|
| [01](01-current-implementation-audit.md) | 实现审计 | 只有 Entity 有向量；Assertion 0/423；E5 无前缀；其余实现正确 |
| [02](02-e5-correctness-audit.md) | E5 正确性 | **PARTIAL**：缺前缀，实测 MRR -12%、R@1 -22% |
| [03](03-error-attribution.md) | 错误归因 | 检索层丢失 52%、Answer 层 27%、抽取 19%；gold 全在场也只有 0.57 正确率 |
| [04](04-retrieval-metrics.md) | 检索指标 | 系统 Final Context Recall 0.483 vs 同模型理想底座 R@10 0.613 |
| [05](05-model-comparison.md) | 模型对比 | e5-large/e5-base/bge-m3 静态与工程属性 |
| [06](06-ablation-results.md) | 消融 | e5-large 前缀版 R@10 **0.807** 全类别第一；bge-m3 dense 0.707 |
| [07](07-vector-migration-risk.md) | 迁移风险 | 动态维度已支持；重嵌机制可复用；需 usage_version 触发 |
| [08](08-reranker-assessment.md) | Reranker | LATER——重排对象错位，先修结构 |
| [09](09-text-serialization-audit.md) | 文本序列化 | 最大单点问题：UUID+relates_to 的 JSON 上下文 |
| [10](10-final-recommendation.md) | 最终建议 | 主推 e5-large+前缀；Candidate v2 CONDITIONAL |

`evidence/`：脚本（可复跑）、检索指标 JSON、消融汇总、错误归因明细、环境与模型信息、实验配置 hash。
`evidence/model-cache/`：三个候选模型的 int8 ONNX（共 ~1.4GB，可删除重下载；Candidate v2 采纳 e5-large 后应移入 `brain-server/models/`）。

已知限制：正式 run 的 brain.db 未保留（仅 sha256），库内向量级指标为代理测量；消融在对话轮底座上进行而非原始抽取库（详见 04/06 的方法声明）。
