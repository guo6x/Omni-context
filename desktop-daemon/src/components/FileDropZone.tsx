'use client';

import React, { useCallback, useRef, useState, useImperativeHandle } from 'react';
import { UploadCloud, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

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

// brain-server 那边 MAX_BODY_BYTES 默认 15MB，base64 膨胀 ~33%，10MB 文件还原时留出余量
const MAX_BYTES = 10 * 1024 * 1024;

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
}

export interface IngestResult {
  filename: string;
  entities: number;
  relationships: number;
  principles: number;
  archivalId: string;
  summary: string;
}

export interface FileDropZoneRef {
  handleFiles: (fileList: File[] | TauriFileLike[] | FileList) => Promise<void>;
}

interface FileDropZoneProps {
  onSuccess?: (result: IngestResult) => void;
  onError?: (filename: string, message: string) => void;
  className?: string;
  ref?: React.Ref<FileDropZoneRef>;
}

type Status = 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';

interface FileTask {
  id: string;
  filename: string;
  status: Status;
  detail?: string;
  jobId?: string;
  stage?: string;
}

const STAGE_LABELS: Record<string, string> = {
  parsing: 'Parsing file...',
  ocr: 'OCR recognizing...',
  extracting: 'LLM extracting...',
  resolving: 'Resolving entities...',
  storing: 'Storing...',
  done: 'Done',
};

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
  ({ onSuccess, onError, className }, ref) => {
    const [dragOver, setDragOver] = useState(false);
    const [tasks, setTasks] = useState<FileTask[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

    const ingestOne = useCallback(
      async (file: File | TauriFileLike, taskId: string) => {
        try {
          if (file.size > MAX_BYTES) {
            throw new Error(`File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`);
          }
          const ab = await file.arrayBuffer();
          const base64 = bufferToBase64(ab);
          const contentType = inferContentType(file);

          // Submit job
          const submitRes = await apiFetch('/api/ingest/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType, base64 }),
          });
          const submitData = await submitRes.json().catch(() => ({}));
          if (!submitRes.ok) {
            throw new Error(submitData?.error || `HTTP ${submitRes.status}`);
          }

          const jobId: string = submitData.jobId;
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, jobId } : t)),
          );

          // Poll job status every 1 second
          const pollInterval = setInterval(async () => {
            try {
              const pollRes = await apiFetch(`/api/ingest/job/${jobId}`);
              if (!pollRes.ok) {
                if (pollRes.status === 404) {
                  clearInterval(pollInterval);
                  intervalsRef.current.delete(taskId);
                  setTasks((prev) =>
                    prev.map((t) =>
                      t.id === taskId
                        ? { ...t, status: 'error', detail: 'Job expired' }
                        : t,
                    ),
                  );
                  onError?.(file.name, 'Job expired');
                }
                return;
              }

              const job = await pollRes.json();

              if (job.status === 'success') {
                clearInterval(pollInterval);
                intervalsRef.current.delete(taskId);
                const r = job.result || {};
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? { ...t, status: 'success', detail: `${r.entities || 0} entities / ${r.relationships || 0} relations`, stage: 'done' }
                      : t,
                  ),
                );
                onSuccess?.({ filename: file.name, entities: r.entities || 0, relationships: r.relationships || 0, principles: r.principles || 0, archivalId: r.archivalId || '', summary: r.summary || '' });
              } else if (job.status === 'failed') {
                clearInterval(pollInterval);
                intervalsRef.current.delete(taskId);
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? { ...t, status: 'error', detail: job.error || 'Processing failed' }
                      : t,
                  ),
                );
                onError?.(file.name, job.error || 'Processing failed');
              } else if (job.status === 'cancelled') {
                clearInterval(pollInterval);
                intervalsRef.current.delete(taskId);
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? { ...t, status: 'cancelled', stage: undefined }
                      : t,
                  ),
                );
              } else {
                // running / queued: show stage
                const stage = job.stage || 'parsing';
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? { ...t, stage }
                      : t,
                  ),
                );
              }
            } catch {
              // Poll error — ignore, keep polling
            }
          }, 1000);
          intervalsRef.current.set(taskId, pollInterval);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: 'error', detail: message } : t)),
          );
          onError?.(file.name, message);
        }
      },
      [onSuccess, onError],
    );

    const handleFiles = useCallback(
      async (fileList: File[] | TauriFileLike[] | FileList) => {
        const files = Array.from(fileList as any) as Array<File | TauriFileLike>;
        if (files.length === 0) return;

        const newTasks: FileTask[] = files.map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filename: f.name,
          status: 'uploading',
        }));
        setTasks((prev) => [...prev, ...newTasks].slice(-12));

        for (let i = 0; i < files.length; i++) {
          await ingestOne(files[i], newTasks[i].id);
        }
      },
      [ingestOne],
    );

    const handleCancel = useCallback(
      async (taskId: string, jobId: string) => {
        // Stop polling immediately
        const intervalId = intervalsRef.current.get(taskId);
        if (intervalId) {
          clearInterval(intervalId);
          intervalsRef.current.delete(taskId);
        }
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'cancelled', stage: undefined } : t,
          ),
        );
        // Send cancel request (fire-and-forget)
        try {
          await apiFetch(`/api/ingest/job/${jobId}/cancel`, { method: 'POST' });
        } catch {
          // Ignore cancel errors — UI already updated
        }
      },
      [],
    );

    useImperativeHandle(ref, () => ({
      handleFiles,
    }));

    const onDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
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
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
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
          <div className="text-sm text-white font-medium">Drag files here or click to select</div>
          <div className="text-xs text-gray-400">
            Supports Markdown / Office / PDF / eBook / Code / Images · Max 10MB per file
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
        </div>

        {tasks.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {tasks
              .slice()
              .reverse()
              .map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
                    t.status === 'cancelled'
                      ? 'bg-black/20 border-white/5 text-gray-500'
                      : 'bg-black/30 border-white/5'
                  }`}
                >
                  <FileText className={`w-3.5 h-3.5 shrink-0 ${t.status === 'cancelled' ? 'text-gray-600' : 'text-gray-500'}`} />
                  <span className={`flex-1 truncate ${t.status === 'cancelled' ? 'text-gray-500' : 'text-gray-200'}`}>{t.filename}</span>
                  {t.status === 'uploading' && t.stage && (
                    <span className="text-cyan-400/80 truncate max-w-[40%] text-[10px]">{STAGE_LABELS[t.stage] || t.stage}</span>
                  )}
                  {t.status === 'cancelled' && (
                    <span className="text-gray-500 truncate max-w-[40%] text-[10px]">Cancelled</span>
                  )}
                  {t.detail && <span className="text-gray-500 truncate max-w-[40%]">{t.detail}</span>}
                  {t.status === 'uploading' && (
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
                      title="Cancel"
                    >
                      &times;
                    </button>
                  )}
                  {t.status === 'success' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  )}
                  {t.status === 'error' && (
                    <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  )}
                  {t.status === 'cancelled' && (
                    <XCircle className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  )}
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
