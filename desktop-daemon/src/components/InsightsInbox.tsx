import React, { useState, useEffect, useCallback } from 'react';
import { Check, CheckCheck, X, Sparkles, Database, RefreshCw, AlertCircle, Copy, Bookmark, Plus, Eye, ListTodo } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { apiFetch } from '@/lib/api-client';

const REFRESH_INTERVAL_MS = 20_000;
const CORE_TARGET_COUNT = 30;

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
  related_entities?: string[];
}

type ReviewFilter = { type?: string; coreOnly?: boolean; unlinkedOnly?: boolean };

interface ReviewTaskSummary {
  corePrinciples: {
    total: number;
    target: number;
    overLimit: number;
    lowSignal: number;
    demoteSamples: Array<{ id: string; name: string; access_count?: number }>;
  };
  unlinkedByType: Array<{
    type: string;
    total: number;
    samples: Array<{ id: string; name: string; access_count?: number }>;
  }>;
}

type ReviewAction = {
  kind: 'core-principles' | 'unlinked-type';
  label: string;
  filter: ReviewFilter;
  type?: string;
};

interface InsightsInboxProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity?: (id: string) => void;
  entities?: any[];
  onOpenMemoryManager?: (filter: ReviewFilter) => void;
}

/** 根据通知类型返回卡片样式配置 */
function getTypeStyles(type: string) {
  switch (type) {
    case 'blindspot':
      return {
        border: 'border-amber-500/25 hover:border-amber-500/50',
        shadow: 'hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]',
        title: 'text-amber-300',
        labelKey: 'insights.type.blindspot',
        labelClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        icon: Eye,
        tagBtn: 'border-amber-500/20 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15 hover:border-amber-500/40',
      };
    case 'decay_warning':
      return {
        border: 'border-rose-500/20 hover:border-rose-500/50',
        shadow: 'hover:shadow-[0_0_15px_rgba(244,63,94,0.15)]',
        title: 'text-rose-300',
        labelKey: 'insights.type.decay_warning',
        labelClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        icon: AlertCircle,
        tagBtn: 'border-rose-500/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15 hover:border-rose-500/40',
      };
    default: // insight, system, reminder
      return {
        border: 'border-cyan-500/20 hover:border-cyan-500/50',
        shadow: 'hover:shadow-[0_0_15px_rgba(34,211,238,0.15)]',
        title: 'text-cyan-300',
        labelKey: '',
        labelClass: '',
        icon: null,
        tagBtn: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/15 hover:border-cyan-500/40',
      };
  }
}

