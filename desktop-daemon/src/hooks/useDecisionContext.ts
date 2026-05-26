"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { CompactEntity } from "@/hooks/useSearchMemory";

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

export function useDecisionContext() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionContextResult | null>(null);

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

  const saveDecision = async (situation: string, conclusion: string, citedEntityIds: string[]): Promise<string | null> => {
    try {
      const response = await apiFetch('/api/mcp/tool/save_decision', {
        method: "POST",
        body: JSON.stringify({
          arguments: {
            situation,
            conclusion,
            cited_entity_ids: citedEntityIds,
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

  return { isLoading, error, result, submit, saveDecision };
}
