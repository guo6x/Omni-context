'use client';

import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://localhost:3001';

const ACCEPTED_TYPES = '.md,.txt,.json,.csv,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf';
const MAX_BYTES = 5 * 1024 * 1024;

export interface IngestResult {
  filename: string;
  entities: number;
  relationships: number;
  principles: number;
  archivalId: string;
  summary: string;
}

interface FileDropZoneProps {
  onSuccess?: (result: IngestResult) => void;
  onError?: (filename: string, message: string) => void;
  className?: string;
}

type Status = 'pending' | 'uploading' | 'success' | 'error';

interface FileTask {
  id: string;
  filename: string;
  status: Status;
  detail?: string;
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

function inferContentType(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'text/plain';
}

export default function FileDropZone({ onSuccess, onError, className }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [tasks, setTasks] = useState<FileTask[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingestOne = useCallback(
    async (file: File, taskId: string) => {
      try {
        if (file.size > MAX_BYTES) {
          throw new Error(`文件超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限`);
        }
        const ab = await file.arrayBuffer();
        const base64 = bufferToBase64(ab);
        const contentType = inferContentType(file);

        const res = await fetch(`${BRAIN_URL}/api/ingest/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType, base64 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, status: 'success', detail: `${data.entities} 实体 / ${data.relationships} 关系` }
              : t,
          ),
        );
        onSuccess?.({ filename: file.name, ...(data as Omit<IngestResult, 'filename'>) });
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
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
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
        <div className="text-sm text-white font-medium">拖入文件 / 点击选择</div>
        <div className="text-xs text-gray-400">
          支持 .md / .txt / .json / .csv / .pdf · 单文件 ≤ 5MB
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
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/30 border border-white/5 text-xs"
              >
                <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span className="flex-1 truncate text-gray-200">{t.filename}</span>
                {t.detail && <span className="text-gray-500 truncate max-w-[40%]">{t.detail}</span>}
                {t.status === 'uploading' && (
                  <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                )}
                {t.status === 'success' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                )}
                {t.status === 'error' && (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
