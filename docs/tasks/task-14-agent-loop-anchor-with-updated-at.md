# Task 14: AgentLoop 锚点纳入 updated_at + 衰减洞见（P3）

## 背景

[brain-server/src/agent/agent-loop.ts:154-199](D:\AI_code\Omni-context\omni-context-release\brain-server\src\agent\agent-loop.ts) 当前的 runCycle：

```ts
const anchorKey = recentEntities
  .map(e => e.id)
  .sort()
  .join('|');
if (this.lastAnchorKey === anchorKey && now - this.lastAnchorAt < this.anchorRefreshMs) {
  return;  // 跳过
}
```

锚点只用 entity.id 拼接，去重窗口 30 分钟。**问题**：

- 用户一直在编辑同一组实体（更新描述 / 加 tag）→ ID 没变 → 锚点不变 → 30 分钟内不会产生新洞见
- 实际上内容变了应该重新分析

且洞见类型当前只有 "隐藏联系"，但 brain-server 有 [MemoryDecayScheduler](D:\AI_code\Omni-context\omni-context-release\brain-server\src\memory\decay-scheduler.ts) 数据，可以生成"记忆衰减预警"。

## 目标

两个改进：

### A. 锚点纳入 updated_at

锚点拼接改成 `entity.id + ':' + entity.updated_at`，实体内容更新时锚点变化、能触发新一轮分析。

### B. 增加"记忆衰减预警"洞见类型

每 N 轮 cycle（比如 6 轮，约 6 分钟）调用一次 `MemoryDecayScheduler` 的查询接口，找出衰减最严重的几条记忆，作为一条 `'decay_warning'` 类型的 notification 推到前端。

## 涉及文件

- `brain-server/src/agent/agent-loop.ts`
  - 改 `anchorKey` 计算
  - 加 `cycleCount` 计数器，每 6 轮触发一次衰减分析
  - 衰减分析逻辑：`decayScheduler.getMostDecayedItems(limit: 5)` → 如果有结果，生成 notification 文案（"以下记忆 7 天未访问，可能值得回顾：..."）→ 走 `db.addNotification` 流程
- `brain-server/src/memory/decay-scheduler.ts`
  - 如果没有"取衰减 Top N"方法，新增一个 `getMostDecayedItems(limit: number)`（按 last_accessed 升序 + importance 降序简单排）
  - 不要改衰减算法本身

## 约束

- 不动 cycle 的 60 秒默认周期
- `anchorRefreshMs` 默认 30 分钟保持不变（updated_at 加入后已经自然解决"内容变化触发"问题）
- 衰减洞见**不要每轮都生成**——6 轮一次足够，否则通知会刷屏
- 不要做衰减阈值的复杂可调——MVP 先按"7 天未访问 + importance > 0.3" 兜底
- notification 类型 `'decay_warning'` 是新的，前端 InsightsInbox 组件展示时按 'insight' 同样样式展示就行，不必专门做 UI

## 验收标准

1. ✅ 抓一个实体进库 → 立刻改它的 description → 30 分钟内 AgentLoop 能感知到 updated_at 变化，下个 cycle 跑 LLM 分析
2. ✅ 库里有 5 个 7 天前的实体 → 6 轮 cycle 后产生一条 `decay_warning` 通知
3. ✅ 衰减分析失败不影响主洞见流程
4. ✅ `cd brain-server && npx tsc --noEmit` 通过

## 进度文档

`docs/progress/2026-05-25-task-14-agent-loop-anchor-with-updated-at.md`

## 不要做的事

- 不要改 cycle 默认周期
- 不要给 decay_warning 单独做 UI 组件——复用现有 insight 通知样式
- 不要纳入更多锚点维度（如 tags hash）——updated_at 已经够
