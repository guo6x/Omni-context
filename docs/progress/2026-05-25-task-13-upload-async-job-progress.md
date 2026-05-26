# Task 13: 文件上传改异步 + 进度追踪 — 进度记录

## 目标

将 `POST /api/ingest/file` 从同步阻塞（整个管线在一个 HTTP 请求内完成）改为异步 job + 轮询模式。

## 改动清单

### `brain-server/src/api/handlers/ingest.ts`

**Job Store**（内存 Map）：
- `JobState`: `{ jobId, status, stage?, filename, createdAt, completedAt?, result?, error? }`
- `status`: `'queued' | 'running' | 'success' | 'failed'`
- `stage`: `'parsing' | 'ocr' | 'extracting' | 'resolving' | 'storing' | 'done'`
- `createJob()`: 容量保护，超 100 个时清除最旧的 completed/failed jobs
- `getJob()`: 懒清理——completed 超过 5 分钟自动删并返回 null
- `updateJob()`: 原地更新 job 状态

**拆分路由**：
- `POST /api/ingest/file`: 校验入参 → `createJob()` → `setImmediate(runIngestPipeline)` → 立即返回 `{ jobId, status, filename }`
- `GET /api/ingest/job/:jobId`: 查 `getJob()`，返回 job 状态/阶段/结果/错误，过期返回 404

**`runIngestPipeline()`**: 原同步管线完整复制为 async function，每个阶段调 `updateJob()` 更新 stage，异常时 `FAIL(stage, error)`

### `desktop-daemon/src/components/FileDropZone.tsx`

- `FileTask` 新增 `jobId?`, `stage?` 字段
- 新增 `STAGE_LABELS` 中英文对照表
- `ingestOne` 改造：
  - POST 收到 `{ jobId }` → 启动 `setInterval(1000ms)` 轮询
  - `status === 'success'` → `clearInterval` + 显示实体/关系数
  - `status === 'failed'` → `clearInterval` + 显示错误
  - `status === 'queued' | 'running'` → 更新 stage（如 "OCR 识别中..."）
  - 404 → `clearInterval` + 显示"任务已过期"
- 列表渲染：processing 状态时在文件名旁显示 stage 文字

## 关键取舍

| 决策 | 理由 |
|------|------|
| 内存 Map 非持久化 | 单机长时间任务，重启丢 job 可接受；简单可靠 |
| `setImmediate` 而非 worker pool | brain-server 已是单进程，不需要额外复杂度 |
| 轮询 1s 不做退避 | 本地 HTTP，即使 100 并发也才 100rps，完全不构成负担 |
| 懒清理 | 无定时器开销，查 job 时顺带 TTL 检查 |
| 不实现取消 | MVP 范围，后续可按需加 |

## 自测结果

- `npx tsc --noEmit` (brain-server): 通过
- `npm run build` (brain-server): 通过
- `npm run build` (desktop-daemon): 通过

## 遗留问题

- 取消 job 功能留待后续 task
- 30s 超时警告未实现（可在后续单独 PR 加）
