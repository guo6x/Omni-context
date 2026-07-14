# Cost Estimate

Development 可观测调用：Answer 77、Judge 22、Agent Review 20、Extraction 45、统一检索/Reranker 逻辑操作 35、重试 0。Answer/Judge 可观测输入 98,981、输出 35,579，Agent Review 输入 43,883、输出 2,012；按 2026-07-14 DeepSeek 官方 v4-flash 价格，可观测费用约 `$0.0295`。

计划调用：

| 范围 | Answer | Judge | Extraction | Reranker 操作 | Token 估计（入/出） | 费用估计 |
|---|---:|---:|---:|---:|---:|---:|
| Formal 250 Full Omni | 250 | 60 | 330 | 250 | 345,293 / 343,592 | $0.1445 |
| Comparison 70×3 | 210 | 60 | 90 | 70 | 280,969 / 160,034 | $0.0841 |
| 合计 | 460 | 120 | 420 | 320 | 626,262 / 503,625 | $0.2287 |
| +20% 缓冲 | — | — | — | — | — | $0.2744 |

估计时长：Formal 2.26h、Comparison 0.78h、合计加 20% 缓冲 3.64h，建议预留 4–5 小时夜间窗口。

冻结 Brain Server API 不返回 Extraction 的 Provider Token，因此 Extraction 输入用真实字符数/4、输出用保守 700 Token 代理；Reranker 是统一检索逻辑操作，不记录为独立付费 LLM 调用。这些必须在正式运行前决定是否扩充遥测。
