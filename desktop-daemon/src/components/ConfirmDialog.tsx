'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  impact?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  impact,
  confirmText: confirmTextProp,
  cancelText: cancelTextProp,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmText = confirmTextProp ?? t('confirm.confirm_text');
  const cancelText = cancelTextProp ?? t('confirm.cancel_text');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, busy, onCancel]);

  // Reset busy state when dialog closes so it can be reused.
  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
    }
  }, [isOpen]);

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }, [busy, onConfirm]);

  const handleCancel = useCallback(() => {
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  if (!isOpen) return null;

  const confirmClass = destructive
    ? 'bg-red-600/80 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm'
    : 'bg-cyan-600/80 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={handleCancel}
      role="presentation"
    >
      <div
        className="bg-[#0a0b12]/95 border border-white/10 max-w-md w-full p-6 rounded-2xl relative"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          aria-label={cancelText}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-4 h-4" />
        </button>

        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-white mb-2 pr-8"
        >
          {destructive && (
            <AlertTriangle className="w-5 h-5 text-red-400 inline-block mr-2" />
          )}
          {title}
        </h2>

        <p className="text-sm text-gray-300 whitespace-pre-line mb-4">{message}</p>

        {impact && (
          <div className="mb-4 p-3 rounded-lg border border-white/10 bg-white/5 text-xs text-gray-400">
            {impact}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`${confirmClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {busy ? t('confirm.processing') : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useConfirm hook: imperative API on top of ConfirmDialog
// ---------------------------------------------------------------------------

type ConfirmOptions = Omit<
  ConfirmDialogProps,
  'isOpen' | 'onConfirm' | 'onCancel'
> & {
  onConfirm?: () => void | Promise<void>;
  impact?: React.ReactNode;
};

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    if (pending.options.onConfirm) {
      await pending.options.onConfirm();
    }
    pending.resolve(true);
    setPending(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve(false);
    setPending(null);
  }, [pending]);

  const dialog = (
    <ConfirmDialog
      isOpen={pending !== null}
      title={pending?.options.title ?? ''}
      message={pending?.options.message ?? ''}
      impact={pending?.options.impact}
      confirmText={pending?.options.confirmText}
      cancelText={pending?.options.cancelText}
      destructive={pending?.options.destructive}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, dialog };
}
