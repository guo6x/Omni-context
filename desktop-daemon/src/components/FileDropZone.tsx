'use client';

import React, { useCallback, useEffect, useRef, useState, useImperativeHandle } from 'react';
import { UploadCloud, FileText, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useTranslation } from '@/hooks/useTranslation';
import { IngestJobError, pollIngestJob, summarizeIngestJob } from '@/lib/ingest-job';
import {
  clearPersistedImportAttempt, createImportRecoveryAttemptId,
  getPendingImportJobs, persistImportJob, persistUncertainImport,
} from '@/lib/import-job-recovery';
import {
  acknowledgeImportRecovery,
  createImportSubmission,
  fingerprintImportContent,
  releaseImportContentReservation,
  reserveImportContent,
  settleImportOutcome,
  updateImportContentReservation,
} from '@/lib/import-submission';

export const ACCEPTED_EXTENSIONS = [
  '.md', '.txt', '.json', '.csv', '.pdf', '.html', '.htm',
  '.docx', '.xlsx', '.pptx', '.epub',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.rs', '.go', '.java', '.kt', '.swift',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.lua', '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.toml', '.xml', '.ini', '.env'
];

const ACCEPTED_TYPES = [
  ...ACCEPTED_EXTENSIONS,
  'text/plain', 'text/markdown', 'text/html', 'text/csv',
  'application/json', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/epub+zip',
].join(',');

// 与 brain-server 的 MAX_INGEST_BYTES 对齐（解码后 30MB）；base64 膨胀 ~33% 后约 40MB，仍在 MAX_BODY_BYTES(45MB) 内
const MAX_BYTES = 30 * 1024 * 1024;

export class TauriFileLike {
  name: string;
  size: number;
  type: string;
  private path: string;

  constructor(name: string, size: number, path: string) {
    this.name = name;
    this.size = size;
    this.path = path;
    this.type = "";
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const { readBinaryFile } = await import("@tauri-apps/api/fs");
    const uint8 = await readBinaryFile(this.path);
    return uint8.buffer as ArrayBuffer;
  }

  get uploadKey(): string {
    return `tauri:${this.path}:${this.size}`;
  }
}

export interface IngestResult {
  filename: string;
  entities: number;
  relationships: number;
  principles: number;
  archivalId: string;
  summary: string;
  partial?: boolean;
  failures?: number;
  completed?: number;
  total?: number;
  coverage?: number;
  countsKnown?: boolean;
}

export interface FileDropZoneRef {
  handleFiles: (fileList: File[] | TauriFileLike[] | FileList) => Promise<void>;
}

interface FileDropZoneProps {
  onSuccess?: (result: IngestResult) => void;
  onError?: (filename: string, message: string) => void;
  onDataChanged?: () => void;
  className?: string;
  ref?: React.Ref<FileDropZoneRef>;
}

type Status = 'pending' | 'uploading' | 'cancelling' | 'paused' | 'success' | 'partial' | 'error' | 'cancelled';

interface FileTask {
  id: string;
  filename: string;
  status: Status;
  detail?: string;
  jobId?: string;
  stage?: string;
  requiresAcknowledgement?: boolean;
}

interface TaskControl {
  key: string;
  fingerprint?: string | null;
  filename: string;
  status: Status;
  jobId?: string;
  controller: AbortController;
  version: number;
  cancelRequested: boolean;
  requiresAcknowledgement?: boolean;
  recoveryAttemptId?: string;
}

const STAGE_LABELS: Record<string, string> = {
  pending: '等待上传…',
  queued: '等待处理…',
  parsing: '解析文件…',
  ocr: '识别文字…',
  extracting: '抽取记忆…',
  resolving: '整理实体…',
  storing: '保存记忆…',
  done: '已完成',
};

const isActiveStatus = (status: Status) => ['pending', 'uploading', 'cancelling', 'paused'].includes(status);

