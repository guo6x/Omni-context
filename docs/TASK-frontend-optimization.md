# 任务：浏览器插件 + 移动端可靠性优化

状态：待开始
负责人：外部 AI
指挥/审查：本人（通过本文档下达，进度走 `docs/PROGRESS-frontend-optimization.md`）
创建日期：2026-06-18

---

## 0. 给执行者的话

- 这是**可靠性/体验修复**，不是加功能、不是重构。逐条按下面改，不要扩散到无关代码。
- 改动前先读懂相关文件，尤其 `browser-extension/background.js` 的轮询逻辑。
- 用中文写注释（与现有风格一致），conventional commit。
- 进度写进 `docs/PROGRESS-frontend-optimization.md`（格式见末尾）。
- **只许 commit，不许 push**；改完置"待审查"，我审完再决定打包/推送。
- 移动端改动你这边无法出 APK 也没关系，代码改对、typecheck 过即可，APK 由指挥侧出。

---

## 1. 背景

跨 AI 本地记忆是产品命脉，而"浏览器插件捕获对话 → 立刻确认生效"是核心闭环。当前这个闭环有几处可靠性缺陷会让用户误以为"没生效/坏了"。本任务集中修这些，不动产品形态。

---

## 2. 浏览器插件改动（主，按优先级）

### P0 — 捕获反馈被 Chrome 闹钟钳制坑了（必须修）

文件：`browser-extension/background.js`

现状：
- `submitAndPoll`（约 194 行）提交后用 `chrome.alarms.create(`poll-${jobId}`, { periodInMinutes: 1/60 })` 想"每秒轮询一次"。
- 但 **Chrome MV3 会把闹钟周期强制钳到最小 ~30 秒**，`1/60` 分钟（1 秒）不被尊重。
- 同时 `JOB_TIMEOUT_MS = 30000`（30 秒）。第一次轮询（~30s）恰好撞上超时线。

后果：
- 抽取稍慢（LLM + embedding 容易 >30s）就误报"处理超时"，哪怕实际成功。
- 即便秒级完成，用户也要等约 30 秒才看到"✓ 沉淀完成"，体感像坏了。

修法（在 SW 内做快轮询，闹钟仅作兜底）：

1. 把 `handlePoll` 里"查询一次任务状态并据此通知/清理"的逻辑抽成一个可复用函数（例如 `pollOnce(jobId): Promise<'done'|'pending'|'gone'>`），`handlePoll` 调它。
2. `submitAndPoll` 拿到 `jobId` 后，**立即在 SW 内启动 setTimeout 自轮询**：每 ~1.5s 调一次 `pollOnce`，直到返回 `done`/`gone` 或累计到上限（建议 ~25s）。命中即给"✓ 沉淀完成"通知。
3. **闹钟保留作兜底**（SW 在长任务期间可能被回收，setTimeout 会随之失效，闹钟能唤醒 SW 续查），但把周期改为合理值（如 `periodInMinutes: 1`），别再写 `1/60`。
4. 把 `JOB_TIMEOUT_MS` 提到合理值（建议 `5 * 60 * 1000`，5 分钟），让"仍在后台处理"提示只在真的很久才出现。
5. **防重复通知**：`pollOnce` 在通知/清理前必须先确认 `jobs[jobId]` 仍存在；完成后 `untrackPendingJob` + `chrome.alarms.clear`。这样快轮询先完成并清理后，兜底闹钟再触发时 `pollOnce` 查不到 job 即静默清自己（现有 `if (!jobInfo) clear & return` 已具备此语义，复用即可）。

验收：
- 本地起桌面端，用插件捕获一段对话；秒级完成的任务应在 **数秒内**（非 30s）弹出"✓ 沉淀完成 N 实体/M 关系"。
- 人为让抽取耗时 >30s（可临时在服务端 mock，或用大段文本）不再误报"处理超时"。
- SW 被回收的极端情况下（可在 chrome://extensions 手动 terminate service worker），仍能靠闹钟最终给出完成/失败通知，且不重复通知。

### P1 — token 变更不生效（必须修）

文件：`browser-extension/background.js`

现状：`cachedToken`（约 9 行）首次读出后永不失效。用户重新配对/重置 token 后，后台仍用旧 token，捕获静默失败，直到 SW 重启。

修法：新增 `chrome.storage.onChanged` 监听，`local` 区的 `localApiToken` 变化时刷新 `cachedToken`：

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.localApiToken) {
    cachedToken = changes.localApiToken.newValue || null;
  }
});
```

验收：在 popup 改 token 后，无需重载扩展，下一次捕获即用新 token（可用错误 token → 正确 token 切换验证连通从失败转成功）。

### P2 — `localhost` 改 `127.0.0.1`（建议修）

文件：`browser-extension/background.js:2`、`browser-extension/popup.js:2`

现状：两处 `API_BASE = 'http://localhost:3001'`。Windows 上 `localhost` 可能先解析到 IPv6 `::1`，而 brain-server 走 IPv4，导致首连变慢/偶发失败。系统其它部分（MCP 代理）统一用 `127.0.0.1`。

修法：两处改为 `http://127.0.0.1:3001`。

