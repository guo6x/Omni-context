# Frontend Optimization Progress

## 状态

待审查

## 已完成

- [x] 修复浏览器插件 MV3 alarm 快轮询问题：提交任务后先在 service worker 存活期内快速轮询，alarm 保留为 1 分钟兜底。
- [x] 将插件任务超时从 30 秒调整为 5 分钟，避免长任务被过早判定超时。
- [x] 抽出 `pollOnce(jobId)`，统一处理成功、失败、过期、超时和 pending 状态。
- [x] 避免任务完成后的重复通知：每次轮询先检查 pending job 是否仍存在，完成后清理 pending job 和 alarm。
- [x] 为浏览器插件 token 缓存添加 `chrome.storage.onChanged` 监听，`localApiToken` 变化后立即刷新缓存。
- [x] 将浏览器插件 `API_BASE` 从 `localhost` 改为 `127.0.0.1`。
- [x] 移动端上传未同步实体从串行改为最多 5 个并发。
- [x] 移动端同步仍保持逐条成功标记：上传成功才 `markEntitySynced`，失败项继续保留为 unsynced。

## 关键判断

- 没有发现现成的实体批量写入接口。移动端 `mobile-app/src/services/api.ts` 只有 `addEntity(entity)` 对应 `POST /api/entities`，服务端路由也只看到单条实体写入路径，因此本轮按任务要求采用有界并发，而不是自行新增 batch API。
- `pullFromServer()` 的 `api.getEntities({ limit: 1000 })` 暂未修改。这个上限可能是移动端性能保护，也可能是同步完整性缺陷；同时 `api.getKnowledgeGraph()` 内部也存在实体 1000 / 关系 2000 的拉取上限，需要一起确认分页和图谱规模策略。

## 指挥裁定

- M2：已裁定为**有意的移动端上限**（性能保护，全量图谱在桌面端）。保持 1000 不动，已在 `pullFromServer` 加注释说明。不做分页。
- server batch endpoint：本轮不补；有界并发已够，留作后续按需。

## 待确认

- 浏览器插件仍需要在 Chrome 扩展环境里手动 smoke test：提交页面、任务成功通知、任务失败通知、token 修改后立即生效。（指挥侧重打包 zip 后验。）

## 修改文件

- `browser-extension/background.js`
- `browser-extension/popup.js`
- `mobile-app/src/services/syncService.ts`

## 验证

- 通过：`browser-extension` 执行 `npm run build`。
- 通过：`mobile-app` 执行 `npm run typecheck`。
- 通过：`browser-extension/*.js` 未再发现 `localhost:3001`。
- 未执行：Chrome 扩展手动 smoke test，需要在浏览器扩展环境中验证通知和 token 刷新行为。
