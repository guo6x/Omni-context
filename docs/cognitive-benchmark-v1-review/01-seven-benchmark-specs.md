# Seven Benchmark Specifications

状态：供外部审查；Synthetic/Curated Evaluation，不是官方 LoCoMo。

| 类别 | 目标 | 场景核心 | 主指标 |
|---|---|---|---|
| Cognitive Continuity | 长期画像能否稳定影响建议 | 目标、偏好、预算、时间、能力短板 | Profile Recall、Constraint Utilization、Contradiction Rate |
| Memory Evolution | 当前事实是否替代旧状态且保留历史 | 技术栈、地点、项目状态变化 | Current/Historical Accuracy、Stale Leakage |
| Conflict Resolution | 冲突来源、置信度和时间能否正确处理 | 明确纠正、低置信度导入、历史查询 | Latest Valid Fact、Invalidated Rejection |
| Cross-Agent Transfer | Synthetic Agent 间传播与来源保留 | A 写入、B/C 更新、A 回读 | Recall、Propagation、Provenance、Isolation Error |
| Human-like Forgetting | 区分保留、失效、抑制和噪声过滤 | 长期目标、短期状态、一次性噪声 | Retention、Suppression、Precision、Invalidation |
| Proactive Insight | 从行为轨迹发现有证据的盲点 | 方向切换、未验证、资源冲突 | Insight Precision/Recall、Overreach、Actionability |
| Decision Quality | 长期约束能否改善复杂选择 | 风险预算、稳定收入、可逆试验 | Constraint Coverage、Option Comparison、Risk Awareness |

Cross-Agent 只使用数据内的 Synthetic Agent 标签，不连接真实 ChatGPT、Claude 或外部账号。Proactive Insight 与 Decision Quality 允许固定的非独立 LLM Judge；其余类别优先使用确定性评分。
