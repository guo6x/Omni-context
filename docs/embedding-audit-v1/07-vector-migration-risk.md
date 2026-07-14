# 07 — 向量维度迁移风险审计

当前 384 维（e5-small）。候选：e5-base 768 维 / e5-large 1024 维 / bge-m3 1024 维。

## 1. 逐项检查

| # | 检查项 | 现状 | 风险 |
|---|---|---|---|
| 1 | Vector 表创建 SQL | migration `add_vec0_virtual_table` 硬编码 `FLOAT[384]`（sqlite.ts:157-162） | 新库仍会先建 384 维表，首次写入新维度时触发重建 |
| 2 | sqlite-vec 维度 | 运行时从 sqlite_master 解析实际维度（`_resolveVecDimension`，sqlite.ts:2134-2146） | 低 |
| 3 | Migration | 无按模型版本的向量迁移；靠 `_recreateVecTable`（sqlite.ts:2153-2160）**DROP 重建** | 中：重建瞬间 KNN 为空，需等 reembed 完成 |
| 4 | 旧库兼容 | `maybeReembedOnModelChange`（routes.ts:294-308）用 app_meta `embedding_model` 检测切换，后台全量重嵌 | 中：重嵌是后台异步，期间检索质量降级；且**只对比模型名，不含前缀/用法版本** |
| 5 | Vector 序列化 | Float32Array→BLOB（encodeEmbedding），维度无关 | 低 |
| 6 | API Schema | embedding 不经 REST 暴露原始向量；`getInfo().dimensions` 报告配置值而非实测值（service.ts:252，硬编码 fallback 384） | 低（显示性错误） |
| 7 | Desktop 类型 | 未发现硬编码 384 的 TS 类型 | 低 |
| 8 | Backup/Restore | 备份为文件级复制，BLOB 随库走 | 低 |
| 9 | Export/Import | 同上；跨模型导入旧向量会与新查询向量不可比 → 依赖 reembed 兜底 | 中 |
| 10 | Entity Merge | vec_entities DELETE+INSERT（sqlite.ts:2123-2127），KNN JOIN 过滤 merged（:2058） | 低 |
| 11 | Assertion 更新 | 无 assertion 向量，不适用（Candidate v2 新增时需设计） | — |
| 12 | 浏览器捕获写入 | 走同一 EmbeddingService | 低 |
| 13 | 移动端同步 | 未见向量同步逻辑（向量为服务端本地生成） | 低 |
| 14 | Windows 安装包内模型 | `scripts/build-desktop-only.js` 打包 `models/`；e5-small 130MB → bge-m3/e5-large 会使安装包 +440MB | **高（分发成本）** |
| 15 | 测试 Fixture | 测试多用 in-memory + reembed 跳过（routes.ts:296 VITEST 早退） | 低 |

## 2. 任务书问题回答

- **是否支持运行时动态维度**：是（检测→DROP→重建，sqlite.ts:2028-2030），但代价是清空向量索引。
- **是否需要新 Migration**：建议新增：①vec 表维度参数化；②app_meta 记录 `embedding_model@usage_version`（前缀修复也要触发重嵌）；③（若上 assertion 向量）新建 `vec_assertions` 表。
- **是否按模型版本区分 Vector Index**：建议 Candidate v2 采用 `vec_entities_<dim>` 或元数据栏位记录模型指纹，避免"半新半旧"窗口。
- **如何避免 384/1024 混用**：现有机制已避免持久混用（重建+reembed）；风险窗口是 reembed 进行中的查询。评测场景应改为**同步预热**：ingest 前先跑完 reembed 再放行（评测 runner 本来就等 health check，可加向量计数断言）。
- **如何回滚**：切回旧模型名→再次触发重建+重嵌即可（幂等）；但要接受两次全量重嵌成本（Conv1 规模 ~400 条文本，e5-small 约 4s，bge-m3 CPU 约 2-4 min，可接受）。
- **是否需要完整重建向量**：是，任何模型或用法（前缀）变更都必须全量重嵌，旧向量与新查询空间不可比。
- **是否需要重新跑 Conversation 1**：见报告 10 问题 7（结论：ONLY AFTER 修复项就绪后作为 Candidate v2 重跑）。

## 3. 红线确认

本轮未对任何既有数据库做写操作；所有实验在 `docs/embedding-audit-v1/evidence/` 下的独立脚本与只读数据上进行；`evaluation-freeze-candidate-v1` 标签未移动（HEAD 校验见报告 01）。
