"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  X, Scale, GitBranch, Loader2, ChevronDown, ChevronRight, Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  getSafeOutcomeRetryArgs,
  isDeterministicOutcomeRejection,
  isUserDecision,
  readDecisionLineage,
} from "@/lib/decision-timeline";
import { createRequestDeadline } from "@/lib/request-deadline";
import { useTranslation } from "@/hooks/useTranslation";
import type { DecisionLineage, DecisionOutcomeJournal } from "@/hooks/useDecisionContext";

const OUTCOME_SAVE_TIMEOUT_MS = 15_000;

interface DecisionItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  created_at: string;
  authority?: string;
  user_confirmed?: boolean;
}

interface OutcomeSubmissionArgs {
  decision_id: string;
  idempotency_key: string;
  actual_outcome: string;
  outcome_timestamp: string;
  outcome_score: number;
  provenance: { source: "desktop-decision-log"; authority: "user-journal" };
}

interface PendingOutcomeSubmission {
  args: OutcomeSubmissionArgs;
  status: "saving" | "uncertain";
}

interface DecisionTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity: (id: string) => void;
}

type Confidence = "high" | "medium" | "low";

function confidenceOf(tags?: string[]): Confidence | null {
  const tag = tags?.find((x) => x.startsWith("confidence-"));
  if (!tag) return null;
  const v = tag.slice("confidence-".length);
  return v === "high" || v === "medium" || v === "low" ? v : null;
}

const CONF_CLASS: Record<Confidence, string> = {
  high: "bg-emerald-600/30 border-emerald-500/50 text-emerald-300",
  medium: "bg-yellow-600/30 border-yellow-500/50 text-yellow-300",
  low: "bg-red-600/30 border-red-500/50 text-red-300",
};

