"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { apiFetch } from "@/lib/api-client";
import { createRequestDeadline } from "@/lib/request-deadline";
import { useTranslation } from "@/hooks/useTranslation";

type JsonObject = Record<string, unknown>;

type OutcomeContext = {
  outcome_id: string;
  verification_status: string;
  revisit_required: boolean;
  expected_state: JsonObject | null;
  trusted_observed_state: JsonObject | null;
  reason_codes: string[];
};

type RevisionProjection = {
  root_decision_id: string;
  original_decision_id: string;
  parent_decision_id: string;
  current_decision_id: string;
  revision_index: number;
  revision_count: number;
  revision_status: "OPEN" | "DECIDED" | "ABANDONED" | null;
  trigger_type: string | null;
  revisit_required: boolean;
  reopen_recommended: boolean;
  latest_outcome: string | null;
  outcome_reason_codes: string[];
  current_disposition: string | null;
  new_plan_pending_approval: boolean | null;
  evidence_delta_summary: Array<{
    evidence_class: string;
    category: "UNCHANGED" | "NEW" | "STALE_NOW" | "CONFLICTED_NOW" | "MISSING_NOW" | "QUALIFICATION_CHANGED";
    original_status: string | null;
    current_status: string | null;
  }>;
  history_truncated: boolean;
  history: Array<{
    revision_id: string;
    revision_index: number;
    parent_decision_id: string;
    new_decision_id: string;
    trigger_type: string;
    status: string;
    new_disposition: string;
    resolved_at: string;
  }>;
};

type PlanRecord = {
  plan: {
    plan_id: string; decision_id: string; capability_id: string; state: string;
    required_approval: boolean; approval_granted?: boolean; risk_snapshot?: { risk_level: string; side_effect_class: string; reversible: boolean };
    evidence_coverage_snapshot?: { entries?: Array<{ evidence_class: string; status: string }> };
    normalized_inputs?: Record<string, unknown>; created_at?: string; expires_at?: string;
  };
  approval_request?: { status: string; expires_at?: string; side_effect_summary?: { side_effect_class: string; reversible: boolean }; evidence_summary?: { mandatory_satisfied: boolean } } | null;
  blocked_reason?: string | null;
  outcome?: { status?: "PENDING" | "VERIFIED" | "MISMATCH" | "INCONCLUSIVE"; revisit_required?: boolean; readback_attempts?: number; verification_attempts?: number } | null;
  outcome_context?: OutcomeContext | null;
  revision?: RevisionProjection | null;
};

type ReopenTarget = {
  decisionId: string;
  outcomeId: string | null;
  outcomeStatus: "MISMATCH" | "INCONCLUSIVE" | "VERIFIED";
};

function isPlanRecord(value: unknown): value is PlanRecord {
  if (!value || typeof value !== 'object') return false;
  const plan = (value as Partial<PlanRecord>).plan;
  return Boolean(plan && typeof plan === 'object'
    && typeof plan.plan_id === 'string' && typeof plan.decision_id === 'string'
    && typeof plan.capability_id === 'string' && typeof plan.state === 'string');
}

