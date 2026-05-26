'use client';

import { useContext, useMemo } from 'react';
import { ToastContext } from '@/components/Toast';

type ToastOpts = { duration?: number; action?: React.ReactNode };

interface ToastApi {
  success: (message: string, detail?: string, opts?: ToastOpts) => string;
  error: (message: string, detail?: string, opts?: ToastOpts) => string;
  warning: (message: string, detail?: string, opts?: ToastOpts) => string;
  info: (message: string, detail?: string, opts?: ToastOpts) => string;
  dismiss: (id: string) => void;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  const { push, dismiss } = ctx;

  return useMemo<ToastApi>(
    () => ({
      success: (message, detail, opts) => push({ type: 'success', message, detail, ...opts }),
      error: (message, detail, opts) => push({ type: 'error', message, detail, ...opts }),
      warning: (message, detail, opts) => push({ type: 'warning', message, detail, ...opts }),
      info: (message, detail, opts) => push({ type: 'info', message, detail, ...opts }),
      dismiss,
    }),
    [push, dismiss],
  );
}
