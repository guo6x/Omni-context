# 05 — 候选 Embedding 模型比较

> 测量数据来自 `evidence/retrieval-*.json`（本机 CPU 实测，Intel Core Ultra 5 125H / 32GB / 无独显）。
> 检索质量数字见报告 06 消融表；本报告为静态属性 + 工程约束对比。

## 1. 候选清单

| | Baseline | Candidate A | Candidate B | Candidate C（可选第4） |
|---|---|---|---|---|
| 模型 | Xenova/multilingual-e5-small | Xenova/multilingual-e5-large | Xenova/bge-m3 | Xenova/multilingual-e5-base |
| 上游 | intfloat/multilingual-e5-small | intfloat/multilingual-e5-large | BAAI/bge-m3 | intfloat/multilingual-e5-base |

bge-m3 选用 **Xenova/bge-m3**（transformers.js 官方作者转换的 ONNX，目录布局与 v2.17 兼容），未用名字相近的非官方仓库；onnx-community/bge-m3-ONNX 亦存在（面向 v3），二者上游权重一致。

## 2. 静态属性对比（24 项）

| 属性 | e5-small | e5-large | bge-m3 | e5-base |
|---|---|---|---|---|
| 1 参数规模 | ~118M | ~560M | ~568M | ~278M |
| 2 向量维度 | 384 | 1024 | 1024 (dense) | 768 |
| 3 最大上下文 | 512 tok | 512 tok | **8192 tok** | 512 tok |
| 4 多语言 | 94 语 | 94 语 | 100+ 语 | 94 语 |
| 5 中文能力 | 中 | 良 | **优**（C-MTEB 领先） | 良 |
| 6 英文能力 | 中 | 良 | 良 | 良 |
| 7 Query instruction | 必须 `query:` | 必须 `query:` | **不需要** | 必须 `query:` |
| 8 Pooling | mean | mean | **CLS** | mean |
| 9 Normalization | L2 | L2 | L2 | L2 |
| 10 Transformers.js 兼容 | ✓（在用） | ✓ Xenova 官方 | ✓ Xenova 官方 | ✓ Xenova 官方 |
| 11 ONNX 兼容 | ✓ | ✓ | ✓ | ✓ |
| 12 Windows CPU | ✓（实测） | ✓（实测） | ✓（实测） | ✓（实测） |
| 13 GPU | 本机无 CUDA；onnxruntime DirectML 未集成 | 同左 | 同左 | 同左 |
| 14 模型下载大小（int8 量化 onnx） | 118MB | 562MB | 570MB | 279MB |
| 15 常驻内存（实测 RSS） | ~0.65GB | 0.43GB | **2.1GB** | 0.20GB |
| 16 加载时间（实测） | ~1.2-1.5s | 2.6s | 2.2s | 1.8s |
| 17 单 Query 延迟（实测 P50） | ~6ms | 31.6ms | 26.4ms | 13.9ms |
| 18 批量吞吐 | 串行 embedBatch（service.ts:112-119，无真正批处理） | 同架构下按延迟折算 | 同左 | 同左 |
| 19 SQLite 增长 | 384×4B=1.5KB/实体 | 4KB/实体（×2.7） | 4KB/实体（×2.7） | 3KB/实体（×2） |
| 20 安装包影响 | 现状（打包 130MB 模型目录） | +440MB | +450MB | +160MB |
| 21 离线运行 | ✓ | ✓ | ✓ | ✓ |
| 22 许可 | MIT | MIT | MIT | MIT |
| 23 长文本 | ✗（512） | ✗（512） | ✓（8192） | ✗（512） |
| 24 需要额外 Sparse/ColBERT？ | 否 | 否 | dense 单独可用；sparse/ColBERT 头 ONNX 版不输出，**用不上也不需要** | 否 |

## 3. 工程要点

1. **bge-m3 用法差异**：CLS pooling + 无前缀。若沿用现有 `pooling:'mean'` 代码路径会再次犯"用法错误"——EmbeddingService 需要按模型配置 pooling/prefix（建议加 `usageProfile` 配置项，包含 `queryPrefix/passagePrefix/pooling`）。
2. **e5 系列升级最省事**：与现网同家族，改模型名 + 补前缀即可，重嵌机制已有。
3. **8192 上下文只对 bge-m3 有意义**：当前被嵌入文本（实体 `name: description`，中位数十字符）远不到 512；只有未来做 assertion/段落级嵌入或长文档嵌入时长上下文才有价值。
4. **磁盘/分发**：本机 D 盘仅 5.5GB 空闲；桌面安装包若内置 bge-m3/e5-large 需 +440-450MB，对分发影响显著。e5-base 是折中。
5. **延迟预算**：正式 run 检索 P50=2588ms，其中 embedding 仅 ~6ms——**embedding 延迟即使 ×20 也不是瓶颈**（大头是 LLM 重排网络调用）。
