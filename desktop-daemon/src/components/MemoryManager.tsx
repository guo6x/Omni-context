"use client";

import { X, Upload, Trash2, Star, Search, RefreshCw, Database, FileUp, Copy, Bookmark } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/hooks/useToast';
import { useTranslation } from '@/hooks/useTranslation';
import { IngestJobError, pollIngestJob, summarizeIngestJob, type IngestSummary } from '@/lib/ingest-job';
import {
  clearPersistedImportAttempt, createImportRecoveryAttemptId,
  flushNativeImportRecovery, getPendingImportJobs, hydrateNativeImportRecovery,
  persistImportJob, persistUncertainImport,
} from '@/lib/import-job-recovery';
import {
  acknowledgeImportRecovery,
  createImportSubmission,
  fingerprintImportContent,
  releaseImportContentReservation,
  reserveImportContent,
  settleImportOutcome,
  updateImportContentReservation,
} from '@/lib/import-submission';

interface ReviewItem {
  id: string;
  name: string;
  type: string;
  description: string;
  tags: string[];
  created_at: string;
  access_count: number;
  isCore: boolean;
  source: string;
  provenance: { source?: string; platform?: string; tool?: string; at?: string } | null;
}

interface ReviewTaskSummary {
  corePrinciples: {
    total: number;
    target: number;
    overLimit: number;
    lowSignal: number;
  };
  unlinkedByType: Array<{ type: string; total: number }>;
}

const CORE_TARGET_COUNT = 30;

const SOURCE_FILTERS: Array<{ key: string; label: string; cls: string }> = [
  { key: '', label: '全部', cls: 'text-gray-300' },
  { key: '__user__', label: '你写的', cls: 'text-emerald-400' },
  { key: 'external_ai', label: '外部 AI', cls: 'text-purple-400' },
  { key: 'import', label: '导入', cls: 'text-cyan-400' },
  { key: 'auto_sediment', label: '自动沉淀', cls: 'text-amber-400' },
];