function uploadKey(file: File | TauriFileLike): string {
  return file instanceof TauriFileLike
    ? file.uploadKey
    : `file:${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))),
    );
  }
  return btoa(binary);
}

function inferContentType(file: File | TauriFileLike): string {
  const lower = file.name.toLowerCase();
  // Office / 电子书：浏览器有时会给错（或为空），按扩展名强制覆盖更稳
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (file.type) return file.type;
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  // 代码 / 配置文件统一按纯文本处理
  if (/\.(js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|lua|sh|bash|zsh|yaml|yml|toml|xml|ini|env)$/.test(lower)) {
    return 'text/plain';
  }
  return 'text/plain';
}

const FileDropZone = React.forwardRef<FileDropZoneRef, FileDropZoneProps>(
  ({ onSuccess, onError, onDataChanged, className }, ref) => {
    const { t } = useTranslation();
    const [dragOver, setDragOver] = useState(false);
    const [tasks, setTasks] = useState<FileTask[]>([]);
    const [notice, setNotice] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const controlsRef = useRef(new Map<string, TaskControl>());
    const activeFilesRef = useRef(new Map<string, string>());
    const callbacksRef = useRef({ onSuccess, onError, onDataChanged });

    useEffect(() => { callbacksRef.current = { onSuccess, onError, onDataChanged }; }, [onSuccess, onError, onDataChanged]);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        // Stop local requests only. Closing the UI must not cancel a persisted server job.
        controlsRef.current.forEach((control) => control.controller.abort());
        controlsRef.current.clear();
        activeFilesRef.current.clear();
      };
    }, []);

    useEffect(() => {
      const recoveries = getPendingImportJobs().filter((record) => record.owner === 'file-drop');
      if (!recoveries.length) return;
      const restoredTasks: FileTask[] = [];
      for (const recovery of recoveries) {
        const recoveryIdentity = recovery.kind === 'job' ? recovery.jobId : recovery.attemptId;
        const taskId = `restored-${recovery.kind}-${recoveryIdentity}`;
        const key = `restored:${recoveryIdentity}`;
        const hasJob = recovery.kind === 'job';
        const filename = hasJob ? '已恢复的文件导入任务' : '待核对的文件导入';
        const detail = hasJob
          ? '检测到上次未完成的导入。继续查询只读取原任务，不会重新上传。'
          : '上次提交结果未确认。请先核对记忆库；确认前不会允许再次导入。';
        const control: TaskControl = {
          key, filename, status: hasJob ? 'paused' : 'error',
          jobId: recovery.kind === 'job' ? recovery.jobId : undefined,
          recoveryAttemptId: recovery.kind === 'uncertain' ? recovery.attemptId : undefined,
          controller: new AbortController(), version: 0, cancelRequested: false,
          requiresAcknowledgement: !hasJob,
        };
        controlsRef.current.set(taskId, control);
        activeFilesRef.current.set(key, taskId);
        restoredTasks.push({
          id: taskId, filename, status: control.status, jobId: control.jobId,
          requiresAcknowledgement: control.requiresAcknowledgement, detail,
        });
      }
      setTasks((existing) => [
        ...restoredTasks,
        ...existing.filter((task) => !restoredTasks.some((restored) => restored.id === task.id)),
      ]);
      setNotice('已恢复上次的导入状态。请继续查询原任务，或核对记忆库后确认；不会自动重新上传。');
    }, []);

    const isCurrent = useCallback((taskId: string, control: TaskControl, version: number) => (
      mountedRef.current && controlsRef.current.get(taskId) === control && control.version === version
    ), []);

    const updateTask = useCallback((taskId: string, patch: Partial<FileTask>) => {
      if (mountedRef.current) {
        setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, ...patch } : task));
      }
    }, []);

    const refreshData = useCallback(() => {
      try { callbacksRef.current.onDataChanged?.(); }
      catch { if (mountedRef.current) setNotice('界面刷新未完成，请手动刷新记忆库，核对已保存的内容。'); }
    }, []);

    const watchTask = useCallback(async (taskId: string, control: TaskControl) => {
      if (!control.jobId) return;
      const version = control.version;
      try {
        const job = await pollIngestJob(control.jobId, {
          signal: control.controller.signal,
          onProgress: (snapshot) => {
            if (!isCurrent(taskId, control, version)) return;
            if (snapshot.status === 'queued' || snapshot.status === 'running') {
              updateTask(taskId, {
                stage: snapshot.stage || (snapshot.status === 'queued' ? 'queued' : 'parsing'),
                detail: control.cancelRequested ? '正在确认取消结果；已保存的内容不会回滚。'
                  : snapshot.importProgress ? `已处理 ${snapshot.importProgress.done}/${snapshot.importProgress.total} 段` : undefined,
              });
            }
          },
        });
        if (!isCurrent(taskId, control, version)) return;
        const summary = summarizeIngestJob(job);
        const requiresAcknowledgement = settleImportOutcome(
          summary.outcome, 'file-drop', control.fingerprint ?? null, control.jobId, control.recoveryAttemptId,
        );
        const units = summary.total > 0 ? ` · 成功处理 ${summary.completed}/${summary.total} 段` : '';
        const saved = summary.countsKnown
          ? `服务报告抽取 ${summary.entities} 条记忆 / ${summary.relationships} 条关系（非净新增数量）`
          : '已保存数量暂时无法确认，请检查记忆库';
        const failures = summary.failures > 0 ? ` · ${summary.failures} 项未完成` : '';
        const coverage = summary.coverage !== undefined ? ` · 覆盖 ${Math.round(summary.coverage * 100)}%` : '';
        const status: Status = summary.outcome === 'failed' ? 'error' : summary.outcome;
        const reviewPrompt = requiresAcknowledgement
          ? '请先核对记忆库；确认后才可重新选择此文件，不会自动重新上传。'
          : '';
        control.status = status;
        control.requiresAcknowledgement = requiresAcknowledgement;
        updateTask(taskId, {
          status,
          stage: undefined,
          requiresAcknowledgement,
          detail: summary.outcome === 'failed' ? `${job.error || '处理失败'}；${saved}。已保存内容不会回滚。${reviewPrompt}`
            : summary.outcome === 'cancelled' ? `${job.error ? `${job.error}；` : ''}已取消；${saved}。已保存内容不会回滚。${reviewPrompt}`
            : `${job.error ? `${job.error}。` : ''}${summary.outcome === 'partial' ? '部分完成 · ' : ''}${saved}${units}${failures}${coverage}${reviewPrompt ? `。${reviewPrompt}` : ''}`,
        });
        if (!requiresAcknowledgement) {
          activeFilesRef.current.delete(control.key);
          controlsRef.current.delete(taskId);
        }
        // Failure/cancellation can happen after persistence; always refresh the library.
        refreshData();

        if (summary.outcome === 'success' || summary.outcome === 'partial') {
          const result = job.result;
          callbacksRef.current.onSuccess?.({
            filename: control.filename,
            entities: summary.entities,
            relationships: summary.relationships,
            principles: typeof result?.principles === 'number' && Number.isFinite(result.principles) ? Math.max(0, Math.floor(result.principles)) : 0,
            archivalId: typeof result?.archivalId === 'string' ? result.archivalId : '',
            summary: typeof result?.summary === 'string' ? result.summary : '',
            partial: summary.outcome === 'partial',
            failures: summary.failures,
            completed: summary.completed,
            total: summary.total,
            coverage: summary.coverage,
            countsKnown: summary.countsKnown,
          });
        } else if (summary.outcome === 'failed') {
          callbacksRef.current.onError?.(control.filename, job.error || '处理失败，请先检查已保存的记忆。');
        }
      } catch (error) {
        if (!isCurrent(taskId, control, version)) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        const expired = error instanceof IngestJobError && error.code === 'expired';
        const invalid = error instanceof IngestJobError && error.code === 'invalid';
        const needsAcknowledgement = expired || invalid;
        const message = error instanceof IngestJobError && error.code === 'unauthorized'
          ? '连接未授权。请重新连接桌面端后继续查询，后台任务可能仍在运行。'
          : expired ? '任务状态已过期。请先检查记忆库，避免重复导入。'
          : invalid ? '任务状态无效，无法确认导入结果。请先核对记忆库，再决定是否重新选择文件。'
          : error instanceof IngestJobError && error.code === 'timeout'
            ? '查询超时，后台任务可能仍在运行。继续查询不会重新上传。'
            : '暂时无法读取任务状态，后台任务可能仍在运行。继续查询不会重新上传。';
        control.status = needsAcknowledgement ? 'error' : 'paused';
        control.requiresAcknowledgement = needsAcknowledgement;
        updateImportContentReservation(control.fingerprint ?? null, 'file-drop', { phase: 'uncertain' });
        updateTask(taskId, { status: control.status, stage: undefined, detail: message, requiresAcknowledgement: needsAcknowledgement });
        if (needsAcknowledgement) refreshData();
        callbacksRef.current.onError?.(control.filename, message);
      }
    }, [isCurrent, updateTask, refreshData]);

    const ingestOne = useCallback(
      async (file: File | TauriFileLike, taskId: string) => {
        const control = controlsRef.current.get(taskId);
        if (!control || !mountedRef.current) return;
        const version = control.version;
        let submissionUncertain = false;
        const submission = createImportSubmission(control.controller);
        try {
          if (file.size > MAX_BYTES) {
            throw new Error(`文件超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 限制`);
          }
          const ab = await submission.wait(() => file.arrayBuffer());
          if (!isCurrent(taskId, control, version)) return;
          const fingerprint = await submission.wait(() => fingerprintImportContent(ab));
          if (!isCurrent(taskId, control, version)) return;
          const reservation = reserveImportContent(fingerprint, 'file-drop');
          if (!reservation.reserved) {
            let message = '检测到上次导入尚未恢复或核对，已暂停新的上传。请先处理已有任务；不会自动重新上传。';
            if (reservation.reason === 'fingerprint-unavailable') {
              message = t('upload.fingerprint_unavailable');
            } else if (reservation.reason === 'duplicate') {
              const ownerName = reservation.existing.owner === 'onboarding' ? '首次使用引导'
                : reservation.existing.owner === 'library' ? '记忆库导入' : '文件导入';
              message = `相同内容已在${ownerName}中处理或待核对，已阻止重复上传。请回到原任务查看结果。`;
            }
            control.fingerprint = null;
            control.status = 'error';
            updateTask(taskId, { status: 'error', stage: undefined, detail: message });
            activeFilesRef.current.delete(control.key);
            controlsRef.current.delete(taskId);
            setNotice(message);
            return;
          }
          control.fingerprint = fingerprint;
          const body = submission.prepare(() => {
            const base64 = bufferToBase64(ab);
            const contentType = inferContentType(file);
            return JSON.stringify({ filename: file.name, contentType, base64 });
          });
          control.status = 'uploading';
          updateTask(taskId, { status: 'uploading', stage: 'parsing' });
          const submitRes = await submission.wait(() => {
            control.recoveryAttemptId = createImportRecoveryAttemptId();
            if (!persistUncertainImport('file-drop', control.recoveryAttemptId)) {
              control.recoveryAttemptId = undefined;
              throw new Error('无法保存恢复标记，为避免重复导入，本次未提交。请检查本地存储后重试。');
            }
            submissionUncertain = true;
            return apiFetch('/api/ingest/file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: control.controller.signal,
            });
          });
          if (!submitRes.ok) {
            submissionUncertain = submitRes.status >= 500;
            if (!submissionUncertain && control.recoveryAttemptId) {
              clearPersistedImportAttempt('file-drop', control.recoveryAttemptId);
              control.recoveryAttemptId = undefined;
            }
          }
          const submitData = await submission.wait(() => submitRes.json().catch(() => ({})));
          if (!isCurrent(taskId, control, version)) return;
          if (!submitRes.ok) {
            throw new Error(submitData?.error || `HTTP ${submitRes.status}`);
          }
          if (typeof submitData.jobId !== 'string' || !submitData.jobId) {
            throw new Error('服务器未返回任务编号');
          }
          submission.dispose();
          const jobId = submitData.jobId;
          control.jobId = jobId;
          const recoverySaved = control.recoveryAttemptId
            ? persistImportJob('file-drop', jobId, control.recoveryAttemptId)
            : persistImportJob('file-drop', jobId);
          if (recoverySaved) control.recoveryAttemptId = undefined;
          updateImportContentReservation(fingerprint, 'file-drop', { phase: 'running', jobId });
          updateTask(taskId, {
            jobId,
            detail: recoverySaved ? undefined : '任务已接收，但本地无法保存恢复记录。请勿关闭应用，直到任务结束并核对结果。',
          });
          // Submit subsequent files without waiting for extraction; each job polls serially.
          void watchTask(taskId, control);
        } catch (err) {
          if (!isCurrent(taskId, control, version)) return;
          const message = submissionUncertain
            ? '未能确认上传结果，后台可能已收到文件。请先检查记忆库，避免重复导入。'
            : submission.timedOut
              ? '读取或准备文件已超过 30 秒，尚未提交。可以重新选择文件。'
              : err instanceof Error ? err.message : String(err);
          control.status = 'error';
          control.requiresAcknowledgement = submissionUncertain;
          if (submissionUncertain) {
            updateImportContentReservation(control.fingerprint ?? null, 'file-drop', { phase: 'uncertain' });
          } else {
            releaseImportContentReservation(control.fingerprint ?? null, 'file-drop');
            if (control.recoveryAttemptId) clearPersistedImportAttempt('file-drop', control.recoveryAttemptId);
            control.recoveryAttemptId = undefined;
          }
          updateTask(taskId, { status: 'error', stage: undefined, detail: message, requiresAcknowledgement: submissionUncertain });
          // An unacknowledged write must not be silently repeated by a second drop.
          if (!submissionUncertain) {
            activeFilesRef.current.delete(control.key);
            controlsRef.current.delete(taskId);
          } else refreshData();
          callbacksRef.current.onError?.(file.name, message);
        } finally {
          submission.dispose();
        }
      },
      [isCurrent, updateTask, watchTask, refreshData, t],
    );

    const handleFiles = useCallback(
      async (fileList: File[] | TauriFileLike[] | FileList) => {
        if (!mountedRef.current) return;
        const selected = Array.from(fileList as ArrayLike<File | TauriFileLike>);
        const uploads: Array<{ file: File | TauriFileLike; task: FileTask }> = [];
        let duplicates = 0;
        for (const file of selected) {
          const key = uploadKey(file);
          if (activeFilesRef.current.has(key)) { duplicates++; continue; }
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          activeFilesRef.current.set(key, id);
          controlsRef.current.set(id, {
            key, filename: file.name, status: 'pending', controller: new AbortController(), version: 0, cancelRequested: false,
          });
          uploads.push({ file, task: { id, filename: file.name, status: 'pending', stage: 'pending' } });
        }
        setNotice(duplicates > 0 ? `已忽略 ${duplicates} 个重复文件：已有导入任务或上传结果待确认，请先查看现有任务。` : '');
        if (uploads.length === 0) return;
        setTasks((prev) => [
          ...prev.filter((task) => isActiveStatus(task.status) || task.requiresAcknowledgement),
          ...prev.filter((task) => !isActiveStatus(task.status) && !task.requiresAcknowledgement).slice(-12),
          ...uploads.map(({ task }) => task),
        ]);
        for (const { file, task } of uploads) {
          if (!mountedRef.current) break;
          await ingestOne(file, task.id);
        }
      },
      [ingestOne],
    );

    const handleCancel = useCallback(
      async (taskId: string, jobId: string) => {
        const control = controlsRef.current.get(taskId);
        if (!control || control.jobId !== jobId || control.cancelRequested
          || (control.status !== 'uploading' && control.status !== 'paused')) return;
        control.status = 'cancelling';
        control.cancelRequested = true;
        control.version++;
        control.controller.abort();
        control.controller = new AbortController();
        const version = control.version;
        updateTask(taskId, { status: 'cancelling', stage: undefined, detail: '正在请求取消；已保存的内容不会回滚。' });
        const timer = setTimeout(() => control.controller.abort(), 10_000);
        try {
          const response = await apiFetch(`/api/ingest/job/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST', signal: control.controller.signal,
          });
          if (!isCurrent(taskId, control, version)) return;
          // A terminal job may win the race with cancellation. Read its actual outcome.
          if (!response.ok && response.status !== 409) throw new Error('取消请求未确认');
          clearTimeout(timer);
          control.controller = new AbortController();
          void watchTask(taskId, control);
        } catch {
          if (!isCurrent(taskId, control, version)) return;
          control.status = 'paused';
          const message = '未能确认取消结果，后台可能仍在运行。请继续查询，不会重复上传或取消。';
          updateTask(taskId, { status: 'paused', stage: undefined, detail: message });
          callbacksRef.current.onError?.(control.filename, message);
        } finally {
          clearTimeout(timer);
        }
      },
      [isCurrent, updateTask, watchTask],
    );

    const resumeTask = useCallback((taskId: string) => {
      const control = controlsRef.current.get(taskId);
      if (!control?.jobId || control.status !== 'paused') return;
      control.status = control.cancelRequested ? 'cancelling' : 'uploading';
      control.version++;
      control.controller.abort();
      control.controller = new AbortController();
      updateTask(taskId, { status: control.status, detail: '继续查询原任务，不会重新上传。' });
      void watchTask(taskId, control);
    }, [updateTask, watchTask]);

    const acknowledgeTaskUncertainty = useCallback((taskId: string) => {
      const control = controlsRef.current.get(taskId);
      if (!control?.requiresAcknowledgement || !mountedRef.current) return;
      control.version++;
      control.controller.abort();
      activeFilesRef.current.delete(control.key);
      acknowledgeImportRecovery('file-drop', control.fingerprint ?? null, control.jobId, control.recoveryAttemptId);
      controlsRef.current.delete(taskId);
      updateTask(taskId, {
        requiresAcknowledgement: false,
        detail: '已确认核对记忆库。现在可以重新选择此文件，不会自动上传。',
      });
    }, [updateTask]);

    useImperativeHandle(ref, () => ({
      handleFiles,
    }));

    const onDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
      },
      [handleFiles],
    );

    return (
      <div className={className}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl cursor-pointer transition-all border-2 ${
            dragOver
              ? 'border-cyan-400 bg-cyan-900/10 shadow-[0_0_20px_rgba(0,242,254,0.18)]'
              : 'border-dashed border-cyan-800 bg-white/5 hover:border-cyan-600 hover:bg-cyan-900/5'
          }`}
        >
          <UploadCloud className="w-8 h-8 text-cyan-400" />
          <div className="text-sm text-white font-medium">拖入文件，或点击选择</div>
          <div className="text-xs text-gray-400">
            Markdown / Office / PDF / 电子书 / 代码 · 单文件最大 30MB
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </div>

        {notice && <p role="status" className="mt-2 text-xs leading-5 text-amber-300">{notice}</p>}

        {tasks.length > 0 && (
          <ul aria-label="导入任务" aria-live="polite" className="mt-3 space-y-1.5">
            {tasks
              .slice()
              .reverse()
              .map((t) => (
                <li
                  key={t.id}
                  data-status={t.status}
                  className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border text-xs ${
                    t.status === 'cancelled'
                      ? 'bg-black/20 border-white/5 text-gray-500'
                      : t.status === 'partial' || t.status === 'paused' || t.requiresAcknowledgement ? 'bg-amber-900/10 border-amber-500/25'
                      : 'bg-black/30 border-white/5'
                  }`}
                >
                  <FileText className={`w-3.5 h-3.5 shrink-0 ${t.status === 'cancelled' ? 'text-gray-600' : 'text-gray-500'}`} />
                  <span className={`min-w-0 flex-1 truncate ${t.status === 'cancelled' ? 'text-gray-500' : 'text-gray-200'}`}>{t.filename}</span>
                  {(t.status === 'pending' || t.status === 'uploading') && t.stage && (
                    <span className="text-cyan-400/80 truncate max-w-[40%] text-[10px]">{STAGE_LABELS[t.stage] || t.stage}</span>
                  )}
                  {t.status === 'cancelled' && (
                    <span className="text-gray-500 text-[10px]">已取消</span>
                  )}
                  {t.status === 'cancelling' && <span className="text-amber-300 text-[10px]">正在确认取消…</span>}
                  {(t.status === 'pending' || t.status === 'uploading' || t.status === 'cancelling') && (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                  )}
                  {t.status === 'uploading' && t.jobId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancel(t.id, t.jobId!);
                      }}
                      className="p-0.5 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400 shrink-0 leading-none"
                      title="取消导入"
                      aria-label={`取消导入 ${t.filename}`}
                    >
                      &times;
                    </button>
                  )}
                  {t.status === 'paused' && t.jobId && (
                    <button type="button" onClick={() => resumeTask(t.id)}
                      className="shrink-0 rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10"
                      aria-label={`继续查询 ${t.filename}`}>
                      继续查询
                    </button>
                  )}
                  {t.requiresAcknowledgement && (
                    <button type="button" onClick={() => acknowledgeTaskUncertainty(t.id)}
                      className="rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10"
                      aria-label={`已核对记忆库，允许重新选择 ${t.filename}`}>
                      已核对记忆库，允许重新选择
                    </button>
                  )}
                  {t.status === 'success' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  )}
                  {t.status === 'error' && !t.requiresAcknowledgement && (
                    <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  )}
                  {(t.status === 'partial' || t.status === 'paused' || t.requiresAcknowledgement) && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  {t.status === 'cancelled' && (
                    <XCircle className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  )}
                  {t.detail && <span className={`basis-full break-words leading-5 ${t.status === 'partial' || t.status === 'paused' || t.requiresAcknowledgement ? 'text-amber-200/80' : 'text-gray-400'}`}>{t.detail}</span>}
                </li>
              ))}
          </ul>
        )}
      </div>
    );
  }
);

FileDropZone.displayName = 'FileDropZone';
export default FileDropZone;
