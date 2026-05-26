"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, Scale, BookOpen, History, ShieldAlert, Loader2, Check, Save, ChevronDown, ChevronRight } from "lucide-react";
import { useDecisionContext } from "@/hooks/useDecisionContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";

interface DecisionAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity: (entityId: string) => void;
}

type ColumnKey = "principles" | "history" | "conflicts";

interface ColumnDef {
  key: ColumnKey;
  labelKey: string;
  emptyKey: string;
  icon: React.ReactNode;
}

export default function DecisionAssistant({ isOpen, onClose, onSelectEntity }: DecisionAssistantProps) {
  const { t } = useTranslation();
  const { isLoading, error, result, submit, saveDecision } = useDecisionContext();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveConclusion, setSaveConclusion] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [expandedRefs, setExpandedRefs] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
      setQuery("");
      setShowSaveInput(false);
      setSaveConclusion("");
    }
  }, [isOpen]);

  const columns: ColumnDef[] = [
    { key: "principles", labelKey: "decision.section_principles", emptyKey: "decision.no_result_principles", icon: <BookOpen className="w-4 h-4 text-purple-400" /> },
    { key: "history", labelKey: "decision.section_history", emptyKey: "decision.no_result_history", icon: <History className="w-4 h-4 text-blue-400" /> },
    { key: "conflicts", labelKey: "decision.section_conflicts", emptyKey: "decision.no_result_conflicts", icon: <ShieldAlert className="w-4 h-4 text-red-400" /> },
  ];

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;
    submit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const getCitedIds = (): string[] => {
    if (!result) return [];
    const ids: string[] = [];
    for (const p of result.principles || []) {
      if (p.id) ids.push(p.id);
    }
    for (const m of result.relevantMemories || []) {
      if (m.id) ids.push(m.id);
    }
    for (const c of result.conflicts || []) {
      if (c.a?.id) ids.push(c.a.id);
      if (c.b?.id) ids.push(c.b.id);
    }
    return [...new Set(ids)];
  };

  const handleSave = async () => {
    const trimmed = saveConclusion.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    try {
      const citedIds = getCitedIds();
      const newEntityId = await saveDecision(query, trimmed, citedIds);
      if (newEntityId) {
        toast.success(t("decision.save_success"));
        onSelectEntity(newEntityId);
      }
      onClose();
    } catch {
      toast.error(t("toast.graph_save_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setShowSaveInput(false);
      setSaveConclusion("");
    }
  };

  const handleItemClick = (id: string | undefined) => {
    if (id) {
      onSelectEntity(id);
    }
    onClose();
  };

  const getColumnItems = (col: ColumnKey) => {
    if (!result) return [];
    switch (col) {
      case "principles":
        return (result.principles || []).map((p) => ({ id: p.id, title: p.name, subtitle: p.description || p.type }));
      case "history":
        return (result.relevantMemories || []).map((m) => ({ id: m.id, title: m.name, subtitle: m.description || m.type }));
      case "conflicts":
        return (result.conflicts || []).map((c) => ({
          id: c.a?.id || c.b?.id,
          title: `${c.a?.name || "?"} vs ${c.b?.name || "?"}`,
          subtitle: c.description,
        }));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] p-4 bg-black/75 backdrop-blur-md transition-opacity"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="glass-panel w-full max-w-3xl border border-cyan-500/20 bg-slate-950/80 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <Scale className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white tracking-wide">{t("decision.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
            title="Esc"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 输入区域 */}
        <div className="px-5 py-4 border-b border-white/10 bg-black/20">
          <label className="block text-sm text-gray-300 mb-2 font-medium">
            {t("decision.placeholder")}
          </label>
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
            placeholder={t("decision.placeholder")}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-500">{t("decision.submit_hint")}</span>
            <button
              onClick={handleSubmit}
              disabled={!query.trim() || isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("decision.submit")}
            </button>
          </div>
        </div>

        {/* 结果区域 */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* 分析中 / 错误 */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-cyan-400/75 tracking-wider">{t("decision.analyzing")}</p>
            </div>
          )}

          {!isLoading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
              <X className="w-8 h-8 text-red-400/80" />
              <p className="text-sm text-red-300">{t("search.decision_context_error")}</p>
              <p className="text-xs text-gray-500 max-w-md">{error}</p>
            </div>
          )}

          {/* 单流式结果 + 可折叠引用卡片 */}
          {!isLoading && !error && result && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 可折叠引用区 */}
              {(() => {
                const allRefs = columns.flatMap((col) => {
                  const typeLabel = col.key === "principles" ? "Principle" : col.key === "history" ? "Past Decision" : "Conflict";
                  const colorClass = col.key === "principles" ? "text-purple-400 bg-purple-400/10 border-purple-400/30" : col.key === "history" ? "text-blue-400 bg-blue-400/10 border-blue-400/30" : "text-red-400 bg-red-400/10 border-red-400/30";
                  return getColumnItems(col.key).map((item, i) => ({ ...item, typeLabel, colorClass, colKey: col.key, index: i }));
                });
                if (allRefs.length === 0) return null;
                return (
                  <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                    <button onClick={() => setExpandedRefs((prev) => !prev)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/5 transition-colors">
                      {expandedRefs ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                      <span className="text-sm font-medium text-gray-300">References</span>
                      <span className="ml-auto text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">{allRefs.length}</span>
                    </button>
                    {expandedRefs && (
                      <div className="px-4 pb-3 space-y-1.5">
                        {allRefs.map((ref) => (
                          <button key={`${ref.colKey}-${ref.id}-${ref.index}`} onClick={() => handleItemClick(ref.id)} className="w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left border border-transparent hover:border-cyan-500/20 hover:bg-cyan-500/5 transition-all group">
                            <span className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ref.colorClass}`}>{ref.typeLabel}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white font-medium truncate group-hover:text-cyan-300 transition-colors">{ref.title}</p>
                              {ref.subtitle && <p className="text-xs text-gray-500 truncate mt-0.5">{ref.subtitle}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* 保存决策区 */}
              <div className="px-1">
                {!showSaveInput ? (
                  <button
                    onClick={() => { setShowSaveInput(true); setTimeout(() => saveInputRef.current?.focus(), 100); }}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-sm font-medium rounded-lg transition-all"
                  >
                    <Save className="w-4 h-4" />
                    {t("decision.save_button")}
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <textarea ref={saveInputRef} value={saveConclusion} onChange={(e) => setSaveConclusion(e.target.value)} onKeyDown={handleSaveKeyDown} rows={2} placeholder={t("decision.save_placeholder")} className="w-full bg-black/40 border border-emerald-500/30 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all" />
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => { setShowSaveInput(false); setSaveConclusion(""); }} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors">
                        {t("graph.cancel")}
                      </button>
                      <button onClick={handleSave} disabled={!saveConclusion.trim() || isSaving} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-all">
                        {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                        <Check className="w-3.5 h-3.5" />
                        {t("decision.save_confirm")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 未查询时的空白提示 */}
          {!isLoading && !error && !result && (
            <div className="flex-1 flex items-center justify-center py-16">
              <p className="text-sm text-gray-500">
                {query.trim() ? t("decision.submit_hint") : ""}
              </p>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-t border-white/10 text-[10px] text-gray-500 shrink-0">
          <span>Ctrl+Enter {t("search.footer_enter")}</span>
          <span>{t("search.footer_esc")}</span>
        </div>
      </div>
    </div>
  );
}