export default function DecisionTimeline({ isOpen, onClose, onSelectEntity }: DecisionTimelineProps) {
  const { t, language } = useTranslation();

  const [items, setItems] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineageMap, setLineageMap] = useState<Record<string, DecisionLineage>>({});
  const [lineageLoading, setLineageLoading] = useState<string | null>(null);
  const [lineageErrors, setLineageErrors] = useState<Record<string, boolean>>({});
  const expandedIdRef = useRef<string | null>(null);
  const lineageRequestIdRef = useRef(0);
  const outcomeAttemptsRef = useRef(new Set<string>());
  const [outcomeFormId, setOutcomeFormId] = useState<string | null>(null);
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, { text: string; score: string }>>({});
  const [outcomeSubmissions, setOutcomeSubmissions] = useState<Record<string, PendingOutcomeSubmission>>({});
  const [outcomeMessages, setOutcomeMessages] = useState<Record<string, string>>({});

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/mcp/tool/list_entities", {
        method: "POST",
        body: JSON.stringify({ arguments: { type: "decision", limit: 100 } }),
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = ((await res.json()) as DecisionItem[]).filter(isUserDecision);
      data.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setItems(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLineage = useCallback(async (id: string) => {
    const requestId = ++lineageRequestIdRef.current;
    setLineageLoading(id);
    setLineageErrors((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    try {
      const result = await readDecisionLineage(() => apiFetch("/api/mcp/tool/get_decision_lineage", {
        method: "POST",
        body: JSON.stringify({ arguments: { decision_id: id } }),
      }));
      if (lineageRequestIdRef.current === requestId) {
        if (result.kind === "loaded") {
          setLineageMap((previous) => ({ ...previous, [id]: result.data }));
        } else {
          setLineageErrors((previous) => ({ ...previous, [id]: true }));
        }
      }
    } catch {
      if (lineageRequestIdRef.current === requestId) {
        setLineageErrors((previous) => ({ ...previous, [id]: true }));
      }
    } finally {
      if (lineageRequestIdRef.current === requestId) setLineageLoading(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      // Ignore a lineage response that started in the previous open session.
      lineageRequestIdRef.current += 1;
      setLineageLoading(null);
      setLineageErrors({});
      return;
    }

    // Keep the user's last expanded card open, but always re-read its lineage:
    // another MCP client may have added an outcome since the log was closed.
    const previouslyExpanded = expandedIdRef.current;
    setExpandedId(previouslyExpanded);
    setLineageMap({});
    setLineageErrors({});
    fetchDecisions();
    if (previouslyExpanded) void fetchLineage(previouslyExpanded);
  }, [isOpen, fetchDecisions, fetchLineage]);

  const toggleExpand = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        expandedIdRef.current = null;
        return;
      }
      setExpandedId(id);
      expandedIdRef.current = id;
      if (!lineageMap[id]) await fetchLineage(id);
    },
    [expandedId, fetchLineage, lineageMap],
  );

  const submitOutcome = useCallback(async (decisionId: string, args: OutcomeSubmissionArgs) => {
    if (outcomeAttemptsRef.current.has(decisionId)) return;
    outcomeAttemptsRef.current.add(decisionId);
    setOutcomeMessages((previous) => ({ ...previous, [decisionId]: "" }));
    setOutcomeSubmissions((previous) => ({ ...previous, [decisionId]: { args, status: "saving" } }));
    const deadline = createRequestDeadline(OUTCOME_SAVE_TIMEOUT_MS);
    try {
      const res = await apiFetch("/api/mcp/tool/record_decision_outcome", {
        method: "POST",
        body: JSON.stringify({ arguments: args }),
        signal: deadline.signal,
      });
      if (!res.ok && res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
        const errorCode = typeof body?.error === "string" ? body.error : null;
        const detail = typeof body?.error === "string"
          ? body.error
          : typeof body?.message === "string"
            ? body.message
            : null;
        if (isDeterministicOutcomeRejection(res.status, errorCode)) {
          setOutcomeSubmissions((previous) => {
            const next = { ...previous };
            delete next[decisionId];
            return next;
          });
          setOutcomeDrafts((previous) => ({
            ...previous,
            [decisionId]: { text: args.actual_outcome, score: String(args.outcome_score) },
          }));
          setOutcomeMessages((previous) => ({
            ...previous,
            [decisionId]: language === "zh"
              ? `Brain 已拒绝这次保存（HTTP ${res.status}${detail ? `：${detail}` : ""}）。记录没有提交；请核对内容或本地权限，修改后再保存。`
              : `Brain rejected this save (HTTP ${res.status}${detail ? `: ${detail}` : ""}). Nothing was submitted. Review the entry or local permissions, then edit and save again.`,
          }));
          return;
        }
        throw new Error(`OUTCOME_SAVE_HTTP_${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json() as { outcome?: DecisionOutcomeJournal };
      if (!saved.outcome?.outcome_id) throw new Error("Missing outcome receipt");

      const existing = lineageMap[decisionId];
      if (existing) {
        setLineageMap((previous) => {
          const current = previous[decisionId];
          if (!current) return previous;
          const outcomes = current.current.outcomes ?? [];
          if (outcomes.some((entry) => entry.outcome_id === saved.outcome?.outcome_id)) return previous;
          return {
            ...previous,
            [decisionId]: {
              ...current,
              current: { ...current.current, outcomes: [...outcomes, saved.outcome!] },
            },
          };
        });
      } else {
        // The lineage request may have failed earlier. Refresh after the write
        // so the user can see the saved journal entry without closing the log.
        // The write receipt is already authoritative for this request; a
        // failed follow-up read must not mislabel the committed write uncertain.
        void fetchLineage(decisionId);
      }

      setOutcomeSubmissions((previous) => {
        const next = { ...previous };
        delete next[decisionId];
        return next;
      });
      setOutcomeDrafts((previous) => {
        const next = { ...previous };
        delete next[decisionId];
        return next;
      });
      setOutcomeMessages((previous) => ({ ...previous, [decisionId]: t("decision.outcome_saved") }));
    } catch {
      // Keep the exact key and payload: a retry is safe even if the server
      // committed the write but the success response was lost.
      setOutcomeSubmissions((previous) => ({ ...previous, [decisionId]: { args, status: "uncertain" } }));
      setOutcomeMessages((previous) => ({
        ...previous,
        [decisionId]: t(deadline.didTimeout() ? "decision.outcome_timeout" : "decision.outcome_uncertain")
          .replace("{seconds}", String(OUTCOME_SAVE_TIMEOUT_MS / 1000)),
      }));
    } finally {
      deadline.clear();
      outcomeAttemptsRef.current.delete(decisionId);
    }
  }, [fetchLineage, language, lineageMap, t]);

  const saveOutcome = useCallback((decisionId: string) => {
    const pending = outcomeSubmissions[decisionId];
    if (pending) {
      const retryArgs = getSafeOutcomeRetryArgs(pending);
      if (retryArgs) void submitOutcome(decisionId, retryArgs);
      return;
    }
    const draft = outcomeDrafts[decisionId] ?? { text: "", score: "0.5" };
    const actualOutcome = draft.text.trim();
    const score = Number(draft.score);
    if (!actualOutcome || !Number.isFinite(score) || score < 0 || score > 1) {
      setOutcomeMessages((previous) => ({ ...previous, [decisionId]: t("decision.outcome_invalid") }));
      return;
    }
    void submitOutcome(decisionId, {
      decision_id: decisionId,
      idempotency_key: `outcome:${crypto.randomUUID()}`,
      actual_outcome: actualOutcome,
      outcome_timestamp: new Date().toISOString(),
      outcome_score: score,
      provenance: { source: "desktop-decision-log", authority: "user-journal" },
    });
  }, [outcomeDrafts, outcomeSubmissions, submitOutcome, t]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] p-4 bg-black/75 transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl border border-cyan-500/20 bg-slate-950/85 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-black/40 shrink-0">
          <div className="flex items-center gap-3">
            <Scale className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-lg font-semibold text-white tracking-wide">{t("decision.log_title")}</h2>
              <p className="text-[11px] text-gray-500">{t("decision.log_subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
            title="Esc"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-300 text-center py-10">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-16 leading-relaxed">{t("decision.log_empty")}</p>
          ) : (
            <div className="relative space-y-3">
              {/* timeline spine */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/10" />
              {items.map((d) => {
                const conf = confidenceOf(d.tags);
                const expanded = expandedId === d.id;
                const lineage = lineageMap[d.id];
                const outcomes = lineage?.current.outcomes ?? [];
                const visibleOutcomes = outcomes.slice(-5).reverse();
                const draft = outcomeDrafts[d.id] ?? { text: "", score: "0.5" };
                const submission = outcomeSubmissions[d.id];
                return (
                  <div key={d.id} className="relative pl-7">
                    <div className="absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-cyan-400 bg-slate-950" />
                    <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                      <button
                        onClick={() => toggleExpand(d.id)}
                        className="w-full flex items-start gap-2.5 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                      >
                        {expanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white font-medium leading-snug">{d.name}</p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                            <Clock className="w-3 h-3" />
                            {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                          </div>
                        </div>
                        {conf && (
                          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONF_CLASS[conf]}`}>
                            {t(`decision.save_confidence_${conf}`)}
                          </span>
                        )}
                      </button>

                      {expanded && (
                        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                          {d.description && (
                            <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{d.description}</p>
                          )}

                          {lineageLoading === d.id ? (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {t("decision.thinking")}
                            </div>
                          ) : lineageErrors[d.id] ? (
                            <div data-testid="decision-lineage-error" role="alert" className="flex flex-wrap items-center gap-2 text-xs text-amber-200">
                              <span>{t("decision.lineage_load_error")}</span>
                              <button
                                type="button"
                                data-testid="decision-lineage-retry"
                                onClick={() => { void fetchLineage(d.id); }}
                                className="rounded border border-amber-400/30 px-2 py-1 underline underline-offset-2 hover:bg-amber-500/10"
                              >
                                {t("decision.lineage_retry")}
                              </button>
                            </div>
                          ) : lineage ? (
                            <div className="space-y-2">
                              {lineage.sources.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">{t("decision.lineage_source")}</div>
                                  {lineage.sources.map((src, i) => (
                                    <button
                                      key={`${src.entity_id}-${i}`}
                                      data-testid="decision-lineage-source"
                                      onClick={() => { onSelectEntity(src.entity_id); onClose(); }}
                                      className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-white/5 hover:border-purple-500/20 hover:bg-purple-500/5 transition-all text-left"
                                    >
                                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500/60 shrink-0" />
                                      <span className="text-xs text-gray-300 truncate">{src.entity_name}</span>
                                      <span className="ml-auto text-[10px] text-gray-600 shrink-0">{src.entity_type}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {lineage.chain.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">{t("decision.lineage_chain")} ({lineage.chain.length})</div>
                                  {lineage.chain.map((node) => (
                                    <button
                                      key={node.id}
                                      onClick={() => { onSelectEntity(node.id); onClose(); }}
                                      className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-white/5 hover:border-cyan-500/20 hover:bg-cyan-500/5 transition-all text-left"
                                    >
                                      <div className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                                      <span className="text-xs text-gray-300 truncate">{node.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {lineage.sources.length === 0 && lineage.chain.length === 0 && (
                                <p className="text-[11px] text-gray-600">{t("decision.lineage_empty")}</p>
                              )}
                            </div>
                          ) : null}

                          {outcomes.length > 0 && (
                            <section data-testid="decision-outcome-list" className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-[11px] font-semibold text-amber-200">{t("decision.outcome_title")}</h3>
                                <span className="rounded-full border border-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200/80">{t("decision.outcome_journal_badge")}</span>
                              </div>
                              <p className="text-[10px] leading-relaxed text-amber-100/60">{t("decision.outcome_boundary")}</p>
                              <ol className="space-y-2">
                                {visibleOutcomes.map((outcome) => (
                                  <li key={outcome.outcome_id} className="rounded-md border border-white/5 bg-black/20 p-2.5">
                                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200">{outcome.actual_outcome}</p>
                                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                                      <span>{outcome.outcome_timestamp ? new Date(outcome.outcome_timestamp).toLocaleString() : ""}</span>
                                      {Number.isFinite(outcome.outcome_score) && <span>{t("decision.outcome_score_label")}: {Math.round(outcome.outcome_score * 100)}%</span>}
                                      {outcome.outcome_authority === "journal" && outcome.verified === false && <span>{t("decision.outcome_not_verified")}</span>}
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              {outcomes.length > visibleOutcomes.length && <p className="text-[10px] text-gray-500">{t("decision.outcome_recent_only").replace("{count}", String(visibleOutcomes.length))}</p>}
                            </section>
                          )}

                          <div className="space-y-2">
                            <button
                              type="button"
                              aria-expanded={outcomeFormId === d.id}
                              onClick={() => setOutcomeFormId((current) => current === d.id ? null : d.id)}
                              className="rounded-lg border border-amber-500/25 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10"
                            >
                              {outcomeFormId === d.id ? t("decision.outcome_cancel") : t("decision.outcome_add")}
                            </button>
                            {outcomeFormId === d.id && (
                              <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                                <p data-testid="decision-outcome-restart-boundary" role="note" className="text-[10px] leading-relaxed text-amber-100/70">{t("decision.outcome_restart_boundary")}</p>
                                <label className="block text-[11px] text-gray-300" htmlFor={`outcome-${d.id}`}>{t("decision.outcome_prompt")}</label>
                                <textarea
                                  id={`outcome-${d.id}`}
                                  data-testid="decision-outcome-input"
                                  value={submission?.args.actual_outcome ?? draft.text}
                                  onChange={(event) => setOutcomeDrafts((previous) => ({ ...previous, [d.id]: { ...draft, text: event.target.value } }))}
                                  maxLength={2000}
                                  disabled={Boolean(submission)}
                                  rows={3}
                                  className="w-full resize-y rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-amber-400 disabled:opacity-60"
                                  placeholder={t("decision.outcome_placeholder")}
                                />
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <label className="flex items-center gap-2 text-[10px] text-gray-400">
                                    <span>{t("decision.outcome_score_label")} · {language === "zh" ? "主观自评" : "subjective self-rating"}</span>
                                    <input
                                      aria-label={`${t("decision.outcome_score_label")} (${language === "zh" ? "主观自评" : "subjective self-rating"})`}
                                      type="range"
                                      min="0"
                                      max="1"
                                      step="0.25"
                                      value={submission?.args.outcome_score ?? draft.score}
                                      onChange={(event) => setOutcomeDrafts((previous) => ({ ...previous, [d.id]: { ...draft, score: event.target.value } }))}
                                      disabled={Boolean(submission)}
                                      className="accent-amber-400"
                                    />
                                    <span>{Math.round(Number(submission?.args.outcome_score ?? draft.score) * 100)}%</span>
                                  </label>
                                  <p className="basis-full text-[10px] leading-relaxed text-gray-500">
                                    {language === "zh"
                                      ? "粗略主观回顾：0% 表示结果很不理想，100% 表示结果符合预期；50% 是中间/不确定。不是客观成功率或独立核验。"
                                      : "A coarse personal reflection: 0% means a very poor result, 100% means it met expectations, and 50% is mixed or unsure. This is not an objective success rate or independent verification."}
                                  </p>
                                  <button
                                    type="button"
                                    data-testid="decision-outcome-save"
                                    disabled={submission?.status === "saving"}
                                    onClick={() => saveOutcome(d.id)}
                                    className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/30 disabled:cursor-wait disabled:opacity-50"
                                  >
                                    {submission?.status === "saving" ? t("decision.outcome_saving") : submission?.status === "uncertain" ? t("decision.outcome_retry") : t("decision.outcome_save")}
                                  </button>
                                </div>
                                {outcomeMessages[d.id] && <p role="status" aria-live="polite" className="text-[10px] leading-relaxed text-amber-200">{outcomeMessages[d.id]}</p>}
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => { onSelectEntity(d.id); onClose(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30 transition-all"
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                            {t("graph.view_in_graph")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
