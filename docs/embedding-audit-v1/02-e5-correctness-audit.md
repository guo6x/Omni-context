# 02 — E5 模型使用正确性审计

## 1. 结论

**PARTIAL**。Pooling / Normalization / Truncation / Attention Mask 全部正确；**唯一缺失是 E5 系列强制要求的 `query:` / `passage:` 非对称前缀**——项目全链路（实体写入、查询、归档）都用裸文本推理。

| E5 要求 | 项目实现 | 判定 |
|---|---|---|
| `query: ` 前缀 | 无（mcp.ts:1238 等直接传原查询） | ✗ |
| `passage: ` 前缀 | 无（entity-resolver.ts:176 传 `name: description`） | ✗ |
| 语言无关格式 | 同一 pipeline 处理中英文 | ✓ |
| Average Pooling | `pooling:'mean'`（service.ts:126） | ✓ |
| Attention Mask 参与 pooling | transformers.js `mean_pooling(result, attention_mask)`（pipelines.js:1262） | ✓ |
| L2 Normalization | `normalize:true`（service.ts:127） | ✓ |
| 最大长度 512 | tokenizer `model_max_length:512` | ✓ |
| Truncation | pipeline 默认 `truncation:true`（pipelines.js:1246） | ✓ |
| Padding | `padding:true` | ✓ |

## 2. 对照实验（24 组中英/跨语/时间/同人多事件对）

脚本：`evidence/e5-smoke-test.mjs`；结果：`evidence/e5-smoke-results.json`。
变体：A=现状（无前缀）；B=修正前缀；C=故意错误实现（CLS pooling、无归一化）作为对照。

| 指标 | A 现状 | B 加前缀 | C 错误实现 |
|---|---|---|---|
| 正对相似度均值 | 0.8928 | 0.8670 | 0.9525 |
| 负对相似度均值 | 0.7745 | 0.7471 | 0.8885 |
| 硬负例（同人他事/异时间）均值 | 0.8758 | 0.8454 | 0.9476 |
| 正负 margin | 0.1183 | 0.1199 | 0.0640 |
| **Top-1 检索正确率** | **0.750** | **0.833** | 0.750 |
| 其中 temporal 子集 | 3/4 | **4/4** | 3/4 |
| 其中 person-event 子集 | 1/2 | **2/2** | 1/2 |
| 其中 zh 子集 | 6/6 | 6/6 | 6/6 |
| 其中跨语言子集 | 0/4 | 0/4 | 1/4 |

## 3. 真实数据验证（LoCoMo Conv1 419 条对话轮，150 道有 evidence 的可答题）

脚本：`evidence/retrieval-testbed.mjs`（详见报告 04）：

| 指标 | 无前缀（现状） | 加前缀 | 相对变化 |
|---|---|---|---|
| Recall@1 | 0.2533 | 0.3267 | **+29%** |
| Recall@10 | 0.6133 | 0.6333 | +3% |
| MRR@10 | 0.3660 | 0.4167 | **+14%** |
| NDCG@10 | 0.3946 | 0.4354 | +10% |
| temporal R@10 | 0.7568 | 0.8649 | **+14%** |

## 4. 回答核心问题：低分是模型能力不足还是使用错误？

两者都有、但都不是主因：

1. **使用错误（缺前缀）是真实且可测的损失**：排序质量（MRR/R@1）损失约 10–29%（相对值），时间类问题受害最大——这正是 LoCoMo 的重点考察维度。缺前缀还压缩了正负例间距（对话数据上前缀版把 hard-negative 与正例分得更开），使下游"相似度挤在一起"（代码注释 mcp.ts:149 自己也承认了这一点，并用 LLM 重排补偿）。
2. **但即使修正前缀，dialog 级 R@10 也只有 0.63**——e5-small（384 维、118MB 量化）在这个任务上有真实的能力上限（跨语言检索 0/4 全军覆没也是佐证）。
3. **两者加起来仍解释不了正式 run 的主要损失**：正式系统最终上下文命中率只有 0.48（报告 03），而同模型在理想文本底座上无前缀也能到 0.61——说明"检索底座（实体向量 + 非语义的 assertion 挂载）+ 序列化"损失大于 embedding 模型本身的损失。

## 5. 附注

- C 变体（错误 pooling/归一化）margin 减半（0.064 vs 0.118），确认当前 pooling/normalize 实现是正确且有效的。
- 前缀修复是**一行级改动**（embed 调用处加参数），但会改变全库向量空间，必须全量重嵌 + 重建 vec 表（现有 `maybeReembedOnModelChange` 机制可复用，把 meta key 扩展为 `model+usage_version` 即可）。
