"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X, Scale, BookOpen, Loader2, Check, Save,
  ChevronDown, ChevronRight, Send, Sparkles, ThumbsUp,
  AlertTriangle, Lightbulb, GitBranch, Target, MessageSquare, ArrowRight, HelpCircle,
} from "lucide-react";
import { useDecisionContext, ChatMessage } from "@/hooks/useDecisionContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";

interface DecisionAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity: (entityId: string) => void;
}

type Phase = "input" | "analyzing" | "analysis" | "saving" | "done";

export default function DecisionAssistant({ isOpen, onClose, onSelectEntity }: DecisionAssistantProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    isAnalyzing, analysis, analysisError, analyzeDecision,
    chatHistory, isChatLoading, chatFollowUp,
    lineage, isLineageLoading, getDecisionLineage,
    saveDecision, reset,
  } = useDecisionContext();

  // ── state ──

  const [phase, setPhase] = useState<Phase>("input");
  const [query, setQuery] = useState("");
  const [showEvidence, setShowEvidence] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveConclusion, setSaveConclusion] = useState("");
  const [saveConfidence, setSaveConfidence] = useState<"high" | "medium" | "low">("medium");
  const [saveAlternatives, setSaveAlternatives] = useState("");
  const [savedDecisionId, setSavedDecisionId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLTextAreaElement>(null);

  // ── reset on open ──

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
      setQuery("");
      setPhase("input");
      setShowEvidence(true);
      setShowChat(false);
      setChatInput("");
      setShowSaveForm(false);
      setSaveConclusion("");
      setSaveConfidence("medium");
      setSaveAlternatives("");
      setSavedDecisionId(null);
      reset();
    }
  }, [isOpen, reset]);

  // ── scroll chat to bottom ──

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // ── handlers ──

  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setPhase("analyzing");
    await analyzeDecision(trimmed);
    setPhase("analysis");
  }, [query, analyzeDecision]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (phase === "input") handleSubmit();
    } else if (e.key === "Escape" && phase !== "saving") {
      e.preventDefault();
      onClose();
    }
  }, [phase, handleSubmit, onClose]);

  const handleChatSubmit = useCallback(() => {
    const trimmed = chatInput.trim();
    if (!trimmed || isChatLoading) return;
    setChatInput("");
    chatFollowUp(trimmed);
  }, [chatInput, isChatLoading, chatFollowUp]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  }, [handleChatSubmit]);

  const handleSave = useCallback(async () => {
    const trimmed = saveConclusion.trim();
    if (!trimmed) return;
    setPhase("saving");

    try {
      const citedIds = analysis?.rawCitations?.map((c) => c.id) || [];
      const newId = await saveDecision(query, trimmed, citedIds, saveConfidence, saveAlternatives);
      if (newId) {
        setSavedDecisionId(newId);
        toast.success(t("decision.save_success"));
        getDecisionLineage(newId);
      }
      setPhase("done");
    } catch {
      toast.error(t("toast.graph_save_failed"));
      setPhase("analysis");
    }
  }, [saveConclusion, analysis, query, saveConfidence, saveAlternatives, saveDecision, getDecisionLineage, toast, t]);

  const handleEvidenceClick = useCallback((entityId: string) => {
    onSelectEntity(entityId);
  }, [onSelectEntity]);

  const handleNewDecision = useCallback(() => {
    setQuery("");
    setPhase("input");
    setShowEvidence(true);
    setShowChat(false);
    setChatInput("");
    setShowSaveForm(false);
    setSaveConclusion("");
    setSaveConfidence("medium");
    setSaveAlternatives("");
    setSavedDecisionId(null);
    reset();
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [reset]);

  // ── derived ──

  const phases = [
    { key: "input" as const, label: t("decision.phases.input") },
    { key: "analyze" as const, label: t("decision.phases.analyze") },
    { key: "decide" as const, label: t("decision.phases.decide") },
    { key: "done" as const, label: t("decision.phases.done") },
  ];

  const currentPhaseIndex = (() => {
    if (phase === "input") return 0;
    if (phase === "analyzing" || phase === "analysis") return 1;
    if (phase === "saving") return 2;
    return 3;
  })();

  // ── not open ──

  if (!isOpen) return null;

  // ══════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] p-4 bg-black/75 backdrop-blur-md transition-opacity"
      onClick={(e) => { if (phase !== "saving") onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="glass-panel w-full max-w-2xl border border-cyan-500/20 bg-slate-950/85 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-black/40 shrink-0">
          <div className="flex items-center gap-3">
            <Scale className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white tracking-wide">{t("decision.title")}</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Phase indicators */}
            <div className="hidden sm:flex items-center gap-1.5">
              {phases.map((p, i) => (
                <React.Fragment key={p.key}>
                  {i > 0 && <ArrowRight className="w-3 h-3 text-gray-600" />}
                  <span
                    className={`text-[11px] font-medium transition-colors ${
                      i < currentPhaseIndex
                        ? "text-emerald-400"
                        : i === currentPhaseIndex
                        ? "text-cyan-400"
                        : "text-gray-600"
                    }`}
                  >
                    {p.label}
                  </span>
                </React.Fragment>
              ))}
            </div>
            <button
              onClick={onClose}
              disabled={phase === "saving"}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors disabled:opacity-30"
              title="Esc"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ═══ Phase: INPUT ═══ */}
        {phase === "input" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <div className="px-5 py-5 flex-1">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={6}
                placeholder={t("decision.placeholder")}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-500">{t("decision.submit_hint")}</span>
                <button
                  onClick={handleSubmit}
                  disabled={!query.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                >
                  <Sparkles className="w-4 h-4" />
                  {t("decision.submit")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Phase: ANALYZING ═══ */}
        {phase === "analyzing" && (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
              <Sparkles className="w-5 h-5 text-cyan-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-sm text-cyan-400/75 tracking-wider">{t("decision.thinking")}</p>
          </div>
        )}

        {/* ═══ Phase: ANALYSIS ═══ */}
        {(phase === "analysis" || phase === "saving") && !analysis && analysisError && (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-5">
              <AnalysisErrorCard
                error={analysisError}
                noLlmMsg={t("decision.error_no_llm")}
                failedMsg={t("decision.error_analysis_failed")}
              />
              <div className="flex justify-center mt-6">
                <button
                  onClick={handleNewDecision}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm font-medium rounded-lg transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {t("decision.submit")}
                </button>
              </div>
            </div>
          </div>
        )}

        {(phase === "analysis" || phase === "saving") && analysis && (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-5 space-y-4">

              {/* ── Analysis error ── */}
              {analysisError && (
                <AnalysisErrorCard
                  error={analysisError}
                  noLlmMsg={t("decision.error_no_llm")}
                  failedMsg={t("decision.error_analysis_failed")}
                />
              )}

              {/* ── Summary ── */}
              {analysis.summary && (
                <AnalysisCard
                  icon={<Lightbulb className="w-4 h-4" />}
                  title={t("decision.summary_title")}
                  accentClass="border-l-yellow-500/60 bg-yellow-500/5"
                >
                  <p className="text-sm text-gray-200 leading-relaxed">{analysis.summary}</p>
                </AnalysisCard>
              )}

              {/* ── Pros ── */}
              {analysis.pros.length > 0 && (
                <AnalysisCard
                  icon={<ThumbsUp className="w-4 h-4" />}
                  title={t("decision.pros_title")}
                  accentClass="border-l-emerald-500/60 bg-emerald-500/5"
                >
                  <ul className="space-y-2">
                    {analysis.pros.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                        <span className="text-emerald-400 mt-0.5 shrink-0">+</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </AnalysisCard>
              )}

              {/* ── Cons ── */}
              {analysis.cons.length > 0 && (
                <AnalysisCard
                  icon={<AlertTriangle className="w-4 h-4" />}
                  title={t("decision.cons_title")}
                  accentClass="border-l-red-500/60 bg-red-500/5"
                >
                  <ul className="space-y-2">
                    {analysis.cons.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                        <span className="text-red-400 mt-0.5 shrink-0">-</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </AnalysisCard>
              )}

              {/* ── Recommendation ── */}
              {analysis.recommendation && (
                <AnalysisCard
                  icon={<Target className="w-4 h-4" />}
                  title={t("decision.recommendation_title")}
                  accentClass="border-l-cyan-500/60 bg-cyan-500/5"
                >
                  <p className="text-sm text-gray-200 leading-relaxed">{analysis.recommendation}</p>
                </AnalysisCard>
              )}

              {/* ── Clarifying questions ── */}
              {analysis.questions && analysis.questions.length > 0 && (
                <AnalysisCard
                  icon={<HelpCircle className="w-4 h-4" />}
                  title={t("decision.questions_title")}
                  accentClass="border-l-violet-500/60 bg-violet-500/5"
                >
                  <p className="text-xs text-gray-400 mb-2.5">{t("decision.questions_hint")}</p>
                  <ul className="space-y-2">
                    {analysis.questions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                        <span className="text-violet-400 mt-0.5 shrink-0">?</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => {
                      setShowChat(true);
                      setTimeout(() => chatInputRef.current?.focus(), 100);
                    }}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 transition-all"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {t("decision.questions_answer")}
                  </button>
                </AnalysisCard>
              )}

              {/* ── Evidence (expandable) ── */}
              {analysis.rawCitations && analysis.rawCitations.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                  <button
                    onClick={() => setShowEvidence((v) => !v)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                  >
                    {showEvidence ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    )}
                    <BookOpen className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-gray-300">{t("decision.evidence_title")}</span>
                    <span className="ml-auto text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                      {analysis.rawCitations.length}
                    </span>
                  </button>
                  {showEvidence && (
                    <div className="px-4 pb-3 space-y-1.5">
                      {analysis.rawCitations.map((cite) => (
                        <button
                          key={cite.id}
                          onClick={() => handleEvidenceClick(cite.id)}
                          className="w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left border border-transparent hover:border-cyan-500/20 hover:bg-cyan-500/5 transition-all group"
                        >
                          <span className="shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-purple-400/10 text-purple-400 border-purple-400/30">
                            {cite.type}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white font-medium truncate group-hover:text-cyan-300 transition-colors">
                              {cite.name}
                            </p>
                            {cite.description && (
                              <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{cite.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Action bar: discuss / decide ── */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => {
                    setShowChat((v) => !v);
                    setTimeout(() => chatInputRef.current?.focus(), 100);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all border ${
                    showChat
                      ? "bg-violet-600/20 border-violet-500/40 text-violet-300"
                      : "bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20"
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  {t("decision.chat_title")}
                </button>

                <div className="flex-1" />

                <button
                  onClick={() => {
                    setShowSaveForm(true);
                    setTimeout(() => saveInputRef.current?.focus(), 100);
                  }}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                >
                  <Save className="w-4 h-4" />
                  {t("decision.save_button")}
                </button>
              </div>

              {/* ── Chat panel ── */}
              {showChat && (
                <div className="rounded-xl border border-violet-500/20 bg-black/30 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/10 bg-violet-500/5">
                    <span className="text-xs font-medium text-violet-300 tracking-wide">
                      {t("decision.chat_title")}
                    </span>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto p-3 space-y-3">
                    {chatHistory.slice(1).map((msg, i) => (
                      <ChatBubble key={i} msg={msg} />
                    ))}
                    {isChatLoading && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t("decision.thinking")}
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10">
                    <input
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleChatKeyDown}
                      placeholder={t("decision.chat_placeholder")}
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                      disabled={isChatLoading}
                    />
                    <button
                      onClick={handleChatSubmit}
                      disabled={!chatInput.trim() || isChatLoading}
                      className="p-1.5 text-violet-400 hover:text-violet-300 disabled:opacity-30 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ── Save form ── */}
              {showSaveForm && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                    <Save className="w-4 h-4" />
                    {t("decision.save_structure_title")}
                  </h4>

                  {/* Conclusion */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      {t("decision.save_conclusion_label")}
                    </label>
                    <textarea
                      ref={saveInputRef}
                      value={saveConclusion}
                      onChange={(e) => setSaveConclusion(e.target.value)}
                      rows={2}
                      placeholder={t("decision.save_placeholder")}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-emerald-500/50 transition-all"
                    />
                  </div>

                  {/* Confidence */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      {t("decision.save_confidence_label")}
                    </label>
                    <div className="flex gap-2">
                      {(["high", "medium", "low"] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => setSaveConfidence(level)}
                          className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                            saveConfidence === level
                              ? level === "high"
                                ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-300"
                                : level === "medium"
                                ? "bg-yellow-600/30 border-yellow-500/50 text-yellow-300"
                                : "bg-red-600/30 border-red-500/50 text-red-300"
                              : "bg-transparent border-white/10 text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {t(`decision.save_confidence_${level}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Alternatives */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      {t("decision.save_alternatives_label")}
                    </label>
                    <textarea
                      value={saveAlternatives}
                      onChange={(e) => setSaveAlternatives(e.target.value)}
                      rows={2}
                      placeholder={t("decision.save_alternatives_placeholder")}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-emerald-500/50 transition-all"
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setShowSaveForm(false)}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors"
                    >
                      {t("graph.cancel")}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={!saveConclusion.trim() || phase === "saving"}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                    >
                      <Check className="w-4 h-4" />
                      {t("decision.save_confirm")}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ═══ Phase: DONE ═══ */}
        {phase === "done" && (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-5 space-y-5">

              {/* Success */}
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                  <Check className="w-7 h-7 text-emerald-400" />
                </div>
                <p className="text-lg font-semibold text-white">{t("decision.save_success")}</p>
                <p className="text-sm text-gray-400 text-center max-w-sm">
                  {saveConclusion}
                </p>
              </div>

              {/* Decision Lineage */}
              <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10">
                  <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-cyan-400" />
                    {t("decision.lineage_title")}
                  </h4>
                </div>

                {isLineageLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
                  </div>
                ) : lineage ? (
                  <div className="px-4 py-3 space-y-3">
                    {/* Self */}
                    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">{t("decision.lineage_self")}</p>
                        <p className="text-sm text-white font-medium truncate">{lineage.current.name}</p>
                      </div>
                    </div>

                    {/* Sources */}
                    {lineage.sources.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider px-1">
                          <span className="w-3 h-px bg-gray-700" />
                          {t("decision.lineage_source")}
                        </div>
                        {lineage.sources.map((src, i) => (
                          <button
                            key={`${src.entityId}-${i}`}
                            onClick={() => handleEvidenceClick(src.entityId)}
                            className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-white/5 hover:border-purple-500/20 hover:bg-purple-500/5 transition-all text-left"
                          >
                            <div className="w-2 h-2 rounded-full bg-purple-500/60 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-gray-300 font-medium truncate">{src.entityName}</p>
                              <p className="text-[10px] text-gray-600">{src.entityType} - {src.relationship}</p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Decision chain */}
                    {lineage.chain.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider px-1">
                          <span className="w-3 h-px bg-gray-700" />
                          {t("decision.lineage_chain")} ({lineage.chain.length})
                        </div>
                        {lineage.chain.map((node, i) => (
                          <button
                            key={node.id}
                            onClick={() => handleEvidenceClick(node.id)}
                            className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-white/5 hover:border-cyan-500/20 hover:bg-cyan-500/5 transition-all text-left"
                          >
                            <div className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-gray-300 font-medium truncate">{node.name}</p>
                              <p className="text-[10px] text-gray-600">
                                {node.timestamp ? new Date(node.timestamp).toLocaleDateString() : ""}
                              </p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Empty lineage */}
                    {lineage.chain.length === 0 && lineage.sources.length === 0 && (
                      <p className="text-xs text-gray-600 text-center py-3">{t("decision.lineage_empty")}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-3">{t("decision.lineage_empty")}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleNewDecision}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm font-medium rounded-lg transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {t("decision.submit")}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    if (savedDecisionId) onSelectEntity(savedDecisionId);
                    onClose();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-all"
                >
                  <GitBranch className="w-4 h-4" />
                  {t("graph.view_in_graph")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Footer ═══ */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-t border-white/10 text-[10px] text-gray-500 shrink-0">
          <span>Ctrl+Enter {t("search.footer_enter")}</span>
          <span>{t("search.footer_esc")}</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════════

function AnalysisCard({
  icon,
  title,
  accentClass,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-white/10 border-l-2 overflow-hidden ${accentClass}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <span className="text-gray-300">{icon}</span>
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{title}</h4>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function AnalysisErrorCard({
  error,
  noLlmMsg,
  failedMsg,
}: {
  error: string;
  noLlmMsg: string;
  failedMsg: string;
}) {
  const message = error === "LLM_NOT_CONFIGURED" ? noLlmMsg : failedMsg;
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm text-red-300 font-medium">Analysis Error</p>
        <p className="text-xs text-gray-400 mt-1">{message}</p>
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? "bg-cyan-600/30 border border-cyan-500/30 text-gray-200"
            : "bg-white/5 border border-white/10 text-gray-300"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  );
}
