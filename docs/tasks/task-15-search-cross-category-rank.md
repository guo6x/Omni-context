# Task 15: 搜索结果跨类别按相关性排序（P3）

## 背景

[desktop-daemon/src/components/SearchPalette.tsx:48-99](D:\AI_code\Omni-context\omni-context-release\desktop-daemon\src\components\SearchPalette.tsx) 的 `flattenedItems` 是按数据源类型简单拼接的：entity → archival → core。

archival 返回有 `relevanceScore`，但**没拿来跨类别排序**。用户搜"React"时，可能最相关的是 archival 里一段笔记，但被排在所有 entity 后面。

## 目标

把三类结果按相关性统一排序后展示，相关性高的优先。

成功标准：

1. archival 已有 `relevanceScore`（0-1 浮点数）
2. entity / core 没有显式分数，给一个映射规则推一个伪 score
3. 全部归一化到 0-1 区间，再 sort desc
4. 排序后**保留类型标记**（图标 / 颜色），让用户能识别每条来源
5. 用户搜"React"时，分数最高的（不论类型）排第一

## 涉及文件

- `desktop-daemon/src/hooks/useSearchMemory.ts`
  - 返回值结构调整：除了原有的三类数组，加一个 `flattened: Array<{ type, item, score }>` 字段，由 hook 计算
  - **打分规则**：
    - archival：直接用 `result.relevanceScore`
    - entity：name 完全匹配查询关键词 → 1.0；name 包含 → 0.85；description 包含 → 0.6；只是 tags 命中 → 0.5；都没有 → 0.3（兜底）
    - core：key 完全匹配 → 1.0；value 文本包含 → 0.7；其他 → 0.4
  - 用 query 字符串小写 + 去空格做匹配（避免大小写差异）
- `desktop-daemon/src/components/SearchPalette.tsx`
  - `flattenedItems` 改成直接消费 hook 提供的 `flattened` 字段
  - 每条 item 显示类型 badge（已有），可选：在分数 >= 0.85 时加 "⭐ 高相关" 角标

## 约束

- **不要改后端**——前端做排序就够
- 打分规则简单点，不要做复杂 NLP（TF-IDF 之类）
- entity 的打分要兼容**没有 query**的情况（推荐栏不用排序，按 access_count 排，保持现状）
- 空查询时的"最近访问推荐"逻辑保留，不进入新排序
- 排序稳定性：相同 score 时按 type 优先级（entity > archival > core）二级排序，避免每次结果顺序晃

## 验收标准

1. ✅ 搜 "GraphRAG"（已是项目里的实体名）→ 第一条就是这个 entity，score 接近 1.0
2. ✅ 搜一个 archival 里独有的关键词 → archival 排第一
3. ✅ 搜一个普通词 → 三类混合，按相关性顺序
4. ✅ 空查询 → 推荐"最近访问的实体"列表跟现在一样
5. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-15-search-cross-category-rank.md`

## 不要做的事

- 不要做后端语义打分（archival 已有 semantic score 够用了）
- 不要把打分算法做得太复杂，先简单规则上线再迭代
- 不要顺便改 SearchPalette 的展示样式
