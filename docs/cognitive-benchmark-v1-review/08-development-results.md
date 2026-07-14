# Development Results

标注：Development Results、Not Formal Results、Synthetic/Curated Evaluation。

| 模式 | 完成 | Overall Macro |
|---|---:|---:|
| No Memory | 21/21 | 0.3880 |
| Retrieval-Only | 21/21 | 0.9751 |
| Full Omni | 35/35 | 0.9567 |

Full Omni 各类：Continuity 1.0000、Evolution 1.0000、Conflict 0.9000、Cross-Agent 0.9222、Forgetting 0.9722、Proactive Insight 0.9800、Decision Quality 0.9226。

Full Omni 胜过 No Memory，但没有胜过 Retrieval-Only。共同的三题/类上，Proactive Insight 对 Retrieval-Only 的成对胜率（平局计 0.5）为 0.1667，Decision Quality 为 0。主要差异是 Full Omni 抽取后丢失部分 Agent 来源标签、冲突事实未总是显式写入 `rejected_facts`，而短场景的词法 Top-4 基线几乎拿到完整事件原文。

Agent-Judged 指标不是独立 Judge；确定性与 Judge 指标见机器文件。运行错误 0，Development 重试 0。
