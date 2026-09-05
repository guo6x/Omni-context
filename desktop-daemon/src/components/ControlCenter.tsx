"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { apiFetch } from "@/lib/api-client";

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

function stateText(state: JsonObject | null): string {
  if (!state) return "NOT_AVAILABLE";
  const serialized = JSON.stringify(state, null, 2);
  return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}\n… bounded display truncated` : serialized;
}

export default function ControlCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<PlanRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<ReopenTarget | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenResult, setReopenResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/control/plans');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      setRecords(Array.isArray(body?.plans) ? body.plans : []);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [isOpen, refresh]);
  if (!isOpen) return null;

  const act = async (planId: string, action: 'approve_pending_plan' | 'execute_ready_plan' | 'verify_pending_plan') => {
    setBusy(`${action}:${planId}`); setError(null);
    try { await invoke(action, { planId }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const requestReopen = (record: PlanRecord) => {
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
    if (!reopenTarget) return;
    if (reopenTarget.outcomeStatus === "VERIFIED" && !reopenReason.trim()) {
      setError("An explicit owner reason is required to reconsider a verified outcome.");
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
      setReopenResult(`New judgment created: ${String((result as { data?: { new_decision_id?: string } })?.data?.new_decision_id ?? "server-owned revision")}. Execution: NOT STARTED.`);
      setReopenTarget(null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
    <section className="h-full w-full max-w-2xl overflow-y-auto border-l border-cyan-500/20 bg-[#090b12] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-6 flex items-center justify-between"><div><div className="text-xs uppercase tracking-[0.25em] text-cyan-400">Control</div><h2 className="text-2xl font-semibold text-white">Decision Control Center</h2><p className="mt-1 text-xs text-gray-400">Approved ≠ Executed. Reality is verified separately; reopening creates a new judgment only.</p></div><button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button></div>
      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">{error}</div>}
      {reopenResult && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-100">{reopenResult}</div>}
      {records.length === 0 && <div className="rounded-xl border border-white/10 p-6 text-sm text-gray-400">No server-owned decisions or plans yet.</div>}
      <div className="space-y-4">{records.map((record) => {
        const plan = record.plan; const pending = plan.state === 'awaiting_approval'; const ready = plan.state === 'ready'; const outcome = record.outcome;
        const receiptCaptured = Boolean(outcome); const outcomePending = outcome?.status === 'PENDING'; const entries = plan.evidence_coverage_snapshot?.entries ?? [];
        const canReopen = outcome?.status === 'MISMATCH' || outcome?.status === 'INCONCLUSIVE' || outcome?.status === 'VERIFIED';
        const revision = record.revision;
        return <article key={plan.plan_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="font-medium text-white">{plan.capability_id}</div><div className="mt-1 font-mono text-[10px] text-gray-500">{plan.plan_id}</div></div><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${pending ? 'bg-amber-500/20 text-amber-300' : ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-300'}`}>{plan.state}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><span className="text-gray-500">Risk</span><div className="text-gray-200">{plan.risk_snapshot?.risk_level ?? 'unknown'}</div></div><div><span className="text-gray-500">Side effects</span><div className="text-gray-200">{plan.risk_snapshot?.side_effect_class ?? 'unknown'} · {plan.risk_snapshot?.reversible ? 'reversible' : 'not reversible'}</div></div><div><span className="text-gray-500">Evidence</span><div className="text-gray-200">{entries.map((entry) => `${entry.evidence_class}: ${entry.status}`).join(' · ') || 'not available'}</div></div><div><span className="text-gray-500">Expiry</span><div className="text-gray-200">{plan.expires_at ? new Date(plan.expires_at).toLocaleString() : 'bounded policy TTL'}</div></div></div>
          {pending && <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-100">Human approval required. Approval only changes the plan to ready; it never starts execution.</div>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-gray-400"><div>Process<br /><span className="text-gray-200">{receiptCaptured ? 'RECORDED' : 'NOT_STARTED'}</span></div><div>Receipt<br /><span className="text-gray-200">{receiptCaptured ? 'CAPTURED' : 'PENDING'}</span></div><div>Read-back<br /><span className="text-gray-200">{receiptCaptured ? `${outcome?.readback_attempts ?? 0} attempt(s)` : 'PENDING'}</span></div></div>
          <ol className="mt-4 space-y-1 border-l border-white/10 pl-3 text-[11px] text-gray-400"><li>Evidence qualified · {entries.length ? 'coverage captured' : 'not available'}</li><li>Decision {plan.decision_id} · plan created {plan.created_at ? new Date(plan.created_at).toLocaleString() : 'server-owned'}</li><li>Approval · {plan.approval_granted ? 'approved (execution not started by approval)' : pending ? 'awaiting human control' : 'not required / unavailable'}</li><li>Execution / receipt · {receiptCaptured ? 'native receipt captured' : 'not started'}</li><li>Read-back / outcome · {outcome?.status ?? 'pending execution'}</li></ol>
          {outcome && <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-violet-100"><div>Outcome: <span className="font-semibold">{outcome.status}</span>{outcome.revisit_required ? ' · Revisit required' : ''}</div>{record.outcome_context && <div className="mt-3 grid gap-2 md:grid-cols-2"><div><div className="text-[10px] uppercase tracking-wide text-violet-300">Expected state</div><pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px] text-violet-50">{stateText(record.outcome_context.expected_state)}</pre></div><div><div className="text-[10px] uppercase tracking-wide text-violet-300">Trusted observed state</div><pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2 text-[10px] text-violet-50">{stateText(record.outcome_context.trusted_observed_state)}</pre></div></div>}</div>}
          {revision && <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-3 text-xs text-cyan-50"><div className="font-medium text-cyan-200">Current judgment · {revision.current_disposition ?? 'NOT_AVAILABLE'} · revision {revision.revision_index}</div><div className="mt-1 font-mono text-[10px] text-cyan-300">root {revision.root_decision_id} → parent {revision.parent_decision_id} → current {revision.current_decision_id}</div><div className="mt-2 text-[10px] text-cyan-100">Trigger: {revision.trigger_type ?? 'NOT_AVAILABLE'} · New plan: {revision.new_plan_pending_approval === true ? 'AWAITING APPROVAL' : revision.new_plan_pending_approval === false ? 'NOT REQUIRED / NOT PENDING' : 'STATE UNKNOWN'}</div>{revision.outcome_reason_codes.length > 0 && <div className="mt-1 text-[10px] text-cyan-100">Outcome reasons: {revision.outcome_reason_codes.join(' · ')}</div>}<div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-cyan-300">Evidence delta</div><div className="mt-1 flex flex-wrap gap-1">{revision.evidence_delta_summary.map((entry) => <span key={entry.evidence_class} className="rounded bg-black/20 px-2 py-1 text-[10px]">{entry.evidence_class}: {entry.category}</span>)}</div></div><div className="mt-3"><div className="text-[10px] uppercase tracking-wide text-cyan-300">Revision history</div>{revision.history_truncated && <div className="mt-1 text-[10px] text-cyan-200">Showing the most recent bounded history entries.</div>}<ol className="mt-1 space-y-1 border-l border-cyan-400/20 pl-3 text-[10px]">{revision.history.map((entry) => <li key={entry.revision_id}>r{entry.revision_index} · {entry.trigger_type} · {entry.parent_decision_id} → {entry.new_decision_id} · {entry.new_disposition}</li>)}</ol></div></div>}
          <div className="mt-4 flex flex-wrap gap-2">{pending && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'approve_pending_plan')} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-2 text-xs text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />Approve</button>}{ready && !receiptCaptured && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'execute_ready_plan')} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />Run approved action</button>}{outcomePending && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'verify_pending_plan')} className="flex items-center gap-1 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Verify reality</button>}{canReopen && <button disabled={busy !== null} onClick={() => requestReopen(record)} className="flex items-center gap-1 rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />{outcome?.status === 'VERIFIED' ? 'Reconsider judgment' : 'Reopen with current evidence'}</button>}</div>
        </article>;
      })}</div>
      {reopenTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Confirm reopen" onClick={() => busy === null && setReopenTarget(null)}><div className="w-full max-w-lg rounded-xl border border-cyan-400/30 bg-[#101522] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Confirm new judgment</div><h3 className="mt-2 text-lg font-semibold text-white">Reopen decision {reopenTarget.decisionId}?</h3><p className="mt-3 text-sm text-cyan-50">Reopening creates a new judgment. It does not undo the previous action.</p><p className="mt-2 text-xs text-gray-400">Current evidence will be qualified again. Existing evidence, coverage, plan, approval, receipt, read-back, and outcome remain immutable. No execution, retry, or rollback will start.</p><label className="mt-4 block text-xs text-gray-300">Owner reason {reopenTarget.outcomeStatus === 'VERIFIED' ? '(required for verified outcome)' : '(optional)'}</label><textarea value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} maxLength={1000} className="mt-1 min-h-24 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white outline-none focus:border-cyan-400" placeholder="Why should this be reconsidered?" /><div className="mt-4 flex justify-end gap-2"><button disabled={busy !== null} onClick={() => setReopenTarget(null)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200 disabled:opacity-50">Cancel</button><button disabled={busy !== null || (reopenTarget.outcomeStatus === 'VERIFIED' && !reopenReason.trim())} onClick={() => void confirmReopen()} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs text-white disabled:opacity-50">Create new judgment</button></div></div></div>}
    </section>
  </div>;
}
