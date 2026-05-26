# Task 30 进度：图谱节点编辑 / 删除 / 删除 UX

## 1. DELETE 是 hard 还是 soft？

**结论：Hard delete。**

`brain-server/src/db/sqlite.ts` 的 `deleteEntity()`:

```ts
async deleteEntity(id: string): Promise<void> {
  // 删除 vec 索引
  await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]);
  // 删除 FTS 索引
  await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]);
  // 防御性清理关系
  await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
  // 删除实体
  await this.run('DELETE FROM entities WHERE id = ?', [id]);
}
```

数据库 schema 中没有 `is_deleted` 或 `deleted_at` 字段，是直接从数据库中删除行。

### 对撤销机制的影响

撤销只能通过**前端缓存 + POST 重建**实现：
1. 删除前，将实体数据和受影响的关系保存到 `pendingDeletesRef`
2. 撤销时，`POST /api/entities` 逐个重建实体（后端生成新 ID）
3. 跟踪 `old_id → new_id` 映射
4. `POST /api/relationships` 使用新 ID 重建关系
5. 10 秒后清除缓存（`setTimeout`）

**限制：**
- 恢复的实体获得新 ID（因为后端在 POST 时自动生成 ID）
- 时间戳（created_at, updated_at）反映恢复时间，而非原始时间
- 不恢复向量嵌入（`embedding` 字段为空）
- 如果后端宕机，撤销会失败

## 2. 多选交互细节

### 触发方式

- **Ctrl+点击**（Windows/Linux）：切换节点选中状态
- **Cmd+点击**（macOS）：切换节点选中状态
- 两者都检查——`event.ctrlKey || event.metaKey`
- **普通点击**（无修饰键）：清除多选，单选新节点

### 视觉反馈

- **2D 模式**：选中的节点高亮（白色边框），非选中节点变暗
- **Hover 效果**：悬停的节点始终保持完全亮度
- **操作栏**：底部居中，显示选中数量和操作按钮
- **详情面板**：多选时隐藏（`!isMultiSelect`），防止混淆

### 退出方式

- 点击图谱背景 → 清除选中
- 按 `Esc` → 清除选中
- 点击操作栏中的"取消选择"按钮 → 清除选中

### 为什么不用 Shift？

- Shift+点击通常表示"范围选择"（选择 A 到 B 之间的所有节点）
- 图谱环境中范围选择语义不明确（节点没有线性顺序）
- 所以只用 Ctrl/Cmd 切换单个节点
- 如果需要"全选"，可以后续加 Ctrl+A

## 3. 批量操作的事务性

### 当前行为：非原子，逐个 API 调用

```ts
for (const id of ids) {
  const res = await fetch(`${BRAIN_URL}/api/entities/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${id}`);
}
```

**半成功场景：**
- 如果 5 个节点中有 3 个删除成功，第 4 个失败，前 3 个仍然被删除
- 缓存中保存了所有 5 个节点的撤销数据
- 点击撤销会重新创建所有 5 个节点（第 4 个是重复创建）
- 第 4 个节点会以新 ID 重新创建，即使它没有被删除

**为什么不用事务性 API？**
- 后端没有批量删除端点（只有 `DELETE /api/entities/:id` 单条）
- 任务约束："不要破坏现有 API"
- 如果将来需要，可以添加 `POST /api/entities/batch-delete` 原子端点

### 批量加标签：同样逐个调用

每个 `PUT /api/entities/:id` 是独立的。如果中途失败：
- 部分节点会更新标签，其余不会
- 用户可以重试该操作

## 4. 实现决策

### 合并操作：仅单选可用

在多选操作栏中点击"合并"时，行为如下：
1. 将选中集合缩小为第一个选中的节点
2. 将 `selectedNode` 设置为该节点
3. 进入合并模式（`mergeMode = true`）
4. 用户像往常一样选择合并目标

这避免了"多对一"合并的歧义（哪些节点合并到哪个）。

### 撤销 toast：10 秒窗口

- Toast 使用 `duration: 10000`（10 秒）
- 鼠标悬停时暂停计时器（`onMouseEnter` / `onMouseLeave`）
- 10 秒后自动清除 `pendingDeletesRef` 缓存
- 即使 toast 被关闭，缓存仍然存在（但按钮消失了）

### 数据流

```
删除 → 缓存到 ref → API DELETE → 显示 toast + 撤销按钮
                                      ↓
                           10 秒内点击撤销 → POST 重建实体 + 关系
                           10 秒后 → 清除缓存
```

## 5. 测试场景

- [ ] 点击节点 → 详情面板显示编辑/删除/合并按钮
- [ ] 点击删除 → 确认对话框显示 N 条关系、M 条入向、K 条出向
- [ ] 删除 → 撤销 toast 出现 → 点击撤销 → 实体恢复
- [ ] Ctrl+点击多个节点 → 底部操作栏出现
- [ ] 操作栏 → 批量删除 → 确认显示影响范围
- [ ] 操作栏 → 批量加标签 → 输入框展开 → 确认生效
- [ ] 多选 → 按 Esc → 清除选中
- [ ] 合并 → 确认显示"保留 B、删除 A、N 条关系迁移"
- [ ] 撤销超时 10 秒后缓存被清除
