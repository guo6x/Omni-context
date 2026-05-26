# Task 31: 图谱体验深化（聚焦动画 + 时间维度可视化）

## 聚焦脉冲动画实现

### 方案：RAF-free，利用 force-graph 自带渲染循环

- 通过 `useRef` 存储动画状态（`{ nodeId, startTime }`），无需额外 RAF 循环
- 当 `focusEntityId` 变化时，设置 `focusAnimRef` + 500ms `setTimeout` 清除动画
- `nodeCanvasObject` 内直接读取 ref → 计算 `(Date.now() - startTime) / 500` 得到进度
- force-graph 每帧调用 `nodeCanvasObject`，动画自然推进
- 重复聚焦自动清除旧 timer，动画可被中断

### 动画细节

1. **缩放脉冲**：`1 + 0.4 * sin(progress * PI)`，sine 曲线实现 1x → 1.4x → 1x
2. **涟漪**：expanding circle 半径 `nodeSize * (1 + progress * 3.5)`，透明度 `0.45 * (1 - progress)` 线性衰减
3. 颜色统一使用 `#7df9ff`（cyan），与 UI 主题一致

## 时间维度可视化：方案 1（新鲜度光环）

### 选择理由

- 信息密度更高：不需要额外交互，一眼看出哪些是最近创建的
- 不增加 UI 控件（无需 slider、filter）
- 颜色使用 cyan（#7df9ff），与 type palette 无冲突
- 与 Legend 颜色体系正交——type 颜色保留为主色，ring 是独立视觉层

### 实现

- 在 `graphData` useMemo 中预计算每个节点的 `freshness`（0-1）
  - `ageDays = (Date.now() - created_at) / 86400000`
  - `freshness = max(0, 1 - ageDays / 30)`
- `nodeCanvasObject` 中若 `freshness > 0` 且节点未被 dimm，绘制外圈 cyan ring
  - 透明度 = `freshness * 0.55`
  - 半径 = `nodeSize + 2`，线宽 = `2.2 / globalScale`

### 效果

- 今天创建的节点：ring 最亮（opacity ~0.55）
- 7 天前：opacity ~0.42
- 30 天前：opacity = 0，无 ring

## 性能策略

- **freshness 预计算**：在 `graphData` useMemo 中一次性算完，`nodeCanvasObject` 只读取数值，避免每帧 `new Date().getTime()` 开销
- **动画不影响全图重绘**：脉冲/涟漪仅在 `node.id === focusAnim.nodeId` 时绘制，其他节点无额外开销
- **无外部动画库**：纯 Date.now() + ref + setTimeout，零依赖

## 涉及文件

- `desktop-daemon/src/components/GraphViewer.tsx`
  - 新增 `GraphNode.freshness` / `GraphNode.created_at` 字段
  - 新增 `focusAnimRef` / `focusAnimTimerRef`
  - `graphData` useMemo 中预计算 freshness
  - `nodeCanvasObject` 中添加脉冲缩放 + 涟漪 + 新鲜度光环
  - `focusEntityId` useEffect 中触发动画

## 验收状态

- [x] `npm run build` 通过
- [ ] Ctrl+K 搜索 → 脉冲 + 涟漪动画（需实际运行验证）
- [ ] 连续搜索 → 动画互不叠加（需实际运行验证）
- [ ] 最近创建节点有 cyan ring（需实际运行验证）
- [ ] 1000 节点不掉帧（需实际运行验证）
