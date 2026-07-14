# Paper Table Preview

标注：**Development Results — Not Formal Results — Synthetic/Curated Evaluation**。

| Mode | Continuity | Evolution | Conflict | Cross-Agent | Forgetting | Insight* | Decision* | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| No Memory | 0.3889 | 0.3889 | 0.4167 | 0.5000 | 0.5833 | 0.2083 | 0.2296 | 0.3880 |
| Retrieval-Only | 0.9500 | 1.0000 | 1.0000 | 0.9259 | 1.0000 | 0.9917 | 0.9580 | 0.9751 |
| Full Omni | 1.0000 | 1.0000 | 0.9000 | 0.9222 | 0.9722 | 0.9800 | 0.9226 | 0.9567 |

`*` Agent-Judged Metrics，`judge_independent=false`。其余以 Deterministic Metrics 为主。表格不能作为 Formal Benchmark 结果引用。

`evidence/tables/` 提供 11 个 CSV：总体、子指标、三模式、时间冲突、跨 Agent、遗忘分类、主动洞察、决策质量、错误归因、成本延迟、Resume/失败。正式论文表当前只保留列结构，Formal 单元格不得填入 Development 数值。
