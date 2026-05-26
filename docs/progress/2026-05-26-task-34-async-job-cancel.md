# Task 34: 异步 job 取消 — 进度记录

## 完成时间

2026-05-26

## 改动文件

### brain-server/src/api/handlers/ingest.ts

- `JobStatus` 加 `'cancelled'` 枚举
- `JobState` 加 `aborted?: boolean` 字段
- 新增 `CHECK_ABORT()` / `CANCEL()` 辅助函数，在 pipeline 各阶段检查点调用
- 阶段检查点：parsing 前、extracting 前、resolving 前、storing 前
- 新增 `POST /api/ingest/job/:jobId/cancel` 路由：设置 `job.aborted = true`，仅 running/queued 可取消
- `getJob()` 和 `createJob()` 容量清理同步纳入 `cancelled` 状态

### desktop-daemon/src/components/FileDropZone.tsx

- `Status` 类型加 `'cancelled'`
- 新增 `intervalsRef` 存储每个 task 的轮询 interval ID
- 轮询新增 `job.status === 'cancelled'` 分支：清除 interval，渲染已取消状态
- 所有 `clearInterval` 处同步 `intervalsRef.current.delete(taskId)`
- 新增 `handleCancel(taskId, jobId)`：立即停止轮询 + 更新 UI + fire-and-forget 调 cancel 接口
- running 状态且有 jobId 的 task 渲染 `×` 按钮（hover 变红，小尺寸防误点）
- 已取消 task：灰色背景/文字，`XCircle` 图标

### desktop-daemon/src/locales/zh.ts / en.ts

- 加 `upload.cancel`：`'取消'` / `'Cancel'`
- 加 `upload.cancelled`：`'已取消'` / `'Cancelled'`

## 验收

| 标准 | 状态 |
|------|------|
| `cd brain-server && npm run build` 通过 | ✅ |
| running 任务显示 × 按钮 | ✅ |
| 点 × → 调 POST /cancel → pipeline 在下一检查点退出 | ✅ |
| 取消后 job 显示 status='cancelled' | ✅ |
| 已取消 job 5 分钟后 TTL 自动清理 | ✅ |
| 已写入实体不清理 | ✅ |
| 取消接口只允许 running/queued（409 保护） | ✅ |

## 设计决策

- 未做 AbortController 传参：OCR 是本地库调用，LLM extract 是内部方法，等阶段检查点退出足够
- 已取消任务在 UI 立即生效（先清 interval 再发 cancel 请求），不等待后端确认
- cancel 按钮用原生 `×` 字符而非图标库，保持小尺寸
