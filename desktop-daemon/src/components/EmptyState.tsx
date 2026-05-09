'use client';

import React from 'react';
import { Camera, Search, Upload, Sparkles, Keyboard } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { LogoMark } from '@/components/BrandMark';

interface EmptyStateProps {
  onCapture: () => void;
  onDecision: () => void;
  onUploadClick: () => void;
  onShowShortcuts: () => void;
}

export default function EmptyState({
  onCapture,
  onDecision,
  onUploadClick,
  onShowShortcuts,
}: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
      <div className="glass-panel pointer-events-auto max-w-xl w-full p-8 rounded-2xl border border-white/10">
        <div className="flex items-center gap-4 mb-6">
          <LogoMark size={56} className="shrink-0 animate-pulse-glow" />
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">
              {t('empty.title')}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{t('empty.subtitle')}</p>
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
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5 hover:border-cyan-800 hover:bg-cyan-900/10 transition-all text-left group"
    >
      <span className="shrink-0 text-cyan-400 group-hover:text-cyan-300 transition-colors mt-0.5">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>
      </span>
    </button>
  );
}
