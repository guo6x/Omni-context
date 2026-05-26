# Task 30: 图谱节点编辑 / 删除 UX 梳理

## 背景

后端 API 全套有：

- `PATCH /api/entities/:id` —— 改名 / 描述 / 标签
- `DELETE /api/entities/:id` —— 删除
- `POST /api/entities/:id/merge` —— 合并到另一个实体

但 UI 上**入口分散、缺少安全网**：

- GraphViewer 详情面板里点节点能改部分字段，但删除和合并的二次确认不够强（万一手滑删一个核心 principle 节点，关联关系全失效）
- 没有"批量选择 + 批量删除"
- 没有"撤销删除"
- 删除时没显示"这次删除会影响 N 条关系"，用户不知道后果

## 目标

把节点的编辑 / 删除 / 合并体验做成一致、安全、可发现。

成功标准：

1. **详情面板** 编辑按钮明确（icon + 文字），点开后字段可编辑（name / description / type / tags）
2. **删除前预览**：显示"将删除此实体 + 失效 N 条关系（其中 M 条入向、K 条出向）" + 二次确认弹窗
3. **合并**：选目标实体 → 显示"合并后保留: <name>，删除: <name>，N 条关系迁移" → 确认
4. **批量选择**：图谱 Ctrl+点击多选 → 出现底部 action bar "已选 N 个 [删除] [批量加标签] [合并到...]"
5. **撤销删除**：删除后 10 秒内 toast 显示 "已删除 N 个实体 [撤销]" → 点撤销恢复（这要求后端配合，或前端 cache 已删数据）

## 涉及文件

- `desktop-daemon/src/components/GraphViewer.tsx`
  - 详情面板：编辑/删除/合并按钮的可发现性提升
  - 删除按钮加二次确认 dialog（复用 `ConfirmDialog`）
  - 多选状态 + 底部 action bar
  - 撤销机制：删除时把删除内容暂存到 ref，10 秒内可恢复（调 POST /api/entities 重新创建）
- `desktop-daemon/src/components/EntityEditDialog.tsx`（新建，可选）
  - 把现有的零散编辑字段集中成一个 dialog，统一编辑体验
- `desktop-daemon/src/components/ConfirmDialog.tsx`
  - 检查是否支持"显示影响范围预览" props，没有就加
- 后端：先确认现有 DELETE 是否级联 / soft-delete
  - 看 `brain-server/src/api/handlers/entities.ts` 的 DELETE handler 是 hard delete 还是只标记
  - 如果 hard delete，撤销就只能靠前端 cache + POST 重建
  - 如果 soft delete，撤销就直接 PATCH `is_deleted=false`

## 约束

- **不要破坏现有 API** —— 撤销机制就近选择，不强求改后端
- 二次确认的弹窗要**明确给出后果**，不要笼统的"确定删除吗?"
- 批量操作要有"取消选择"按钮 + Esc 退出多选
- 撤销 toast 自动消失时间设 10 秒，足够用户犹豫
- 不要做"回收站"——撤销是临时机制，不沉淀
- 删除多个实体时整体一笔（不要一条条删，避免半成功状态）
- 合并按钮要明确"哪个保留哪个删除"——颜色/位置突出保留方

## 验收标准

1. ✅ 点节点 → 详情面板能看到编辑/删除/合并三个按钮
2. ✅ 点删除 → 弹窗显示"将删除 X，失效 N 条关系" → 取消能返回，确认才删
3. ✅ 删除后 toast 显示 "已删除，[撤销]" → 10 秒内点撤销实体恢复
4. ✅ Ctrl+点击多个节点 → 底部 action bar 出现
5. ✅ action bar 点"批量删除" → 弹窗显示影响范围 → 确认后一次性删
6. ✅ 合并：选 A → 点合并 → 选 B → 弹窗"保留 B，删除 A，3 条关系迁移到 B" → 确认
7. ✅ Esc 退出多选模式
8. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-30-graph-node-edit-delete-ux.md`

包含：
- 现有 DELETE 是 hard 还是 soft（决定撤销实现方式）
- 多选交互的细节（Ctrl 还是 Cmd 还是 Shift，跨平台）
- 批量操作的事务性（一笔成功 / 一笔失败的处理）

## 不要做的事

- 不要做"导出选中节点"——那是另一个功能（数据导出按钮在设置里已经有了）
- 不要做正经"回收站"页面——撤销 toast 够用
- 不要做"编辑历史"——超出范围
- 不要在节点上 hover 直接显示删除按钮（误操作风险高）
- 不要把合并做成拖拽（拖拽精度差，容易误合并）
