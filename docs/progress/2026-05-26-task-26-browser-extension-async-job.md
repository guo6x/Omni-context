# Task 26 Progress: 浏览器扩展适配异步 job 协议

**日期**: 2026-05-26

## 现有结构梳理

`browser-extension/` 三个 JS 文件各司其职:

| 文件 | 职责 |
|---|---|
| `content.js` | 注入页面,提供 `GET_PAGE_CONTENT` / `GET_SELECTION` 响应 |
| `popup.js` | popup 窗口 UI,通过 `chrome.runtime.sendMessage` 触发 capture |
| `background.js` | service worker,处理消息、右键菜单、API 调用 |

旧 `background.js` 直接把文本 POST 到 `/api/graph/extract`,等同步返回 `response.ok` 就弹通知。task-13 把这个端点变成了异步 job 模式,PATH 也改成了 `/api/ingest/file` → 旧逻辑直接断。

## 选型: setInterval vs chrome.alarms

| | setInterval | chrome.alarms |
|---|---|---|
| SW unload 后恢复 | ❌ 丢失 | ✅ alarm 持久化,唤醒 SW |
| MV3 兼容 | ⚠️ SW 可能被终止 | ✅ 标准做法 |
| 最小间隔 | 无限制 | 开发模式 ~1s |

**结论**: 用 `chrome.alarms`,理由:
- 需求明确要求 SW unload 后恢复轮询
- 项目已有 `omni-context-health` alarm (`periodInMinutes: 0.5`),模式一致
- 合并到同一个 `onAlarm` listener,按 alarm name 前缀路由

## SW unload 后如何恢复

1. 提交 job 时,`chrome.storage.local` 存入 `{ pendingJobs: { [jobId]: { filename, startedAt } } }`
2. SW 启动时,`recoverPendingJobs()` 读 `storage.local`,为每个 pending jobId 重建 alarm
3. 不存 base64(太大+隐私)
4. job 完成/失败/超时后,从 storage 删除对应条目并清除 alarm

## 变更清单

### `background.js`
- 删除旧 `sendToBrainServer()` (POST `/api/graph/extract`)
- 新增 `submitAndPoll()` → POST `/api/ingest/file` → 获取 jobId → 建 alarm
- 新增 `handlePoll()` → GET `/api/ingest/job/:jobId` → 成功/失败/超时分支
- 新增 `textToBase64()` (UTF-8 safe, TextEncoder)
- 新增 `sanitizeFilename()` (去掉非法字符)
- 新增 `getPendingJobs()` / `trackPendingJob()` / `untrackPendingJob()` (chrome.storage.local)
- 合并 health + poll 到一个 `chrome.alarms.onAlarm` listener
- `capturePage()` / `captureSelection()` 改为调用 `submitAndPoll()`
- 添加 `recoverPendingJobs()` IIFE 在 SW 启动时恢复

### `popup.js`
- toast: `"网页已沉淀入大脑！"` → `"已提交"`
- toast: `"选中内容已沉淀！"` → `"已提交"`
- 实际结果通过 `chrome.notifications` 系统通知展示(popup 关闭后仍可见)

### 未修改
- `content.js` — 仍只提供内容,不调 API
- `manifest.json` — 已有 `alarms` 权限

## 自测

**环境**: Chrome 131 (MV3), brain-server 运行在 localhost:3001

| 场景 | 预期 | 结果 |
|---|---|---|
| 右键 Capture this page | 系统通知"沉淀完成: 已抽取 N 实体 / M 关系" | ⬜ |
| popup 点 capturePageBtn | popup toast "已提交" → 系统通知结果 | ⬜ |
| popup 点 captureSelectionBtn | popup toast "已提交" → 系统通知结果 | ⬜ |
| 关掉 brain-server 后提交 | 系统通知"提交失败" | ⬜ |
| 提交后 30 秒未完成 | 系统通知"处理超时: 任务仍在后台处理" | ⬜ |
| SW 被 unload 后重新加载 | pending job 恢复轮询,不丢结果 | ⬜ |

## Edge MV3 兼容性

chrome.alarms / chrome.storage.local / chrome.notifications 均为 Edge MV3 支持的 API,无需额外适配。
