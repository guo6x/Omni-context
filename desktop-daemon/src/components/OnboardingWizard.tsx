// 首次启动引导：价值优先的 4 步路径
// ① 连接模型 ② 导入并查看真实结果 ③ 接第二个 AI ④ 沉淀习惯
"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { LLM_PRESETS } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { AppSettings } from '@/hooks/useSettings';
import { apiFetch } from '@/lib/api-client';
import { getImportErrorCode, responseImportErrorCode } from '@/lib/import-error';
import { ingestExtractionModeNotice, pollIngestJob, summarizeIngestJob, type IngestJob } from '@/lib/ingest-job';
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

function formatOnboardingMessage(
  translate: (key: string) => string,
  key: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.split(`{${name}}`).join(String(value)),
    translate(key),
  );
}

class LocalImportPolicyError extends Error {
  constructor() {
    super('LOCAL_ONLY_REMOTE_EMBEDDINGS');
    this.name = 'LocalImportPolicyError';
  }
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
  const [localExtractionOnly, setLocalExtractionOnly] = useState(false);

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
  const [localImportBlocked, setLocalImportBlocked] = useState(false);
  const extractionModeNotice = ingestExtractionModeNotice(importReceipt?.extractionMode, localExtractionOnly);

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
        setImportMsg(t('onboarding.alpha_recovery_job'));
      } else {
        importRecoveryAttemptRef.current = recovery.attemptId;
        setNeedsImportReview(true);
        setImportMsg(t('onboarding.alpha_recovery_uncertain'));
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
        setLocalExtractionOnly(false);
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
            setImportMsg(formatOnboardingMessage(t, 'onboarding.alpha_progress', { done, total, entities }));
          } else {
            setImportMsg(t(progress.status === 'queued' ? 'onboarding.alpha_queued' : 'onboarding.alpha_processing'));
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
        success: t('onboarding.alpha_import_success'),
        partial: formatOnboardingMessage(t, 'onboarding.alpha_import_partial', { detail: job.error ? ` ${job.error}.` : '' }),
        failed: formatOnboardingMessage(t, 'onboarding.alpha_import_failed', { detail: job.error ? `: ${job.error}` : '' }),
        cancelled: t('onboarding.alpha_import_cancelled'),
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
        ? t('onboarding.alpha_recovery_unauthorized')
        : code === 'expired'
          ? t('onboarding.alpha_recovery_expired')
          : code === 'timeout'
            ? t('onboarding.alpha_recovery_timeout')
            : code === 'disconnected'
              ? t('onboarding.alpha_recovery_disconnected')
              : t('onboarding.alpha_recovery_unknown'));
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
    setImportMsg(t('onboarding.alpha_resume_status'));
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
    setImportMsg(t('onboarding.alpha_review_acknowledged'));
  };

  const processImport = async (file: File) => {
    if (!recoveryHydratedRef.current) {
      setImportAlert(true);
      setImportMsg(t('onboarding.alpha_recovery_hydrating'));
      return;
    }
    if (importBusyRef.current || importPendingRef.current) return;
    importControllerRef.current?.abort();
    const controller = new AbortController();
    importControllerRef.current = controller;
    importBusyRef.current = true;
    setImportPendingLock(true);
    setNeedsImportReview(false);
    setImporting(true); setImportAlert(false); setImportReceipt(null); setLocalImportBlocked(false);
    setImportJobId(null); setCanResumeImport(false); setImportMsg(t('onboarding.alpha_submitting'));
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
            throw new Error(t('onboarding.alpha_recovery_required'));
          }
          const entry = {
            onboarding: t('onboarding.alpha_entry_onboarding'),
            library: t('onboarding.alpha_entry_library'),
            'file-drop': t('onboarding.alpha_entry_file_drop'),
          }[reservation.existing.owner];
          throw new Error(formatOnboardingMessage(t, 'onboarding.alpha_duplicate_import', { entry }));
        }
        importFingerprintRef.current = fingerprint;
      };
      reserveContent();
      // 只有明确的格式校验拒绝才改走普通文件，认证/网络/服务错误不能触发第二次写入。
      if (lower.endsWith('.json')) {
        const text = new TextDecoder().decode(ab);
        assertSubmissionActive();
        const body = JSON.stringify({ text, useLocalExtraction: localExtractionOnly });
        assertSubmissionActive();
        importRecoveryAttemptRef.current = createImportRecoveryAttemptId();
        if (!persistUncertainImport('onboarding', importRecoveryAttemptRef.current)) {
          importRecoveryAttemptRef.current = null;
          throw new Error(t('onboarding.alpha_recovery_marker_failed'));
        }
        await flushNativeImportRecovery();
        submissionMayHavePersisted = true;
        const r = await abortableImport(apiFetch('/api/import/chat', { method: 'POST', body, signal: controller.signal }), controller.signal);
        assertSubmissionActive();
        if (r.ok) {
          const { jobId, platform, parsed } = await abortableImport(r.json(), controller.signal);
          assertSubmissionActive();
          if (typeof jobId !== 'string' || !jobId.trim()) throw new Error(t('onboarding.alpha_missing_job_id'));
          clearTimeout(submitTimer);
          setImportJobId(jobId);
          const recoverySaved = persistImportJob('onboarding', jobId, importRecoveryAttemptRef.current || undefined);
          await flushNativeImportRecovery();
          if (recoverySaved) importRecoveryAttemptRef.current = null;
          updateImportContentReservation(fingerprint, 'onboarding', { phase: 'running', jobId });
          setImportMsg(formatOnboardingMessage(t, 'onboarding.alpha_chat_progress', {
            platform,
            parsed,
            notice: recoverySaved ? '' : ` ${t('onboarding.alpha_recovery_record_warning')}`,
          }));
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
        if (await responseImportErrorCode(r) === 'LOCAL_ONLY_REMOTE_EMBEDDINGS') {
          throw new LocalImportPolicyError();
        }
        if (r.status !== 400 && r.status !== 422) {
          throw new Error(r.status === 401 || r.status === 403
            ? t('onboarding.alpha_chat_unauthorized')
            : formatOnboardingMessage(t, 'onboarding.alpha_chat_submit_uncertain', { status: r.status }));
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
      const body = JSON.stringify({ filename: file.name, contentType, base64, useLocalExtraction: localExtractionOnly });
      assertSubmissionActive();
      importRecoveryAttemptRef.current = createImportRecoveryAttemptId();
      if (!persistUncertainImport('onboarding', importRecoveryAttemptRef.current)) {
        importRecoveryAttemptRef.current = null;
        throw new Error(t('onboarding.alpha_recovery_marker_failed'));
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
      if (!r2.ok) {
        if (getImportErrorCode(d2) === 'LOCAL_ONLY_REMOTE_EMBEDDINGS') {
          throw new LocalImportPolicyError();
        }
        throw new Error(d2.error || t('onboarding.alpha_upload_failed'));
      }
      if (typeof d2.jobId !== 'string' || !d2.jobId.trim()) throw new Error(t('onboarding.alpha_missing_job_id'));
      clearTimeout(submitTimer);
      setImportJobId(d2.jobId);
      const recoverySaved = persistImportJob('onboarding', d2.jobId, importRecoveryAttemptRef.current || undefined);
      await flushNativeImportRecovery();
      if (recoverySaved) importRecoveryAttemptRef.current = null;
      updateImportContentReservation(fingerprint, 'onboarding', { phase: 'running', jobId: d2.jobId });
      setImportMsg(formatOnboardingMessage(t, 'onboarding.alpha_file_progress', {
        notice: recoverySaved ? '' : ` ${t('onboarding.alpha_recovery_record_warning')}`,
      }));
      await pollJob(d2.jobId, controller);
    } catch (err) {
      // 截止时间触发的 abort 仍属于本次操作，必须显示结果；卸载则不再改 UI。
      if (!ownsCurrentImport(controller)) return;
      const blockedByRemoteEmbedding = err instanceof LocalImportPolicyError;
      setLocalImportBlocked(blockedByRemoteEmbedding);
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
      setImportMsg(blockedByRemoteEmbedding
        ? t('onboarding.alpha_local_import_blocked')
        : submissionMayHavePersisted
        ? submissionTimedOut
          ? t('onboarding.alpha_submit_timeout_uncertain')
          : formatOnboardingMessage(t, 'onboarding.alpha_submit_uncertain', { error: err instanceof Error ? err.message : String(err) })
        : submissionTimedOut
          ? t('onboarding.alpha_read_timeout')
          : formatOnboardingMessage(t, 'onboarding.alpha_file_not_submitted', { error: err instanceof Error ? err.message : String(err) }));
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
        ? t('onboarding.alpha_close_while_processing')
        : t('onboarding.alpha_close_while_uncertain'));
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
            Omni-Context <span className="sr-only">{t('onboarding.alpha_screen_reader_label')}</span>
          </h2>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? 'w-6 bg-cyan-400' : s < step ? 'w-2 bg-cyan-600/40' : 'w-2 bg-white/10'}`} />
            ))}
          </div>
          <button onClick={complete} className="text-gray-400 hover:text-white text-xs flex items-center gap-1">{t('onboarding.skip')} <X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {/* ① LLM */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Brain className="w-5 h-5 text-cyan-400" /> {t('onboarding.alpha_welcome_title')}</h2>
                <p className="text-xs text-gray-400 leading-relaxed">{t('onboarding.alpha_welcome_desc')}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{t('onboarding.alpha_model_privacy')}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { id: 'deepseek', emoji: '🐳', name: 'DeepSeek', cost: t('onboarding.alpha_cost_low') },
                  { id: 'ollama', emoji: '🏠', name: 'Ollama', cost: t('onboarding.alpha_cost_local_free') },
                  { id: 'openai', emoji: '🤖', name: 'GPT-4o mini', cost: t('onboarding.alpha_cost_low') },
                  { id: 'custom', emoji: '⚙️', name: t('onboarding.alpha_provider_custom'), cost: t('onboarding.alpha_cost_custom') },
                ].map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p.id)} className={`p-3 rounded-xl border text-center transition-all ${selectedPresetId === p.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="text-lg">{p.emoji}</div><div className="font-bold text-xs truncate mt-1">{p.name}</div><div className="text-[9px] text-gray-500">{p.cost}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <input value={apiUrl} onChange={(e) => { editProvider(); setApiUrl(e.target.value); setSelectedPresetId(findProviderPreset(e.target.value)); }} aria-label={t('onboarding.alpha_api_url')} placeholder={t('onboarding.alpha_api_url')} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                  <input value={model} onChange={(e) => { editProvider(); setModel(e.target.value); }} aria-label={t('onboarding.alpha_model')} placeholder={t('onboarding.alpha_model')} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                </div>
                {/* Model Quick-Tags */}
                {(() => {
                  const matchedPreset = LLM_PRESETS.find(p => p.apiUrl && apiUrl === p.apiUrl);
                  if (matchedPreset && matchedPreset.recommendedModels && matchedPreset.recommendedModels.length > 0) {
                    return (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span className="text-[10px] text-gray-500 flex items-center mr-1">{t('onboarding.alpha_recommended')}</span>
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
                  aria-label={t(showApiKey ? 'onboarding.alpha_hide_api_key' : 'onboarding.alpha_show_api_key')}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={testLlm} disabled={testState === 'testing' || !apiUrl.trim() || !model.trim()} className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border disabled:opacity-50 ${testState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : testState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {testState === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.testing')}</> : testState === 'success' ? <><Check className="w-4 h-4" />{t('onboarding.test_success')}</> : <span>{t('onboarding.test_btn')}</span>}
              </button>
              {testState === 'failed' && <p className="text-[10px] text-rose-400 text-center">{testError}</p>}
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                <p className="text-[11px] leading-relaxed text-gray-400">{t('onboarding.alpha_local_import_desc')}</p>
                <button
                  type="button"
                  data-testid="onboarding-local-import"
                  onClick={() => { invalidateProviderTest(); setLocalExtractionOnly(true); setStep(2); }}
                  className="text-xs font-medium text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  {t('onboarding.alpha_local_import_cta')}
                </button>
              </div>
            </div>
          )}

          {/* ② 导入结果不是理解证明；提问只由用户主动发起。 */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Upload className="w-5 h-5 text-cyan-400" /> {t('onboarding.alpha_import_title')}</h2>
                <p className="text-xs text-gray-400 leading-relaxed">{t('onboarding.alpha_import_desc')}</p>
              </div>
              {extractionModeNotice === 'local' && (
                <p data-testid="onboarding-local-extraction-note" role="note" className="rounded-lg border border-cyan-700/40 bg-cyan-950/20 p-3 text-[11px] leading-relaxed text-cyan-100/80">
                  {t('onboarding.alpha_local_import_notice')}
                </p>
              )}
              <button type="button"
                aria-label={t('onboarding.alpha_drop_zone_label')}
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
                <span className="text-sm font-semibold text-white mt-2">{t(importing ? 'onboarding.alpha_importing' : importPending ? 'onboarding.alpha_review_first' : 'onboarding.alpha_choose_file')}</span>
                <span id="onboarding-import-hint" className="text-[10px] text-gray-500 mt-1">{t('onboarding.alpha_import_formats')}</span>
              </button>
              <input ref={fileRef} type="file" aria-label={t('onboarding.alpha_file_input_label')} accept=".json,.md,.txt,.pdf,application/json" disabled={importing || importPending} className="hidden" onChange={(e) => { if (!importBusyRef.current && !importPendingRef.current && e.target.files?.[0]) processImport(e.target.files[0]); }} />
              {importMsg && (
                <div role={importAlert ? 'alert' : 'status'} aria-atomic="true" className={`text-xs rounded-lg border p-2.5 ${importAlert ? 'text-amber-200 bg-amber-950/20 border-amber-500/30' : 'text-gray-300 bg-gray-800/50 border-white/10'}`}>
                  {importMsg}
                  {canResumeImport && importJobId && (
                    <button type="button" onClick={resumeImport} disabled={importing} className="mt-3 block rounded-lg border border-cyan-500/40 px-3 py-2 font-medium text-cyan-300 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50">
                      {t('onboarding.alpha_resume_original')}
                    </button>
                  )}
                  {needsImportReview && (
                    <button type="button" onClick={acknowledgeImportReview} disabled={importing} className="mt-3 block rounded-lg border border-amber-500/40 px-3 py-2 font-medium text-amber-200 hover:bg-amber-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50">
                      {t('onboarding.alpha_acknowledge_review')}
                    </button>
                  )}
                  {localImportBlocked && onOpenSettings && (
                    <button type="button" onClick={() => onOpenSettings('diagnostics')} className="mt-3 block rounded-lg border border-cyan-500/40 px-3 py-2 font-medium text-cyan-200 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                      {t('onboarding.alpha_local_import_diagnostics')}
                    </button>
                  )}
                </div>
              )}
              {importReceipt && (
                <section aria-label={t('onboarding.alpha_import_receipt')} data-testid="onboarding-import-receipt" className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-white">{t(importReceipt.countBasis === 'saved' ? 'onboarding.alpha_saved_result' : 'onboarding.alpha_processed_result')}</h3>
                  {extractionModeNotice === 'local' && <p data-testid="onboarding-import-extraction-mode" className="text-xs leading-relaxed text-cyan-100/80">{t('onboarding.alpha_local_receipt')}</p>}
                  {extractionModeNotice === 'unknown' && <p data-testid="onboarding-unknown-extraction-mode" role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-100">{t('onboarding.alpha_unknown_extraction_mode')}</p>}
                  <p className="text-xs text-gray-200">{importReceipt.countsKnown
                    ? formatOnboardingMessage(t, importReceipt.countBasis === 'saved' ? 'onboarding.alpha_saved_counts' : 'onboarding.alpha_reported_counts', {
                      entities: importReceipt.entities,
                      relationships: importReceipt.relationships,
                    })
                    : t('onboarding.alpha_counts_unknown')}</p>
                  {importReceipt.total > 0 && <p className="text-xs text-gray-400">{formatOnboardingMessage(t, 'onboarding.alpha_processed_segments', {
                    completed: importReceipt.completed,
                    total: importReceipt.total,
                    failureNote: importReceipt.failures > 0
                      ? ` · ${formatOnboardingMessage(t, 'onboarding.alpha_segments_incomplete', { failures: importReceipt.failures })}`
                      : '',
                  })}</p>}
                  {importReceipt.coverage !== undefined && <p className="text-xs text-gray-400">{formatOnboardingMessage(t, 'onboarding.alpha_coverage', { percent: Math.round(importReceipt.coverage * 100) })}</p>}
                  <p className="text-xs leading-relaxed text-gray-400">{t('onboarding.alpha_receipt_disclaimer')}</p>
                  {onAskImported && importReceipt.countsKnown && (importReceipt.entities > 0 || importReceipt.relationships > 0) && (
                    <button type="button" onClick={onAskImported} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                      {t('onboarding.alpha_ask_with_import')} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
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
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-cyan-400" /> {t('onboarding.alpha_mcp_title')}</h2>
                <p className="text-xs text-gray-400 leading-relaxed">{t('onboarding.alpha_mcp_desc')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ id: 'claude', name: 'Claude Desktop' }, { id: 'cursor', name: 'Cursor' }, { id: 'cline', name: 'Cline (VS Code)' }, { id: 'other', name: t('onboarding.alpha_client_later') }].map((c) => (
                  <button key={c.id} onClick={() => { setSelectedClient(c.id as any); setMcpState('idle'); }} className={`p-4 rounded-xl border text-left transition-all ${selectedClient === c.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="font-semibold text-sm flex items-center justify-between">{c.name}{selectedClient === c.id && <Check className="w-4 h-4 text-cyan-400" />}</div>
                  </button>
                ))}
              </div>
              <button onClick={connectMcp} disabled={mcpState === 'connecting'} className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border ${mcpState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : mcpState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {mcpState === 'connecting' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.client_connecting')}</> : mcpState === 'success' ? <><Check className="w-4 h-4" />{t('onboarding.client_configured')}</> : selectedClient === 'other' ? <><span>{t('onboarding.next')}</span><ArrowRight className="w-4 h-4" /></> : <><Copy className="w-4 h-4" /><span>{t('onboarding.alpha_connect_client')}</span></>}
              </button>
            </div>
          )}

          {/* ④ 习惯 */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Database className="w-5 h-5 text-cyan-400" /> {t('onboarding.alpha_habit_title')}</h2>
                <p className="text-xs text-gray-400 leading-relaxed">{t('onboarding.alpha_habit_desc')}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-center">
                <div className="text-xs text-gray-400">{t('onboarding.alpha_capture_shortcut')}</div>
                <div className="text-lg font-mono text-cyan-300 mt-1">Ctrl + Shift + P</div>
              </div>
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-3 text-center text-xs text-cyan-200/90">{t('onboarding.alpha_decision_boundary')}</div>
            </div>
          )}
        </div>

        {(importing || importPending) && step !== 2 && (
          <p role="status" className="px-6 pb-3 text-xs text-gray-400">{importing
            ? t('onboarding.alpha_return_to_import_processing')
            : t('onboarding.alpha_return_to_import_uncertain')}</p>
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
