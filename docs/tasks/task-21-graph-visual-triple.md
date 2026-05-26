# Task 21: 图谱节点视觉三件套（size 映射 + 关系线区分 + Legend）

## 背景

目前 GraphViewer 视觉基础已经不错（柔光、hover 放大、dimmed、glyph、白色边框），但**信息架构**层面还差三个关键点：

1. **节点 size 没语义**：`(node.val || 5)`——所有节点大小几乎一致，看不出"哪些是核心节点"
2. **关系线视觉无区分**：`supports / contradicts / depends_on / conflicts_with / superseded` 等关系类型在线型/颜色上看起来一样。**冲突关系应该一眼看出**，目前用户得点开关系才知道是冲突
3. **类型颜色没图例**：14 种实体类型对应不同颜色，但用户不知道"紫色=principle, 蓝色=tool"

## 目标

补齐三件套，让用户**扫一眼图谱就能识别**核心节点 / 冲突关系 / 节点类型分布。

### A. 节点 size 映射 access_count + importance

- 公式：`node.val = base + scale * (access_count_norm * 0.6 + importance_norm * 0.4)`
- 归一化：access_count / max_access_count（避免极大值垄断），importance 0-1 已是归一
- base = 4, scale = 8（最终 val 在 4-12 之间）
- entity 表确认是否有 `importance` 字段——如果没有就只用 access_count（更新 task 文档里这一节描述）
- principle 类实体默认 size +2（产品定位上"原则"应该显眼）

### B. 关系线视觉区分

按 `RelationshipType` 区分颜色 + 线型（实线 / 虚线 / 粗线）：

| 关系类型 | 颜色 | 线型 | 含义 |
|----------|------|------|------|
| `supports` | `#10b981` 绿 | 实线 1.5px | 正向支持 |
| `depends_on` | `#3b82f6` 蓝 | 实线 1.5px | 依赖 |
| `contradicts` | `#ef4444` 红 | 实线 2px | 冲突 |
| `conflicts_with` | `#f97316` 橙 | 实线 2px | 冲突（弱） |
| `superseded` | `#6b7280` 灰 | 虚线 [4, 4] | 已被取代（弱化） |
| `related_to` | `#9ca3af` 浅灰 | 实线 1px | 弱关联（默认） |
| 其他/未知 | `#64748b` | 实线 1px | 兜底 |

实现：force-graph 的 `linkColor` + `linkLineDash` + `linkWidth` 三个 prop 都接受函数，按 link.type 返回对应值即可。

冲突/取代关系**箭头要保留**（已有），方向能看出来。

### C. 类型 Legend

在 GraphViewer 右上角加一个可折叠的"Legend"小面板（默认展开），列出当前画布上**实际存在**的 entity type，每条：
- 一个圆点（用该类型颜色）
- 类型名（i18n）
- 计数（"3 个" / "2"）

点击 Legend 里某个类型 → 高亮所有该类型节点（其他变 dimmed）。再点 → 取消高亮。

## 涉及文件

- `desktop-daemon/src/components/GraphViewer.tsx`
  - 节点 size 计算：在数据进 force-graph 前的转换函数里加 `val` 字段
  - `linkColor` / `linkLineDash` / `linkWidth` 三个 prop 改为函数式
  - 新增 type filter state（被 Legend 控制）
  - 加 Legend JSX：absolute 定位右上 + glass-panel 样式
- `desktop-daemon/src/lib/entity-colors.ts`（可能已有，确认）
  - 把 entity type → color 的映射集中导出，供节点渲染和 Legend 共用
- `desktop-daemon/src/lib/relationship-styles.ts`（新建）
  - 导出 `RELATIONSHIP_STYLES: Record<RelationshipType, { color, dash?, width }>`
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `graph.legend_title`、`graph.legend_filter_active`、各 entity type 中英名（如果还没）

## 约束

- **不要换图引擎**——`react-force-graph-2d` 继续用
- 节点 size 不要超过 `val=14`（再大节点会盖住边）
- 关系线颜色要在深色背景上够亮，但又不能花
- Legend 只显示**当前画布上存在**的类型（不要全列 14 个），用户看图谱里有啥
- Legend 折叠/展开状态用 localStorage 持久化（key: `omni_graph_legend_expanded`）
- access_count 没有时（新实体）按 0 算
- 节点 size 改造**不要破坏现有的 hover/selected 放大逻辑**（sizeScale * val）

## 验收标准

1. ✅ 图谱里 access_count 最高的节点目视上明显更大
2. ✅ principle 类型节点比 concept 同 access_count 时大一圈
3. ✅ conflicts_with / contradicts 关系线一眼红色 / 橙色
4. ✅ superseded 关系线虚线 + 灰色（弱化）
5. ✅ 右上角 Legend 显示当前画布上的所有 entity 类型 + 计数
6. ✅ 点 Legend 里"principle" → 所有 principle 节点高亮，其他 dimmed
7. ✅ 再点取消高亮
8. ✅ Legend 折叠/展开状态刷新后保留
9. ✅ 中英 i18n 都对
10. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-21-graph-visual-triple.md`

包含：
- 三件套各自实现说明
- entity 表有没有 importance 字段，最终 size 公式怎么定的
- Legend 高亮性能影响（大图谱时是否卡）
- 自测截图（如有）

## 不要做的事

- 不要做 3D 图谱的视觉增强（保持 2D）
- 不要做节点的"实体类型筛选 dropdown"（Legend 点击就能筛了，更简洁）
- 不要顺手改物理模拟参数（弹簧力 / 斥力 / 中心力）
- 不要加节点动画（如 pulse）——hover/selected 已经够
