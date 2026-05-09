'use client';

import { useContext, useMemo } from 'react';
import { ToastContext } from '@/components/Toast';

interface ToastApi {
  success: (message: string, detail?: string) => string;
  error: (message: string, detail?: string) => string;
  warning: (message: string, detail?: string) => string;
  info: (message: string, detail?: string) => string;
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
      success: (message, detail) => push({ type: 'success', message, detail }),
      error: (message, detail) => push({ type: 'error', message, detail }),
      warning: (message, detail) => push({ type: 'warning', message, detail }),
      info: (message, detail) => push({ type: 'info', message, detail }),
      dismiss,
    }),
    [push, dismiss],
  );
}
