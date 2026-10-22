// 首次启动引导：价值优先的 4 步路径
// ① 连接模型 ② 导入并查看真实结果 ③ 接第二个 AI ④ 沉淀习惯
"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { LLM_PRESETS } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { AppSettings } from '@/hooks/useSettings';
import { apiFetch } from '@/lib/api-client';
import { pollIngestJob, summarizeIngestJob, type IngestJob } from '@/lib/ingest-job';
import {
  clearPersistedImportAttempt, createImportRecoveryAttemptId,
  flushNativeImportRecovery, getPendingImportJobs, hydrateNativeImportRecovery,
  persistImportJob, persistUncertainImport,
} from '@/lib/import-job-recovery';
import {
  acknowledgeImportRecovery, fingerprintImportContent, reserveImportContent,
  settleImportOutcome, updateImportContentReservation, releaseImportContentReservation,
} from '@/lib/import-submission';
import {
  X, Database, ChevronRight, ChevronLeft, Check, Upload,
  ArrowRight, Loader2, Copy, Brain, Sparkles, Eye, EyeOff
} from 'lucide-react';

async function safeInvoke<T = any>(cmd: string, args?: any): Promise<T | undefined> {
  if (typeof window === 'undefined') return;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`safeInvoke ${cmd} 失败:`, e);
    throw e;
  }
}

interface OnboardingWizardProps {
  settings: AppSettings;
  visible?: boolean;
  onUpdateBehavior: (updates: Partial<AppSettings['behavior']>) => void;
  onUpdateLlmProvider: (updates: Partial<AppSettings['llmProvider']>) => void;
  onImportComplete?: () => void;
  /** Keep parent-level modal dismissal in sync with the fail-closed import lock. */
  onImportPendingChange?: (pending: boolean) => void;
  onAskImported?: () => void;
  onClose: () => void;
  onOpenSettings?: (tab: 'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'mcp' | 'diagnostics' | 'privacy' | 'about') => void;
  triggerPrecipitate?: () => Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }>;
}

const TOTAL_STEPS = 4;
const IMPORT_SUBMIT_TIMEOUT_MS = 30_000;
// In the browser, invalidate old tests during commit, before a late response
// can run ahead of passive effects. Static rendering has no active requests.
const useProviderLifecycleEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// File 读取和 response.json 不一定响应 AbortSignal，也要在截止时间交还界面。
function abortableImport<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Stopped waiting for import submission', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
    if (signal.aborted) onAbort();
  });
}

function findProviderPreset(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/+$/, '');
  return LLM_PRESETS.find((preset) => preset.apiUrl && preset.apiUrl.replace(/\/+$/, '') === normalized)?.id || 'custom';
}