export default function InsightsInbox({ isOpen, onClose, onSelectEntity, entities, onOpenMemoryManager }: InsightsInboxProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [reviewTasks, setReviewTasks] = useState<ReviewTaskSummary | null>(null);

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
  }, [t]);

  const fetchReviewTasks = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/review/tasks?targetCoreCount=${CORE_TARGET_COUNT}`);
      if (!res.ok) return;
      setReviewTasks(await res.json());
    } catch (e) {
      console.warn('Failed to fetch review tasks', e);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchInsights();
    fetchReviewTasks();
    const timer = setInterval(fetchInsights, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isOpen, fetchInsights, fetchReviewTasks]);

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
    if (favIds.has(i.id)) { toast.success(t('actions.favorited')); return; }
    const content = `${i.title}\n\n${i.content}`;
    try {
      // 去重：已有一模一样的收藏就不再重复存
      const existing = await apiFetch('/api/memory/archival').then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const dup = Array.isArray(existing) && existing.some((x: any) => Array.isArray(x.tags) && x.tags.includes('收藏') && x.content === content);
      if (!dup) {
        const r = await apiFetch('/api/memory/archival', {
          method: 'POST',
          body: JSON.stringify({ content, summary: i.title, tags: ['收藏'], importance: 0.8 }),
        });
        if (!r.ok) throw new Error();
      }
      setFavIds((s) => new Set(s).add(i.id));
      toast.success(t('actions.favorited'));
    } catch { toast.error(t('actions.favorite_failed')); }
  }, [favIds, toast, t]);

  const promoteInsight = useCallback(async (insight: Insight) => {
    setInsights((prev) => prev.filter((i) => i.id !== insight.id));
    try {
      const res = await apiFetch(`/api/notifications/${insight.id}/promote`, {
        method: 'POST',
      });
      if (res.ok) {
        toast.success(t('actions.promoted_to_graph'));
      } else {
        throw new Error();
      }
    } catch (e) {
      console.warn('Failed to promote insight', e);
      toast.error(t('actions.promote_failed'));
      fetchInsights();
    }
  }, [fetchInsights, toast, t]);

  const promoteAllInsights = useCallback(async () => {
    const insightItems = insights.filter((i) => i.type === 'insight');
    if (insightItems.length === 0) return;
    const ids = insightItems.map((i) => i.id);
    setInsights((prev) => prev.filter((i) => i.type !== 'insight'));
    const results = await Promise.allSettled(
      ids.map((id) =>
        apiFetch(`/api/notifications/${id}/promote`, { method: 'POST' }).then((r) => r.ok)
      )
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    if (succeeded === ids.length) {
      toast.success(t('actions.promoted_all_to_graph'));
    } else {
      toast.error(t('actions.promote_all_failed'));
      fetchInsights();
    }
  }, [insights, fetchInsights, toast, t]);

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

  const getReviewAction = useCallback((insight: Insight): ReviewAction | null => {
    if (
      insight.title.startsWith('🌙 睡眠整理报告：核心原则')
      || (insight.title === '🌙 睡眠整理报告' && insight.content.includes('核心原则'))
    ) {
      return { kind: 'core-principles', label: '整理核心原则', filter: { type: 'principle', coreOnly: true } };
    }
    const pendingType = insight.title.match(/^(?:待整理主题|未深入主题)：([^\s]+)(?:\s+类型)?/);
    if (pendingType) {
      return { kind: 'unlinked-type', label: '查看待整理内容', type: pendingType[1], filter: { type: pendingType[1], unlinkedOnly: true } };
    }
    return null;
  }, []);

  const getReviewDetail = useCallback((action: ReviewAction) => {
    if (action.kind === 'core-principles') {
      const task = reviewTasks?.corePrinciples;
      if (!task) return null;
      return {
        title: `当前 ${task.total} 条核心原则，目标约 ${task.target} 条`,
        desc: task.overLimit > 0
          ? `建议先降级 ${task.overLimit} 条低引用原则；其中 ${task.lowSignal} 条几乎没有被检索使用。`
          : '当前核心原则数量合理，可以只做逐条复核。',
        samples: task.demoteSamples,
      };
    }
    const task = reviewTasks?.unlinkedByType.find((x) => x.type === action.type);
    if (!task) return null;
    return {
      title: `${task.type} 孤立内容 ${task.total} 条`,
      desc: '这些内容没有关系边，优先合并、补关系或删除低价值条目，避免稀释检索。',
      samples: task.samples,
    };
  }, [reviewTasks]);

  const demoteExcessCorePrinciples = useCallback(async () => {
    const total = reviewTasks?.corePrinciples.total ?? 0;
    const overLimit = reviewTasks?.corePrinciples.overLimit ?? 0;
    if (overLimit <= 0) {
      toast.success('核心原则数量已经在建议范围内');
      return;
    }
    if (!confirm(`将核心原则从 ${total} 条降到约 ${CORE_TARGET_COUNT} 条？\n低引用原则会降为普通原则，不会删除内容。`)) return;
    try {
      const res = await apiFetch('/api/review/core-principles/demote-excess', {
        method: 'POST',
        body: JSON.stringify({ targetCoreCount: CORE_TARGET_COUNT }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`已降级 ${data.demoted || 0} 条核心原则`);
      fetchReviewTasks();
    } catch (e) {
      console.warn('Failed to demote excess core principles', e);
      toast.error('批量降级失败');
    }
  }, [fetchReviewTasks, reviewTasks, toast]);

  const openReviewTask = useCallback(async (insight: Insight, filter: ReviewFilter) => {
    onOpenMemoryManager?.(filter);
    onClose();
    try {
      await apiFetch(`/api/notifications/${insight.id}/read`, { method: 'POST' });
    } catch (e) {
      console.warn('Failed to mark review task as read', e);
    }
  }, [onClose, onOpenMemoryManager]);

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
            onClick={promoteAllInsights}
            className="p-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors disabled:opacity-30"
            disabled={insights.filter((i) => i.type === 'insight').length === 0}
            title={t('actions.promote_all_to_graph')}
          >
            <Plus className="w-4 h-4" />
          </button>
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
          insights.map((insight) => {
            const styles = getTypeStyles(insight.type);
            const TypeIcon = styles.icon;
            const reviewAction = getReviewAction(insight);
            const reviewDetail = reviewAction ? getReviewDetail(reviewAction) : null;
            return (
            <div
              key={insight.id}
              className={`bg-black/40 border ${styles.border} rounded-lg p-4 relative group transition-all ${styles.shadow}`}
            >
              <div className="flex items-center gap-2 mb-2 pr-8">
                {styles.labelKey && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${styles.labelClass}`}>
                    {TypeIcon && <TypeIcon className="w-3 h-3" />}
                    {t(styles.labelKey)}
                  </span>
                )}
                <h3 className={`${styles.title} font-medium text-sm`}>{insight.title}</h3>
              </div>
              <p className="text-gray-300 text-sm leading-relaxed">{insight.content}</p>

              {reviewAction && onOpenMemoryManager && (
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  {reviewDetail && (
                    <>
                      <div className="text-xs font-semibold text-emerald-200">{reviewDetail.title}</div>
                      <div className="mt-1 text-xs leading-5 text-gray-400">{reviewDetail.desc}</div>
                      {reviewDetail.samples.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {reviewDetail.samples.slice(0, 3).map((sample) => (
                            <span key={sample.id} className="max-w-[12rem] truncate rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-gray-300">
                              {sample.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => openReviewTask(insight, reviewAction.filter)}
                      className="inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                      {reviewAction.label}
                    </button>
                    {reviewAction.kind === 'core-principles' && (
                      <button
                        onClick={demoteExcessCorePrinciples}
                        disabled={!reviewTasks || (reviewTasks.corePrinciples.overLimit || 0) <= 0}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
                      >
                        一键降到约 {CORE_TARGET_COUNT} 条
                      </button>
                    )}
                  </div>
                </div>
              )}

              {onSelectEntity && insight.related_entities && insight.related_entities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 items-center">
                  <span className="text-[11px] text-gray-500 font-medium">{t('insights.related_entities')}</span>
                  {insight.related_entities.map((id) => {
                    const ent = entities?.find((e: any) => e.id === id);
                    if (!ent) return null;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          onSelectEntity(id);
                          onClose();
                        }}
                        className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${styles.tagBtn}`}
                        title={ent.description}
                      >
                        {ent.name}
                      </button>
                    );
                  })}
                </div>
              )}
              
              <div className="flex items-center justify-between mt-4">
                <span
                  className="text-xs text-gray-500"
                  title={new Date(insight.created_at).toLocaleString()}
                >
                  {formatRelative(insight.created_at)}
                </span>
                <div className="flex items-center gap-1">
                  {insight.type === 'insight' && (
                    <button
                      onClick={() => promoteInsight(insight)}
                      title={t('actions.promote_to_graph')}
                      className="flex items-center gap-1 text-xs text-green-400 opacity-60 group-hover:opacity-100 transition-opacity hover:text-green-300 hover:bg-green-500/10 px-2 py-1 rounded"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{t('actions.promote_to_graph')}</span>
                    </button>
                  )}
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
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-opacity ${favIds.has(insight.id) ? 'text-yellow-300 opacity-100' : 'text-gray-400 opacity-60 group-hover:opacity-100 hover:text-yellow-300 hover:bg-yellow-500/10'}`}
                  >
                    <Bookmark className={`w-3 h-3 ${favIds.has(insight.id) ? 'fill-yellow-400/40' : ''}`} />
                  </button>
                  <button
                    onClick={() => markAsRead(insight.id)}
                    className="flex items-center gap-1 text-xs text-cyan-400 opacity-60 group-hover:opacity-100 transition-opacity hover:bg-cyan-500/20 px-2 py-1 rounded"
                  >
                    <Check className="w-3 h-3" />
                    {t('insights.dismiss')}
                  </button>
                </div>
              </div>
            </div>
          );
          })
        )}
      </div>
    </div>
  );
}
