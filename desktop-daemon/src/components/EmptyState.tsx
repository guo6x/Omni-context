'use client';

import React from 'react';
import { Camera, Search, Upload, Sparkles, Keyboard, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { LogoMark } from '@/components/BrandMark';

interface EmptyStateProps {
  onCapture: () => void;
  onDecision: () => void;
  onUploadClick: () => void;
  onShowShortcuts: () => void;
  onDismiss?: () => void;
  onLoadDemo: () => void;
  isLoadingDemo?: boolean;
}

export default function EmptyState({
  onCapture,
  onDecision,
  onUploadClick,
  onShowShortcuts,
  onDismiss,
  onLoadDemo,
  isLoadingDemo = false,
}: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-6 pointer-events-none overflow-auto">
      <div className="glass-panel pointer-events-auto relative max-w-xl w-full max-h-[calc(100vh-7rem)] overflow-y-auto p-5 sm:p-7 rounded-2xl border border-white/10">
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label={t('empty.close_welcome')}
            title={t('empty.close_hint')}
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-3 sm:gap-4 mb-5 pr-8">
          <LogoMark size={48} className="shrink-0 animate-pulse-glow" />
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide truncate">
              {t('empty.title')}
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">{t('empty.subtitle')}</p>
          </div>
        </div>

        <div className="text-xs uppercase tracking-wider text-cyan-400/70 mb-3 flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          {t('empty.quick_actions')}
        </div>

        <div className="space-y-2">
          <ActionRow
            icon={<Camera className="w-5 h-5" />}
            label={t('empty.capture_label')}
            hint={t('empty.capture_hint')}
            onClick={onCapture}
          />
          <ActionRow
            icon={<Upload className="w-5 h-5" />}
            label={t('empty.upload_label')}
            hint={t('empty.upload_hint')}
            onClick={onUploadClick}
          />
          <ActionRow
            icon={<Search className="w-5 h-5" />}
            label={t('empty.decision_label')}
            hint={t('empty.decision_hint')}
            onClick={onDecision}
          />
          <ActionRow
            icon={<Sparkles className="w-5 h-5 text-purple-400" />}
            label={t('empty.load_demo')}
            hint={t('empty.load_demo_hint')}
            onClick={onLoadDemo}
            disabled={isLoadingDemo}
            loading={isLoadingDemo}
            loadingText={t('empty.generating_vectors')}
          />
        </div>

        <button
          onClick={onShowShortcuts}
          className="mt-5 flex items-center gap-2 text-xs text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <Keyboard className="w-3.5 h-3.5" />
          {t('empty.docs')}
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  loading,
  loadingText,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-left group ${
        disabled || loading
          ? 'bg-white/5 border-white/5 opacity-60 cursor-not-allowed'
          : 'bg-white/5 border-white/5 hover:border-cyan-800 hover:bg-cyan-900/10'
      }`}
    >
      <span className="shrink-0 text-cyan-400 group-hover:text-cyan-300 transition-colors mt-0.5">
        {loading ? (
          <span className="block w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        ) : (
          icon
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-white flex items-center gap-2">
          {label}
          {loading && loadingText && <span className="text-xs text-cyan-400 animate-pulse">{loadingText}</span>}
        </span>
        <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>
      </span>
    </button>
  );
}
