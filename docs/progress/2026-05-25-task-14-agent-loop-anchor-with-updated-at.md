# Task 14: AgentLoop 锚点纳入 updated_at + 衰减洞见 — 进度记录

## 目标

A. 锚点从纯 id 拼接改为 id + updated_at，实体内容变化时锚点变化触发重新分析
B. 每 6 轮 cycle 检查记忆衰减，生成 decay_warning 通知

## 改动清单

### `brain-server/src/agent/agent-loop.ts`
- `AgentLoop` 构造函数新增可选 `decayScheduler?: MemoryDecayScheduler`
- 新增 `cycleCount` 计数器 + `DECAY_CHECK_INTERVAL = 6`
- **锚点计算**（runCycle）：
  - 旧：`e.id` join → 新：`${e.id}:${e.updated_at}` join
- **衰减洞见**（runCycle 末尾）：
  - 每 6 轮 → `decayScheduler.getMostDecayedItems(5)`
  - 生成 `type: 'decay_warning'` notification
  - 文案：列出每条记忆的名称、类型、未访问天数
  - try/catch 包裹，失败不打断主流程

### `brain-server/src/memory/decay-scheduler.ts`
- 新增 `getMostDecayedItems(limit)`：
  - 查询 `last_accessed < 7 days ago AND access_count > 0`
  - 按 `last_accessed ASC, access_count DESC` 排序
  - 返回 `{ id, name, type, last_accessed, access_count }`

### `brain-server/src/shared-types.ts`
- `NotificationType` 新增 `'decay_warning'`

### `brain-server/src/api/routes.ts`
- `ApiRouter` + `createServer` 新增可选 `decayScheduler` 参数（避免创建第二个实例）

### `brain-server/src/api-server.ts`
- 创建 `MemoryDecayScheduler` 并传递给 `AgentLoop` 和 `createServer`

## 关键取舍

| 决策 | 理由 |
|------|------|
| 衰减阈值用 `access_count > 0` 而非 `importance > 0.3` | entity 表无 importance 字段，access_count 是实用替代 |
| mcp-server 不传 decayScheduler | 独立入口，不需要 agent loop 的衰减洞见 |
| 每 6 轮（约 6 分钟）检查一次 | 避免通知刷屏，频率合理 |

## 自测结果

- `npx tsc --noEmit` (brain-server): 通过
- `npm run build` (brain-server): 通过
- `npm run build` (desktop-daemon): 通过

## 遗留问题

- 无