验收：插件功能不变；连通更稳。`grep` 确认插件内无其它 `localhost:3001` 残留。

---

## 3. 移动端改动（次，按优先级）

### M1 — 同步逐条串行上传，首次同步很慢

文件：`mobile-app/src/services/syncService.ts:73-81`（`sync()`）

现状：`for (const entity of unsynced) { await api.addEntity(entity); ... }` —— 串行，N 条就是 N 次往返。首次同步几百上千条会非常慢。

修法（按此顺序判断）：
1. **先确认服务端有没有批量写入实体的接口**（查 `brain-server` 的 ingest/entity 路由 + `mobile-app/src/services/api.ts`）。有就走批量，单请求提交多条。
2. 若无批量接口：改为**有界并发**（并发池，如同时 5 条），而非一次性 `Promise.all` 全发（避免压垮本地服务端）。
3. **保持现有"逐条成功才标 synced、单条失败不阻塞其他"的语义**——不能因为并发就把整批一起标记成功。失败的留 unsynced，下次重试。

非目标：不引入新依赖做并发池，用简单的分批/计数即可。

验收：构造 ≥100 条未同步实体，同步耗时显著下降；失败条目仍保持 unsynced；`updatePendingCount` 结果正确。

### M2 — 拉取只取 1000 条（先确认意图，不要盲改）

文件：`mobile-app/src/services/syncService.ts:106`（`api.getEntities({ limit: 1000 })`）

现状：写死 1000。真实库已 1 万+，移动端只会看到一部分。

要求：**先在进度文档里提出**——这是有意的移动端上限（性能考虑）还是缺陷？
- 若是有意上限：保持，但在代码加一行注释说明，并确认 UI 有"仅显示部分"的合理表现，不误导。
- 若应镜像全量：改为分页拉取（循环按 offset 取直到取完），注意移动端内存与本地库写入性能。

非目标：在没和指挥确认前，不要直接把 1000 改成大数或全量。

---

## 4. 明确非目标

- 不动桌面端（本任务不含）。
- 不改插件/移动端的 UI 形态、不加新功能、不加新页面。
- 不引入新依赖。
- 不动 `manifest.json` 权限。
- 不碰检索精度任务涉及的 brain-server 代码。

---

## 5. 测试与验证

- 浏览器插件：在 chrome://extensions 加载未打包版本，按各条"验收"人工验证（插件无单测，靠人工冒烟 + 在进度文档贴结果/截图说明）。
- 移动端：`mobile-app` 跑 `npm run typecheck` 必须通过；M1 的同步逻辑若能加轻量单测更好（非强制）。
- 不得引入 typecheck/lint 报错。

---

## 6. 风险与回滚

| 风险 | 处理 |
|---|---|
| 快轮询 + 闹钟双通知 | 按 P0 第 5 点用 job 存在性做幂等护栏 |
| SW 被回收导致 setTimeout 轮询中断 | 闹钟兜底，超时提到 5 分钟 |
| 移动端并发压垮本地服务端 | 有界并发（≤5），不要无限 Promise.all |
| `127.0.0.1` 改动影响某些环境 | 仅本地回环，风险极低；如有 LAN 场景另说（本任务只动插件→本机的连接） |

回滚：改动集中在 `background.js`、`popup.js`、`syncService.ts`，无 schema/无数据迁移，`git revert` 对应 commit 即可。

---

## 7. 进度文档要求

在 `docs/PROGRESS-frontend-optimization.md` 持续更新：

```
# 进度：浏览器插件 + 移动端可靠性优化

## 当前状态
（待开始 / 进行中 / 待审查 / 已完成）

## 已完成
- [ ] P0 SW 快轮询 + 闹钟兜底 + 超时调整 + 防重复通知
- [ ] P1 token onChanged 刷新
- [ ] P2 localhost -> 127.0.0.1（两处）
- [ ] M1 同步批量/有界并发（先查批接口，结论：____）
- [ ] M2 拉取上限意图确认（结论：____）
- [ ] typecheck 通过（结果贴下面）

## 关键决策记录
（偏离本文档的设计选择，写明理由）

## 验证结果
（插件人工冒烟结果；mobile typecheck 输出）

## 待确认（留给指挥）
（M2 等需要我拍板的点）

## 改动文件清单
（file -> 改了什么）
```

完成置"待审查"，**不要 push**，等我审查。
