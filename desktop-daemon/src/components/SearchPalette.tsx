"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { Search, Database, Clock, Cpu, X, Sparkles, CornerDownLeft, AlertCircle, Info, Calendar } from "lucide-react";
import { useSearchMemory, ArchivalSearchResult, CoreMemoryItem, FlattenedSearchItem } from "@/hooks/useSearchMemory";
import { Entity } from "@shared/types";
import { useTranslation } from "@/hooks/useTranslation";

interface SearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity: (entityId: string) => void;
  allEntities: Entity[];
}

interface FlattenedItem {
  keyId: string;
  type: "entity" | "archival" | "core";
  title: string;
  subtitle?: string;
  rawData: any;
  score?: number;
}

export default function SearchPalette({ isOpen, onClose, onSelectEntity, allEntities }: SearchPaletteProps) {
  const { t } = useTranslation();
  const { query, setQuery, results, isLoading, hasError } = useSearchMemory();
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedMemory, setSelectedMemory] = useState<{
    type: "archival" | "core";
    title: string;
    content: string;
    metadata: Record<string, any>;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setActiveIndex(0);
      setSelectedMemory(null);
    }
  }, [isOpen]);

  const flattenedItems = useMemo<FlattenedItem[]>(() => {
    if (!query.trim()) {
      const sorted = [...allEntities]
        .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
        .slice(0, 5);
      return sorted.map((e) => ({
        keyId: `rec-${e.id}`,
        type: "entity" as const,
        title: e.name,
        subtitle: e.description || e.type,
        rawData: e,
      }));
    }

    const list: FlattenedItem[] = [];

    results.flattened.forEach((fsItem: FlattenedSearchItem) => {
      if (fsItem.type === "entity") {
        const e = fsItem.item as Entity;
        list.push({
          keyId: `entity-${e.id}`,
          type: "entity",
          title: e.name,
          subtitle: e.description || e.type,
          rawData: e,
          score: fsItem.score,
        });
      } else if (fsItem.type === "archival") {
        const res = fsItem.item as ArchivalSearchResult;
        list.push({
          keyId: `archival-${res.item.id}`,
          type: "archival",
          title: res.item.summary || res.item.content.slice(0, 60) + "...",
          subtitle: res.item.content,
          rawData: res,
          score: fsItem.score,
        });
      } else if (fsItem.type === "core") {
        const item = fsItem.item as CoreMemoryItem;
        list.push({
          keyId: `core-${item.key}`,
          type: "core",
          title: item.key,
          subtitle: typeof item.value === "string" ? item.value : JSON.stringify(item.value),
          rawData: item,
          score: fsItem.score,
        });
      }
    });

    return list;
  }, [query, results, allEntities]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector(`[data-index="${activeIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [flattenedItems.length]);

  if (!isOpen) return null;

  const handleSelect = (item: FlattenedItem) => {
    if (item.type === "entity") {
      const entity = item.rawData as Entity;
      onSelectEntity(entity.id);
      onClose();
    } else if (item.type === "archival") {
      const res = item.rawData as ArchivalSearchResult;
      setSelectedMemory({
        type: "archival",
        title: res.item.summary || t('search.detail_archival'),
        content: res.item.content,
        metadata: {
          tags: res.item.tags || [],
          importance: res.item.importance ?? 0,
          createdAt: res.item.createdAt,
          archivedAt: res.item.archivedAt,
          matchType: res.matchType,
          relevanceScore: res.relevanceScore,
        },
      });
    } else if (item.type === "core") {
      const core = item.rawData as CoreMemoryItem;
      setSelectedMemory({
        type: "core",
        title: t('search.core_memory').replace('{key}', core.key),
        content: typeof core.value === "string" ? core.value : JSON.stringify(core.value, null, 2),
        metadata: {
          category: core.category,
          lastAccessed: core.lastAccessed,
          accessCount: core.accessCount,
          summary: core.summary,
        },
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (selectedMemory) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedMemory(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (flattenedItems.length > 0 ? (prev + 1) % flattenedItems.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (flattenedItems.length > 0 ? (prev - 1 + flattenedItems.length) % flattenedItems.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flattenedItems[activeIndex]) {
        handleSelect(flattenedItems[activeIndex]);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] p-4 bg-black/75 transition-opacity"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-2xl border border-cyan-500/20 bg-slate-950/80 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[72vh] relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 输入框区域 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10 bg-black/40">
          <Search className="w-5 h-5 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 min-w-0 bg-transparent text-white placeholder-gray-500 border-none outline-none text-base"
            autoFocus
          />
          <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">ESC</span>
        </div>

        {/* 搜索结果渲染列表 */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-cyan-400/75 tracking-wider">{t('search.scanning')}</p>
            </div>
          )}

          {!isLoading && hasError && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <AlertCircle className="w-10 h-10 text-red-500/80" />
              <h3 className="text-sm font-semibold text-white">{t('search.error_title')}</h3>
              <p className="text-xs text-gray-400 max-w-xs">{t('search.error_detail')}</p>
            </div>
          )}

          {!isLoading && !hasError && flattenedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Info className="w-10 h-10 text-gray-600" />
              <p className="text-sm text-gray-400">{t("search.no_results")}</p>
            </div>
          )}

          {!isLoading && !hasError && flattenedItems.length > 0 && (
            <div className="space-y-4">
              {!query.trim() && (
                <div className="px-2 pt-1 pb-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 tracking-wider uppercase">
                    <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                    {t("search.recent_entities")}
                  </span>
                </div>
              )}

              <div className="space-y-1">
                {flattenedItems.map((item, index) => {
                  const isActive = index === activeIndex;
                  const itemIcon =
                    item.type === "entity" ? (
                      <Database className={`w-4 h-4 ${isActive ? "text-cyan-400" : "text-purple-400"} shrink-0`} />
                    ) : item.type === "archival" ? (
                      <Clock className={`w-4 h-4 ${isActive ? "text-cyan-400" : "text-yellow-400"} shrink-0`} />
                    ) : (
                      <Cpu className={`w-4 h-4 ${isActive ? "text-cyan-400" : "text-green-400"} shrink-0`} />
                    );

                  const badgeText =
                    item.type === "entity"
                      ? t("search.section_entities")
                      : item.type === "archival"
                      ? t("search.section_archival")
                      : t("search.section_core");

                  return (
                    <div
                      key={item.keyId}
                      data-index={index}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                        isActive
                          ? "bg-cyan-500/10 border-cyan-500/30 text-white"
                          : "bg-transparent border-transparent text-gray-300 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {itemIcon}
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium truncate">{item.title}</h4>
                          <p className="text-xs text-gray-500 truncate mt-0.5">{item.subtitle}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(item.score != null && item.score >= 0.85) && (
                          <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border bg-yellow-950/30 border-yellow-600/40 text-yellow-300">
                            ★ {t('search.high_relevance')}
                          </span>
                        )}
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${
                          item.type === "entity"
                            ? "bg-purple-950/30 border-purple-800/40 text-purple-300"
                            : item.type === "archival"
                            ? "bg-amber-950/30 border-amber-800/40 text-amber-300"
                            : "bg-emerald-950/30 border-emerald-800/40 text-emerald-300"
                        }`}>
                          {badgeText}
                        </span>
                        {isActive && (
                          <CornerDownLeft className="w-3.5 h-3.5 text-cyan-400 animate-pulse shrink-0" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 底部按键提示 */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-t border-white/10 text-[10px] text-gray-500">
          <div className="flex items-center gap-3">
            <span>{t('search.footer_up_down')}</span>
            <span>{t('search.footer_enter')}</span>
          </div>
          <span>{t('search.footer_esc')}</span>
        </div>

        {/* 二级详情框 Modal */}
        {selectedMemory && (
          <div
            className="absolute inset-0 z-50 flex flex-col bg-slate-950/95 p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-6 border-b border-white/10 pb-4">
              <div>
                <span className={`text-xs uppercase font-bold tracking-wider px-2 py-0.5 rounded border inline-block mb-2 ${
                  selectedMemory.type === "archival"
                    ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
                    : "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                }`}>
                  {selectedMemory.type === "archival" ? t('search.detail_archival') : t('search.detail_core')}
                </span>
                <h3 className="text-lg font-semibold text-white tracking-wide">{selectedMemory.title}</h3>
              </div>
              <button
                onClick={() => {
                  setSelectedMemory(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="p-1 text-gray-400 hover:text-white bg-white/5 rounded-lg border border-white/10 transition-colors"
                title={t('search.detail_back')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 space-y-6">
              <div className="p-4 bg-black/40 border border-white/10 rounded-xl">
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">{t('search.detail_record')}</h4>
                {selectedMemory.type === "core" ? (
                  <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap overflow-x-auto">
                    {selectedMemory.content}
                  </pre>
                ) : (
                  <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">
                    {selectedMemory.content}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedMemory.type === "archival" && (
                  <>
                    {selectedMemory.metadata.tags && selectedMemory.metadata.tags.length > 0 && (
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                        <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">{t('search.detail_tags')}</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedMemory.metadata.tags.map((t: string) => (
                            <span key={t} className="text-xs bg-cyan-950/30 border border-cyan-800/40 text-cyan-300 px-2 py-0.5 rounded-full">
                              #{t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-2">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('search.detail_weight')}</h4>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{t('search.detail_importance')}</span>
                        <span className="text-yellow-400 font-bold">{(selectedMemory.metadata.importance * 10).toFixed(0)} / 10</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{t('search.detail_match_type')}</span>
                        <span className="text-cyan-400 uppercase font-semibold text-[10px]">{selectedMemory.metadata.matchType}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{t('search.detail_relevance')}</span>
                        <span className="text-cyan-400">{(selectedMemory.metadata.relevanceScore * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </>
                )}

                {selectedMemory.type === "core" && (
                  <>
                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-2">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('search.detail_attrs')}</h4>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{t('search.detail_category')}</span>
                        <span className="text-emerald-400 font-semibold">{selectedMemory.metadata.category}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{t('search.detail_access_count')}</span>
                        <span className="text-white font-bold">{t('search.detail_access_unit').replace('{count}', String(selectedMemory.metadata.accessCount))}</span>
                      </div>
                    </div>
                  </>
                )}

                <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex flex-col justify-center gap-2">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('search.detail_timeline')}</h4>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Calendar className="w-3.5 h-3.5 text-gray-500" />
                    <span>
                      {selectedMemory.type === "archival" ? (
                        <>{t('search.detail_archived_at')}{new Date(selectedMemory.metadata.archivedAt).toLocaleString()}</>
                      ) : (
                        <>{t('search.detail_last_accessed')}{new Date(selectedMemory.metadata.lastAccessed).toLocaleString()}</>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 mt-6 pt-4 flex justify-end gap-3 text-xs">
              <button
                onClick={() => {
                  setSelectedMemory(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="px-4 py-2 border border-white/10 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-all"
              >
                {t('search.detail_back_list')}
              </button>
              <button
                onClick={() => {
                  setSelectedMemory(null);
                  onClose();
                }}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              >
                {t('search.detail_close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
