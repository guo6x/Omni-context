# Task 21 进度：图谱节点视觉三件套

**日期**: 2026-05-26

## A. 节点 size 映射

### importance 字段确认
`shared/types.ts` 中 Entity 接口只有 `access_count` 字段（第48行），没有 `importance` 字段。
因此 size 公式简化为只用 access_count：

```
val = base + scale * (access_count / maxAccessCount) + principleBonus
base = 4, scale = 8, principleBonus = (type === 'principle' ? 2 : 0)
最终 val 范围: 4~12
```

### 实现
- `graphData` useMemo 中：先计算所有可见节点的最大 access_count，然后归一化
- principle 类型节点 +2
- `Math.min(12, ...)` 限幅
- `nodeVal` prop 照旧读取 `node.val`，不做额外处理

### 自测
- access_count 高的节点目视上明显更大
- principle 节点比同 access_count 的 concept 大一圈

## B. 关系线视觉区分

### 关系类型样式映射
新建 `desktop-daemon/src/lib/relationship-styles.ts`：
```
supports:       #10b981 绿, 实线 1.5px
depends_on:     #3b82f6 蓝, 实线 1.5px
contradicts:    #ef4444 红, 实线 2px
conflicts_with: #f97316 橙, 实线 2px
superseded:     #6b7280 灰, 虚线 [4,4] 1px
related_to:     #9ca3af 浅灰, 实线 1px
relates_to:     #9ca3af (同 related_to)
default:        #64748b, 实线 1px (兜底)
```

### 实现
- `linkColor` / `linkWidth` / `linkLineDash` 三个 prop 使用 `getRelationshipStyle(link.type)` 获取
- 去除了之前基于 weight 的 alpha 加权（直接用样式颜色，确保区分度）
- 箭头和粒子保留，方向可辨识

### 自测
- conflicts_with / contradicts 关系线红色/橙色，一目了然
- superseded 关系线虚线灰色，明显弱化
- 深色背景上颜色够亮但不过花

## C. 类型 Legend

### 实现
- **位置**：右上角（`top-4 right-4`）
- **折叠**：点击标题栏展开/收起，状态存入 `localStorage` key `omni_graph_legend_expanded`
- **内容**：只显示当前画布实际存在的类型，按 count 降序排列
  - 圆点（对应类型颜色）
  - 类型名（type.replace(/_/g, ' ')）
  - 计数（number only，如 "3"）
- **交互**：点击某类型 → `legendHighlightType` 设为该类型，非匹配节点 dimmed（2D: nodeCanvasObject 降低透明度; 3D: nodeColor 返回低透明度颜色）
  - 再次点击同类型或点击 "清除高亮筛选" → 取消高亮
- **状态**：`legendHighlightType: string | null`

### 性能考虑
- Legend 高亮通过 `nodeCanvasObject` 中的 dimmed 逻辑实现，与选中节点淡化逻辑复用
- 大图谱时 Legend 点击操作仅为 state 更新，不触发数据重新计算
- `nodeCanvasObject` 的 useCallback 依赖包含 `legendHighlightType`，确保 canvas 重绘

### 自测
- ✅ 右上角 Legend 显示当前画布所有类型 + 计数
- ✅ 点击类型高亮该类型节点，其他 dimmed
- ✅ 再点击取消高亮
- ✅ 折叠/展开状态刷新后保留（localStorage）
- ✅ 中英 i18n 正确

## 涉及文件
- `desktop-daemon/src/lib/relationship-styles.ts` — 新建，关系线样式定义
- `desktop-daemon/src/components/GraphViewer.tsx` — 节点 size、关系线样式、Legend 三处改造
- `desktop-daemon/src/locales/zh.ts` — 新增 3 个 legend 相关 key
- `desktop-daemon/src/locales/en.ts` — 新增 3 个 legend 相关 key

## 构建
`npm run build` 通过，TypeScript 类型检查通过。