function stateText(state: JsonObject | null, unavailable: string, truncated: string): string {
  if (!state) return unavailable;
  const serialized = JSON.stringify(state, null, 2);
  return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}\n… ${truncated}` : serialized;
}

export default function ControlCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [records, setRecords] = useState<PlanRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<ReopenTarget | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenResult, setReopenResult] = useState<string | null>(null);

  const refresh = useCallback(async (replaceInFlight = false) => {
    // Polls and retries share one read. A successful mutation must replace any
    // older read so a pre-action snapshot cannot restore stale action buttons.
    // Failed/unavailable reads never masquerade as an empty approval queue.
    if (requestRef.current) {
      if (!replaceInFlight) return;
      requestRef.current.abort();
    }
    const controller = new AbortController();
    const deadline = createRequestDeadline(15_000, controller.signal);
    requestRef.current = controller;
    setLoading(true);
    try {
      const response = await apiFetch('/api/control/plans', { signal: deadline.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?.plans) || !body.plans.every(isPlanRecord)) {
        throw new Error('CONTROL_PLANS_RESPONSE_INVALID');
      }
      if (requestRef.current !== controller) return;
      setRecords(body.plans);
      setLoadError(null);
    } catch (e) {
      if (requestRef.current === controller) {
        setLoadError(deadline.didTimeout() ? 'CONTROL_PLANS_TIMEOUT' : e instanceof Error ? e.message : String(e));
      }
    } finally {
      deadline.clear();
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      clearInterval(timer);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [isOpen, refresh]);
  if (!isOpen) return null;

  const valueText = (value?: string | null): string => {
    if (!value) return t('controlCenter.unavailable');
    const key = `controlCenter.values.${value.toLowerCase()}`;
    const translated = t(key);
    // Keep unknown technical identifiers intact for advanced inspection.
    return typeof translated !== 'string' || translated === key ? value : translated;
  };
  const dateText = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
  const actionsDisabled = busy !== null || loading || loadError !== null;

  const act = async (planId: string, action: 'approve_pending_plan' | 'execute_ready_plan' | 'verify_pending_plan') => {
    if (actionsDisabled) return;
    setBusy(`${action}:${planId}`); setError(null);
    try { await invoke(action, { planId }); await refresh(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const requestReopen = (record: PlanRecord) => {
    if (actionsDisabled) return;
    const status = record.outcome?.status;
    if (status !== "MISMATCH" && status !== "INCONCLUSIVE" && status !== "VERIFIED") return;
    setReopenTarget({
      decisionId: record.plan.decision_id,
      outcomeId: record.outcome_context?.outcome_id ?? null,
      outcomeStatus: status,
    });
    setReopenReason("");
    setReopenResult(null);
  };

  const confirmReopen = async () => {
    if (!reopenTarget || actionsDisabled) return;
    if (reopenTarget.outcomeStatus === "VERIFIED" && !reopenReason.trim()) {
      setError(t('controlCenter.reason_required_error'));
      return;
    }
    setBusy(`reopen:${reopenTarget.decisionId}`); setError(null);
    try {
      // The user reaches this branch only after seeing the confirmation copy
      // below. Minting the short-lived session does not itself mutate a
      // decision or execute a plan.
      await invoke('enable_cli_reopen');
      const result = await invoke<Record<string, unknown>>('reopen_decision', {
        decisionId: reopenTarget.decisionId,
        reason: reopenReason.trim() || null,
        outcomeId: reopenTarget.outcomeId,
      });
      setReopenResult(t('controlCenter.reopen_created').replace('{id}', String((result as { data?: { new_decision_id?: string } })?.data?.new_decision_id ?? t('controlCenter.server_revision'))));
      setReopenTarget(null);
      await refresh(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="control-center-title" className="h-full w-full max-w-2xl overflow-y-auto border-l border-cyan-500/20 bg-[#090b12] p-4 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-wide text-cyan-400">{t('controlCenter.eyebrow')}</div>
          <h2 id="control-center-title" className="mt-1 text-2xl font-semibold text-white">{t('controlCenter.title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-300">{t('controlCenter.purpose')}</p>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">{t('controlCenter.boundary')}</p>
        </div>
        <button onClick={onClose} aria-label={t('controlCenter.close')} className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      {loadError && <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
        <div className="font-medium">{t('controlCenter.load_failed')}</div>
        <p className="mt-2 text-xs leading-relaxed">{t('controlCenter.load_failed_hint')}</p>
        {records !== null && records.length > 0 && <p className="mt-2 text-xs">{t('controlCenter.stale_records')}</p>}
        <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('controlCenter.technical_details')}</summary><div className="mt-1 break-words font-mono">{loadError}</div></details>
        <button disabled={loading} onClick={() => void refresh()} className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-xs disabled:opacity-50">{t('controlCenter.retry')}</button>
      </div>}
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">
        <p>{t('controlCenter.action_failed')}</p>
        <details className="mt-2"><summary className="cursor-pointer">{t('controlCenter.technical_details')}</summary><div className="mt-1 break-words">{error}</div></details>
      </div>}
      {reopenResult && <div role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-100">{reopenResult}</div>}
      {loading && <div role="status" className="mb-4 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />{t(records === null ? 'controlCenter.loading' : 'controlCenter.refreshing')}</div>}
      {!loadError && records?.length === 0 && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-relaxed text-gray-300">
        <h3 className="font-medium text-white">{t('controlCenter.empty_title')}</h3>
        <p className="mt-2">{t('controlCenter.empty_hint')}</p>
        <p className="mt-3 text-xs text-gray-400">{t('controlCenter.personal_decisions_hint')}</p>
      </div>}
      <div className="space-y-4">{(records ?? []).map((record) => {
        const plan = record.plan; const pending = plan.state === 'awaiting_approval'; const ready = plan.state === 'ready'; const outcome = record.outcome;
        const receiptCaptured = Boolean(outcome); const outcomePending = outcome?.status === 'PENDING'; const entries = plan.evidence_coverage_snapshot?.entries ?? [];
        const canReopen = outcome?.status === 'MISMATCH' || outcome?.status === 'INCONCLUSIVE' || outcome?.status === 'VERIFIED';
        const revision = record.revision;
        return <article key={plan.plan_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-words font-medium text-white">{plan.capability_id}</div><div className="mt-1 break-all font-mono text-[10px] text-gray-500">{plan.plan_id}</div></div><span title={plan.state} className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${pending ? 'bg-amber-500/20 text-amber-300' : ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-300'}`}>{valueText(plan.state)}</span></div>
          <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div><span className="text-gray-500">{t('controlCenter.risk')}</span><div className="text-gray-200" title={plan.risk_snapshot?.risk_level}>{valueText(plan.risk_snapshot?.risk_level)}</div></div>
            <div><span className="text-gray-500">{t('controlCenter.side_effects')}</span><div className="text-gray-200" title={plan.risk_snapshot?.side_effect_class}>{valueText(plan.risk_snapshot?.side_effect_class)} · {plan.risk_snapshot ? t(plan.risk_snapshot.reversible ? 'controlCenter.reversible' : 'controlCenter.not_reversible') : t('controlCenter.unknown')}</div></div>
            <div><span className="text-gray-500">{t('controlCenter.evidence')}</span><div className="break-words text-gray-200">{entries.map((entry) => `${entry.evidence_class}: ${valueText(entry.status)}`).join(' · ') || t('controlCenter.unavailable')}</div></div>
            <div><span className="text-gray-500">{t('controlCenter.expiry')}</span><div className="text-gray-200">{plan.expires_at ? dateText(plan.expires_at) : t('controlCenter.policy_ttl')}</div></div>
          </div>
          {pending && <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">{t('controlCenter.approval_hint')}</div>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-gray-400">
            <div>{t('controlCenter.process')}<br /><span className="text-gray-200">{t(receiptCaptured ? 'controlCenter.recorded' : 'controlCenter.not_started')}</span></div>
            <div>{t('controlCenter.receipt')}<br /><span className="text-gray-200">{t(receiptCaptured ? 'controlCenter.captured' : 'controlCenter.pending')}</span></div>
            <div>{t('controlCenter.readback')}<br /><span className="text-gray-200">{receiptCaptured ? t('controlCenter.attempts').replace('{count}', String(outcome?.readback_attempts ?? 0)) : t('controlCenter.pending')}</span></div>
          </div>
          <ol className="mt-4 space-y-1 break-words border-l border-white/10 pl-3 text-[11px] text-gray-400">
            <li>{t('controlCenter.evidence_qualified')} · {t(entries.length ? 'controlCenter.coverage_captured' : 'controlCenter.unavailable')}</li>
            <li>{t('controlCenter.decision')} {plan.decision_id} · {t('controlCenter.plan_created')} {plan.created_at ? dateText(plan.created_at) : t('controlCenter.server_owned')}</li>
            <li>{t('controlCenter.approval')} · {t(plan.approval_granted ? 'controlCenter.approved_not_executed' : pending ? 'controlCenter.awaiting_human' : 'controlCenter.approval_not_required')}</li>
            <li>{t('controlCenter.execution_receipt')} · {t(receiptCaptured ? 'controlCenter.native_receipt' : 'controlCenter.not_started')}</li>
            <li>{t('controlCenter.readback_outcome')} · {outcome?.status ? valueText(outcome.status) : t('controlCenter.pending_execution')}</li>
          </ol>
          {outcome && <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-violet-100">
            <div>{t('controlCenter.outcome')}: <span className="font-semibold" title={outcome.status}>{valueText(outcome.status)}</span>{outcome.revisit_required ? ` · ${t('controlCenter.revisit_required')}` : ''}</div>
            {record.outcome_context && <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div><div className="text-[10px] tracking-wide text-violet-300">{t('controlCenter.expected_state')}</div><pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px] text-violet-50">{stateText(record.outcome_context.expected_state, t('controlCenter.unavailable'), t('controlCenter.truncated'))}</pre></div>
              <div><div className="text-[10px] tracking-wide text-violet-300">{t('controlCenter.observed_state')}</div><pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px] text-violet-50">{stateText(record.outcome_context.trusted_observed_state, t('controlCenter.unavailable'), t('controlCenter.truncated'))}</pre></div>
            </div>}
          </div>}
          {revision && <div className="mt-3 break-words rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-cyan-50">
            <div className="font-medium text-cyan-200">{t('controlCenter.current_judgment')} · {valueText(revision.current_disposition)} · {t('controlCenter.revision')} {revision.revision_index}</div>
            <div className="mt-1 break-all font-mono text-[10px] text-cyan-300">{t('controlCenter.root')} {revision.root_decision_id} → {t('controlCenter.parent')} {revision.parent_decision_id} → {t('controlCenter.current')} {revision.current_decision_id}</div>
            <div className="mt-2 text-[10px] text-cyan-100">{t('controlCenter.trigger')}: {valueText(revision.trigger_type)} · {t('controlCenter.new_plan')}: {t(revision.new_plan_pending_approval === true ? 'controlCenter.new_plan_pending' : revision.new_plan_pending_approval === false ? 'controlCenter.new_plan_not_pending' : 'controlCenter.unknown')}</div>
            {revision.outcome_reason_codes.length > 0 && <div className="mt-1 text-[10px] text-cyan-100">{t('controlCenter.outcome_reasons')}: {revision.outcome_reason_codes.join(' · ')}</div>}
            <div className="mt-3"><div className="text-[10px] tracking-wide text-cyan-300">{t('controlCenter.evidence_delta')}</div><div className="mt-1 flex flex-wrap gap-1">{revision.evidence_delta_summary.map((entry) => <span key={entry.evidence_class} title={entry.category} className="rounded bg-black/20 px-2 py-1 text-[10px]">{entry.evidence_class}: {valueText(entry.category)}</span>)}</div></div>
            <div className="mt-3"><div className="text-[10px] tracking-wide text-cyan-300">{t('controlCenter.revision_history')}</div>{revision.history_truncated && <div className="mt-1 text-[10px] text-cyan-200">{t('controlCenter.bounded_history')}</div>}<ol className="mt-1 space-y-1 border-l border-cyan-400/20 pl-3 text-[10px]">{revision.history.map((entry) => <li key={entry.revision_id}>{t('controlCenter.revision')} {entry.revision_index} · {valueText(entry.trigger_type)} · {entry.parent_decision_id} → {entry.new_decision_id} · {valueText(entry.new_disposition)}</li>)}</ol></div>
          </div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {pending && <button disabled={actionsDisabled} onClick={() => act(plan.plan_id, 'approve_pending_plan')} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-2 text-xs text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />{t('controlCenter.approve')}</button>}
            {ready && !receiptCaptured && <button disabled={actionsDisabled} onClick={() => act(plan.plan_id, 'execute_ready_plan')} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />{t('controlCenter.run')}</button>}
            {outcomePending && <button disabled={actionsDisabled} onClick={() => act(plan.plan_id, 'verify_pending_plan')} className="flex items-center gap-1 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 disabled:opacity-50"><Check className="h-3.5 w-3.5" />{t('controlCenter.verify')}</button>}
            {canReopen && <button disabled={actionsDisabled} onClick={() => requestReopen(record)} className="flex items-center gap-1 rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{t(outcome?.status === 'VERIFIED' ? 'controlCenter.reconsider' : 'controlCenter.reopen')}</button>}
          </div>
        </article>;
      })}</div>
      {reopenTarget && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={t('controlCenter.confirm_reopen')} onClick={() => busy === null && setReopenTarget(null)}>
        <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-cyan-400/30 bg-[#101522] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="text-xs tracking-wide text-cyan-300">{t('controlCenter.confirm_new_judgment')}</div>
          <h3 className="mt-2 break-words text-lg font-semibold text-white">{t('controlCenter.reopen_question').replace('{id}', reopenTarget.decisionId)}</h3>
          <p className="mt-3 text-sm text-cyan-50">{t('controlCenter.reopen_boundary')}</p>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">{t('controlCenter.reopen_evidence_hint')}</p>
          <label htmlFor="control-reopen-reason" className="mt-4 block text-xs text-gray-300">{t('controlCenter.owner_reason')} {t(reopenTarget.outcomeStatus === 'VERIFIED' ? 'controlCenter.reason_required' : 'controlCenter.reason_optional')}</label>
          <textarea id="control-reopen-reason" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} maxLength={1000} className="mt-1 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white outline-none focus:border-cyan-400" placeholder={t('controlCenter.reason_placeholder')} />
          <div className="mt-4 flex justify-end gap-2"><button disabled={busy !== null} onClick={() => setReopenTarget(null)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200 disabled:opacity-50">{t('controlCenter.cancel')}</button><button disabled={actionsDisabled || (reopenTarget.outcomeStatus === 'VERIFIED' && !reopenReason.trim())} onClick={() => void confirmReopen()} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs text-white disabled:opacity-50">{t('controlCenter.create_judgment')}</button></div>
        </div>
      </div>}
    </section>
  </div>;
}
