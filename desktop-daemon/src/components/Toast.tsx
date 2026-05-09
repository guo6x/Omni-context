'use client';

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  detail?: string;
  duration: number;
}

export interface ToastInput {
  type: ToastType;
  message: string;
  detail?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 4;
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 8000;

const styleByType: Record<
  ToastType,
  { border: string; text: string; glow: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    border: 'border-green-400/60',
    text: 'text-green-300',
    glow: 'shadow-[0_0_18px_rgba(74,222,128,0.18)]',
    Icon: CheckCircle2,
  },
  error: {
    border: 'border-red-400/60',
    text: 'text-red-300',
    glow: 'shadow-[0_0_18px_rgba(248,113,113,0.20)]',
    Icon: XCircle,
  },
  warning: {
    border: 'border-yellow-400/60',
    text: 'text-yellow-300',
    glow: 'shadow-[0_0_18px_rgba(250,204,21,0.18)]',
    Icon: AlertTriangle,
  },
  info: {
    border: 'border-cyan-400/60',
    text: 'text-cyan-300',
    glow: 'shadow-[0_0_18px_rgba(34,211,238,0.18)]',
    Icon: Info,
  },
};

function genId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = genId();
    const duration =
      input.duration ?? (input.type === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
    const item: ToastItem = {
      id,
      type: input.type,
      message: input.message,
      detail: input.detail,
      duration,
    };
    setToasts((prev) => {
      const next = [...prev, item];
      // FIFO: drop oldest when over the cap
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const { Icon, border, text, glow } = styleByType[toast.type];
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef<number>(toast.duration);
  const startedAtRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (paused) {
      clear();
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      );
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return clear;
  }, [paused, toast.id, onDismiss]);

  const hasDetail = toast.type === 'error' && !!toast.detail;

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto glass-panel border ${border} ${glow} px-3 py-2.5 animate-in slide-in-from-right-4 fade-in duration-200`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${text}`} />
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm leading-snug text-white/95">{toast.message}</div>
          {hasDetail && (
            <>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/50 transition-colors hover:text-white/80"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" /> hide details
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" /> show details
                  </>
                )}
              </button>
              {expanded && (
                <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 p-2 text-[11px] leading-relaxed text-white/70">
                  {toast.detail}
                </div>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="ml-1 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/90"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
