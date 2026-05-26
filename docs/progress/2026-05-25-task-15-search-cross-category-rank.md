# Task 15 Progress: 搜索结果跨类别按相关性排序

Date: 2026-05-26

## 改动概要

- **改动文件数**: 4 (useSearchMemory.ts, SearchPalette.tsx, en.ts, zh.ts)
- **核心变更**: 前端对 entity/archival/core 三类搜索结果统一打分排序，不再按类型简单拼接

## 实现方案

### 1. `useSearchMemory.ts` — 新增打分逻辑

**新增类型 `FlattenedSearchItem`**:
```typescript
{ type: "entity" | "archival" | "core", item: Entity | ArchivalSearchResult | CoreMemoryItem, score: number }
```

**打分规则**:
| 类别 | 条件 | score |
|------|------|-------|
| entity | name 完全匹配 | 1.0 |
| entity | name 包含 query | 0.85 |
| entity | description 包含 query | 0.6 |
| entity | tags 命中 | 0.5 |
| entity | 兜底 | 0.3 |
| archival | 直接用 `relevanceScore` | 0-1 |
| core | key 完全匹配 | 1.0 |
| core | value 文本包含 | 0.7 |
| core | 兜底 | 0.4 |

**排序**: score desc → 同分按 type 优先级 (entity > archival > core) 二级排序

**query 归一化**: 小写 + 去多余空格

### 2. `SearchPalette.tsx` — 消费 flattened 结果

- `flattenedItems` 中 entity/archival/core 的构建改为直接遍历 `results.flattened`
- 决策上下文 (principle/history/conflict) 不受影响，仍排在最前
- 空查询推荐逻辑不受影响
- 新增: score >= 0.85 的条目显示 `★ 高相关` 角标

### 3. Locale 新增 key

- `search.high_relevance`: 英文 "High" / 中文 "高相关"

## 验证

- `npm run build` 通过
- 决策模式: principle/history/conflict 仍排最前
- 空查询: "最近访问的实体" 推荐不变
- 有 query: 三类结果按 score 降序混合排列

## 验收对照

1. 搜 "GraphRAG" → entity 的 name 完全匹配得 1.0，排第一
2. 搜 archival 独有关键词 → archival 的 relevanceScore 排第一
3. 搜普通词 → 三类混合，按相关性顺序
4. 空查询 → 推荐"最近访问的实体"与之前一致
5. `npm run build` 通过
