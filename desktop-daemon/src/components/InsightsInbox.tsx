import React, { useState, useEffect, useCallback } from 'react';
import { Check, CheckCheck, X, Sparkles, Database, RefreshCw, AlertCircle, Copy, Bookmark } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { apiFetch } from '@/lib/api-client';

const REFRESH_INTERVAL_MS = 20_000;

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'now';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(then).toLocaleString();
}

interface Insight {
  id: string;
  title: string;
  content: string;
  type: string;
  created_at: string;
  read_status: boolean;
}

interface InsightsInboxProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InsightsInbox({ isOpen, onClose }: InsightsInboxProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setInsights(Array.isArray(data) ? data : []);
      } else {
        setError(`Brain Server returned ${res.status}`);
      }
    } catch (e) {
      console.warn('Failed to fetch insights', e);
      setError(t('insights.cannot_connect'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchInsights();
    const timer = setInterval(fetchInsights, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isOpen, fetchInsights]);

  const markAsRead = useCallback(async (id: string) => {
    setInsights((prev) => prev.filter((i) => i.id !== id));
    try {
      await apiFetch(`/api/notifications/${id}/read`, {
        method: 'POST',
      });
    } catch (e) {
      console.warn('Failed to mark insight as read', e);
      // 网络失败时回滚展示，避免用户以为已处理
      fetchInsights();
    }
  }, [fetchInsights]);

  const copyInsight = useCallback(async (i: Insight) => {
    try { await navigator.clipboard.writeText(`${i.title}\n\n${i.content}`); toast.success(t('actions.copied')); }
    catch { toast.error(t('actions.copy_failed')); }
  }, [toast, t]);

  const favoriteInsight = useCallback(async (i: Insight) => {
    try {
      const r = await apiFetch('/api/memory/archival', {
        method: 'POST',
        body: JSON.stringify({ content: `${i.title}\n\n${i.content}`, summary: i.title, tags: ['收藏'], importance: 0.8 }),
      });
      if (!r.ok) throw new Error();
      toast.success(t('actions.favorited'));
    } catch { toast.error(t('actions.favorite_failed')); }
  }, [toast, t]);

  const markAllAsRead = useCallback(async () => {
    if (insights.length === 0) return;
    const ids = insights.map((i) => i.id);
    setInsights([]);
    await Promise.allSettled(
      ids.map((id) =>
        apiFetch(`/api/notifications/${id}/read`, { method: 'POST' })
      )
    );
  }, [insights]);

  if (!isOpen) return null;

  return (
    <div className="absolute top-16 right-6 w-[28rem] max-w-[calc(100vw-3rem)] max-h-[80vh] flex flex-col bg-[#0a0b12]/95 rounded-xl shadow-2xl border border-cyan-500/30 overflow-hidden z-40 animate-in slide-in-from-right-8 duration-300">
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#0a0b12]/80">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
          <h2 className="text-white font-medium">{t('insights.title')}</h2>
          {insights.length > 0 && (
            <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full text-xs font-bold border border-cyan-500/30">
              {insights.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={markAllAsRead}
            className="p-1.5 text-gray-400 hover:text-cyan-300 hover:bg-white/10 rounded transition-colors disabled:opacity-30"
            disabled={insights.length === 0}
            title={t('insights.mark_all_read')}
          >
            <CheckCheck className="w-4 h-4" />
          </button>
          <button
            onClick={fetchInsights}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50"
            disabled={loading}
            title={t('insights.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            title={t('insights.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/20">
        {error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
            <AlertCircle className="w-10 h-10 mb-4 text-yellow-400/70" />
            <p className="text-sm text-gray-300">{error}</p>
            <button
              onClick={fetchInsights}
              className="mt-4 rounded-lg border border-cyan-500/30 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/10"
            >
              {t('insights.retry')}
            </button>
          </div>
        ) : loading && insights.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : insights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <Database className="w-7 h-7 opacity-50" />
            </div>
            <p className="text-sm text-gray-300">{t('insights.empty_title')}</p>
            <p className="text-xs mt-2 max-w-64 leading-5">{t('insights.empty_desc')}</p>
          </div>
        ) : (
          insights.map((insight) => (
            <div
              key={insight.id}
              className="bg-black/40 border border-cyan-500/20 rounded-lg p-4 relative group hover:border-cyan-500/50 transition-all hover:shadow-[0_0_15px_rgba(34,211,238,0.15)]"
            >
              <h3 className="text-cyan-300 font-medium text-sm mb-2 pr-8">{insight.title}</h3>
              <p className="text-gray-300 text-sm leading-relaxed">{insight.content}</p>
              
              <div className="flex items-center justify-between mt-4">
                <span
                  className="text-xs text-gray-500"
                  title={new Date(insight.created_at).toLocaleString()}
                >
                  {formatRelative(insight.created_at)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copyInsight(insight)}
                    title={t('actions.copy')}
                    className="flex items-center gap-1 text-xs text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity hover:text-cyan-300 hover:bg-cyan-500/10 px-2 py-1 rounded"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => favoriteInsight(insight)}
                    title={t('actions.favorite')}
                    className="flex items-center gap-1 text-xs text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity hover:text-yellow-300 hover:bg-yellow-500/10 px-2 py-1 rounded"
                  >
                    <Bookmark className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => markAsRead(insight.id)}
                    className="flex items-center gap-1 text-xs text-cyan-400 opacity-60 group-hover:opacity-100 transition-opacity hover:bg-cyan-500/20 px-2 py-1 rounded"
                  >
                    <Check className="w-3 h-3" />
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
