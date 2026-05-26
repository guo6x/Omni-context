# Task 13: 文件上传改异步 + 进度追踪（P2）

## 背景

[brain-server/src/api/handlers/ingest.ts](D:\AI_code\Omni-context\omni-context-release\brain-server\src\api\handlers\ingest.ts) 当前在一个 HTTP 请求里**同步完成**：解析文件 → OCR / PDF / Office → LLM 抽取实体 → 实体消解 → 冲突检测 → embedding 生成 → 落库 → 返回。

大文件（PDF / EPUB）+ LLM 慢的话，这一条请求要跑十几秒到几十秒。前端 FileDropZone 只显示"上传中"spinner，**用户不知道当前卡在 OCR、LLM 还是入库**，超时也只能干等。

## 目标

把 ingest 改成"异步 job + 进度查询"模型。

成功标准：

1. `POST /api/ingest/file` 立刻返回（< 200ms）：`{ jobId, status: 'queued', filename }`
2. 后台异步跑完整管线，每个阶段更新 job 状态
3. 新增 `GET /api/ingest/job/:jobId`：返回 `{ status, stage, progress, result?, error? }`
   - status: `'queued' | 'running' | 'success' | 'failed'`
   - stage: `'parsing' | 'ocr' | 'extracting' | 'resolving' | 'storing' | 'done'`
4. 前端 FileDropZone 上传后开始轮询（每 1s 一次），显示当前 stage 文字 + spinner
5. 完成 / 失败时停止轮询，显示最终结果（实体数 / 关系数 / 错误信息）

## 涉及文件

- `brain-server/src/api/handlers/ingest.ts`
  - 把现在的 handler 拆成 `handleIngestSubmit`（立刻返回 jobId）和 `handleIngestQuery`（查询状态）
  - 把同步管线包到一个 async function 里，`setImmediate` 启动，不等
  - **不需要持久化 job 状态**——内存 Map 够用（用 UUID key）。下次重启 brain-server 任务就丢了，但这本来就是单机长时间任务，可以接受
  - 加自动清理：成功 / 失败的 job 状态保留 5 分钟后从 Map 里删
- `brain-server/src/api/routes.ts`
  - 注册新路由 `POST /api/ingest/file`（改成 submit）和 `GET /api/ingest/job/:jobId`
- `desktop-daemon/src/components/FileDropZone.tsx`
  - `ingestOne` 改造：
    - POST 收到 jobId → 进入 `'running'` 状态
    - 启动 `setInterval` 每 1 秒 GET `/api/ingest/job/:jobId`
    - 更新 task 显示：`{ stage }`（如"OCR 识别中..." / "LLM 抽取中..."）
    - status === 'success' → 显示成功 + 实体数；'failed' → 显示错误
    - 任何一步停止轮询都要 clearInterval
  - 30 秒还没完成 → 显示警告但不中止（用户可以选择手动取消，加一个 X 按钮发请求让后端取消）

## 约束

- **brain-server 不能依赖外部消息队列**——用内存 Map，简单可靠
- 多个并发 job：用 Map 存就行，brain-server 内部已有的处理是单进程，不需要 worker pool
- 内存 Map 容量保护：超过 100 个 job 时自动清理最旧的
- job ID 用 `uuid.v4()`
- **请求体仍然是现在的 `{ filename, contentType, base64 }`** —— 协议不变，只是返回从"完整结果"变成"jobId"
- 前端轮询要带"指数退避"防止 brain-server 被请求洪水冲掉？**不用**——单机本地 HTTP，1s 一次 100 个文件也才 100rps，OK
- **取消 job 不必本期实现**——MVP 先做提交 + 查询

## 验收标准

1. ✅ 上传一个小 .md 文件 → 1-2 秒看到成功
2. ✅ 上传一个大 PDF（5MB+）→ 上传任务里依次显示"解析中 → 抽取中 → 入库中 → 成功"
3. ✅ 上传一个图片（走 OCR）→ 进度显示"OCR 识别中..."阶段
4. ✅ LLM 配错时 → 进度走到"LLM 抽取中"后失败 → 显示具体错误
5. ✅ 同时拖 5 个文件 → 5 个 task 各自显示自己的进度
6. ✅ 5 分钟后查询已完成的 jobId → 返回 404（已清理）
7. ✅ `npm run build` + `tsc --noEmit` 通过

## 进度文档

`docs/progress/2026-05-25-task-13-upload-async-job-progress.md`

## 不要做的事

- 不要把 job 状态搞成持久化（不需要跨重启）
- 不要做 WebSocket 推送——HTTP 轮询够用，简单可靠
- 不要为了"漂亮"做精确百分比进度条——按 stage 文字提示就够
- 不要顺便重写 ingest 整个管线
