"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Play, ShieldCheck, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { apiFetch } from "@/lib/api-client";

type PlanRecord = {
  plan: {
    plan_id: string; decision_id: string; capability_id: string; state: string;
    required_approval: boolean; approval_granted?: boolean; risk_snapshot?: { risk_level: string; side_effect_class: string; reversible: boolean };
    evidence_coverage_snapshot?: { entries?: Array<{ evidence_class: string; status: string }> };
    normalized_inputs?: Record<string, unknown>; created_at?: string; expires_at?: string;
  };
  approval_request?: { status: string; expires_at?: string; side_effect_summary?: { side_effect_class: string; reversible: boolean }; evidence_summary?: { mandatory_satisfied: boolean } } | null;
  blocked_reason?: string | null;
  outcome?: { status?: string; revisit_required?: boolean; readback_attempts?: number; verification_attempts?: number } | null;
};

export default function ControlCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<PlanRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/control/plans');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      setRecords(Array.isArray(body?.plans) ? body.plans : []);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { if (isOpen) { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); } }, [isOpen, refresh]);
  if (!isOpen) return null;

  const act = async (planId: string, action: 'approve_pending_plan' | 'execute_ready_plan' | 'verify_pending_plan') => {
    setBusy(`${action}:${planId}`); setError(null);
    try { await invoke(action, { planId }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
    <section className="h-full w-full max-w-2xl overflow-y-auto border-l border-cyan-500/20 bg-[#090b12] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-6 flex items-center justify-between"><div><div className="text-xs uppercase tracking-[0.25em] text-cyan-400">Control</div><h2 className="text-2xl font-semibold text-white">Decision Control Center</h2><p className="mt-1 text-xs text-gray-400">Approved ≠ Executed. Reality is verified separately.</p></div><button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button></div>
      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">{error}</div>}
      {records.length === 0 && <div className="rounded-xl border border-white/10 p-6 text-sm text-gray-400">No server-owned decisions or plans yet.</div>}
      <div className="space-y-4">{records.map((record) => {
        const plan = record.plan; const pending = plan.state === 'awaiting_approval'; const ready = plan.state === 'ready'; const outcome = record.outcome;
        const receiptCaptured = Boolean(outcome); const outcomePending = outcome?.status === 'PENDING';
        const entries = plan.evidence_coverage_snapshot?.entries ?? [];
        return <article key={plan.plan_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="font-medium text-white">{plan.capability_id}</div><div className="mt-1 font-mono text-[10px] text-gray-500">{plan.plan_id}</div></div><span className={`rounded-full px-2 py-1 text-[10px] uppercase ${pending ? 'bg-amber-500/20 text-amber-300' : ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-300'}`}>{plan.state}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><span className="text-gray-500">Risk</span><div className="text-gray-200">{plan.risk_snapshot?.risk_level ?? 'unknown'}</div></div><div><span className="text-gray-500">Side effects</span><div className="text-gray-200">{plan.risk_snapshot?.side_effect_class ?? 'unknown'} · {plan.risk_snapshot?.reversible ? 'reversible' : 'not reversible'}</div></div><div><span className="text-gray-500">Evidence</span><div className="text-gray-200">{entries.map((entry) => `${entry.evidence_class}: ${entry.status}`).join(' · ') || 'not available'}</div></div><div><span className="text-gray-500">Expiry</span><div className="text-gray-200">{plan.expires_at ? new Date(plan.expires_at).toLocaleString() : 'bounded policy TTL'}</div></div></div>
          {pending && <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/20 p-3 text-xs text-amber-100">Human approval required. Approval only changes the plan to ready; it never starts execution.</div>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-gray-400"><div>Process<br /><span className="text-gray-200">{receiptCaptured ? 'RECORDED' : 'NOT_STARTED'}</span></div><div>Receipt<br /><span className="text-gray-200">{receiptCaptured ? 'CAPTURED' : 'PENDING'}</span></div><div>Read-back<br /><span className="text-gray-200">{receiptCaptured ? `${outcome?.readback_attempts ?? 0} attempt(s)` : 'PENDING'}</span></div></div>
          <ol className="mt-4 space-y-1 border-l border-white/10 pl-3 text-[11px] text-gray-400"><li>Evidence qualified · {entries.length ? 'coverage captured' : 'not available'}</li><li>Decision {plan.decision_id} · plan created {plan.created_at ? new Date(plan.created_at).toLocaleString() : 'server-owned'}</li><li>Approval · {plan.approval_granted ? 'approved (execution not started by approval)' : pending ? 'awaiting human control' : 'not required / unavailable'}</li><li>Execution / receipt · {receiptCaptured ? 'native receipt captured' : 'not started'}</li><li>Read-back / outcome · {outcome?.status ?? 'pending execution'}</li></ol>
          {outcome && <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-violet-100">Outcome: <span className="font-semibold">{outcome.status}</span>{outcome.revisit_required ? ' · Revisit required' : ''}</div>}
          <div className="mt-4 flex flex-wrap gap-2">{pending && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'approve_pending_plan')} className="flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-2 text-xs text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />Approve</button>}{ready && !receiptCaptured && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'execute_ready_plan')} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />Run approved action</button>}{outcomePending && <button disabled={busy !== null} onClick={() => act(plan.plan_id, 'verify_pending_plan')} className="flex items-center gap-1 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Verify reality</button>}</div>
        </article>;
      })}</div>
    </section>
  </div>;
}
