'use client';

import React from 'react';
import { Search, Upload, Sparkles, Keyboard, X, Scale, GitBranch, Plug, ArrowRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { LogoMark } from '@/components/BrandMark';

interface EmptyStateProps {
  onLoadDemo: () => void;
  isLoadingDemo?: boolean;
  onSearch: () => void;
  onDecision: () => void;
  onUploadClick: () => void;
  onShowDecisionLog: () => void;
  onConnectMcp: () => void;
  onShowShortcuts: () => void;
  onDismiss?: () => void;
}

export default function EmptyState({
  onLoadDemo,
  isLoadingDemo = false,
  onSearch,
  onDecision,
  onUploadClick,
  onShowDecisionLog,
  onConnectMcp,
  onShowShortcuts,
  onDismiss,
}: EmptyStateProps) {
  const { t } = useTranslation();

  const guide = [
    { icon: <Plug className="w-4 h-4" />, label: t('empty.guide_mcp'), how: t('empty.guide_mcp_how'), onClick: onConnectMcp, accent: true },
    { icon: <Search className="w-4 h-4" />, label: t('empty.guide_search'), how: t('empty.guide_search_how'), onClick: onSearch },
    { icon: <Scale className="w-4 h-4" />, label: t('empty.guide_decision'), how: t('empty.guide_decision_how'), onClick: onDecision },
    { icon: <Upload className="w-4 h-4" />, label: t('empty.guide_upload'), how: t('empty.guide_upload_how'), onClick: onUploadClick },
    { icon: <GitBranch className="w-4 h-4" />, label: t('empty.guide_log'), how: t('empty.guide_log_how'), onClick: onShowDecisionLog },
  ];

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-6 pointer-events-none overflow-auto bg-gray-950/70">
      <div className="bg-[#0a0b12]/95 pointer-events-auto relative max-w-xl w-full max-h-[calc(100vh-7rem)] overflow-y-auto p-5 sm:p-7 rounded-2xl border border-white/10">
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

        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4 mb-6 pr-8">
          <LogoMark size={48} className="shrink-0 animate-pulse-glow" />
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide truncate">
              {t('empty.title')}
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">{t('empty.subtitle')}</p>
          </div>
        </div>

        {/* Primary: load demo */}
        <div className="text-xs uppercase tracking-wider text-cyan-400/70 mb-2 flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          {t('empty.start_here')}
        </div>
        <button
          onClick={onLoadDemo}
          disabled={isLoadingDemo}
          className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
            isLoadingDemo
              ? 'bg-cyan-900/20 border-cyan-700/30 opacity-70 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-600/25 to-purple-600/15 border-cyan-500/40 hover:border-cyan-400/60 hover:from-cyan-600/30'
          }`}
        >
          <span className="shrink-0 text-cyan-300">
            {isLoadingDemo ? (
              <span className="block w-6 h-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            ) : (
              <Sparkles className="w-6 h-6" />
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base font-semibold text-white">
              {t('empty.load_demo')}
              {!isLoadingDemo && (
                <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 align-middle">
                  {t('empty.recommended')}
                </span>
              )}
            </span>
            <span className="block text-xs text-gray-400 mt-0.5">
              {isLoadingDemo ? t('empty.generating_vectors') : t('empty.demo_primary_hint')}
            </span>
          </span>
          {!isLoadingDemo && <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0" />}
        </button>

        {/* Feature guide */}
        <div className="text-xs uppercase tracking-wider text-gray-500 mt-6 mb-2">
          {t('empty.guide_title')}
        </div>
        <div className="space-y-1.5">
          {guide.map((g, i) => (
            <button
              key={i}
              onClick={g.onClick}
              className={`w-full flex items-start gap-3 p-2.5 rounded-lg border transition-all text-left group ${
                g.accent
                  ? 'bg-cyan-950/15 border-cyan-800/30 hover:border-cyan-600/50 hover:bg-cyan-900/20'
                  : 'bg-white/[0.03] border-white/5 hover:border-white/10 hover:bg-white/5'
              }`}
            >
              <span className={`shrink-0 mt-0.5 ${g.accent ? 'text-cyan-300' : 'text-gray-400 group-hover:text-cyan-300'} transition-colors`}>
                {g.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-white">{g.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{g.how}</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 mt-1 transition-colors" />
            </button>
          ))}
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
