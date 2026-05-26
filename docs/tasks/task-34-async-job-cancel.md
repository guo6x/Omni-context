# Task 34: 异步 job 取消

## 背景

[[task-13-upload-async-job-progress]] 把文件上传改成异步 job 模式，用户能看到 parsing / ocr / extracting / resolving / storing 五阶段进度。

但**没法中途取消**——上传一个 5MB PDF 走到 extracting 阶段才发现 LLM 配错了，只能干等几十秒到结束。

## 目标

加取消按钮和后端取消逻辑。

成功标准：

1. FileDropZone 任务列表中"running"状态的任务旁边显示一个 `×` 按钮
2. 点 × → 调 `POST /api/ingest/job/:jobId/cancel`
3. brain-server 检查 abort signal → 在下一个阶段检查点退出 → 标记 job 为 `cancelled`
4. UI 上 task 显示 `已取消`（灰色）

## 涉及文件

- `brain-server/src/api/handlers/ingest.ts`
  - `JobState` 加 `aborted?: boolean` 字段
  - `JobStatus` 加 `'cancelled'` 枚举
  - 新增路由 `POST /api/ingest/job/:jobId/cancel`：set `aborted = true`
  - `runIngestPipeline()` 在每个阶段前后检查 `job.aborted`：
    ```ts
    if (job.aborted) {
      updateJob(jobId, { status: 'cancelled', completedAt: Date.now() });
      return;
    }
    ```
  - 长操作（OCR / LLM extract）的 fetch 调用传入 AbortController，cancel 时 abort
- `desktop-daemon/src/components/FileDropZone.tsx`
  - task 上加 × 按钮（仅 running 状态显示）
  - 点击 → fetch `/api/ingest/job/:jobId/cancel` + 立刻 clearInterval（停止轮询）
  - status 渲染加 `cancelled` 分支：灰色 + Loader2 替换为 XCircle
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `upload.cancel`、`upload.cancelled`

## 约束

- 取消是**协作式**——pipeline 在阶段检查点检查 aborted flag，不是强 kill
- 不能保证立即中止——比如 LLM 调用进行中 → 等当前 fetch 超时或完成才检查
- 取消后**不要清理任何已写入数据库的数据**——如果 entity 已经入了，留着，下次重试时会 dedupe（resolveEntities 已有这能力）
- 取消接口的请求体可以是空（jobId 在 URL 路径里）
- × 按钮不要做太大，避免误点

## 验收标准

1. ✅ 上传一个大 PDF → task 列表显示进度 stage
2. ✅ task 旁边出现 × 按钮
3. ✅ 点 × → 立刻显示 "已取消" → brain-server 几秒内停止该 job 的进一步处理
4. ✅ `GET /api/ingest/job/:jobId` 显示 status='cancelled'
5. ✅ 已取消的 job 5 分钟后从 jobStore 自动清理（task-13 TTL）
6. ✅ 取消后数据库里如果有部分实体已写入，**保留**（不回滚）
7. ✅ `cd brain-server && npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-34-async-job-cancel.md`

## 不要做的事

- 不要做"撤销取消"（用户点了 × 就是取消了）
- 不要做 force kill / SIGKILL
- 不要做"取消后清理已写实体" —— 已写就是已写
- 不要在 LLM 调用内部做精细的 cancel hooks—— 等阶段检查点足够