export default function OnboardingWizard({
  settings, visible = true, onUpdateBehavior, onUpdateLlmProvider, onImportComplete, onImportPendingChange, onAskImported, onClose, onOpenSettings,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const { t } = useTranslation();
  const toast = useToast();

  // ① LLM
  const providerRevisionRef = useRef(0);
  const providerVisibleRef = useRef(visible);
  const providerTestControllerRef = useRef<AbortController | null>(null);
  const successfulProviderRef = useRef<AppSettings['llmProvider'] | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState(() => findProviderPreset(settings.llmProvider.apiUrl));
  const [apiUrl, setApiUrl] = useState(settings.llmProvider.apiUrl);
  const [apiKey, setApiKey] = useState(settings.llmProvider.apiKey);
  const [model, setModel] = useState(settings.llmProvider.model);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testError, setTestError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // ② 上传只提交一次；断线后恢复的是同一个任务的只读状态查询。
  const fileRef = useRef<HTMLInputElement>(null);
  const importControllerRef = useRef<AbortController | null>(null);
  const importFingerprintRef = useRef<string | null>(null);
  const importRecoveryAttemptRef = useRef<string | null>(null);
  const importBusyRef = useRef(false);
  const importPendingRef = useRef(false);
  const recoveryHydratedRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [needsImportReview, setNeedsImportReview] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importAlert, setImportAlert] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [canResumeImport, setCanResumeImport] = useState(false);
  const [importReceipt, setImportReceipt] = useState<ReturnType<typeof summarizeIngestJob> | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      await hydrateNativeImportRecovery();
      recoveryHydratedRef.current = true;
      if (!active) return;
      const recovery = getPendingImportJobs().find((record) => record.owner === 'onboarding');
      if (!recovery) return;
      setImportPendingLock(true);
      setImportAlert(true);
      if (recovery.kind === 'job') {
        setImportJobId(recovery.jobId);
        setCanResumeImport(true);
        setImportMsg('已恢复上次引导中的导入任务。继续查询只读取原任务，不会重新上传。');
      } else {
        importRecoveryAttemptRef.current = recovery.attemptId;
        setNeedsImportReview(true);
        setImportMsg('上次提交结果未确认，无法安全判断是否已收到。请先检查记忆库，再确认后才能重新导入。');
      }
    })();
    return () => { active = false; };
  }, []);

  // ③ 跨 AI
  const [selectedClient, setSelectedClient] = useState<'claude' | 'cursor' | 'cline' | 'other'>('claude');
  const [mcpState, setMcpState] = useState<'idle' | 'connecting' | 'success' | 'failed'>('idle');

  const invalidateProviderTest = useCallback(() => {
    providerRevisionRef.current += 1;
    providerTestControllerRef.current?.abort();
    providerTestControllerRef.current = null;
  }, []);

  useProviderLifecycleEffect(() => {
    const stayedVisible = providerVisibleRef.current && visible;
    providerVisibleRef.current = visible;
    invalidateProviderTest();
    const successful = successfulProviderRef.current;
    const keepSuccessfulTest = stayedVisible && successful !== null
      && successful.apiUrl === settings.llmProvider.apiUrl
      && successful.apiKey === settings.llmProvider.apiKey
      && successful.model === settings.llmProvider.model;
    if (!keepSuccessfulTest) successfulProviderRef.current = null;
    // Local edits survive only within this visible cycle. Hiding, reopening,
    // or an authoritative provider change resets the draft, not the import job.
    setApiUrl(settings.llmProvider.apiUrl);
    setApiKey(settings.llmProvider.apiKey);
    setModel(settings.llmProvider.model);
    setSelectedPresetId(findProviderPreset(settings.llmProvider.apiUrl));
    setShowApiKey(false);
    setTestError('');
    // Saving the just-confirmed draft changes props too; keep its Next action
    // enabled, but never carry that success across a hidden cycle.
    setTestState(keepSuccessfulTest ? 'success' : 'idle');
    return invalidateProviderTest;
  }, [visible, settings.llmProvider.apiUrl, settings.llmProvider.apiKey, settings.llmProvider.model, invalidateProviderTest]);

  const editProvider = () => {
    invalidateProviderTest();
    successfulProviderRef.current = null;
    setTestState('idle');
    setTestError('');
  };

  const selectPreset = (id: string) => {
    editProvider();
    setSelectedPresetId(id);
    const p = LLM_PRESETS.find((x) => x.id === id);
    if (p) {
      // 不把上一个服务商的密钥带到另一个服务商。
      if (p.apiUrl.replace(/\/+$/, '') !== apiUrl.replace(/\/+$/, '')) setApiKey('');
      setApiUrl(id === 'custom' ? '' : p.apiUrl);
      setModel(id === 'custom' ? '' : p.defaultModel);
    }
  };

  const testLlm = async () => {
    if (!visible || !providerVisibleRef.current) return;
    invalidateProviderTest();
    const controller = new AbortController();
    providerTestControllerRef.current = controller;
    const revision = ++providerRevisionRef.current;
    const testedProvider = { apiUrl, apiKey, model };
    const isCurrent = () => providerVisibleRef.current
      && providerRevisionRef.current === revision
      && providerTestControllerRef.current === controller
      && !controller.signal.aborted;
    setTestState('testing'); setTestError('');
    try {
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST', body: JSON.stringify(testedProvider), signal: controller.signal,
      });
      if (!isCurrent()) return;
      const data = await res.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (res.ok && data.healthy) {
        successfulProviderRef.current = testedProvider;
        setTestState('success');
        onUpdateLlmProvider(testedProvider);
        toast.success(t('onboarding.test_success'));
      } else { setTestState('failed'); setTestError(data.warning || t('onboarding.test_failed')); }
    } catch (err) {
      if (!isCurrent()) return;
      successfulProviderRef.current = null;
      setTestState('failed'); setTestError(String(err));
    } finally {
      if (providerTestControllerRef.current === controller) providerTestControllerRef.current = null;
    }
  };

  const ownsCurrentImport = (controller: AbortController) => importControllerRef.current === controller;
  const isCurrentImport = (controller: AbortController) => ownsCurrentImport(controller) && !controller.signal.aborted;

  const setImportPendingLock = (pending: boolean) => {
    importPendingRef.current = pending;
    onImportPendingChange?.(pending);
    setImportPending(pending);
  };

  const releaseCurrentImportReservation = () => {
    releaseImportContentReservation(importFingerprintRef.current, 'onboarding');
    importFingerprintRef.current = null;
  };

  const pollJob = async (jobId: string, controller: AbortController) => {
    try {
      const job = await pollIngestJob(jobId, {
        signal: controller.signal,
        onProgress: (progress: IngestJob) => {
          if (!isCurrentImport(controller)) return;
          if (progress.importProgress) {
            const { done, total, entities } = progress.importProgress;
            setImportMsg(`已处理 ${done}/${total} 段 · 已保存 ${entities} 条记忆`);
          } else {
            setImportMsg(progress.status === 'queued' ? '任务已排队，等待处理…' : '正在处理文件，完成后显示实际导入结果…');
          }
        },
      });
      if (!isCurrentImport(controller)) return;
      const receipt = summarizeIngestJob(job);
      const requiresAcknowledgement = settleImportOutcome(
        receipt.outcome, 'onboarding', importFingerprintRef.current, jobId, importRecoveryAttemptRef.current,
      );
      await flushNativeImportRecovery();
      setImportReceipt(receipt);
      setCanResumeImport(false);
      setImportAlert(receipt.outcome !== 'success');
      if (requiresAcknowledgement) {
        setImportJobId(jobId);
        setImportPendingLock(true);
        setNeedsImportReview(true);
      } else {
        importRecoveryAttemptRef.current = null;
        importFingerprintRef.current = null;
        setImportJobId(null);
        setImportPendingLock(false);
        setNeedsImportReview(false);
      }
      setImportMsg({
        success: '导入完成，请查看实际保存结果。',
        partial: `部分内容已导入，仍有内容未完成。${job.error ? `${job.error}。` : ''}已保存内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。`,
        failed: `导入失败${job.error ? `：${job.error}` : ''}。已保存内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。`,
        cancelled: '导入已取消。此前已保存的内容不会回滚。请先核对记忆库；确认后才能重新选择文件，不会自动重新上传。',
      }[receipt.outcome]);
      // 失败/取消前也可能已写入；即使回执缺少数量，父级记忆库仍须刷新。
      onImportComplete?.();
    } catch (error) {
      if (!isCurrentImport(controller)) return;
      const code = (error as { code?: string })?.code;
      updateImportContentReservation(importFingerprintRef.current, 'onboarding', { phase: 'uncertain', jobId });
      setImportAlert(true);
      setCanResumeImport(code === 'disconnected' || code === 'timeout' || code === 'unauthorized');
      setNeedsImportReview(code !== 'disconnected' && code !== 'timeout' && code !== 'unauthorized');
      setImportMsg(code === 'unauthorized'
        ? '连接凭证已失效。请先在设置中重新连接；不会自动重新上传。'
        : code === 'expired'
          ? '任务记录已过期，无法确认最终状态。请先在记忆库检查，避免重复导入。'
          : code === 'timeout'
            ? '已暂停等待，后台任务可能仍在处理。可继续检查原任务，不会重新上传。'
            : code === 'disconnected'
              ? '暂时无法连接本地服务。恢复连接后可继续检查原任务，不会重新上传。'
              : '无法确认任务状态。请先在记忆库检查已保存的内容；不会自动重新上传。');
    } finally {
      if (ownsCurrentImport(controller)) {
        importBusyRef.current = false;
        setImporting(false);
      }
    }
  };

  // 父级隐藏时保留查询与回执；真正卸载只停止查询，不撤销后端已持久化的内容。
  useEffect(() => {
    return () => {
      importControllerRef.current?.abort();
      importControllerRef.current = null;
      importBusyRef.current = false;
      providerRevisionRef.current += 1;
    };
  }, []);

  const resumeImport = async () => {
    if (importBusyRef.current || !importJobId || !canResumeImport) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    importBusyRef.current = true;
    updateImportContentReservation(importFingerprintRef.current, 'onboarding', { phase: 'running', jobId: importJobId });
    setImporting(true); setImportAlert(false); setCanResumeImport(false);
    setImportMsg('继续检查原任务状态，不会重新上传…');
    await pollJob(importJobId, controller);
  };

  const acknowledgeImportReview = async () => {
    if (importBusyRef.current || !needsImportReview) return;
    acknowledgeImportRecovery(
      'onboarding', importFingerprintRef.current, importJobId, importRecoveryAttemptRef.current,
    );
    await flushNativeImportRecovery();
    importRecoveryAttemptRef.current = null;
    importFingerprintRef.current = null;
    setImportPendingLock(false);
    setNeedsImportReview(false);
    setCanResumeImport(false);
    setImportJobId(null);
    setImportReceipt(null);
    setImportAlert(false);
    setImportMsg('已确认检查记忆库。现在可以选择新的文件；已有内容不会自动删除。');
  };

  const processImport = async (file: File) => {
    if (!recoveryHydratedRef.current) {
      setImportAlert(true);
      setImportMsg('正在恢复上次导入状态，请稍后再选择文件。');
      return;
    }
    if (importBusyRef.current || importPendingRef.current) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    importBusyRef.current = true;
    setImportPendingLock(true);
    setNeedsImportReview(false);
    setImporting(true); setImportAlert(false); setImportReceipt(null);
    setImportJobId(null); setCanResumeImport(false); setImportMsg('正在提交文件…');
    let submissionMayHavePersisted = false;
    let submissionTimedOut = false;
    const submissionDeadline = Date.now() + IMPORT_SUBMIT_TIMEOUT_MS;
    const submitTimer = setTimeout(() => {
      submissionTimedOut = true;
      controller.abort();
    }, IMPORT_SUBMIT_TIMEOUT_MS);
    const assertSubmissionActive = () => {
      if (Date.now() >= submissionDeadline) {
        submissionTimedOut = true;
        controller.abort();
      }
      if (!isCurrentImport(controller)) throw new DOMException('Stopped waiting for import submission', 'AbortError');
    };
    try {
      const lower = file.name.toLowerCase();
      const ab = await abortableImport(file.arrayBuffer(), controller.signal);
      assertSubmissionActive();
      const fingerprint = await abortableImport(fingerprintImportContent(ab), controller.signal);
      assertSubmissionActive();
      const reserveContent = () => {
        const reservation = reserveImportContent(fingerprint, 'onboarding');
        if (!reservation.reserved) {
          if (reservation.reason === 'fingerprint-unavailable') {
            throw new Error(t('upload.fingerprint_unavailable'));
          }
          if (reservation.reason === 'recovery-required') {
            throw new Error('检测到上次导入尚未恢复或核对。请先处理已有任务；不会自动重新上传。');
          }
          const entry = { onboarding: '首次引导', library: '记忆库', 'file-drop': '文件导入' }[reservation.existing.owner];
          throw new Error(`已阻止重复导入：相同内容已有${entry}任务或结果待确认。请返回该入口查看原任务，不会再次上传。`);
        }
        importFingerprintRef.current = fingerprint;
      };
      reserveContent();
      // 只有明确的格式校验拒绝才改走普通文件，认证/网络/服务错误不能触发第二次写入。
      if (lower.endsWith('.json')) {
        const text = new TextDecoder().decode(ab);
        assertSubmissionActive();
        const body = JSON.stringify({ text });
        assertSubmissionActive();
        importRecoveryAttemptRef.current = createImportRecoveryAttemptId();
        if (!persistUncertainImport('onboarding', importRecoveryAttemptRef.current)) {
          importRecoveryAttemptRef.current = null;
          throw new Error('无法保存恢复标记，为避免重复导入，本次未提交。请检查本地存储后重试。');
        }
        await flushNativeImportRecovery();
        submissionMayHavePersisted = true;
        const r = await abortableImport(apiFetch('/api/import/chat', { method: 'POST', body, signal: controller.signal }), controller.signal);
        assertSubmissionActive();
        if (r.ok) {
          const { jobId, platform, parsed } = await abortableImport(r.json(), controller.signal);
          assertSubmissionActive();
          if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('服务未返回任务编号。请先在记忆库检查，避免重复导入。');
          clearTimeout(submitTimer);
          setImportJobId(jobId);
          const recoverySaved = persistImportJob('onboarding', jobId, importRecoveryAttemptRef.current || undefined);
          await flushNativeImportRecovery();
          if (recoverySaved) importRecoveryAttemptRef.current = null;
          updateImportContentReservation(fingerprint, 'onboarding', { phase: 'running', jobId });
          setImportMsg(`识别为 ${platform} · ${parsed} 段对话，正在处理…${recoverySaved ? '' : ' 本地无法保存恢复记录，请勿关闭应用，直至任务结束并核对结果。'}`);
          await pollJob(jobId, controller);
          return;
        }
        submissionMayHavePersisted = !(r.status >= 400 && r.status < 500);
        if (!submissionMayHavePersisted) {
          releaseCurrentImportReservation();
          if (importRecoveryAttemptRef.current) {
            clearPersistedImportAttempt('onboarding', importRecoveryAttemptRef.current);
            await flushNativeImportRecovery();
          }
          importRecoveryAttemptRef.current = null;
        }
        if (r.status !== 400 && r.status !== 422) {
          throw new Error(r.status === 401 || r.status === 403
            ? '连接凭证已失效。请先在设置中重新连接；未尝试普通文件上传。'
            : `聊天记录提交未被确认（HTTP ${r.status}）。请先检查记忆库；不会自动重新上传。`);
        }
        submissionMayHavePersisted = false;
        await abortableImport(r.arrayBuffer(), controller.signal);
        assertSubmissionActive();
        // A format rejection released the first attempt. Reacquire before
        // document fallback in case another surface claimed the content.
        reserveContent();
      }
      // 普通文档/笔记 → ingest
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 0x8000, bytes.length))) as any);
      const base64 = btoa(binary);
      let contentType = file.type || 'text/plain';
      if (lower.endsWith('.md')) contentType = 'text/markdown';
      else if (lower.endsWith('.pdf')) contentType = 'application/pdf';
      else if (lower.endsWith('.json')) contentType = 'application/json';
      const body = JSON.stringify({ filename: file.name, contentType, base64 });
      assertSubmissionActive();
      importRecoveryAttemptRef.current = createImportRecoveryAttemptId();
      if (!persistUncertainImport('onboarding', importRecoveryAttemptRef.current)) {
        importRecoveryAttemptRef.current = null;
        throw new Error('无法保存恢复标记，为避免重复导入，本次未提交。请检查本地存储后重试。');
      }
      await flushNativeImportRecovery();
      submissionMayHavePersisted = true;
      const r2 = await abortableImport(apiFetch('/api/ingest/file', { method: 'POST', body, signal: controller.signal }), controller.signal);
      if (!r2.ok) {
        submissionMayHavePersisted = !(r2.status >= 400 && r2.status < 500);
        if (!submissionMayHavePersisted) releaseCurrentImportReservation();
      }
      const d2 = await abortableImport(r2.json(), controller.signal);
      assertSubmissionActive();
      if (!r2.ok) throw new Error(d2.error || '上传失败');
      if (typeof d2.jobId !== 'string' || !d2.jobId.trim()) throw new Error('服务未返回任务编号。请先在记忆库检查，避免重复导入。');
      clearTimeout(submitTimer);
      setImportJobId(d2.jobId);
      const recoverySaved = persistImportJob('onboarding', d2.jobId, importRecoveryAttemptRef.current || undefined);
      await flushNativeImportRecovery();
      if (recoverySaved) importRecoveryAttemptRef.current = null;
      updateImportContentReservation(fingerprint, 'onboarding', { phase: 'running', jobId: d2.jobId });
      setImportMsg(`文件已提交，正在处理…${recoverySaved ? '' : ' 本地无法保存恢复记录，请勿关闭应用，直至任务结束并核对结果。'}`);
      await pollJob(d2.jobId, controller);
    } catch (err) {
      // 截止时间触发的 abort 仍属于本次操作，必须显示结果；卸载则不再改 UI。
      if (!ownsCurrentImport(controller)) return;
      if (submissionMayHavePersisted) {
        updateImportContentReservation(importFingerprintRef.current, 'onboarding', { phase: 'uncertain' });
      } else {
        releaseCurrentImportReservation();
        if (importRecoveryAttemptRef.current) {
          clearPersistedImportAttempt('onboarding', importRecoveryAttemptRef.current);
          await flushNativeImportRecovery();
        }
        importRecoveryAttemptRef.current = null;
      }
      setImportAlert(true);
      setNeedsImportReview(submissionMayHavePersisted);
      setImportPendingLock(submissionMayHavePersisted);
      setImportMsg(submissionMayHavePersisted
        ? submissionTimedOut
          ? '等待提交结果已超过 30 秒，后台可能已接收文件，但尚未确认任务编号。请先检查记忆库，确认后才能开始新的导入；不会自动重新上传。'
          : `提交结果尚未确认：${err instanceof Error ? err.message : String(err)}。请先检查记忆库，确认后才能开始新的导入；不会自动重新上传。`
        : submissionTimedOut
          ? '读取文件已超过 30 秒，尚未提交。可以重新选择文件。'
          : `文件未提交：${err instanceof Error ? err.message : String(err)}。可以重新选择文件。`);
    } finally {
      clearTimeout(submitTimer);
      if (ownsCurrentImport(controller)) {
        importBusyRef.current = false;
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    }
  };

  // ③ 一键接入
  const connectMcp = async () => {
    if (selectedClient === 'other') { setStep(4); return; }
    setMcpState('connecting');
    try {
      await safeInvoke('mcp_install_to', { clientId: selectedClient });
      try { const token = await safeInvoke<string>('get_local_api_token'); if (token) await safeInvoke('set_clipboard', { text: token }); } catch { /* */ }
      setMcpState('success');
      toast.success(t('settings.mcp_install_success'));
    } catch (e) { console.error(e); setMcpState('failed'); toast.error(t('onboarding.client_connect_failed')); }
  };

  const complete = () => {
    if (importPendingRef.current) {
      // The onboarding recovery record is the only UI that can clear an
      // unresolved onboarding reservation. Keep it reachable until the user
      // has checked the receipt or explicitly acknowledged the uncertainty.
      setStep(2);
      setImportAlert(true);
      setImportMsg(importing
        ? '导入仍在后台处理。请先等待或继续检查原任务；确认结果前不能关闭引导。'
        : '请先检查原导入任务并确认结果；确认前不能关闭引导，也不会自动重新上传。');
      return false;
    }
    invalidateProviderTest();
    successfulProviderRef.current = null;
    onUpdateBehavior({ onboarded: true });
    onClose();
    return true;
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
      <div className="bg-[#0a0b12]/95 w-full max-w-2xl rounded-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <h2 id="onboarding-dialog-title" className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 text-sm tracking-wide">
            Omni-Context <span className="sr-only">首次使用引导</span>
          </h2>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? 'w-6 bg-cyan-400' : s < step ? 'w-2 bg-cyan-600/40' : 'w-2 bg-white/10'}`} />
            ))}
          </div>
          <button onClick={complete} className="text-gray-400 hover:text-white text-xs flex items-center gap-1">{t('onboarding.skip')} <X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {/* ① LLM */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Brain className="w-5 h-5 text-cyan-400" /> 先选个"思考引擎"</h2>
                <p className="text-xs text-gray-400 leading-relaxed">你的大脑负责记忆，思考交给一个 AI。选一个、填 key、测通——之后导入和回答都靠它。便宜的就够用。</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  {id: 'deepseek', emoji: '🐳', name: 'DeepSeek', cost: '极便宜' },
                  { id: 'ollama', emoji: '🏠', name: 'Ollama', cost: '本地·免费' },
                  { id: 'openai', emoji: '🤖', name: 'GPT-4o mini', cost: '便宜' },
                  { id: 'custom', emoji: '⚙️', name: '自定义', cost: '任意' },
                ].map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p.id)} className={`p-3 rounded-xl border text-center transition-all ${selectedPresetId === p.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="text-lg">{p.emoji}</div><div className="font-bold text-xs truncate mt-1">{p.name}</div><div className="text-[9px] text-gray-500">{p.cost}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <input value={apiUrl} onChange={(e) => { editProvider(); setApiUrl(e.target.value); setSelectedPresetId(findProviderPreset(e.target.value)); }} aria-label="API URL" placeholder="API URL" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                  <input value={model} onChange={(e) => { editProvider(); setModel(e.target.value); }} aria-label="Model" placeholder="Model" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                </div>
                {/* Model Quick-Tags */}
                {(() => {
                  const matchedPreset = LLM_PRESETS.find(p => p.apiUrl && apiUrl === p.apiUrl);
                  if (matchedPreset && matchedPreset.recommendedModels && matchedPreset.recommendedModels.length > 0) {
                    return (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span className="text-[10px] text-gray-500 flex items-center mr-1">推荐:</span>
                        {matchedPreset.recommendedModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              editProvider();
                              setModel(m);
                            }}
                            className={`px-2 py-0.5 text-[9px] rounded-md transition-colors font-mono border ${
                              model === m
                                ? 'bg-cyan-900/60 text-cyan-400 border-cyan-700/60'
                                : 'bg-black/30 border-white/5 text-gray-400 hover:text-white hover:border-white/10'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="relative">
                <input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(e) => { editProvider(); setApiKey(e.target.value); }} aria-label={t('onboarding.apikey_placeholder')} placeholder={t('onboarding.apikey_placeholder')} className="w-full bg-black/40 border border-white/10 rounded-lg pl-3 pr-10 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  aria-label={showApiKey ? "Hide API Key" : "Show API Key"}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={testLlm} disabled={testState === 'testing' || !apiUrl.trim() || !model.trim()} className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border disabled:opacity-50 ${testState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : testState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {testState === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.testing')}</> : testState === 'success' ? <><Check className="w-4 h-4" />{t('onboarding.test_success')}</> : <span>{t('onboarding.test_btn')}</span>}
              </button>
              {testState === 'failed' && <p className="text-[10px] text-rose-400 text-center">{testError}</p>}
            </div>
          )}

          {/* ② 导入结果不是理解证明；提问只由用户主动发起。 */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Upload className="w-5 h-5 text-cyan-400" /> 先导入一份熟悉的记录</h2>
                <p className="text-xs text-gray-400 leading-relaxed">选择你和 AI 的<b>聊天记录导出</b>(ChatGPT/Claude/Gemini)，或一份<b>文档/笔记</b>(md/txt/pdf)。处理时间取决于文件和模型；完成后先看实际保存结果，再自己提问验证。</p>
              </div>
              <button type="button"
                aria-label="选择或拖入聊天记录、文档或笔记"
                aria-describedby="onboarding-import-hint"
                aria-busy={importing}
                disabled={importing || importPending}
                onDragOver={(e) => { e.preventDefault(); if (!importBusyRef.current && !importPendingRef.current) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation(); setDragOver(false);
                  if (!importBusyRef.current && !importPendingRef.current && e.dataTransfer.files?.[0]) processImport(e.dataTransfer.files[0]);
                }}
                onClick={() => { if (!importBusyRef.current && !importPendingRef.current) fileRef.current?.click(); }}
                className={`w-full border-2 rounded-xl p-6 min-h-[150px] flex flex-col justify-center items-center text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${dragOver ? 'border-cyan-400 bg-cyan-950/10' : 'border-dashed border-cyan-900/60 bg-white/5 hover:border-cyan-600/40'} ${importing || importPending ? 'opacity-70' : 'cursor-pointer'}`}>
                {importing ? <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /> : <Upload className="w-8 h-8 text-cyan-400" />}
                <span className="text-sm font-semibold text-white mt-2">{importing ? '处理中…' : importPending ? '先确认原导入的结果' : '拖入或选择文件'}</span>
                <span id="onboarding-import-hint" className="text-[10px] text-gray-500 mt-1">聊天记录 conversations.json / My Activity.json · 或 md/txt/pdf 文档笔记</span>
              </button>
              <input ref={fileRef} type="file" aria-label="导入聊天记录、文档或笔记" accept=".json,.md,.txt,.pdf,application/json" disabled={importing || importPending} className="hidden" onChange={(e) => { if (!importBusyRef.current && !importPendingRef.current && e.target.files?.[0]) processImport(e.target.files[0]); }} />
              {importMsg && (
                <div role={importAlert ? 'alert' : 'status'} aria-atomic="true" className={`text-xs rounded-lg border p-2.5 ${importAlert ? 'text-amber-200 bg-amber-950/20 border-amber-500/30' : 'text-gray-300 bg-gray-800/50 border-white/10'}`}>
                  {importMsg}
                  {canResumeImport && importJobId && (
                    <button type="button" onClick={resumeImport} disabled={importing} className="mt-3 block rounded-lg border border-cyan-500/40 px-3 py-2 font-medium text-cyan-300 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50">
                      继续检查原任务
                    </button>
                  )}
                  {needsImportReview && (
                    <button type="button" onClick={acknowledgeImportReview} disabled={importing} className="mt-3 block rounded-lg border border-amber-500/40 px-3 py-2 font-medium text-amber-200 hover:bg-amber-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50">
                      已核对记忆库，允许重新选择
                    </button>
                  )}
                </div>
              )}
              {importReceipt && (
                <section aria-label="导入结果" data-testid="onboarding-import-receipt" className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-white">{importReceipt.countBasis === 'saved' ? '实际保存结果' : '导入处理结果'}</h3>
                  <p className="text-xs text-gray-200">{importReceipt.countsKnown
                    ? importReceipt.countBasis === 'saved'
                      ? `已保存 ${importReceipt.entities} 条记忆 · ${importReceipt.relationships} 个关联`
                      : `服务报告抽取 ${importReceipt.entities} 条记忆 · ${importReceipt.relationships} 个关联（非净新增数量）`
                    : '已保存数量暂时无法确认，请检查记忆库'}</p>
                  {importReceipt.total > 0 && <p className="text-xs text-gray-400">成功处理 {importReceipt.completed}/{importReceipt.total} 段{importReceipt.failures > 0 ? ` · ${importReceipt.failures} 段未完成` : ''}</p>}
                  {importReceipt.coverage !== undefined && <p className="text-xs text-gray-400">文件处理覆盖率 {Math.round(importReceipt.coverage * 100)}%</p>}
                  <p className="text-xs leading-relaxed text-gray-400">这是导入回执，不代表 Omni 已完整理解内容。问一个你知道答案的问题，并核对回答里的来源。</p>
                  {onAskImported && importReceipt.countsKnown && (importReceipt.entities > 0 || importReceipt.relationships > 0) && (
                    <button type="button" onClick={onAskImported} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                      用这些记忆提问 <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </section>
              )}
            </div>
          )}

          {/* ③ 跨 AI */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-cyan-400" /> 现在，换个 AI 试试</h2>
                <p className="text-xs text-gray-400 leading-relaxed">一键把大脑接到任何 AI。接上后去那个 AI 里问一句关于你自己的事——它会答出你导入的东西，<b>而你从没在它那说过</b>。这就是"换谁来想都还是你"。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ id: 'claude', name: 'Claude Desktop' }, { id: 'cursor', name: 'Cursor' }, { id: 'cline', name: 'Cline (VS Code)' }, { id: 'other', name: '稍后/其他' }].map((c) => (
                  <button key={c.id} onClick={() => { setSelectedClient(c.id as any); setMcpState('idle'); }} className={`p-4 rounded-xl border text-left transition-all ${selectedClient === c.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="font-semibold text-sm flex items-center justify-between">{c.name}{selectedClient === c.id && <Check className="w-4 h-4 text-cyan-400" />}</div>
                  </button>
                ))}
              </div>
              <button onClick={connectMcp} disabled={mcpState === 'connecting'} className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border ${mcpState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : mcpState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {mcpState === 'connecting' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.client_connecting')}</> : mcpState === 'success' ? <><Check className="w-4 h-4" />已接入，重启该 AI 客户端即可</> : selectedClient === 'other' ? <><span>{t('onboarding.next')}</span><ArrowRight className="w-4 h-4" /></> : <><Copy className="w-4 h-4" /><span>一键接入（自动复制配置/token）</span></>}
              </button>
            </div>
          )}

          {/* ④ 习惯 */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Database className="w-5 h-5 text-cyan-400" /> 让它越用越是你</h2>
                <p className="text-xs text-gray-400 leading-relaxed">以后每个想明白的点、每个决策——按一下<b>沉淀热键</b>(可在设置改，已是全局，任意窗口前都能按)抓当前屏幕，或对任何接入的 AI 说"记一下"。攒得越多，它越懂你怎么想。</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-center">
                <div className="text-xs text-gray-400">全局沉淀热键</div>
                <div className="text-lg font-mono text-cyan-300 mt-1">Ctrl + Shift + P</div>
              </div>
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-3 text-center text-xs text-cyan-200/90">透镜帮你看清，下注的手一直是你的。它只负责记住你走过的路。</div>
            </div>
          )}
        </div>

        {(importing || importPending) && step !== 2 && (
          <p role="status" className="px-6 pb-3 text-xs text-gray-400">{importing
            ? '导入仍在后台处理。请先返回导入步骤查看进度；确认结果前不能关闭引导，也不会重新上传。'
            : '原导入的最终结果尚未确认。请返回导入步骤检查原任务；确认前不能关闭引导，也不会自动重新上传。'}</p>
        )}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div>
            {step > 1 ? (
              <button onClick={() => setStep((s) => s - 1)} className="px-4 py-2 text-xs text-gray-400 hover:text-white flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {t('onboarding.prev')}</button>
            ) : (
              onOpenSettings && <button onClick={() => { if (complete()) setTimeout(() => onOpenSettings('llm'), 200); }} className="text-[11px] text-cyan-400/80 hover:text-cyan-300 hover:underline">{t('onboarding.advanced_setup')}</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < TOTAL_STEPS && step !== 1 && (
              <button onClick={() => setStep((s) => s + 1)} className="px-4 py-2 text-xs text-gray-400 hover:text-white">{t('onboarding.skip')}</button>
            )}
            {step < TOTAL_STEPS ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={step === 1 && testState !== 'success'} className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
                {t('onboarding.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={complete} className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"><Check className="w-4 h-4" /> {t('onboarding.start_app')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