function sourceBadge(it: ReviewItem): { text: string; cls: string } {
  const s = it.source || 'user';
  const date = it.created_at ? it.created_at.slice(5, 10) : '';
  if (s === 'external_ai') return { text: `外部AI·${it.provenance?.tool || ''} ${date}`, cls: 'text-purple-300 border-purple-500/40 bg-purple-500/10' };
  if (s === 'import') return { text: `导入·${it.provenance?.platform || ''} ${date}`, cls: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' };
  if (s === 'auto_sediment') return { text: `自动沉淀 ${date}`, cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
  return { text: `你 · ${date}`, cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' };
}

interface MemoryManagerProps {
  onClose: () => void;
  onDataChanged?: () => void;
  initialType?: string;
  initialCoreOnly?: boolean;
  initialUnlinkedOnly?: boolean;
  filterRequestId?: number;
}

export default function MemoryManager({
  onClose,
  onDataChanged,
  initialType = '',
  initialCoreOnly = false,
  initialUnlinkedOnly = false,
  filterRequestId = 0,
}: MemoryManagerProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [tab, setTab] = useState<'browse' | 'import' | 'favorites'>('browse');

  // ── 浏览 ──
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [source, setSource] = useState('');
  const [type, setType] = useState(initialType);
  const [coreOnly, setCoreOnly] = useState(initialCoreOnly);
  const [unlinkedOnly, setUnlinkedOnly] = useState(initialUnlinkedOnly);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');  // 搜索 debounce，避免每键触发 API
  const [loading, setLoading] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<ReviewItem | null>(null);
  const [detailItem, setDetailItem] = useState<ReviewItem | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewTaskSummary | null>(null);
  const mountedRef = useRef(true);
  const loadControllerRef = useRef<AbortController | null>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const importRunRef = useRef(0);
  const importBusyRef = useRef(false);
  const pendingJobRef = useRef<string | null>(null);
  const pendingAttemptRef = useRef<string | null>(null);
  const pendingContentFingerprintRef = useRef<string | null>(null);
  const acknowledgementRequiredRef = useRef(false);
  const recoveryHydratedRef = useRef(false);

  // 外部定位只同步浏览筛选，不用 key 重挂整页，避免清掉尚未确认的导入任务。
  useEffect(() => {
    setType(initialType);
    setCoreOnly(initialCoreOnly);
    setUnlinkedOnly(initialUnlinkedOnly);
    setSource('');
    setQ('');
    setDebouncedQ('');
    setTab('browse');
    setMergeFrom(null);
    setDetailItem(null);
  }, [initialType, initialCoreOnly, initialUnlinkedOnly, filterRequestId]);

  // 搜索 debounce：300ms 内连续输入只触发一次 API
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importRunRef.current++;
      importControllerRef.current?.abort();
      loadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      await hydrateNativeImportRecovery();
      recoveryHydratedRef.current = true;
      if (!active) return;
      const recoveries = getPendingImportJobs().filter((record) => record.owner === 'library');
      const recovery = recoveries[0];
      if (!recovery) return;
      if (recovery.kind === 'job') {
        pendingJobRef.current = recovery.jobId;
        setResumeJobId(recovery.jobId);
        setImportTone('warning');
        setImportMsg('已恢复上次导入任务。继续查询只读取原任务，不会重新上传。');
      } else {
        pendingAttemptRef.current = recovery.attemptId;
        acknowledgementRequiredRef.current = true;
        setRequiresAcknowledgement(true);
        setImportTone('warning');
        setImportMsg('上次提交结果未确认，无法安全判断是否已收到。请先检查记忆库，再确认后才能重新导入。');
      }
    })();
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (source) params.set('source', source);
      if (type) params.set('type', type);
      if (coreOnly) params.set('coreOnly', 'true');
      if (unlinkedOnly) params.set('unlinkedOnly', 'true');
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
      const [r, c, review] = await Promise.all([
        apiFetch(`/api/entities/review?${params.toString()}`, { signal: controller.signal }),
        apiFetch('/api/entities/sources', { signal: controller.signal }),
        apiFetch(`/api/review/tasks?targetCoreCount=${CORE_TARGET_COUNT}`, { signal: controller.signal }),
      ]);
      if (!r.ok || !c.ok) throw new Error('加载失败');
      const [data, sourceCounts, tasks] = await Promise.all([r.json(), c.json(), review.ok ? review.json() : null]);
      if (!mountedRef.current || controller.signal.aborted || loadControllerRef.current !== controller) return;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setCounts(sourceCounts || {});
      if (tasks) setReviewSummary(tasks);
    } catch {
      if (mountedRef.current && !controller.signal.aborted && loadControllerRef.current === controller) toast.error('加载失败');
    } finally {
      if (mountedRef.current && !controller.signal.aborted && loadControllerRef.current === controller) setLoading(false);
    }
  }, [source, type, coreOnly, unlinkedOnly, debouncedQ, toast]);

  const importCallbacksRef = useRef({ load, onDataChanged, toast });
  useEffect(() => { importCallbacksRef.current = { load, onDataChanged, toast }; }, [load, onDataChanged, toast]);

  useEffect(() => { if (tab === 'browse') load(); }, [tab, source, type, coreOnly, unlinkedOnly, debouncedQ, load]);

  // ── 收藏夹（存在 archival、打"收藏"标签的记忆）──
  const [favs, setFavs] = useState<Array<{ id: string; content: string; summary?: string; createdAt?: string }>>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favDetail, setFavDetail] = useState<{ id: string; content: string; summary?: string; createdAt?: string } | null>(null);
  const loadFavs = useCallback(async () => {
    setFavLoading(true);
    try {
      const r = await apiFetch('/api/memory/archival');
      const data = await r.json();
      setFavs((Array.isArray(data) ? data : []).filter((x: any) => Array.isArray(x.tags) && x.tags.includes('收藏')));
    } catch { toast.error('加载失败'); }
    finally { setFavLoading(false); }
  }, [toast]);
  useEffect(() => { if (tab === 'favorites') loadFavs(); }, [tab, loadFavs]);
  async function copyFav(content: string) {
    try { await navigator.clipboard.writeText(content); toast.success('已复制'); }
    catch { toast.error('复制失败'); }
  }
  async function removeFav(id: string) {
    try { await apiFetch(`/api/memory/archival/${id}`, { method: 'DELETE' }); setFavs((xs) => xs.filter((x) => x.id !== id)); toast.success('已取消收藏'); }
    catch { toast.error('操作失败'); }
  }

  async function callTool(name: string, args: any) {
    const r = await apiFetch(`/api/mcp/tool/${name}`, { method: 'POST', body: JSON.stringify({ arguments: args }) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function toggleCore(it: ReviewItem) {
    try { await callTool('set_core_principle', { id: it.id, isCore: !it.isCore }); setItems((xs) => xs.map((x) => x.id === it.id ? { ...x, isCore: !x.isCore } : x)); }
    catch { toast.error('操作失败'); }
  }
  async function del(it: ReviewItem) {
    if (!confirm(`删除「${it.name}」？不可恢复。`)) return;
    try { await callTool('delete_entity', { id: it.id }); setItems((xs) => xs.filter((x) => x.id !== it.id)); toast.success('已删除'); }
    catch { toast.error('删除失败'); }
  }
  async function doMerge(target: ReviewItem) {
    if (!mergeFrom || mergeFrom.id === target.id) { setMergeFrom(null); return; }
    try {
      await callTool('merge_entities', { keepId: target.id, dropId: mergeFrom.id });
      setItems((xs) => xs.filter((x) => x.id !== mergeFrom.id));
      toast.success(`已并入「${target.name}」`);
    } catch { toast.error('合并失败'); }
    setMergeFrom(null);
  }

  async function demoteLowSignalCoreOnPage() {
    const candidates = items.filter((it) => it.isCore && it.type === 'principle' && it.access_count <= 1);
    if (candidates.length === 0) {
      toast.success('本页没有低频核心原则需要降级');
      return;
    }
    if (!confirm(`将本页 ${candidates.length} 条低频核心原则降为普通原则？`)) return;
    setBatchBusy(true);
    const ids = new Set(candidates.map((it) => it.id));
    setItems((xs) => xs.map((x) => ids.has(x.id) ? { ...x, isCore: false } : x));
    const results = await Promise.allSettled(candidates.map((it) => callTool('set_core_principle', { id: it.id, isCore: false })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setBatchBusy(false);
    toast.success(`已降级 ${ok} 条核心原则`);
    if (ok !== candidates.length) load();
  }

  async function demoteExcessCorePrinciples() {
    const summary = reviewSummary?.corePrinciples;
    if (!summary || summary.overLimit <= 0) {
      toast.success('核心原则数量已经在建议范围内');
      return;
    }
    if (!confirm(`将核心原则从 ${summary.total} 条降到约 ${CORE_TARGET_COUNT} 条？\n低引用原则会降为普通原则，不会删除内容。`)) return;
    setBatchBusy(true);
    try {
      const r = await apiFetch('/api/review/core-principles/demote-excess', {
        method: 'POST',
        body: JSON.stringify({ targetCoreCount: CORE_TARGET_COUNT }),
      });
      if (!r.ok) throw new Error(await r.text());
      const result = await r.json();
      toast.success(`已降级 ${result.demoted || 0} 条核心原则`);
      await load();
    } catch {
      toast.error('批量降级失败');
    } finally {
      setBatchBusy(false);
    }
  }

  async function deleteLowSignalUnlinkedConceptsOnPage() {
    const candidates = items.filter((it) => it.type === 'concept' && it.access_count === 0);
    if (candidates.length === 0) {
      toast.success('本页没有未访问的孤立 concept 可清理');
      return;
    }
    if (!confirm(`删除本页 ${candidates.length} 条未访问的孤立 concept？不可恢复。`)) return;
    setBatchBusy(true);
    const ids = new Set(candidates.map((it) => it.id));
    setItems((xs) => xs.filter((x) => !ids.has(x.id)));
    const results = await Promise.allSettled(candidates.map((it) => callTool('delete_entity', { id: it.id })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setBatchBusy(false);
    toast.success(`已清理 ${ok} 条孤立 concept`);
    if (ok !== candidates.length) load();
  }

  // ── 导入 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState('');
  const [importing, setImporting] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number; entities: number } | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [importTone, setImportTone] = useState<'neutral' | 'success' | 'warning' | 'error'>('neutral');
  const [importSummary, setImportSummary] = useState<IngestSummary | null>(null);
  const [resumeJobId, setResumeJobId] = useState<string | null>(null);
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false);

  function isCurrentImport(run: number, controller: AbortController) {
    return mountedRef.current && importRunRef.current === run && importControllerRef.current === controller;
  }

  function refreshImportData() {
    const current = importCallbacksRef.current;
    void current.load();
    try { current.onDataChanged?.(); }
    catch { current.toast.warning('界面刷新未完成', '请手动刷新记忆库，核对已保存的内容。'); }
  }

  async function watchImport(jobId: string, run: number, controller: AbortController) {
    try {
      const job = await pollIngestJob(jobId, {
        signal: controller.signal,
        onProgress: (snapshot) => {
          if (isCurrentImport(run, controller) && snapshot.importProgress) setProg(snapshot.importProgress);
        },
      });
      if (!isCurrentImport(run, controller)) return;
      const summary = summarizeIngestJob(job);
      const units = summary.total > 0 ? `成功处理 ${summary.completed}/${summary.total} 段 · ` : '';
      const saved = summary.countsKnown
        ? `已保存 ${summary.entities} 条记忆 / ${summary.relationships} 条关系`
        : '已保存数量暂时无法确认，请检查记忆库';
      const modeWarning = summary.extractionMode === 'unknown'
        ? '处理方式未知：回执未记录是否使用配置的 AI 服务或仅本地处理；Omni 不作本地或云端承诺。'
        : '';
      const failures = summary.failures > 0 ? ` · ${summary.failures} 项未完成` : '';
      const coverage = summary.coverage !== undefined ? ` · 覆盖 ${Math.round(summary.coverage * 100)}%` : '';
      const detail = `${modeWarning ? `${modeWarning} · ` : ''}${units}${saved}${failures}${coverage}`;
      const requiresAcknowledgement = settleImportOutcome(
        summary.outcome, 'library', pendingContentFingerprintRef.current, jobId, pendingAttemptRef.current,
      );
      await flushNativeImportRecovery();
      importBusyRef.current = false;
      if (requiresAcknowledgement) {
        pendingJobRef.current = jobId;
        acknowledgementRequiredRef.current = true;
        setRequiresAcknowledgement(true);
      } else {
        pendingJobRef.current = null;
        pendingAttemptRef.current = null;
        pendingContentFingerprintRef.current = null;
        acknowledgementRequiredRef.current = false;
        setRequiresAcknowledgement(false);
      }
      setImporting(false);
      setResumeJobId(null);
      setImportSummary(summary);
      setProg(summary.countsKnown ? { done: summary.completed, total: summary.total, entities: summary.entities } : null);
      const current = importCallbacksRef.current;

      if (summary.outcome === 'success' || summary.outcome === 'partial') {
        const partial = summary.outcome === 'partial';
        setImportTone(partial ? 'warning' : 'success');
        setImportMsg(`${partial ? '部分导入完成' : '导入完成'} · ${detail}${partial
          ? `。${job.error ? `${job.error}。` : ''}已保存内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。`
          : ''}`);
        if (partial) current.toast.warning('部分导入完成', job.error ? `${detail} · ${job.error}` : detail);
        else current.toast.success('导入完成', detail);
      } else if (summary.outcome === 'cancelled') {
        setImportTone('warning');
        setImportMsg(`导入已取消 · ${detail}。已保存内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。`);
        current.toast.info('导入已取消', saved);
      } else {
        setImportTone('error');
        setImportMsg(`导入失败：${job.error || '处理未完成'} · ${detail}。已保存内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。`);
        current.toast.error('导入失败', job.error || '请先检查已保存的记忆，再决定是否重新导入。');
      }
      // Failed and cancelled tasks may also have persisted content before stopping.
      refreshImportData();
    } catch (error) {
      if (!isCurrentImport(run, controller)) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      const expired = error instanceof IngestJobError && error.code === 'expired';
      const invalid = error instanceof IngestJobError && error.code === 'invalid';
      const needsAcknowledgement = expired || invalid;
      importBusyRef.current = false;
      setImporting(false);
      if (needsAcknowledgement) {
        updateImportContentReservation(pendingContentFingerprintRef.current, 'library', { phase: 'uncertain' });
      }
      setImportTone('warning');
      setResumeJobId(needsAcknowledgement ? null : jobId);
      if (needsAcknowledgement) {
        acknowledgementRequiredRef.current = true;
        setRequiresAcknowledgement(true);
        setProg(null);
        refreshImportData();
      }
      setImportMsg(error instanceof IngestJobError && error.code === 'unauthorized'
        ? '连接未授权。请重新连接桌面端后继续查询，后台导入可能仍在进行。'
        : expired ? '任务状态已过期。已保存内容不会回滚，请先浏览记忆库，避免重复导入。'
        : invalid ? '任务状态无效，无法确认导入结果。请先核对记忆库，再决定是否开始新的导入。'
        : error instanceof IngestJobError && error.code === 'timeout'
          ? '查询超时，后台导入可能仍在进行。继续查询原任务，不会重新上传。'
          : '暂时无法读取任务状态，后台导入可能仍在进行。继续查询原任务，不会重新上传。');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!recoveryHydratedRef.current) {
      e.target.value = '';
      setImportTone('warning');
      setImportMsg('正在恢复上次导入状态，请稍后再选择文件。');
      return;
    }
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || importBusyRef.current || pendingJobRef.current || acknowledgementRequiredRef.current || !mountedRef.current) return;
    importBusyRef.current = true;
    const run = ++importRunRef.current;
    const controller = new AbortController();
    importControllerRef.current = controller;
    setImporting(true); setProg(null); setImportSummary(null); setResumeJobId(null); setImportTone('neutral'); setImportMsg('解析中…');
    let submissionUncertain = false;
    let fingerprint: string | null = null;
    const submission = createImportSubmission(controller);
    try {
      const bytes = await submission.wait(() => f.arrayBuffer());
      fingerprint = await submission.wait(() => fingerprintImportContent(bytes));
      if (!isCurrentImport(run, controller)) return;
      const reservation = reserveImportContent(fingerprint, 'library');
      if (!reservation.reserved) {
        importBusyRef.current = false;
        setImporting(false);
        setImportTone('warning');
        setImportMsg(reservation.reason === 'fingerprint-unavailable'
          ? t('upload.fingerprint_unavailable')
          : reservation.reason === 'recovery-required'
            ? '检测到上次导入尚未恢复或核对，已暂停新的上传。请先处理已有任务；不会自动重新上传。'
            : `相同内容已在${reservation.existing.owner === 'onboarding' ? '首次使用引导' : reservation.existing.owner === 'file-drop' ? '文件导入' : '记忆库导入'}中处理或待核对，已阻止重复上传。请回到原任务查看结果。`);
        return;
      }
      pendingContentFingerprintRef.current = fingerprint;
      const text = new TextDecoder('utf-8').decode(bytes);
      const body = submission.prepare(() => {
        const payload: { text: string; maxConversations?: number } = { text };
        if (limit.trim() && Number(limit) > 0) payload.maxConversations = Number(limit);
        return JSON.stringify(payload);
      });
      const r = await submission.wait(async () => {
        pendingAttemptRef.current = createImportRecoveryAttemptId();
        if (!persistUncertainImport('library', pendingAttemptRef.current)) {
          pendingAttemptRef.current = null;
          throw new Error('无法保存恢复标记，为避免重复导入，本次未提交。请检查本地存储后重试。');
        }
        await flushNativeImportRecovery();
        submissionUncertain = true;
        return apiFetch('/api/import/chat', { method: 'POST', body, signal: controller.signal });
      });
      if (!r.ok) {
        submissionUncertain = r.status >= 500;
        if (!submissionUncertain && pendingAttemptRef.current) {
          clearPersistedImportAttempt('library', pendingAttemptRef.current);
          await flushNativeImportRecovery();
          pendingAttemptRef.current = null;
        }
        throw new Error(await submission.wait(() => r.text()));
      }
      const { jobId, platform, parsed, importing: imp } = await submission.wait(() => r.json());
      if (!isCurrentImport(run, controller)) return;
      if (controller.signal.aborted || typeof jobId !== 'string' || !jobId) throw new Error('未收到有效任务编号');
      submission.dispose();
      pendingJobRef.current = jobId;
      const recoverySaved = persistImportJob('library', jobId, pendingAttemptRef.current || undefined);
      await flushNativeImportRecovery();
      if (recoverySaved) pendingAttemptRef.current = null;
      updateImportContentReservation(fingerprint, 'library', { phase: 'running', jobId });
      setImportMsg(`识别为 ${platform} · 解析到 ${parsed} 段，正在抽取 ${imp} 段${recoverySaved ? '' : '。本地无法保存恢复记录，请勿关闭应用，直至任务结束并核对结果。'}`);
      await watchImport(jobId, run, controller);
    } catch (err) {
      if (!isCurrentImport(run, controller)) return;
      importBusyRef.current = false;
      setImporting(false);
      setImportTone(submissionUncertain ? 'warning' : 'error');
      if (submissionUncertain) {
        updateImportContentReservation(fingerprint, 'library', { phase: 'uncertain' });
        acknowledgementRequiredRef.current = true;
        setRequiresAcknowledgement(true);
        refreshImportData();
      } else {
        releaseImportContentReservation(fingerprint, 'library');
        if (pendingAttemptRef.current) {
          clearPersistedImportAttempt('library', pendingAttemptRef.current);
          await flushNativeImportRecovery();
        }
        pendingAttemptRef.current = null;
        pendingContentFingerprintRef.current = null;
      }
      setImportMsg(submissionUncertain
        ? '未能确认提交结果，后台可能已收到文件。请先浏览记忆库，避免重复导入。'
        : submission.timedOut
          ? '读取或准备文件已超过 30 秒，尚未提交。可以重新选择文件。'
          : `导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      submission.dispose();
    }
  }

  function resumeImport() {
    const jobId = pendingJobRef.current;
    if (!jobId || importBusyRef.current || acknowledgementRequiredRef.current || !mountedRef.current) return;
    importBusyRef.current = true;
    const run = ++importRunRef.current;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    setImporting(true);
    setResumeJobId(null);
    setImportTone('neutral');
    setImportMsg('继续查询原任务，不会重新上传…');
    void watchImport(jobId, run, controller);
  }

  async function acknowledgeImportUncertainty() {
    if (!acknowledgementRequiredRef.current || importBusyRef.current || !mountedRef.current) return;
    importRunRef.current++;
    importControllerRef.current?.abort();
    const jobId = pendingJobRef.current;
    pendingJobRef.current = null;
    acknowledgeImportRecovery('library', pendingContentFingerprintRef.current, jobId, pendingAttemptRef.current);
    await flushNativeImportRecovery();
    pendingAttemptRef.current = null;
    acknowledgementRequiredRef.current = false;
    pendingContentFingerprintRef.current = null;
    setRequiresAcknowledgement(false);
    setResumeJobId(null);
    setProg(null);
    setImportSummary(null);
    setImportTone('neutral');
    setImportMsg('已确认核对记忆库。现在可以选择新文件，不会自动提交。');
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <h2 id="memory-manager-dialog-title" className="flex items-center gap-2 text-[var(--color-fg)] font-semibold"><Database className="w-4 h-4 text-cyan-400" /> 记忆管理</h2>
          <button onClick={onClose} aria-label="关闭记忆管理" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-accent)]/10 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {(['browse', 'favorites', 'import'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === k ? 'bg-[var(--color-accent)]/15 text-[var(--color-fg)] font-medium border border-[var(--color-accent)]/30' : 'text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-accent)]/5'}`}>
              {k === 'browse' ? '浏览' : k === 'favorites' ? '收藏' : '导入'}
            </button>
          ))}
        </div>

        {tab === 'browse' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2 flex-wrap">
              {(type || coreOnly || unlinkedOnly) && (
                <div className="flex items-center gap-1.5">
                  {type && (
                    <button
                      onClick={() => setType('')}
                      className="text-xs rounded-md px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    >
                      类型：{type} ×
                    </button>
                  )}
                  {coreOnly && (
                    <button
                      onClick={() => setCoreOnly(false)}
                      className="text-xs rounded-md px-2.5 py-1 border border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                    >
                      仅核心原则 ×
                    </button>
                  )}
                  {unlinkedOnly && (
                    <button
                      onClick={() => setUnlinkedOnly(false)}
                      className="text-xs rounded-md px-2.5 py-1 border border-amber-500/40 bg-amber-500/10 text-amber-300"
                    >
                      仅孤立内容 ×
                    </button>
                  )}
                </div>
              )}
              {SOURCE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setSource(f.key)}
                  className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${source === f.key ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium' : 'border-[var(--color-border)] text-[var(--color-fgMuted)] hover:text-[var(--color-fg)]'}`}>
                  {f.label}{f.key && counts[f.key === '__user__' ? 'user' : f.key] != null ? ` ${counts[f.key === '__user__' ? 'user' : f.key]}` : ''}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 bg-[var(--color-bgSubtle)]/50">
                <Search className="w-3.5 h-3.5 text-[var(--color-fgMuted)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
                  placeholder="搜索…" className="bg-transparent text-sm text-[var(--color-fg)] py-1.5 w-40 outline-none placeholder:text-[var(--color-fgMuted)]/50" />
              </div>
              <button onClick={load} className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] transition-colors"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            {mergeFrom && <div className="px-5 pt-2 text-xs text-amber-500">合并模式：点另一条把「{mergeFrom.name}」并入它 · <button onClick={() => setMergeFrom(null)} className="underline font-semibold text-[var(--color-accent)]">取消</button></div>}
            {(coreOnly || unlinkedOnly) && (
              <div className="mx-5 mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                <div className="text-xs font-medium text-[var(--color-fg)]">
                  {coreOnly ? '核心原则整理' : '孤立内容整理'}
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--color-fgMuted)]">
                  {coreOnly
                    ? `当前核心原则 ${reviewSummary?.corePrinciples.total ?? total} 条，目标约 ${CORE_TARGET_COUNT} 条。先把低引用的通用原则降级，保留真正独特的核心。`
                    : '先处理本页未访问孤立 concept：这类内容通常来自批量导入，容易稀释检索质量。'}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {coreOnly && (
                    <>
                      <button
                        onClick={demoteExcessCorePrinciples}
                        disabled={batchBusy || !reviewSummary || reviewSummary.corePrinciples.overLimit <= 0}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        一键降到约 {CORE_TARGET_COUNT} 条
                      </button>
                      <button
                        onClick={demoteLowSignalCoreOnPage}
                        disabled={batchBusy || items.length === 0}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        只降级本页低频核心
                      </button>
                    </>
                  )}
                  {unlinkedOnly && (
                    <button
                      onClick={deleteLowSignalUnlinkedConceptsOnPage}
                      disabled={batchBusy || items.length === 0}
                      className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      批量清理本页未访问 concept
                    </button>
                  )}
                  <button
                    onClick={load}
                    disabled={batchBusy}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] disabled:opacity-50"
                  >
                    刷新筛选
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {items.map((it) => {
                const b = sourceBadge(it);
                const isCurrentMergeFrom = mergeFrom && mergeFrom.id === it.id;
                return (
                  <div key={it.id} className={`flex items-start gap-2 py-2.5 border-t border-[var(--color-border)]/40 cursor-pointer hover:bg-[var(--color-accent)]/5 transition-colors ${isCurrentMergeFrom ? 'bg-[var(--color-accent)]/10 border-l-2 border-l-[var(--color-accent)] pl-1' : ''}`}
                    onClick={() => mergeFrom ? doMerge(it) : setDetailItem(it)}>
                    <button onClick={(e) => { e.stopPropagation(); toggleCore(it); }} title="设/撤核心" className="mt-0.5">
                      <Star className={`w-4 h-4 ${it.isCore ? 'text-yellow-400 fill-yellow-400' : 'text-[var(--color-fgMuted)]/40 hover:text-yellow-400'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--color-fg)] truncate font-medium">{it.name} <span className="text-[10px] text-[var(--color-fgMuted)] bg-[var(--color-bgSubtle)] px-1 rounded ml-1">{it.type}{it.isCore ? ' · 核心' : ''}</span></div>
                      {it.description && <div className="text-xs text-[var(--color-fgMuted)] line-clamp-1 mt-0.5">{it.description}</div>}
                    </div>
                    <span className={`text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap self-center ${b.cls}`}>{b.text}</span>
                    <div className="flex items-center gap-2 whitespace-nowrap self-center ml-2">
                      <button onClick={(e) => { e.stopPropagation(); setMergeFrom(it); }} className="text-xs text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] transition-colors">合并</button>
                      <button onClick={(e) => { e.stopPropagation(); del(it); }} className="text-[var(--color-fgMuted)] hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {!loading && items.length === 0 && <div className="text-center text-[var(--color-fgMuted)] text-sm py-10">没有匹配的记忆</div>}
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="p-5 overflow-y-auto">
            <div className="text-sm text-[var(--color-fg)] font-medium">从 AI 聊天记录导入</div>
            <div className="text-xs text-[var(--color-fgMuted)] mt-1 leading-relaxed">把你和 ChatGPT / Claude / Gemini 的历史对话变成大脑记忆。对话的原始日期会保留，所以"上个月想了啥"也能召回。</div>
            <button type="button" disabled={importing || Boolean(resumeJobId) || requiresAcknowledgement} onClick={() => fileRef.current?.click()}
              className="mt-4 w-full border border-dashed border-[var(--color-border)] rounded-xl py-8 text-center transition-colors disabled:opacity-60 enabled:cursor-pointer enabled:hover:bg-[var(--color-accent)]/5 enabled:hover:border-[var(--color-accent)]/50">
              <FileUp className="w-6 h-6 mx-auto text-[var(--color-accent)] animate-pulse" />
              <div className="text-sm mt-2 text-[var(--color-fg)] font-medium">{importing ? '处理中…' : requiresAcknowledgement ? '导入结果待确认，请先核对记忆库' : resumeJobId ? '已有导入任务，请继续查询' : '选择导出文件'}</div>
              <div className="text-[11px] text-[var(--color-fgMuted)] mt-1">conversations.json / chat.html（ChatGPT/Claude） · My Activity（Gemini，HTML 或 JSON 都行）</div>
            </button>
            <input ref={fileRef} type="file" accept=".json,.html,.htm,application/json,text/html" disabled={importing || Boolean(resumeJobId) || requiresAcknowledgement} className="hidden" onChange={onFile} />
            <div className="mt-4 flex items-center gap-2 text-xs text-[var(--color-fgMuted)]">
              导入最近 <input value={limit} disabled={importing || Boolean(resumeJobId) || requiresAcknowledgement} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} placeholder="全部"
                className="w-16 text-center bg-[var(--color-bgSubtle)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-fg)] outline-none" /> 段（留空 = 全部）
            </div>
            {(importMsg || prog) && (
              <div role="status" aria-live="polite" data-import-outcome={importSummary?.outcome || (requiresAcknowledgement ? 'unconfirmed' : resumeJobId ? 'paused' : importTone === 'error' ? 'error' : 'pending')}
                className={`mt-4 rounded-lg border p-3 ${importTone === 'warning' ? 'border-amber-500/30 bg-amber-500/5' : importTone === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--color-border)] bg-[var(--color-bgSubtle)]/50'}`}>
                <div className={`text-xs leading-5 break-words ${importTone === 'warning' ? 'text-amber-300' : importTone === 'error' ? 'text-red-300' : 'text-[var(--color-fg)]'}`}>{importMsg}</div>
                {prog && prog.total > 0 && (
                  <>
                    <div className="text-xs text-[var(--color-fgMuted)] mt-1">{importSummary ? '成功处理' : '已处理（含失败项）'} <b className="text-[var(--color-fg)]">{prog.done}/{prog.total}</b> 段 · 已保存 <b className="text-[var(--color-accent)]">{prog.entities}</b> 条记忆</div>
                    <div className="h-1.5 bg-[var(--color-bgSubtle)] rounded mt-2 overflow-hidden"><div className={`h-full ${importTone === 'warning' || importTone === 'error' ? 'bg-amber-400' : 'bg-gradient-to-r from-cyan-400 to-purple-500'} ${importing ? 'animate-shimmer-fast' : ''}`} style={{ width: `${Math.max(0, Math.min(100, Math.round(prog.done / prog.total * 100)))}%` }} /></div>
                  </>
                )}
                {resumeJobId && <button type="button" onClick={resumeImport}
                  className="mt-3 rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10">
                  继续查询任务状态
                </button>}
                {requiresAcknowledgement && <button type="button" onClick={acknowledgeImportUncertainty}
                  className="mt-3 rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10">
                  已核对记忆库，允许重新选择
                </button>}
              </div>
            )}
            <div className="text-[11px] text-[var(--color-fgMuted)] mt-4">每段对话会跑一次 LLM 抽取（用你配置的模型）。导入在后台进行，可关闭此窗口。</div>
          </div>
        )}

        {tab === 'favorites' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2">
              <div className="text-xs text-[var(--color-fgMuted)]">收藏的洞见 · 共 {favs.length} 条（在洞察通知 / 问大脑里点 ★ 收藏）</div>
              <button onClick={loadFavs} className="ml-auto p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] transition-colors"><RefreshCw className={`w-4 h-4 ${favLoading ? 'animate-spin' : ''}`} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {favs.length === 0 && !favLoading && (
                <div className="text-sm text-[var(--color-fgMuted)] text-center py-12">还没有收藏。看到好洞见时点一下 ★ 就收进这里。</div>
              )}
              {favs.map((it) => (
                <div key={it.id} className="group flex items-start gap-2 py-2.5 border-t border-[var(--color-border)]/40">
                  <Bookmark className="w-4 h-4 text-yellow-400 fill-yellow-400/30 mt-0.5 shrink-0" />
                  <button onClick={() => setFavDetail(it)} title="点击放大查看" className="min-w-0 flex-1 text-left">
                    {it.summary && <div className="text-sm text-[var(--color-fg)] truncate font-semibold group-hover:text-[var(--color-accent)] transition-colors">{it.summary}</div>}
                    <div className="text-xs text-[var(--color-fgMuted)] whitespace-pre-wrap line-clamp-4 mt-0.5">{it.content}</div>
                    {it.createdAt && <div className="text-[10px] text-[var(--color-fgMuted)]/40 mt-1">{it.createdAt.slice(0, 10)}</div>}
                  </button>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button onClick={() => copyFav(it.content)} title="复制" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeFav(it.id)} title="取消收藏" className="p-1.5 text-[var(--color-fgMuted)] hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {favDetail && (
          <div className="absolute inset-0 z-10 flex flex-col rounded-2xl bg-[var(--color-bg)] border border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 min-w-0 text-[var(--color-fg)] font-semibold">
                <Bookmark className="w-4 h-4 text-yellow-400 fill-yellow-400/30 shrink-0" />
                <span className="truncate">{favDetail.summary || '收藏'}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => copyFav(favDetail.content)} title="复制" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] rounded-lg transition-colors"><Copy className="w-4 h-4" /></button>
                <button onClick={() => setFavDetail(null)} title="返回" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] rounded-lg transition-colors"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-[var(--color-fg)] whitespace-pre-wrap leading-relaxed">{favDetail.content}</div>
            {favDetail.createdAt && <div className="px-5 py-2 text-[10px] text-[var(--color-fgMuted)]/40 border-t border-[var(--color-border)]/40">{favDetail.createdAt.slice(0, 10)}</div>}
          </div>
        )}

        {detailItem && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-[var(--color-bg)] border border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 min-w-0 text-[var(--color-fg)] font-semibold">
                <Database className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                <span className="truncate">{detailItem.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => {
                  navigator.clipboard.writeText(detailItem.description || detailItem.name);
                  toast.success('描述已复制');
                }} title="复制描述" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] rounded-lg transition-colors">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => setDetailItem(null)} title="返回" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 基本元数据展示 */}
              <div className="grid grid-cols-2 gap-4 bg-[var(--color-bgSubtle)]/50 p-4 rounded-xl border border-[var(--color-border)]/40 text-xs">
                <div>
                  <span className="text-[var(--color-fgMuted)]">实体类型</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.type}</div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">来源</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">
                    {detailItem.source === 'external_ai' ? '外部 AI' : detailItem.source === 'import' ? '导入' : detailItem.source === 'auto_sediment' ? '自动沉淀' : '你写的'}
                  </div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">创建时间</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.created_at || '未知'}</div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">访问次数</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.access_count ?? 0} 次</div>
                </div>
              </div>

              {/* 标签列表 */}
              {detailItem.tags && detailItem.tags.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--color-fgMuted)]">标签</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {detailItem.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 text-[var(--color-accent)] font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 描述内容 */}
              <div className="flex flex-col flex-1">
                <span className="text-xs text-[var(--color-fgMuted)] mb-2 font-medium">描述内容</span>
                <div className="flex-1 min-h-[150px] p-4 bg-[var(--color-bgSubtle)] rounded-xl border border-[var(--color-border)] text-[var(--color-fg)] text-sm whitespace-pre-wrap leading-relaxed select-text overflow-y-auto">
                  {detailItem.description || <span className="text-[var(--color-fgMuted)] italic">暂无描述</span>}
                </div>
              </div>

              {/* 溯源信息 */}
              {detailItem.provenance && (
                <div className="text-[10px] text-[var(--color-fgMuted)]/60 border-t border-[var(--color-border)]/40 pt-3">
                  <span>溯源信息：</span>
                  {detailItem.provenance.platform && <span>平台 ({detailItem.provenance.platform}) </span>}
                  {detailItem.provenance.tool && <span>工具 ({detailItem.provenance.tool}) </span>}
                  {detailItem.provenance.at && <span>时间 ({detailItem.provenance.at}) </span>}
                </div>
              )}
            </div>
            
            {/* 底部动作条 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bgSubtle)]/30 rounded-b-2xl">
              <button 
                onClick={() => {
                  toggleCore(detailItem);
                  setDetailItem(prev => prev ? { ...prev, isCore: !prev.isCore } : null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  detailItem.isCore 
                    ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' 
                    : 'border-[var(--color-border)] hover:bg-[var(--color-bgSubtle)] text-[var(--color-fg)]'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${detailItem.isCore ? 'fill-yellow-500' : ''}`} />
                {detailItem.isCore ? '核心记忆' : '设为核心'}
              </button>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setMergeFrom(detailItem);
                    setDetailItem(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bgSubtle)] text-xs text-[var(--color-fg)] transition-colors"
                >
                  合并此实体
                </button>
                <button
                  onClick={() => {
                    del(detailItem);
                    setDetailItem(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                >
                  删除实体
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
