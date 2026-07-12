"use client";

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { CompactEntity } from "@/hooks/useSearchMemory";

// ── v2: structured analysis types ──

export interface AnalysisResult {
  summary: string;
  pros: string[];
  cons: string[];
  recommendation: string;
  questions?: string[];
  evidence: Array<{
    entityId: string;
    entityName: string;
    entityType: string;
    relevance: string;
  }>;
  rawCitations: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
  }>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface DecisionNode {
  id: string;
  name: string;
  conclusion: string;
  situation: string;
  timestamp: string;
  confidence?: "high" | "medium" | "low";
}

export interface DecisionLineage {
  current: DecisionNode;
  sources: Array<{
    entityId: string;
    entityName: string;
    entityType: string;
    relationship: string;
  }>;
  chain: DecisionNode[];
}

export interface DecisionContextResult {
  situation: string;
  principles: CompactEntity[];
  relevantMemories: CompactEntity[];
  conflicts: Array<{
    a: { id: string; name: string };
    b: { id: string; name: string };
    description: string;
  }>;
}

// ── v2: public API ──

export function useDecisionContext() {
  // legacy: direct retrieval (no LLM)
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionContextResult | null>(null);

  // v2: AI analysis
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // v2: chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  // 当前正在讨论的决策情境（discuss_decision 需要非空 situation）
  const [decisionSituation, setDecisionSituation] = useState("");

  // v2: lineage
  const [lineage, setLineage] = useState<DecisionLineage | null>(null);
  const [isLineageLoading, setIsLineageLoading] = useState(false);

  // ── legacy: retrieve context without LLM analysis ──

  const submit = async (query: string) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiFetch('/api/mcp/tool/get_decision_context', {
        method: "POST",
        body: JSON.stringify({ arguments: { situation: query, limit: 5 } }),
      });

      if (!response.ok) {
        throw new Error(`Decision context failed: ${response.statusText}`);
      }

      const data = (await response.json()) as DecisionContextResult;
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  // ── v2: AI-powered analysis ──

  const analyzeDecision = useCallback(async (situation: string) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    setDecisionSituation(situation);

    try {
      const response = await apiFetch('/api/mcp/tool/analyze_decision', {
        method: "POST",
        body: JSON.stringify({ arguments: { situation } }),
      });

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 400 && body.includes("LLM")) {
          throw new Error("LLM_NOT_CONFIGURED");
        }
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const data = (await response.json()) as AnalysisResult;
      setAnalysis(data);

      // seed chat history with the analysis context
      setChatHistory([
        {
          role: "assistant",
          content: JSON.stringify({
            summary: data.summary,
            recommendation: data.recommendation,
          }),
        },
      ]);
    } catch (e) {
      setAnalysisError(String(e));
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // ── v2: follow-up chat ──

  const chatFollowUp = useCallback(async (message: string) => {
    setIsChatLoading(true);

    const newHistory = [...chatHistory, { role: "user" as const, content: message }];
    setChatHistory(newHistory);

    try {
      const response = await apiFetch('/api/mcp/tool/discuss_decision', {
        method: "POST",
        body: JSON.stringify({
          arguments: {
            messages: newHistory,
            situation: decisionSituation || result?.situation || "",
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat failed: ${response.statusText}`);
      }

      const data = await response.json() as { reply: string };
      setChatHistory([...newHistory, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setChatHistory([...newHistory, { role: "assistant", content: `[Error] ${String(e)}` }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatHistory, result, decisionSituation]);

  // ── v2: save with confidence + alternatives ──

  const saveDecision = async (
    situation: string,
    conclusion: string,
    citedEntityIds: string[],
    confidence?: "high" | "medium" | "low",
    alternatives?: string,
  ): Promise<string | null> => {
    try {
      const response = await apiFetch('/api/mcp/tool/save_decision', {
        method: "POST",
        body: JSON.stringify({
          arguments: {
            situation,
            conclusion,
            cited_entity_ids: citedEntityIds,
            confidence: confidence || "medium",
            alternatives: alternatives || "",
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Save decision failed: ${response.statusText}`);
      }

      const entity = await response.json();
      return entity.id;
    } catch (e) {
      throw e;
    }
  };

  // ── v2: decision lineage ──

  const getDecisionLineage = useCallback(async (decisionId: string) => {
    setIsLineageLoading(true);
    setLineage(null);

    try {
      const response = await apiFetch('/api/mcp/tool/get_decision_lineage', {
        method: "POST",
        body: JSON.stringify({ arguments: { decision_id: decisionId } }),
      });

      if (!response.ok) {
        throw new Error(`Lineage query failed: ${response.statusText}`);
      }

      const data = await response.json() as DecisionLineage;
      setLineage(data);
    } catch (e) {
      console.warn("[DecisionContext] Lineage query failed:", e);
    } finally {
      setIsLineageLoading(false);
    }
  }, []);

  // ── reset all state ──

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setResult(null);
    setIsAnalyzing(false);
    setAnalysis(null);
    setAnalysisError(null);
    setChatHistory([]);
    setLineage(null);
  }, []);

  return {
    // legacy
    isLoading,
    error,
    result,
    submit,
    saveDecision,
    // v2
    isAnalyzing,
    analysis,
    analysisError,
    analyzeDecision,
    chatHistory,
    isChatLoading,
    chatFollowUp,
    lineage,
    isLineageLoading,
    getDecisionLineage,
    reset,
  };
}


// P0-9: Decision lineage tracking
type LineageRelation = 'continues' | 'revises' | 'supersedes' | 'reverses' | 'invalidates';

interface SaveDecisionPayload {
  situation: string;
  previous_decision_id?: string;
  supersedes_decision_id?: string;
  lineage_relation?: LineageRelation;
  evidence_ids?: string[];
  conclusion?: string;
}

function withLineage(payload: SaveDecisionPayload): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };
  if (payload.previous_decision_id) {
    result.previous_decision_id = payload.previous_decision_id;
    result.lineage_relation = payload.lineage_relation || 'continues';
  }
  if (payload.supersedes_decision_id) {
    result.supersedes_decision_id = payload.supersedes_decision_id;
    result.lineage_relation = 'supersedes';
  }
  return result;
}
