"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  X, Scale, GitBranch, Loader2, ChevronDown, ChevronRight, Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useTranslation } from "@/hooks/useTranslation";
import { DecisionLineage } from "@/hooks/useDecisionContext";

interface DecisionItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  created_at: string;
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
  const { t } = useTranslation();

  const [items, setItems] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineageMap, setLineageMap] = useState<Record<string, DecisionLineage>>({});
  const [lineageLoading, setLineageLoading] = useState<string | null>(null);

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/mcp/tool/list_entities", {
        method: "POST",
        body: JSON.stringify({ arguments: { type: "decision", limit: 100 } }),
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = (await res.json()) as DecisionItem[];
      data.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setItems(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setExpandedId(null);
      fetchDecisions();
    }
  }, [isOpen, fetchDecisions]);

  const toggleExpand = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (!lineageMap[id]) {
        setLineageLoading(id);
        try {
          const res = await apiFetch("/api/mcp/tool/get_decision_lineage", {
            method: "POST",
            body: JSON.stringify({ arguments: { decision_id: id } }),
          });
          if (res.ok) {
            const data = (await res.json()) as DecisionLineage;
            setLineageMap((prev) => ({ ...prev, [id]: data }));
          }
        } catch {
          // best effort; expansion still shows description
        } finally {
          setLineageLoading(null);
        }
      }
    },
    [expandedId, lineageMap],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] p-4 bg-black/75 backdrop-blur-md transition-opacity"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-2xl border border-cyan-500/20 bg-slate-950/85 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh]"
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
                          ) : lineage ? (
                            <div className="space-y-2">
                              {lineage.sources.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-gray-600 uppercase tracking-wider">{t("decision.lineage_source")}</div>
                                  {lineage.sources.map((src, i) => (
                                    <button
                                      key={`${src.entityId}-${i}`}
                                      onClick={() => { onSelectEntity(src.entityId); onClose(); }}
                                      className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-white/5 hover:border-purple-500/20 hover:bg-purple-500/5 transition-all text-left"
                                    >
                                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500/60 shrink-0" />
                                      <span className="text-xs text-gray-300 truncate">{src.entityName}</span>
                                      <span className="ml-auto text-[10px] text-gray-600 shrink-0">{src.entityType}</span>
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
