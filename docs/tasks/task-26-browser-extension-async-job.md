# Task 26: 浏览器扩展适配 task-13 异步 job 新协议

## 背景

[[task-13-upload-async-job-progress]] 把 `POST /api/ingest/file` 从"同步返回完整结果"改成了"立刻返回 jobId，结果走 `GET /api/ingest/job/:jobId` 轮询"。

桌面端 `FileDropZone.tsx` 已经配套改了，但 `browser-extension/` 走的还是老协议——**会断**。用户从浏览器右键沉淀网页 → 老逻辑期望 `response.entities` 直接拿到 → 实际响应是 `{ jobId, status, filename }` → JS 拿不到 entities → toast 显示 0 实体或 NaN。

## 目标

让浏览器扩展跟桌面端走同一套异步 job + 轮询协议。

成功标准：

1. 右键沉淀当前页 / popup 点"发送到 Omni" → 立刻显示 toast "已提交"
2. 后台轮询 job 状态，完成后 toast 显示 "已抽取 N 实体 / M 关系"
3. 失败 / 超时（30 秒未完成）→ toast 显示错误

## 涉及文件

- `browser-extension/` 下相关文件（看现有结构，可能是 `background.js` / `popup.js` / `service_worker.js`）
  - 先 `Read` 现状再改
- 协议层：保持跟桌面端一致
  - POST `/api/ingest/file` body: `{ filename, contentType, base64 }`
  - 收到 `{ jobId }` → 启动 `setInterval(1000ms)` GET `/api/ingest/job/:jobId`
  - 浏览器扩展 MV3 service worker 可能没有持续 setInterval 能力 → 用 `chrome.alarms` API 实现轮询
  - 完成后清除 alarm，显示结果

## 约束

- **不要改 brain-server 端协议** —— 桌面端已经按新协议工作
- service worker 生命周期受 MV3 限制（可能被 unload）—— 用 `chrome.alarms` 是标准做法
- 轮询超时设 30 秒，超时后 toast 警告"任务仍在后台处理，请稍后在桌面应用查看图谱"
- 不引入新的第三方库（fetch + chrome API 够用）
- 兼容 Chrome MV3 + Edge MV3，Firefox MV2 兼容性如果原本就有就保留

## 验收标准

1. ✅ 在 Chrome 装扩展 → 右键页面"发送到 Omni-Context" → 提交 toast 立刻出现
2. ✅ 等 5-10 秒看到 "已抽取 X 实体 / Y 关系" toast
3. ✅ 故意关掉 brain-server → 提交后看到 "任务失败" 或连接错误 toast
4. ✅ service worker 被浏览器 unload 再 reload 后，未完成的轮询能恢复（用 chrome.alarms 持久化 jobId）
5. ✅ 没有把 base64 写到 localStorage / chrome.storage（base64 太大 + 隐私）

## 进度文档

`docs/progress/2026-05-26-task-26-browser-extension-async-job.md`

包含：
- 现有 browser-extension 代码结构梳理
- 新轮询循环用 setInterval 还是 chrome.alarms 的选型
- service worker unload 后 job 状态如何恢复（chrome.storage.local 存 pending jobIds）
- 自测：Chrome MV3 + Edge 实测，Firefox 标称兼容（如果之前就标称）

## 不要做的事

- 不要顺手改 popup UI 样式
- 不要做"实时进度条"——toast 提交 + 完成两次提示就够
- 不要把 jobId 存到 chrome.storage.sync（local 即可，sync 不需要）
- 不要在扩展里塞 LLM 配置 / 直连——所有调用都走 brain-server
