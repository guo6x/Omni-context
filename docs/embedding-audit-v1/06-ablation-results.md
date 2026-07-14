# 06 — 小规模 Embedding 消融结果

## 1. 方法与偏差声明

任务书要求"复制正式 Conversation 1 数据库，固定抽取结果只换 Embedding"。**正式 brain.db 未在磁盘保留**（报告 01 §5），无法在原库上做严格消融。替代设计（口径 B，报告 04）：

- **固定**：419 条 Conv1 对话轮 passage（`[session时间] speaker: text`）、150 道有 evidence 的可答题、gold dia_id、全部指标代码、同一台机器、同一 transformers.js 2.17.2 管线；
- **只变**：embedding 模型与用法（前缀/pooling）；
- 未做小样本 Answer 验证：①任务书优先级即"先看检索指标，不先调 Answer Model"；②没有正式库，无法把"检索改善"通过真实 pipeline（实体挂载 assertion）传导到 Answer，硬做会引入比结论更大的噪声。Answer 层的影响已用正式 run 的条件正确率（报告 03 §4）单独刻画。
- 本消融衡量的是**模型在本任务文本分布上的检索能力**；生产收益还要乘上系统结构因子（assertion 挂载、重排），故对正式指标的外推一律取保守区间（报告 10 问题 8）。

所有模型使用 int8 量化 ONNX（与生产 `quantized:true` 一致）。bge-m3 按官方要求用 CLS pooling + 无前缀；控制实验证实 mean pooling 会使其 MRR 从 0.438 掉到 0.369，排除了"用法不当压低 bge-m3"的可能。

## 2. 主表（ALL，n=150；完整 JSON 见 `evidence/retrieval-*.json`、`evidence/ablation-summary.json`）

| 模型/用法 | 维度 | R@1 | R@5 | R@10 | R@20 | R-full@10 | MRR@10 | NDCG@10 | 加载 | 查询P50 | 查询P95 | passage P50 | 峰值RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| e5-small 无前缀（现状） | 384 | 0.253 | 0.560 | 0.613 | 0.727 | 0.487 | 0.366 | 0.395 | 1.5s | 5.9ms | 9.1ms | 12ms | 0.65GB |
| e5-small 修正前缀 | 384 | 0.327 | 0.560 | 0.633 | 0.740 | 0.507 | 0.417 | 0.435 | 1.2s | 6.4ms | 8.6ms | 12ms | 0.65GB |
| e5-base 前缀 | 768 | 0.333 | 0.640 | 0.707 | 0.767 | 0.573 | 0.455 | 0.482 | 1.8s | 13.9ms | 18.1ms | 29ms | 0.20GB |
| **e5-large 前缀** | 1024 | **0.420** | **0.713** | **0.807** | **0.867** | **0.660** | **0.544** | **0.573** | 2.6s | 31.6ms | 40.8ms | 65ms | 0.43GB |
| bge-m3 CLS dense | 1024 | 0.313 | 0.613 | 0.707 | 0.820 | 0.613 | 0.438 | 0.478 | 2.2s | 26.4ms | 35.8ms | 60ms | **2.1GB** |

分类别 R@10（前缀/正确用法版）：

| 类别 | e5-small | e5-base | e5-large | bge-m3 |
|---|---:|---:|---:|---:|
| temporal | 0.865 | 0.811 | **0.973** | 0.892 |
| multi_hop | 0.364 | 0.545 | **0.818** | 0.455 |
| single_hop | 0.563 | 0.625 | **0.750** | 0.563 |
| open_domain | 0.586 | 0.714 | **0.743** | 0.714 |

辅助消融：passage 去掉时间戳（e5-small 前缀版）R@10 0.633→0.660 但 temporal MRR 0.563→0.522——时间戳对时间类排序有正贡献，对其余类别是轻噪声；assertion 序列化时间信息应保留（报告 09）。

## 3. 读数

1. **e5-large 在全部四个类别全面第一**，temporal 0.973 和 multi_hop 0.818 是质变级（现状分别 0.757/0.364）。
2. **bge-m3 dense-only 在本数据上不如同尺寸的 e5-large**（英文对话为主；其混合检索 sparse/ColBERT 头在 transformers.js ONNX 里不可用，中文长文本优势在本任务测不到），且 int8 量化下 RSS 2.1GB、对 XLM-R CLS 向量的量化损伤可能更大。
3. **e5-base 是性价比拐点**：+74% 下载体积换 R@10 +7.3pts；e5-large 再 +100% 体积换再 +10pts。
4. 延迟全部无关紧要：正式 run 检索 P50 2588ms，embedding 最贵的 e5-large 也只占 32ms（1.2%）。
5. 向量库增长：396 实体 × 4KB（1024 维）≈ 1.6MB，可忽略；若未来 assertion 全量入库（423 条）同样可忽略。

## 4. 红线遵守

- 未读取/统计 Conversation 2–10（数据经 `loadLoCoMoConversation(path, 1)` 的 split-guard 逐条只读 Conv1）；
- 未触碰 `evaluation-freeze-candidate-v1`、未改动任何既有数据库、未删除旧证据；
- 未调 Prompt/阈值，未同时改动抽取/重排/回答模型——全部消融只变 embedding。
