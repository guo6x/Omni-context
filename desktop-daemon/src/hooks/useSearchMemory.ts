"use client";

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { Entity } from "@shared/types";

export interface ArchivalMemoryItem {
  id: string;
  content: string;
  summary?: string;
  tags?: string[];
  createdAt: string;
  archivedAt: string;
  importance?: number;
}

export interface ArchivalSearchResult {
  item: ArchivalMemoryItem;
  relevanceScore: number;
  matchType: "text" | "semantic" | "tag";
}

export interface CoreMemoryItem {
  key: string;
  value: any;
  category: string;
  lastAccessed: string;
  accessCount: number;
  summary?: string;
}

export interface CompactEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface FlattenedSearchItem {
  type: "entity" | "archival" | "core";
  item: Entity | ArchivalSearchResult | CoreMemoryItem;
  score: number;
}

export interface SearchResults {
  entities: Entity[];
  archival: ArchivalSearchResult[];
  core: CoreMemoryItem[];
  flattened: FlattenedSearchItem[];
}

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreEntity(q: string, entity: Entity): number {
  if (!q) return 0.3;
  const nq = normalizeQuery(q);
  const name = (entity.name || '').toLowerCase();
  const desc = (entity.description || '').toLowerCase();
  const tags = (entity.tags || []).map(t => t.toLowerCase());

  if (name === nq) return 1.0;
  if (name.includes(nq)) return 0.85;
  if (desc.includes(nq)) return 0.6;
  if (tags.some(t => t.includes(nq) || nq.includes(t))) return 0.5;
  return 0.3;
}

function scoreCore(q: string, core: CoreMemoryItem): number {
  if (!q) return 0.4;
  const nq = normalizeQuery(q);
  const key = (core.key || '').toLowerCase();
  const value = typeof core.value === 'string'
    ? core.value.toLowerCase()
    : JSON.stringify(core.value).toLowerCase();

  if (key === nq) return 1.0;
  if (value.includes(nq)) return 0.7;
  return 0.4;
}

const TYPE_ORDER: Record<string, number> = { entity: 0, archival: 1, core: 2 };

function buildFlattened(
  query: string,
  entities: Entity[],
  archival: ArchivalSearchResult[],
  core: CoreMemoryItem[],
): FlattenedSearchItem[] {
  const items: FlattenedSearchItem[] = [];

  for (const e of entities) {
    items.push({ type: "entity", item: e, score: scoreEntity(query, e) });
  }
  for (const a of archival) {
    items.push({ type: "archival", item: a, score: a.relevanceScore ?? 0 });
  }
  for (const c of core) {
    items.push({ type: "core", item: c, score: scoreCore(query, c) });
  }

  items.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
  });

  return items;
}

export function useSearchMemory() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({
    entities: [],
    archival: [],
    core: [],
    flattened: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const searchCounter = useRef(0);

  useEffect(() => {
    const handler = setTimeout(() => {
      const truncated = query.slice(0, 200);
      setDebouncedQuery(truncated);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults({ entities: [], archival: [], core: [], flattened: [] });
      setIsLoading(false);
      setHasError(false);
      return;
    }

    const currentSearchId = ++searchCounter.current;
    setIsLoading(true);
    setHasError(false);

    const limit = 5;

    const performSearch = async () => {
      const searchEntitiesPromise = apiFetch('/api/entities/search', {
        method: "POST",
        body: JSON.stringify({ query: debouncedQuery, limit }),
      }).then(async (res) => {
        if (!res.ok) throw new Error("Entities search failed");
        return (await res.json()) as Entity[];
      });

      const searchArchivalPromise = apiFetch('/api/memory/archival/search', {
        method: "POST",
        body: JSON.stringify({ query: debouncedQuery, limit }),
      }).then(async (res) => {
        if (!res.ok) throw new Error("Archival search failed");
        return (await res.json()) as ArchivalSearchResult[];
      });

      const searchCorePromise = apiFetch('/api/memory/core/search', {
        method: "POST",
        body: JSON.stringify({ query: debouncedQuery, limit }),
      }).then(async (res) => {
        if (!res.ok) throw new Error("Core search failed");
        return (await res.json()) as CoreMemoryItem[];
      });

      const promises: Promise<any>[] = [
        searchEntitiesPromise,
        searchArchivalPromise,
        searchCorePromise,
      ];

      const outcomes = await Promise.allSettled(promises);

      if (currentSearchId !== searchCounter.current) {
        return;
      }

      let entities: Entity[] = [];
      let archival: ArchivalSearchResult[] = [];
      let core: CoreMemoryItem[] = [];
      let errorsCount = 0;

      if (outcomes[0].status === "fulfilled") {
        entities = outcomes[0].value;
      } else {
        console.error("Entities search error:", outcomes[0].reason);
        errorsCount++;
      }

      if (outcomes[1].status === "fulfilled") {
        archival = outcomes[1].value;
      } else {
        console.error("Archival search error:", outcomes[1].reason);
        errorsCount++;
      }

      if (outcomes[2].status === "fulfilled") {
        core = outcomes[2].value;
      } else {
        console.error("Core search error:", outcomes[2].reason);
        errorsCount++;
      }

      setHasError(errorsCount === 3);

      setResults({
        entities,
        archival: archival.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)),
        core,
        flattened: buildFlattened(debouncedQuery, entities, archival, core),
      });
      setIsLoading(false);
    };

    performSearch();
  }, [debouncedQuery]);

  return {
    query,
    setQuery,
    results,
    isLoading,
    hasError,
  };
}
