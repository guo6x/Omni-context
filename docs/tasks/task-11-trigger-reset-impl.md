# Task 11: triggerReset 实装真功能（P1）

## 背景

[desktop-daemon/src/hooks/useOmniContext.ts:98-101](D:\AI_code\Omni-context\omni-context-release\desktop-daemon\src\hooks\useOmniContext.ts)：

```ts
const triggerReset = useCallback(() => {
  addLog("触发重置操作", "warning");
  console.log("重置操作已触发");
}, [addLog]);
```

而 page.tsx 里 `handleReset` 还跟 handlePrecipitate 一样跑完整的 HUD "处理中→成功"动画。用户按了"重置"看到成功提示，**实际上什么都没做**。

## 目标

要么真的实现"重置"，要么暂时隐藏入口。

经过权衡：**实现轻量的"会话重置"**，把当前桌面 App 的 UI 内存状态清空（搜索历史、HUD 状态、临时缓存、当前选中的图谱节点），**不动数据库 / 图谱内容**。

为什么不重置数据库：用户没有"清空所有记忆"的强需求，且这个操作不可逆，应该单独做一个带二次确认的"清空所有数据"按钮（后面 Task 单独提，本任务不做）。

## 目标行为

1. 按"重置"快捷键 / 按钮 → 清空：
   - 搜索浮层的查询字符串 / 结果缓存
   - 当前选中的图谱节点 (`selectedNode` / `focusEntityId`)
   - HUD 显示状态（隐藏 HUD）
   - 日志栏的当前条目（保留最近 3 条作为"系统启动"基线）
2. HUD 显示"已重置当前会话"
3. **不要清数据库**、不要刷新页面、不要重启 brain-server

## 涉及文件

- `desktop-daemon/src/hooks/useOmniContext.ts`
  - 修改 `triggerReset`：暴露给外部的能力扩展为可清空 `logs`（除了最近 3 条系统启动日志）+ 返回 `Promise<{ ok: true }>`
- `desktop-daemon/src/app/page.tsx`
  - `handleReset` 改造：
    - 清掉 `selectedNode`、`focusEntityId`、`searchPalette` 相关 state
    - 关闭 HUD 浮层（如果开着）
    - 调 `triggerReset()` 清日志
    - HUD 显示"已重置当前会话"（绿色，1.5s 后自动隐藏不论 autoHUD）
  - 删除原来 1.5s 写死的 setTimeout 假动作
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `hud.reset_done` = "已重置当前会话" / "Session reset"

## 约束

- **绝对不要触发任何破坏数据的操作**（不要 DELETE 实体、不要 truncate 表、不要清 archival memory）
- 不要在 brain-server 加任何重置端点——这一轮全在前端做
- 重置后用户**仍能立刻使用沉淀 / 搜索**，没有"半秒空白期"
- 不要循环依赖：useOmniContext 现在的 `setStatus` / `setLogs` 都在 hook 内部，本任务只是让 reset 真的去调它们

## 验收标准

1. ✅ 选中图谱里某个节点 → 按重置 → 节点取消选中 / 高亮消失
2. ✅ 打开搜索浮层输了点字 → 按重置 → 浮层 query 清空（如果浮层关了就不动）
3. ✅ 日志栏里有十几条记录 → 按重置 → 只剩 3 条系统启动基线 + 1 条"已重置"
4. ✅ HUD 显示"已重置当前会话"（绿色），1.5s 后自动消失
5. ✅ 重置后立刻按沉淀仍然能用
6. ✅ 重置后**图谱节点和关系数量不变**（数据库未动）
7. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-11-trigger-reset-impl.md`

## 不要做的事

- 不要做"清空所有数据"功能（那是另一个独立 task，要带二次确认 + 数据导出建议）
- 不要顺手改 handlePrecipitate / handleDecision
- 不要在 reset 后强制刷新整个图谱画布（性能/感知差）
