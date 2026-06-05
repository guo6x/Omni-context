"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { BarChart3, Brain, Code, FileText, Zap, Shield, TrendingUp, Info, RotateCcw, Search, Network, MousePointer2, Pencil, Trash2, GitMerge, Check, X, GitBranch, Clock, Undo2, Tags, Target, Layers, Bot, Send, Sparkles, Copy, Bookmark, History } from "lucide-react";
import { Entity, Relationship } from "@shared/types";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ConfirmDialog";
import { apiFetch } from '@/lib/api-client';
import { getRelationshipStyle } from '@/lib/relationship-styles';
import { useSettings } from "@/hooks/useSettings";
import { THEMES, NODE_TYPE_TO_THEME_KEY } from "@/lib/themes";

// 3D 图谱节点数据结构
interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  val: number; // 节点大小
  color: string;
  glyph: string;
  accessCount: number;
  connections: number;
  lastAccessed?: string;
  created_at?: string;
  freshness?: number; // 0-1, 今天=1, 30+天=0
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
  description?: string;
  weight: number;
  color: string;
}

// 节点颜色映射
const TYPE_COLORS: Record<string, string> = {
  principle: "#a855f7",         // 紫色
  code_snippet: "#3b82f6",      // 蓝色
  evidence: "#22c55e",          // 绿色
  concept: "#eab308",           // 黄色
  tool: "#f97316",              // 橙色
  security_rule: "#ef4444",     // 红色
  performance_optimization: "#14b8a6", // 青色
  architecture_pattern: "#8b5cf6",     // 靛紫
  bug_vulnerability: "#f43f5e",        // 玫红
  business_logic: "#06b6d4",           // 天蓝
  critical_review: "#d946ef",          // 粉紫
  capture_snapshot: "#64748b",         // 灰色
  memory: "#0ea5e9",                   // 亮蓝
  person: "#fb923c",                   // 浅橙
  project: "#84cc16",                  // 黄绿
  goal: "#f59e0b",                     // 琥珀 — 目标
  question: "#10b981",                 // 翠绿 — 未决
  preference: "#ec4899",               // 粉 — 偏好
  event: "#7c3aed",                    // 紫 — 经历
  task: "#65a30d",                     // 橄榄 — 待办
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  principle: <Brain className="w-4 h-4" />,
  code_snippet: <Code className="w-4 h-4" />,
  evidence: <FileText className="w-4 h-4" />,
  concept: <Info className="w-4 h-4" />,
  tool: <Zap className="w-4 h-4" />,
  security_rule: <Shield className="w-4 h-4" />,
  performance_optimization: <TrendingUp className="w-4 h-4" />,
};

// 2D 节点上叠加的图标字符（Unicode 表意符号，比 lucide 图标更便宜）
const TYPE_GLYPHS: Record<string, string> = {
  principle: '✦',
  code_snippet: '⌘',
  evidence: '◈',
  concept: '◉',
  tool: '⚡',
  person: '☻',
  project: '⊡',
  security_rule: '⚠',
  performance_optimization: '⇧',
  architecture_pattern: '⌖',
  bug_vulnerability: '✗',
  business_logic: '◐',
  critical_review: '◊',
  capture_snapshot: '◇',
  memory: '◎',
  goal: '⚑',
  question: '?',
  preference: '♥',
  event: '◷',
  task: '☑',
};

// 关系类型颜色：每种关系语义独立着色，避免一团青色边
const RELATIONSHIP_COLORS: Record<string, string> = {
  derived_from: '#f59e0b',      // 琥珀 — 派生
  relates_to: '#22d3ee',         // 青 — 默认关联
  depends_on: '#10b981',         // 翠绿 — 依赖
  conflicts_with: '#f43f5e',     // 玫红 — 冲突
  extends: '#6366f1',            // 靛蓝 — 继承
  cites: '#0ea5e9',              // 天蓝 — 引用
  belongs_to: '#a78bfa',         // 紫罗兰 — 归属
  supported_by: '#14b8a6',       // 蓝绿 — 支撑
  extracted_from: '#94a3b8',     // 灰蓝 — 抽取来源
  reviewed_by: '#ec4899',        // 粉 — 审阅
  references: '#3b82f6',         // 蓝 — 通用引用
};

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/.exec(hex.trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function getLinkEndpointId(endpoint: any): string {
  if (!endpoint) return "";
  return typeof endpoint === "object" ? String(endpoint.id || "") : String(endpoint);
}


interface GraphViewer3DProps {
  entities: Entity[];
  relationships: Relationship[];
  onDataChanged?: () => void;
  focusEntityId?: string;
  onFocusEntityReset?: () => void;
}

export default function GraphViewer3D({ 
  entities, 
  relationships, 
  onDataChanged,
  focusEntityId,
  onFocusEntityReset
}: GraphViewer3DProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const { settings } = useSettings();
  const currentTheme = useMemo(() => {
    return THEMES[settings.appearance.theme] || THEMES['neutral-dark'];
  }, [settings.appearance.theme]);

  const getThemeColor = useCallback((type: string) => {
    const themeKey = NODE_TYPE_TO_THEME_KEY[type] || 'concept';
    return currentTheme.graphNodeColors[themeKey] || currentTheme.fgMuted;
  }, [currentTheme]);

  function relativeTime(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diff = Date.now() - then;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('graph.just_now');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('graph.minutes_ago').replace('{n}', String(min));
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('graph.hours_ago').replace('{n}', String(hr));
    const day = Math.floor(hr / 24);
    if (day < 30) return t('graph.days_ago').replace('{n}', String(day));
    const mo = Math.floor(day / 30);
    if (mo < 12) return t('graph.months_ago').replace('{n}', String(mo));
    const yr = Math.floor(mo / 12);
    return t('graph.years_ago').replace('{n}', String(yr));
  }
  const { confirm, dialog } = useConfirm();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  // react-force-graph 只在挂载时量一次父容器、之后仅听 window.resize；右侧面板
  // 出现/消失改变容器宽度时画布尺寸不会更新（半边消失）。用 ResizeObserver 显式喂宽高。
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ForceGraph, setForceGraph] = useState<any>(null);
  const [is3D, setIs3D] = useState(true);
  const [query, setQuery] = useState("");
  // 命令栏「问大脑」：右栏第三态——结构化答案卡 + 高亮命中子图
  const [cmdInput, setCmdInput] = useState("");
  const [followInput, setFollowInput] = useState("");
  // 答案卡每一轮的完整结构：多轮追问时每轮都保留自己的结论/依据/引用，
  // 历史轮和当前轮用同一套富文本渲染，不再把旧轮降级成灰色折叠块
  type AnswerTurn = { question: string; conclusion: string; reasons: Array<{ text: string; entityIds: string[] }>; questions: string[]; isDecision: boolean; sources: Array<{ id: string; name: string; type: string; description?: string }>; citedEntityIds: string[]; savedAsDecision?: boolean };
  const [gAnswer, setGAnswer] = useState<{ turns: AnswerTurn[] } | null>(null);
  const [gLoading, setGLoading] = useState(false);
  // 追问加载时立刻显示用户刚问的这句（答案回来前先占位），更像正常聊天
  const [gPendingQ, setGPendingQ] = useState<string | null>(null);
  const [gSaving, setGSaving] = useState(false);
  const [answerWidth, setAnswerWidth] = useState(320);
  useEffect(() => {
    const v = Number(localStorage.getItem('omni_answer_width'));
    if (v >= 300 && v <= 720) setAnswerWidth(v);
  }, []);
  const [cmdFocused, setCmdFocused] = useState(false);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const answerScrollRef = useRef<HTMLDivElement>(null);
  // 新一轮 / 开始思考时把答案卡滚到底，露出最新内容
  useEffect(() => {
    const el = answerScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [gAnswer?.turns.length, gLoading]);
  // 会话历史（可续聊）：sessionIdRef = 当前会话；lastDecisionIdRef = 决策链上一个决策（用 ref 避免异步 state 读取）
  const sessionIdRef = useRef<string | null>(null);
  const lastDecisionIdRef = useRef<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [histItems, setHistItems] = useState<Array<{ id: string; title: string; updated_at: string; turns: number }>>([]);
  const [activeType, setActiveType] = useState<string>("all");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [graphLoadError, setGraphLoadError] = useState<string | null>(null);

  // 编辑 / 合并状态
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");

  // Phase 2：MST 模式 + 时间轴
  const [mstMode, setMstMode] = useState(false);
  // 时间轴：null 表示不筛选；否则只显示 created_at <= timeFilter 的节点
  const [timeFilter, setTimeFilter] = useState<number | null>(null);
  const [showTimeSlider, setShowTimeSlider] = useState(false);

  // Legend 高亮 + 折叠状态
  const [legendHighlightType, setLegendHighlightType] = useState<string | null>(null);
  const [legendExpanded, setLegendExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('omni_graph_legend_expanded') !== 'false';
  });

  // 多选模式
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const isMultiSelect = selectedNodeIds.size > 1;

  // 撤销删除缓存
  const pendingDeletesRef = useRef<{
    entities: Entity[];
    relationships: Relationship[];
  } | null>(null);
  const undoToastIdRef = useRef<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 聚焦脉冲动画
  const focusAnimRef = useRef<{ nodeId: string; startTime: number } | null>(null);
  const focusAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleLegendExpand = useCallback(() => {
    setLegendExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('omni_graph_legend_expanded', String(next));
      return next;
    });
  }, []);

  // 动态加载 3D 图谱库
  useEffect(() => {
    const loadGraph = async () => {
      setGraphLoadError(null);
      try {
        if (is3D) {
          const mod = await import("react-force-graph-3d");
          setForceGraph(() => mod.default);
        } else {
          const mod = await import("react-force-graph-2d");
          setForceGraph(() => mod.default);
        }
      } catch (err3d) {
        // 3D 不可用时尝试 2D
        try {
          const mod = await import("react-force-graph-2d");
          setForceGraph(() => mod.default);
          setIs3D(false);
        } catch (err2d) {
          console.error("[GraphViewer3D] 图谱库加载失败", err3d, err2d);
          setGraphLoadError(String(err2d));
        }
      }
    };
    loadGraph();
  }, [is3D]);

  // 监听图谱容器尺寸变化，显式喂给 ForceGraph，避免右侧面板增减导致画布半边消失
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDimensions({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const availableTypes = useMemo(() => {
    return Array.from(new Set(entities.map((entity) => entity.type))).sort();
  }, [entities]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((entity) => entity.tags?.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [entities]);

  // 时间轴边界：所有实体 created_at 的最早/最晚毫秒值
  const timeBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    entities.forEach((entity) => {
      const ts = new Date(entity.created_at).getTime();
      if (!Number.isNaN(ts)) {
        if (ts < min) min = ts;
        if (ts > max) max = ts;
      }
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  }, [entities]);

  const visibleEntities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return entities.filter((entity) => {
      const matchesType = activeType === "all" || entity.type === activeType;
      const matchesTag =
        activeTag === "all" || (entity.tags && entity.tags.includes(activeTag));
      const matchesQuery =
        !normalizedQuery ||
        entity.name.toLowerCase().includes(normalizedQuery) ||
        entity.description?.toLowerCase().includes(normalizedQuery) ||
        entity.tags?.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      const matchesTime =
        timeFilter === null ||
        (() => {
          const ts = new Date(entity.created_at).getTime();
          return Number.isNaN(ts) || ts <= timeFilter;
        })();

      return matchesType && matchesTag && matchesQuery && matchesTime;
    });
  }, [activeType, activeTag, entities, query, timeFilter]);

  useEffect(() => {
    if (selectedNode && !visibleEntities.some((entity) => entity.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [selectedNode, visibleEntities]);

  // 连接关系数统计
  const connectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    relationships.forEach((r) => {
      counts[r.source_id] = (counts[r.source_id] || 0) + 1;
      counts[r.target_id] = (counts[r.target_id] || 0) + 1;
    });
    return counts;
  }, [relationships]);

  // 将 entities 和 relationships 转化为图谱数据
  const graphData = useMemo(() => {
    // 先算每个节点的连接数（用于节点大小 + 详情面板）
    const connCount: Record<string, number> = {};
    relationships.forEach((r) => {
      connCount[r.source_id] = (connCount[r.source_id] || 0) + 1;
      connCount[r.target_id] = (connCount[r.target_id] || 0) + 1;
    });

    const nodes: GraphNode[] = (() => {
      // 归一化 access_count：避免单个极大值垄断尺寸
      const maxAccess = visibleEntities.reduce(
        (max, e) => Math.max(max, e.access_count || 0), 0
      );
      const accessNorm = (entity: Entity) =>
        maxAccess > 0 ? (entity.access_count || 0) / maxAccess : 0;

      const now = Date.now(); // 一次性获取，所有节点共用
      return visibleEntities.map((entity) => {
        const conn = connCount[entity.id] || 0;
        // size = base + scale * access_count_norm, principle +2, max 12
        const base = 4;
        const scale = 8;
        const principleBonus = entity.type === 'principle' ? 2 : 0;
        const val = Math.min(12, base + scale * accessNorm(entity) + principleBonus);
        // 预计算 freshness：7 天内=1→0.77, 30 天内线性衰减到 0
        let freshness = 0;
        if (entity.created_at) {
          const ageDays = (now - new Date(entity.created_at).getTime()) / 86400000;
          if (ageDays < 30) {
            freshness = Math.max(0, 1 - ageDays / 30);
          }
        }
        return {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          description: entity.description,
          val,
          color: getThemeColor(entity.type),
          glyph: TYPE_GLYPHS[entity.type] || '•',
          accessCount: entity.access_count || 0,
          connections: conn,
          lastAccessed: entity.last_accessed,
          created_at: entity.created_at,
          freshness,
        };
      });
    })();

    const nodeIds = new Set(visibleEntities.map((e) => e.id));
    let visibleRels = relationships.filter(
      (rel) => nodeIds.has(rel.source_id) && nodeIds.has(rel.target_id)
    );

    // MST 模式：用最大生成森林（Kruskal + 并查集）裁掉冗余边，
    // 只保留把图连起来的最强骨架关系，减少视觉噪音。
    if (mstMode && visibleRels.length > 0) {
      const parent: Record<string, string> = {};
      const find = (x: string): string => {
        while (parent[x] !== undefined && parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        if (parent[x] === undefined) parent[x] = x;
        return x;
      };
      const union = (a: string, b: string): boolean => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return false;
        parent[ra] = rb;
        return true;
      };
      const sorted = [...visibleRels].sort(
        (a, b) => (b.weight || 1) - (a.weight || 1)
      );
      visibleRels = sorted.filter((rel) => union(rel.source_id, rel.target_id));
    }

    const links: GraphLink[] = visibleRels.map((rel) => {
      const style = getRelationshipStyle(rel.type);
      return {
        source: rel.source_id,
        target: rel.target_id,
        type: rel.type,
        description: rel.description,
        weight: rel.weight,
        color: style.color,
      };
    });

    return { nodes, links };
  }, [relationships, visibleEntities, mstMode]);

  const selectedNeighborhoodIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const ids = new Set<string>([selectedNode.id]);
    relationships.forEach((rel) => {
      if (rel.source_id === selectedNode.id) ids.add(rel.target_id);
      if (rel.target_id === selectedNode.id) ids.add(rel.source_id);
    });
    return ids;
  }, [relationships, selectedNode]);

  const isFocusDimmedNode = useCallback((nodeId: string) => {
    if (selectedNodeIds.size > 1) return !selectedNodeIds.has(nodeId);
    if (selectedNode) return !selectedNeighborhoodIds.has(nodeId);
    return false;
  }, [selectedNeighborhoodIds, selectedNode, selectedNodeIds]);

  const graphSummary = useMemo(() => {
    const typeCounts = new Map<string, number>();
    let indexedCount = 0;
    let recentCount = 0;
    const now = Date.now();

    entities.forEach((entity) => {
      typeCounts.set(entity.type, (typeCounts.get(entity.type) || 0) + 1);
      if (entity.embedding) indexedCount += 1;
      const createdAt = new Date(entity.created_at).getTime();
      if (!Number.isNaN(createdAt) && now - createdAt <= 7 * 86400000) {
        recentCount += 1;
      }
    });

    const topTypes = Array.from(typeCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4);

    const strongestNodes = [...entities]
      .sort((a, b) => (connectionCounts[b.id] || 0) - (connectionCounts[a.id] || 0))
      .slice(0, 3);

    return {
      totalNodes: entities.length,
      totalEdges: relationships.length,
      visibleNodes: visibleEntities.length,
      visibleEdges: graphData.links.length,
      typeCount: typeCounts.size,
      indexedCount,
      recentCount,
      topTypes,
      strongestNodes,
    };
  }, [connectionCounts, entities, graphData.links.length, relationships.length, visibleEntities.length]);

  const hasActiveFilter = query.trim() !== "" || activeType !== "all" || activeTag !== "all" || timeFilter !== null || legendHighlightType !== null || mstMode;

  const clearGraphFilters = useCallback(() => {
    setQuery("");
    setActiveType("all");
    setActiveTag("all");
    setTimeFilter(null);
    setLegendHighlightType(null);
    setMstMode(false);
  }, []);

  const handleNodeClick = useCallback(
    (node: any, event?: MouseEvent) => {
      const isModifier = event?.ctrlKey || event?.metaKey;
      const entity = entities.find((e) => e.id === node.id);
      setSelectedNode(entity || null);

      if (isModifier) {
        // Ctrl/Cmd+点击：切换多选
        setSelectedNodeIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) {
            next.delete(node.id);
          } else {
            next.add(node.id);
          }
          return next;
        });
      } else {
        // 普通点击：单选
        setSelectedNodeIds(new Set([node.id]));
      }

      // 聚焦到点击的节点
      if (graphRef.current && is3D) {
        const distance = 120;
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        graphRef.current.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          node,
          1500
        );
      } else if (graphRef.current && !is3D) {
        graphRef.current.centerAt(node.x, node.y, 800);
        graphRef.current.zoom(2.5, 800);
      }
    },
    [entities, is3D]
  );

  // 通过 id 聚焦到节点（搜索 Enter / 邻居点击复用）
  const focusNodeById = useCallback(
    (id: string) => {
      const target = graphData.nodes.find((n: any) => n.id === id) as any;
      if (target) {
        handleNodeClick(target);
      } else {
        const entity = entities.find((e) => e.id === id);
        if (entity) setSelectedNode(entity);
      }
    },
    [graphData.nodes, entities, handleNodeClick]
  );

  // 会话自动保存（upsert 到 discussions，可续聊）。best-effort，失败不打扰用户。
  const saveSession = useCallback(async (turns: AnswerTurn[]) => {
    if (!turns.length) return;
    try {
      const r = await apiFetch('/api/discussions', {
        method: 'POST',
        body: JSON.stringify({ id: sessionIdRef.current, title: (turns[0].question || '问大脑').slice(0, 80), turns }),
      });
      if (r.ok) { const d = await r.json().catch(() => null); if (d?.id) sessionIdRef.current = d.id; }
    } catch { /* best effort */ }
  }, []);

  // 调 graph_answer 跑一轮（首问/追问共用）：右栏切答案卡并高亮命中子图。
  // priorTurns 是此前已答的各轮，新的一轮追加到末尾；发给后端时把每轮压平成
  // user/assistant 消息（依据也带上），让模型看得到之前的分析。
  const runAnswer = useCallback(async (question: string, priorTurns: AnswerTurn[]) => {
    setGLoading(true);
    setGPendingQ(question);
    setSelectedNode(null);
    setSelectedNodeIds(new Set());
    if (priorTurns.length === 0) { sessionIdRef.current = null; lastDecisionIdRef.current = null; } // 首问 = 新会话
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const tn of priorTurns) {
      messages.push({ role: 'user', content: tn.question });
      const c = [tn.conclusion, ...tn.reasons.map((r) => '· ' + (r?.text || ''))].filter(Boolean).join('\n') || '(no answer)';
      messages.push({ role: 'assistant', content: c });
    }
    messages.push({ role: 'user', content: question });
    const append = (turn: AnswerTurn) => setGAnswer({ turns: [...priorTurns, turn] });
    try {
      const res = await apiFetch('/api/mcp/tool/graph_answer', {
        method: 'POST',
        body: JSON.stringify({ arguments: { messages } }),
      });
      if (!res.ok) {
        const body = await res.text();
        const conclusion = res.status === 400 && body.includes('LLM') ? t('cmd.need_llm') : t('cmd.error');
        append({ question, conclusion, reasons: [], questions: [], isDecision: false, sources: [], citedEntityIds: [] });
        return;
      }
      const data = await res.json();
      const newTurn: AnswerTurn = {
        question,
        conclusion: data.conclusion || '',
        reasons: Array.isArray(data.reasons) ? data.reasons : [],
        questions: Array.isArray(data.questions) ? data.questions : [],
        isDecision: !!data.isDecision,
        sources: Array.isArray(data.sources) ? data.sources : [],
        citedEntityIds: Array.isArray(data.citedEntityIds) ? data.citedEntityIds : [],
      };
      const allTurns = [...priorTurns, newTurn];
      setGAnswer({ turns: allTurns });
      saveSession(allTurns); // 续聊：每答完一轮就存，关掉不丢
    } catch (e) {
      append({ question, conclusion: t('cmd.error'), reasons: [], questions: [], isDecision: false, sources: [], citedEntityIds: [] });
    } finally {
      setGLoading(false);
      setGPendingQ(null);
    }
  }, [t, saveSession]);

  // 决策：把当前答案存为决定。存完【不关闭】——决策常是连续多个，方便继续讨论/做下一个；
  // 同一会话里的后续决策通过 previous_decision_id 自动挂成决策链。
  const saveDecision = useCallback(async () => {
    const turns = gAnswer?.turns ?? [];
    const idx = turns.length - 1;
    const turn = idx >= 0 ? turns[idx] : null;
    if (!turn || gSaving) return;
    setGSaving(true);
    try {
      const r = await apiFetch('/api/mcp/tool/save_decision', {
        method: 'POST',
        body: JSON.stringify({
          arguments: {
            situation: turn.question,
            conclusion: turn.conclusion,
            cited_entity_ids: turn.citedEntityIds,
            confidence: 'medium',
            alternatives: '',
            previous_decision_id: lastDecisionIdRef.current || undefined,
          },
        }),
      });
      if (!r.ok) throw new Error();
      const saved = await r.json().catch(() => null);
      if (saved?.id) lastDecisionIdRef.current = saved.id; // 决策链：下一个决策承接它
      const nextTurns = turns.map((tn, i) => (i === idx ? { ...tn, savedAsDecision: true } : tn));
      setGAnswer({ turns: nextTurns });
      saveSession(nextTurns); // 把"已存决策"状态也持久化
      toast.success(t('cmd.decision_saved'));
      onDataChanged?.();
    } catch (e) {
      toast.error(t('cmd.error'));
    } finally {
      setGSaving(false);
    }
  }, [gAnswer, gSaving, onDataChanged, saveSession, toast, t]);

  // 历史会话：打开列表 / 载入一条续聊 / 删除
  const openHistory = useCallback(async () => {
    setHistOpen((v) => !v);
    try {
      const r = await apiFetch('/api/discussions');
      if (r.ok) setHistItems(await r.json());
    } catch { /* */ }
  }, []);
  const loadDiscussion = useCallback(async (id: string) => {
    try {
      const r = await apiFetch(`/api/discussions/${id}`);
      if (!r.ok) return;
      const d = await r.json();
      const turns: AnswerTurn[] = Array.isArray(d.turns) ? d.turns : [];
      if (!turns.length) return;
      sessionIdRef.current = d.id;
      lastDecisionIdRef.current = null;
      setHistOpen(false);
      setCmdFocused(false);
      setSelectedNode(null);
      setGAnswer({ turns });
    } catch { /* */ }
  }, []);
  const deleteDiscussion = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await apiFetch(`/api/discussions/${id}`, { method: 'DELETE' }); setHistItems((xs) => xs.filter((x) => x.id !== id)); }
    catch { /* */ }
  }, []);

  // 答案卡：复制 / 收藏一轮的洞见（结论 + 依据）
  const turnText = (turn: AnswerTurn) => [turn.conclusion, ...turn.reasons.map((r) => '· ' + r.text)].filter(Boolean).join('\n');
  const copyAnswer = useCallback(async (turn: AnswerTurn) => {
    try { await navigator.clipboard.writeText(turnText(turn)); toast.success(t('actions.copied')); }
    catch { toast.error(t('actions.copy_failed')); }
  }, [toast, t]);
  const favoriteAnswer = useCallback(async (turn: AnswerTurn) => {
    try {
      const r = await apiFetch('/api/memory/archival', {
        method: 'POST',
        body: JSON.stringify({ content: turnText(turn), summary: turn.question || turn.conclusion.slice(0, 60), tags: ['收藏'], importance: 0.8 }),
      });
      if (!r.ok) throw new Error();
      toast.success(t('actions.favorited'));
    } catch { toast.error(t('actions.favorite_failed')); }
  }, [toast, t]);

  // 命令栏聚焦时的示例问题：尽量取自用户真实图谱(决策/原则)，不足则补静态
  const cmdExamples = useMemo(() => {
    const out: string[] = [];
    const d = entities.find((e) => (e.type as string) === 'decision');
    const p = entities.find((e) => (e.type as string) === 'principle');
    if (d) out.push(t('cmd.ex_review').replace('{name}', d.name));
    if (p) out.push(t('cmd.ex_view').replace('{name}', p.name));
    for (const f of [t('cmd.ex_recent'), t('cmd.ex_struggle')]) { if (out.length < 3) out.push(f); }
    return out.slice(0, 3);
  }, [entities, t]);

  // 命令栏输入时的匹配节点(找节点 → 跳转，复用 search 功能)
  const cmdMatches = useMemo(() => {
    const q = cmdInput.trim().toLowerCase();
    if (!q) return [] as Entity[];
    return entities.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 5);
  }, [cmdInput, entities]);

  const submitCommand = useCallback(() => {
    const q = cmdInput.trim();
    if (!q || gLoading) return;
    runAnswer(q, []);
  }, [cmdInput, gLoading, runAnswer]);

  const followUp = useCallback(() => {
    const q = followInput.trim();
    if (!q || gLoading || !gAnswer) return;
    setFollowInput("");
    runAnswer(q, gAnswer.turns);
  }, [followInput, gLoading, gAnswer, runAnswer]);

  useEffect(() => {
    if (focusEntityId) {
      const timer = setTimeout(() => {
        // 触发聚焦脉冲动画：先清理旧动画再启动新动画
        if (focusAnimTimerRef.current) clearTimeout(focusAnimTimerRef.current);
        focusAnimRef.current = { nodeId: focusEntityId, startTime: Date.now() };
        focusAnimTimerRef.current = setTimeout(() => {
          focusAnimRef.current = null;
          focusAnimTimerRef.current = null;
        }, 500);

        focusNodeById(focusEntityId);
        onFocusEntityReset?.();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [focusEntityId, focusNodeById, onFocusEntityReset]);

  // 组件卸载时清理动画 timer
  useEffect(() => {
    return () => {
      if (focusAnimTimerRef.current) {
        clearTimeout(focusAnimTimerRef.current);
      }
    };
  }, []);

  // Ctrl/Cmd+K 聚焦命令栏；Esc 关闭答案卡 / 退出多选
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        cmdInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (gAnswer) { setGAnswer(null); setCmdInput(""); setFollowInput(""); setSelectedNode(null); return; }
        if (selectedNodeIds.size > 0) { setSelectedNodeIds(new Set()); setSelectedNode(null); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeIds.size, gAnswer]);

  // 进入编辑模式：把当前选中节点字段填到表单
  const enterEditMode = useCallback(() => {
    if (!selectedNode) return;
    setEditName(selectedNode.name);
    setEditType(selectedNode.type);
    setEditDesc(selectedNode.description || "");
    setEditTags((selectedNode.tags || []).join(", "));
    setEditMode(true);
    setMergeMode(false);
  }, [selectedNode]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!selectedNode || busy) return;
    setBusy(true);
    try {
      const tags = editTags
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await apiFetch(`/api/entities/${selectedNode.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim() || selectedNode.name,
          type: editType.trim() || selectedNode.type,
          description: editDesc,
          tags,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('toast.graph_saved'), t('toast.graph_saved_detail').replace('{name}', editName));
      setEditMode(false);
      onDataChanged?.();
    } catch (err) {
      toast.error(t('toast.graph_save_failed'), String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedNode, busy, editName, editType, editDesc, editTags, toast, onDataChanged]);

  // 计算删除影响：给定一组 entityId，统计受影响的出入向关系
  const getRelationImpact = useCallback((entityIds: string[]) => {
    const idSet = new Set(entityIds);
    let total = 0;
    let inbound = 0;
    let outbound = 0;
    relationships.forEach((r) => {
      if (idSet.has(r.source_id) && idSet.has(r.target_id)) {
        total++;
      } else if (idSet.has(r.source_id)) {
        total++;
        outbound++;
      } else if (idSet.has(r.target_id)) {
        total++;
        inbound++;
      }
    });
    return { total, inbound, outbound };
  }, [relationships]);

  const handleDelete = useCallback(async () => {
    if (!selectedNode || busy) return;
    const impact = getRelationImpact([selectedNode.id]);
    const ok = await confirm({
      title: t('confirm.delete_node_title'),
      message: t('confirm.delete_node_message_single')
        .replace('{name}', selectedNode.name)
        .replace('{total}', String(impact.total))
        .replace('{inbound}', String(impact.inbound))
        .replace('{outbound}', String(impact.outbound)),
      confirmText: t('confirm.delete_confirm_text'),
      destructive: true,
    });
    if (!ok) return;

    // 缓存数据用于撤销
    const deletedEntity = entities.find((e) => e.id === selectedNode.id);
    const affectedRels = relationships.filter(
      (r) => r.source_id === selectedNode.id || r.target_id === selectedNode.id
    );
    pendingDeletesRef.current = {
      entities: deletedEntity ? [deletedEntity] : [],
      relationships: affectedRels,
    };

    setBusy(true);
    try {
      const res = await apiFetch(`/api/entities/${selectedNode.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelectedNode(null);
      setSelectedNodeIds(new Set());
      onDataChanged?.();

      // 显示撤销 toast
      const undoAction = (
        <button
          onClick={() => handleUndoDelete()}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-md transition-colors"
        >
          <Undo2 className="w-3 h-3" />
          {t('graph.undo')}
        </button>
      );
      undoToastIdRef.current = toast.info(
        t('toast.graph_deleted_undo').replace('{name}', selectedNode.name),
        undefined,
        { duration: 10000, action: undoAction }
      );
      // 10 秒后清除撤销缓存
      undoTimerRef.current = setTimeout(() => {
        pendingDeletesRef.current = null;
        undoToastIdRef.current = null;
      }, 10000);
    } catch (err) {
      pendingDeletesRef.current = null;
      toast.error(t('toast.graph_delete_failed'), String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedNode, busy, toast, onDataChanged, confirm, getRelationImpact, entities, relationships]);

  // 撤销删除：用缓存数据 POST 重建实体和关系
  const handleUndoDelete = useCallback(async () => {
    const pending = pendingDeletesRef.current;
    if (!pending || pending.entities.length === 0) return;
    pendingDeletesRef.current = null;
    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
    if (undoToastIdRef.current) { toast.dismiss(undoToastIdRef.current); undoToastIdRef.current = null; }

    setBusy(true);
    const oldToNew: Record<string, string> = {};
    try {
      // 重建实体
      for (const entity of pending.entities) {
        const res = await apiFetch('/api/entities', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entity.name,
            type: entity.type,
            description: entity.description,
            tags: entity.tags,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = await res.json();
        oldToNew[entity.id] = created.id;
      }
      // 重建关系
      for (const rel of pending.relationships) {
        const newSourceId = oldToNew[rel.source_id];
        const newTargetId = oldToNew[rel.target_id];
        if (!newSourceId || !newTargetId) continue;
        await apiFetch('/api/relationships', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId: newSourceId,
            targetId: newTargetId,
            type: rel.type,
            description: rel.description,
            weight: rel.weight,
          }),
        });
      }
      toast.success(
        t('toast.graph_restored').replace('{count}', String(pending.entities.length)),
        t('toast.graph_restored_detail').replace('{rels}', String(pending.relationships.length))
      );
      onDataChanged?.();
    } catch (err) {
      toast.error(t('toast.graph_restore_failed'), String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, toast, onDataChanged]);

  const handleMerge = useCallback(
    async (targetId: string) => {
      if (!selectedNode || busy) return;
      const target = entities.find((e) => e.id === targetId);
      if (!target) return;
      // 计算合并影响：源节点的关系数
      const impact = getRelationImpact([selectedNode.id]);
      const ok = await confirm({
        title: t('confirm.merge_node_title'),
        message: t('confirm.merge_node_message_enhanced')
          .replace('{source}', selectedNode.name)
          .replace('{target}', target.name)
          .replace('{total}', String(impact.total)),
        confirmText: t('confirm.merge_confirm_text'),
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await apiFetch(`/api/entities/${selectedNode.id}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        toast.success(
          t('toast.graph_merge_done'),
          t('toast.graph_merge_done_detail').replace('{moved}', String(data.moved)).replace('{dropped}', String(data.dropped))
        );
        setMergeMode(false);
        setMergeQuery("");
        // 切换选中到合并目标
        setSelectedNode(target);
        onDataChanged?.();
      } catch (err) {
        toast.error(t('toast.graph_merge_failed'), String(err));
      } finally {
        setBusy(false);
      }
    },
    [selectedNode, busy, entities, toast, onDataChanged, confirm, getRelationImpact]
  );

  const [showBatchTagInput, setShowBatchTagInput] = useState(false);
  const [batchTagText, setBatchTagText] = useState("");

  // 合并目标候选
  const mergeCandidates = useMemo(() => {
    if (!selectedNode || !mergeMode) return [] as Entity[];
    const q = mergeQuery.trim().toLowerCase();
    return entities
      .filter((e) => e.id !== selectedNode.id)
      .filter((e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [entities, selectedNode, mergeQuery, mergeMode]);

  // 切换节点时，自动退出编辑/合并模式
  useEffect(() => {
    setEditMode(false);
    setMergeMode(false);
    setMergeQuery("");
    // 切换到非多选模式时重置
    if (!isMultiSelect) {
      // 留给单选的干净状态
    }
  }, [selectedNode?.id]);

  // 批量删除：一次性删除多个实体
  const handleBatchDelete = useCallback(async () => {
    if (selectedNodeIds.size === 0 || busy) return;
    const ids = Array.from(selectedNodeIds);
    const impact = getRelationImpact(ids);
    const targetEntities = entities.filter((e) => ids.includes(e.id));
    const names = targetEntities.map((e) => e.name).slice(0, 5).join(', ');
    const moreText = targetEntities.length > 5 ? ` +${targetEntities.length - 5}` : '';
    const ok = await confirm({
      title: t('confirm.batch_delete_title').replace('{count}', String(ids.length)),
      message: t('confirm.batch_delete_message')
        .replace('{count}', String(ids.length))
        .replace('{names}', names + moreText)
        .replace('{total}', String(impact.total))
        .replace('{inbound}', String(impact.inbound))
        .replace('{outbound}', String(impact.outbound)),
      confirmText: t('confirm.delete_confirm_text'),
      destructive: true,
    });
    if (!ok) return;

    // 缓存用于撤销
    const affectedRels = relationships.filter(
      (r) => ids.includes(r.source_id) || ids.includes(r.target_id)
    );
    pendingDeletesRef.current = {
      entities: targetEntities,
      relationships: affectedRels,
    };

    setBusy(true);
    try {
      // 批量删除：逐个调 API
      for (const id of ids) {
        const res = await apiFetch(`/api/entities/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${id}`);
      }
      setSelectedNode(null);
      setSelectedNodeIds(new Set());
      onDataChanged?.();

      const undoAction = (
        <button
          onClick={() => handleUndoDelete()}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-md transition-colors"
        >
          <Undo2 className="w-3 h-3" />
          {t('graph.undo')}
        </button>
      );
      undoToastIdRef.current = toast.info(
        t('toast.graph_batch_deleted_undo').replace('{count}', String(ids.length)),
        undefined,
        { duration: 10000, action: undoAction }
      );
      undoTimerRef.current = setTimeout(() => {
        pendingDeletesRef.current = null;
        undoToastIdRef.current = null;
      }, 10000);
    } catch (err) {
      pendingDeletesRef.current = null;
      toast.error(t('toast.graph_delete_failed'), String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedNodeIds, busy, toast, onDataChanged, confirm, getRelationImpact, entities, relationships, handleUndoDelete]);

  // 批量加标签
  const handleBatchTag = useCallback(async () => {
    const tagText = batchTagText.trim();
    if (!tagText || selectedNodeIds.size === 0 || busy) return;
    const tags = tagText.split(/[,、]/).map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setBusy(true);
    const ids = Array.from(selectedNodeIds);
    try {
      for (const id of ids) {
        const entity = entities.find((e) => e.id === id);
        if (!entity) continue;
        const existingTags = entity.tags || [];
        const mergedTags = Array.from(new Set([...existingTags, ...tags]));
        await apiFetch(`/api/entities/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: mergedTags }),
        });
      }
      toast.success(
        t('toast.graph_batch_tagged').replace('{count}', String(ids.length)).replace('{tags}', tags.join(', '))
      );
      setBatchTagText("");
      setShowBatchTagInput(false);
      onDataChanged?.();
    } catch (err) {
      toast.error(t('toast.graph_tag_failed'), String(err));
    } finally {
      setBusy(false);
    }
  }, [batchTagText, selectedNodeIds, busy, entities, toast, onDataChanged]);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      if (visibleEntities.length === 0) return;
      event.preventDefault();
      focusNodeById(visibleEntities[0].id);
    },
    [visibleEntities, focusNodeById]
  );

  const handleResetCamera = useCallback(() => {
    if (graphRef.current) {
      if (is3D) {
        graphRef.current.cameraPosition({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, 1000);
      } else {
        graphRef.current.zoomToFit(500);
      }
    }
  }, [is3D]);

  // 节点标签渲染（2D 模式）
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHover = node.id === hovered;
      const isSelected = selectedNode?.id === node.id || selectedNodeIds.has(node.id);
      // 选中某个节点时只突出它的一跳邻域；Legend 高亮时非匹配类型节点也会淡化。
      const dimmed = (isFocusDimmedNode(node.id) && !isHover)
        || (!!legendHighlightType && node.type !== legendHighlightType);
      const sizeScale = isHover || isSelected ? 1.25 : 1;
      let nodeSize = (node.val || 5) * sizeScale;

      // 聚焦脉冲动画：缩放脉冲 1x → 1.4x → 1x（500ms，sine 曲线）
      let focusPulseProgress = 0;
      const focusAnim = focusAnimRef.current;
      if (focusAnim && focusAnim.nodeId === node.id) {
        focusPulseProgress = Math.min(1, (Date.now() - focusAnim.startTime) / 500);
      }
      if (focusPulseProgress > 0 && focusPulseProgress < 1) {
        const pulseScale = 1 + 0.4 * Math.sin(focusPulseProgress * Math.PI);
        nodeSize *= pulseScale;
      }

      // 外层柔光
      const glowAlpha = dimmed ? 0.05 : isHover || isSelected ? 0.6 : 0.25;
      const grad = ctx.createRadialGradient(
        node.x, node.y, nodeSize * 0.5,
        node.x, node.y, nodeSize * 2.4
      );
      grad.addColorStop(0, hexToRgba(node.color, glowAlpha));
      grad.addColorStop(1, hexToRgba(node.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeSize * 2.4, 0, 2 * Math.PI);
      ctx.fill();

      // 节点主体
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
      ctx.fillStyle = dimmed ? hexToRgba(node.color, 0.25) : node.color;
      ctx.fill();

      // 聚焦涟漪：从节点中心向外辐射的 expanding circle
      if (focusPulseProgress > 0 && focusPulseProgress < 1) {
        const rippleRadius = nodeSize * (1 + focusPulseProgress * 3.5);
        const rippleAlpha = 0.45 * (1 - focusPulseProgress);
        ctx.beginPath();
        ctx.arc(node.x, node.y, rippleRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(125, 249, 255, ${rippleAlpha})`;
        ctx.lineWidth = 2.5 / globalScale;
        ctx.stroke();
      }

      // 边框
      ctx.lineWidth = (isHover || isSelected ? 2.5 : 1.5) / globalScale;
      ctx.strokeStyle = isHover || isSelected ? '#ffffff' : hexToRgba(node.color, dimmed ? 0.3 : 0.9);
      ctx.stroke();

      // 新鲜度光环：最近创建的节点外圈加 cyan ring（不影响主色）
      if (node.freshness && node.freshness > 0 && !dimmed) {
        const ringAlpha = node.freshness * 0.55;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeSize + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(125, 249, 255, ${ringAlpha})`;
        ctx.lineWidth = 2.2 / globalScale;
        ctx.stroke();
      }

      // 中心 glyph：尺寸够大时才画
      if (nodeSize * globalScale > 8) {
        const glyphSize = Math.max(nodeSize * 1.1, 6 / globalScale);
        ctx.font = `${glyphSize}px "Segoe UI Symbol", "Apple Symbols", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = dimmed ? 'rgba(255,255,255,0.2)' : '#0a0b12';
        ctx.fillText(node.glyph || '•', node.x, node.y);
      }

      // 名称标签
      if (globalScale > 0.5) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${isSelected || isHover ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isHover || isSelected
          ? '#7df9ff'
          : dimmed
            ? 'rgba(200,200,200,0.25)'
            : '#e2e8f0';
        ctx.fillText(node.name, node.x, node.y + nodeSize + 3);
      }
    },
    [hovered, selectedNode, selectedNodeIds, legendHighlightType, isFocusDimmedNode]
  );

  // 节点3D标签
  const nodeThreeObject = useCallback((node: any) => {
    // 3D 模式使用 CSS2D 标签
    if (typeof window === "undefined") return null;
    try {
      const { CSS2DObject } = require("three/examples/jsm/renderers/CSS2DRenderer");
      const div = document.createElement("div");
      // 在名称前加上类型表意符号，让 3D 标签也能一眼区分节点类型
      div.textContent = `${node.glyph || "•"} ${node.name}`;
      div.style.color = node.color;
      div.style.fontSize = "11px";
      div.style.fontFamily = "Inter, sans-serif";
      div.style.padding = "2px 6px";
      div.style.borderRadius = "4px";
      div.style.background = "rgba(10, 11, 18, 0.85)";
      div.style.pointerEvents = "none";
      div.style.whiteSpace = "nowrap";
      return new CSS2DObject(div);
    } catch {
      return undefined; // 回退到默认渲染
    }
  }, []);

  // 选中节点的邻居（连接的实体 + 关系类型 + 方向）
  const neighbors = useMemo(() => {
    if (!selectedNode) return [] as Array<{
      entity: Entity;
      type: string;
      direction: "out" | "in";
      weight: number;
    }>;
    const entityMap = new Map(entities.map((e) => [e.id, e]));
    const list: Array<{
      entity: Entity;
      type: string;
      direction: "out" | "in";
      weight: number;
    }> = [];
    relationships.forEach((rel) => {
      if (rel.source_id === selectedNode.id) {
        const tgt = entityMap.get(rel.target_id);
        if (tgt) list.push({ entity: tgt, type: rel.type, direction: "out", weight: rel.weight || 1 });
      } else if (rel.target_id === selectedNode.id) {
        const src = entityMap.get(rel.source_id);
        if (src) list.push({ entity: src, type: rel.type, direction: "in", weight: rel.weight || 1 });
      }
    });
    return list.sort((a, b) => b.weight - a.weight).slice(0, 20);
  }, [selectedNode, relationships, entities]);

  // Hover/3D 内置 tooltip：用一段 HTML 显示名字 + 类型 + 描述 + 度数
  const nodeLabelHtml = useCallback((node: any) => {
    const safeName = String(node.name || "").replace(/</g, "&lt;");
    const safeDesc = node.description
      ? String(node.description).replace(/</g, "&lt;").slice(0, 300)
      : "";
    const type = String(node.type || "").replace(/_/g, " ");
    const last = node.lastAccessed ? relativeTime(node.lastAccessed) : "";
    return `
      <div style="
        background:rgba(10,11,18,0.95);
        border:1px solid rgba(125,249,255,0.25);
        border-radius:8px;
        padding:8px 10px;
        max-width:360px;
        font-family:Inter,sans-serif;
        color:#e2e8f0;
        box-shadow:0 8px 24px rgba(0,0,0,0.4);
        word-wrap:break-word;
        overflow-wrap:break-word;
      ">
        <div style="color:#7df9ff;font-weight:600;font-size:12px;">${safeName}</div>
          <div style="color:#94a3b8;font-size:10px;margin-top:2px;">${type} · ${node.connections} ${t('graph.connections_label_html')} · ${node.accessCount} ${t('graph.access_count_html')}${last ? ` · ${last}` : ""}</div>
        ${safeDesc ? `<div style="color:#cbd5e1;font-size:11px;margin-top:6px;line-height:1.4;">${safeDesc}</div>` : ""}
      </div>
    `;
  }, []);

  if (graphLoadError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0b12]">
        <div className="text-center max-w-md px-6">
          <div className="text-red-400 text-sm mb-2">{t('graph.load_engine_failed')}</div>
          <p className="text-xs text-gray-400 mb-4">{t('graph.load_engine_detail')}</p>
          <pre className="text-[10px] text-gray-500 bg-black/40 p-3 rounded text-left overflow-auto max-h-32">
            {graphLoadError}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-1.5 text-xs text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/20"
          >
            {t('graph.reload_page')}
          </button>
        </div>
      </div>
    );
  }

  if (!ForceGraph && entities.length > 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0b12]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-cyan-400 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">{t('graph.loading_engine')}</p>
        </div>
      </div>
    );
  }

  // 答案态高亮跟随"最新一轮"的命中子图
  const gLastTurn = gAnswer && gAnswer.turns.length > 0 ? gAnswer.turns[gAnswer.turns.length - 1] : null;
  const gCited = gLastTurn?.citedEntityIds ?? [];

  return (
    <div className="flex h-full">
      {/* 图谱主区域 */}
      <div className="relative min-w-0 flex-1" ref={containerRef}>
        {/* 控制栏 + 时间轴：统一放进 top 容器纵向堆叠，时间轴自然落在控制栏下方，
            不再用 top-[60px] 魔法数字，避免与摘要行重叠 */}
        <div className="absolute top-4 left-4 right-4 z-10 flex flex-col gap-2">
        {/* 命令栏：问大脑 / 决策 / 找节点 的统一入口，回答出现在右栏答案卡 */}
        <div className="relative">
          <div className="flex items-center gap-2.5 rounded-xl border border-cyan-500/25 bg-gray-950/85 px-3.5 py-2.5 shadow-2xl shadow-cyan-950/20 backdrop-blur-sm">
            <Brain className="h-4 w-4 shrink-0 text-cyan-300" />
            <input
              ref={cmdInputRef}
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              onFocus={() => { setCmdFocused(true); setHistOpen(false); }}
              onBlur={() => setTimeout(() => setCmdFocused(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCommand(); } }}
              placeholder={t('cmd.placeholder')}
              className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 outline-none"
            />
            <button onClick={openHistory} title={t('cmd.history')} className={`shrink-0 transition-colors hover:text-cyan-200 ${histOpen ? 'text-cyan-300' : 'text-gray-400'}`}>
              <History className="h-4 w-4" />
            </button>
            {gLoading ? (
              <span className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
            ) : (
              <button onClick={submitCommand} disabled={!cmdInput.trim()} className="shrink-0 text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-30" title={t('cmd.send')}>
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          {cmdFocused && (cmdInput.trim() ? cmdMatches.length > 0 : true) && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-xl border border-white/10 bg-gray-950/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-sm">
              {cmdInput.trim() ? (
                <>
                  <div className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-wider text-gray-500">{t('cmd.matches')}</div>
                  {cmdMatches.map((m) => (
                    <button
                      key={m.id}
                      onMouseDown={(e) => { e.preventDefault(); setCmdFocused(false); focusNodeById(m.id); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-gray-300 hover:bg-white/5"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getThemeColor(m.type) }} />
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="shrink-0 text-[10px] text-gray-600">{m.type.replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                  <div className="mt-1 border-t border-white/5 px-2 pt-1.5 text-[11px] text-gray-500">{t('cmd.enter_hint')}</div>
                </>
              ) : (
                <>
                  <div className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-wider text-gray-500">{t('cmd.try_ask')}</div>
                  {cmdExamples.map((ex, i) => (
                    <button
                      key={i}
                      onMouseDown={(e) => { e.preventDefault(); if (gLoading) return; setCmdInput(ex); setCmdFocused(false); runAnswer(ex, []); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-gray-300 hover:bg-cyan-950/30 hover:text-cyan-100"
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
                      <span className="flex-1 truncate">{ex}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {histOpen && (
            <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-gray-950/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-sm">
              <div className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-wider text-gray-500">{t('cmd.history')}</div>
              {histItems.length === 0 ? (
                <div className="px-2 py-3 text-[13px] text-gray-500">{t('cmd.history_empty')}</div>
              ) : (
                histItems.map((h) => (
                  <div key={h.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <button onClick={() => loadDiscussion(h.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" />
                      <span className="flex-1 truncate text-[13px] text-gray-200">{h.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-600">{h.updated_at?.slice(5, 10)}</span>
                    </button>
                    <button onClick={(e) => deleteDiscussion(h.id, e)} title="删除" className="shrink-0 text-gray-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 max-w-md items-center gap-2 rounded-lg border border-white/10 bg-gray-950/90 px-3 py-2 shadow-2xl shadow-black/30">
            <Search className="h-4 w-4 text-cyan-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('graph.search_placeholder')}
              className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 outline-none"
            />
          </div>
          <select
            value={activeType}
            onChange={(event) => setActiveType(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-gray-950/90 px-3 text-xs text-gray-200 outline-none hover:border-cyan-500/40"
            aria-label={t('graph.filter_by_type')}
          >
            <option value="all">{t('graph.all_types')}</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {availableTags.length > 0 && (
            <select
              value={activeTag}
              onChange={(event) => setActiveTag(event.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-gray-950/90 px-3 text-xs text-gray-200 outline-none hover:border-cyan-500/40 max-w-[160px]"
              aria-label={t('graph.filter_by_tag_aria')}
            >
              <option value="all">{t('graph.all_tags')}</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setIs3D(!is3D)}
            className="h-9 px-3 bg-gray-950/90 border border-white/10 rounded-lg text-xs text-cyan-400 hover:bg-gray-900 hover:border-cyan-500/40 transition-colors"
          >
            {is3D ? t('graph.mode_2d') : t('graph.mode_3d')}
          </button>
          <button
            onClick={handleResetCamera}
            className="h-9 px-3 bg-gray-950/90 border border-white/10 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            {t('graph.reset_camera')}
          </button>
          <button
            onClick={() => setMstMode((v) => !v)}
            className={`h-9 px-3 rounded-lg text-xs border transition-colors flex items-center gap-1 ${
              mstMode
                ? "bg-cyan-900/40 border-cyan-700/50 text-cyan-300"
                : "bg-gray-950/90 border-white/10 text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40"
            }`}
            title={t('graph.mst_tooltip')}
          >
            <GitBranch className="w-3 h-3" />
            {mstMode ? t('graph.mst_mode') : t('graph.full_view')}
          </button>
          {timeBounds && (
            <button
              onClick={() => setShowTimeSlider((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs border transition-colors flex items-center gap-1 ${
                showTimeSlider || timeFilter !== null
                  ? "bg-cyan-900/40 border-cyan-700/50 text-cyan-300"
                  : "bg-gray-950/90 border-white/10 text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40"
              }`}
              title={t('graph.time_tooltip')}
            >
              <Clock className="w-3 h-3" />
              {t('graph.timeline')}
            </button>
          )}
          <div className="basis-full flex flex-wrap items-center gap-2 pt-1 text-[11px] text-gray-400">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-950/75 px-2.5 py-1.5 shadow-xl shadow-black/20">
              <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t('graph.visible_summary')
                .replace('{nodes}', String(graphSummary.visibleNodes))
                .replace('{totalNodes}', String(graphSummary.totalNodes))
                .replace('{edges}', String(graphSummary.visibleEdges))
                .replace('{totalEdges}', String(graphSummary.totalEdges))}</span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-950/75 px-2.5 py-1.5 shadow-xl shadow-black/20">
              <Layers className="h-3.5 w-3.5 text-purple-300" />
              <span>{t('graph.type_summary')
                .replace('{types}', String(graphSummary.typeCount))
                .replace('{indexed}', String(graphSummary.indexedCount))}</span>
            </div>
            {selectedNode && (
              <div className="hidden lg:flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-950/30 px-2.5 py-1.5 text-cyan-200 shadow-xl shadow-cyan-950/20">
                <Target className="h-3.5 w-3.5" />
                <span>{t('graph.focus_summary').replace('{count}', String(selectedNeighborhoodIds.size))}</span>
              </div>
            )}
            {hasActiveFilter && (
              <button
                onClick={clearGraphFilters}
                className="rounded-lg border border-cyan-500/20 bg-cyan-950/30 px-2.5 py-1.5 text-cyan-300 hover:bg-cyan-900/40 hover:text-cyan-100 transition-colors"
              >
                {t('graph.clear_filters')}
              </button>
            )}
          </div>
        </div>

        {/* 时间轴面板：在控制栏正下方，随其换行高度自然下移 */}
        {showTimeSlider && timeBounds && (
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-gray-950/95 px-4 py-2.5 shadow-2xl shadow-black/30">
            <Clock className="h-4 w-4 shrink-0 text-cyan-400" />
            <input
              type="range"
              min={timeBounds.min}
              max={timeBounds.max}
              step={Math.max(1, Math.floor((timeBounds.max - timeBounds.min) / 200))}
              value={timeFilter ?? timeBounds.max}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTimeFilter(v >= timeBounds.max ? null : v);
              }}
              className="flex-1 accent-cyan-400"
              aria-label={t('graph.time_slider_label')}
            />
            <span className="shrink-0 text-xs text-gray-300 font-mono w-[150px] text-right">
              {timeFilter === null
                ? t('graph.all_time')
                : `≤ ${new Date(timeFilter).toLocaleDateString()} ${new Date(timeFilter).toLocaleTimeString()}`}
            </span>
            <button
              onClick={() => setTimeFilter(null)}
              disabled={timeFilter === null}
              className="shrink-0 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title={t('graph.reset_time_filter')}
            >
              {t('graph.reset')}
            </button>
          </div>
        )}
        </div>

        {/* 图例：左侧中下方可折叠交互式 Legend（展开时向上生长） */}
        {graphData.nodes.length > 0 && (
        <div
          className="absolute left-4 bottom-36 z-10 hidden max-w-[220px] rounded-lg border border-white/10 bg-gray-950/90 shadow-2xl shadow-black/30 lg:block"
        >
          <button
            onClick={toggleLegendExpand}
            className="flex items-center justify-between w-full px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
            title={legendExpanded ? t('graph.legend_collapse') : t('graph.legend_expand')}
          >
            <span className="uppercase font-medium tracking-wider">{t('graph.legend')}</span>
            <span className="text-[10px] text-gray-500">{legendExpanded ? '▾' : '▸'}</span>
          </button>
          {legendExpanded && (
            <div className="px-3 pb-2 space-y-1 border-t border-white/5">
              {legendHighlightType && (
                <button
                  onClick={() => setLegendHighlightType(null)}
                  className="w-full text-left text-[10px] text-cyan-400 hover:text-cyan-300 py-0.5"
                >
                  {t('graph.legend_clear_filter')}
                </button>
              )}
              {(() => {
                // 统计当前画布各类型数量
                const typeCounts: Record<string, number> = {};
                visibleEntities.forEach((e) => {
                  typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
                });
                return Object.entries(typeCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => {
                    const color = getThemeColor(type);
                    const isActive = legendHighlightType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setLegendHighlightType(isActive ? null : type)}
                        className={`flex items-center gap-2 w-full text-left py-1 px-1 rounded transition-colors ${
                          isActive
                            ? 'bg-cyan-900/30 ring-1 ring-cyan-500/50'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-[11px] text-gray-300 truncate flex-1">
                          {type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">{count}</span>
                      </button>
                    );
                  });
              })()}
            </div>
          )}
        </div>
        )}

        {/* 统计信息：左侧中下方，图例下方 */}
        {graphData.nodes.length > 0 && (
        <div className="absolute bottom-16 left-4 z-10 rounded-lg border border-white/10 bg-gray-950/90 p-3 shadow-2xl shadow-black/30">
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-gray-500">{t('graph.visible_nodes')}</span>
              <p className="text-cyan-400 font-mono font-bold">{visibleEntities.length}</p>
            </div>
            <div>
              <span className="text-gray-500">{t('graph.visible_edges')}</span>
              <p className="text-purple-400 font-mono font-bold">{graphData.links.length}</p>
            </div>
          </div>
        </div>
        )}

        {graphData.nodes.length === 0 && entities.length > 0 && (
          <div className="absolute inset-0 z-[9] flex items-center justify-center bg-[#0a0b12]/70 px-6">
            <div className="max-w-lg rounded-xl border border-cyan-500/20 bg-gray-950/85 p-6 text-center shadow-2xl shadow-cyan-950/30">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
                <Network className="h-6 w-6 text-cyan-300" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                {entities.length === 0 ? t('graph.no_nodes') : t('graph.no_nodes_match')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                {entities.length === 0
                  ? t('graph.no_nodes_hint')
                  : t('graph.no_nodes_match_hint')}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-left text-xs text-gray-400">
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <Brain className="mb-2 h-4 w-4 text-cyan-300" />
                  {t('graph.capture_content')}
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <Zap className="mb-2 h-4 w-4 text-yellow-300" />
                  {t('graph.extract_relations')}
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <MousePointer2 className="mb-2 h-4 w-4 text-purple-300" />
                  {t('graph.click_explore')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3D/2D 图谱 */}
        {ForceGraph && graphData.nodes.length > 0 && (
          <ForceGraph
            ref={graphRef}
            width={dimensions.width || undefined}
            height={dimensions.height || undefined}
            graphData={graphData}
            nodeId="id"
            nodeLabel={nodeLabelHtml}
            nodeVal={(node: any) => node.val}
            nodeColor={(node: any) => {
              // 答案态：命中子图的节点保持高亮，其余压暗
              if (gCited.length > 0 && !gCited.includes(node.id)) {
                return hexToRgba(node.color, 0.12);
              }
              if (isFocusDimmedNode(node.id)) {
                return hexToRgba(node.color, 0.16);
              }
              if (legendHighlightType && node.type !== legendHighlightType) {
                return hexToRgba(node.color, 0.18);
              }
              return node.color;
            }}
            linkSource="source"
            linkTarget="target"
            linkLabel={(link: any) => t('graph.link_label').replace('{type}', link.type.replace(/_/g, " ")).replace('{weight}', (link.weight || 1).toFixed(2))}
            linkColor={(link: any) => {
              const color = getRelationshipStyle(link.type).color;
              const sourceId = getLinkEndpointId(link.source);
              const targetId = getLinkEndpointId(link.target);
              // 答案态：只保留命中子图内部的连线，其余压暗
              if (gCited.length > 0) {
                const inSub = gCited.includes(sourceId) && gCited.includes(targetId);
                return inSub ? color : hexToRgba(color, 0.08);
              }
              const focusDimmed = selectedNode
                ? sourceId !== selectedNode.id && targetId !== selectedNode.id
                : selectedNodeIds.size > 1 && (!selectedNodeIds.has(sourceId) || !selectedNodeIds.has(targetId));
              return focusDimmed ? hexToRgba(color, 0.12) : color;
            }}
            linkWidth={(link: any) => {
              const baseWidth = getRelationshipStyle(link.type).width;
              const sourceId = getLinkEndpointId(link.source);
              const targetId = getLinkEndpointId(link.target);
              if (selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id)) {
                return baseWidth + 1;
              }
              return baseWidth;
            }}
            linkLineDash={(link: any) => getRelationshipStyle(link.type).dash || null}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkCurvature={0.15}
            linkDirectionalParticles={(link: any) => {
              const sourceId = getLinkEndpointId(link.source);
              const targetId = getLinkEndpointId(link.target);
              if (selectedNode && sourceId !== selectedNode.id && targetId !== selectedNode.id) return 0;
              return Math.max(1, Math.round((link.weight || 1) * 2));
            }}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleWidth={(link: any) => Math.max(1.5, (link.weight || 1) * 1.2)}
            linkDirectionalParticleColor={(link: any) => link.color}
            onNodeClick={handleNodeClick}
            onNodeHover={(node: any) => setHovered(node?.id || null)}
            onBackgroundClick={() => { setSelectedNode(null); setSelectedNodeIds(new Set()); }}
            backgroundColor="#0a0b12"
            // 2D 模式配置
            {...(!is3D && {
              nodeCanvasObject,
              nodeCanvasObjectMode: () => "replace",
            })}
            // 3D 模式配置
            {...(is3D && {
              nodeThreeObjectExtend: true,
              nodeThreeObject,
            })}
            // 力导向参数
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            warmupTicks={100}
            cooldownTicks={200}
          />
        )}
      </div>

      {/* 详情面板（仅单选时显示） */}
      {selectedNode && !isMultiSelect && !gAnswer && (
        <div className="absolute bottom-4 left-4 right-4 z-20 max-h-[55vh] bg-gray-950/95 border border-white/10 p-4 overflow-y-auto md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:w-80 md:max-h-none md:border-l">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-cyan-400">{t("graph.title")}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* 操作工具栏 */}
          {!editMode && !mergeMode && (
            <div className="flex items-center gap-1.5 mb-4 pb-3 border-b border-white/5">
              <button
                onClick={enterEditMode}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 bg-cyan-950/30 hover:bg-cyan-900/40 border border-cyan-800/40 rounded-lg disabled:opacity-40 transition-colors"
                title={t('graph.edit_tooltip')}
              >
                <Pencil className="w-3.5 h-3.5" />
                {t('graph.edit')}
              </button>
              <button
                onClick={() => { setMergeMode(true); setMergeQuery(""); }}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-300 hover:text-purple-200 bg-purple-950/30 hover:bg-purple-900/40 border border-purple-800/40 rounded-lg disabled:opacity-40 transition-colors"
                title={t('graph.merge_tooltip')}
              >
                <GitMerge className="w-3.5 h-3.5" />
                {t('graph.merge')}
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-300 hover:text-red-200 bg-red-950/30 hover:bg-red-900/40 border border-red-800/40 rounded-lg ml-auto disabled:opacity-40 transition-colors"
                title={t('graph.delete_tooltip')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('graph.delete')}
              </button>
            </div>
          )}

          {/* provenance：外部 AI 写入的记忆给出来源提示，便于用户识别非本人沉淀 */}
          {!editMode && !mergeMode && (selectedNode as any).metadata?.provenance?.source === 'external_ai' && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-700/30 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
              <Bot className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{t('graph.provenance_external').replace('{tool}', (selectedNode as any).metadata.provenance.tool || 'MCP')}</span>
            </div>
          )}

          {/* 合并选择器 */}
          {mergeMode && (
            <div className="mb-4 p-3 border border-purple-800/40 bg-purple-950/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-purple-300 font-medium flex items-center gap-1">
                  <GitMerge className="w-3.5 h-3.5" />
                  {t('graph.merge_target')}
                </span>
                <button
                  onClick={() => { setMergeMode(false); setMergeQuery(""); }}
                  className="text-gray-400 hover:text-white"
                  title={t('graph.cancel')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                value={mergeQuery}
                onChange={(e) => setMergeQuery(e.target.value)}
                placeholder={t('graph.merge_search_placeholder')}
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-gray-500 outline-none focus:border-purple-500/60"
              />
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {mergeCandidates.length === 0 && (
                  <li className="text-xs text-gray-500 px-2 py-1">{t('graph.merge_no_results')}</li>
                )}
                {mergeCandidates.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => handleMerge(e.id)}
                      disabled={busy}
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 hover:bg-purple-900/30 border border-transparent hover:border-purple-700/40 disabled:opacity-40 transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getThemeColor(e.type) }}
                      />
                      <span className="text-xs text-gray-200 truncate flex-1">{e.name}</span>
                      <span className="text-[10px] text-gray-500 shrink-0">{e.type.replace(/_/g, " ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 编辑表单 */}
          {editMode && (
            <div className="mb-4 p-3 border border-cyan-800/40 bg-cyan-950/20 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-cyan-300 font-medium flex items-center gap-1">
                  <Pencil className="w-3.5 h-3.5" />
                  {t('graph.edit_node')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSaveEdit}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-green-300 hover:bg-green-900/30 rounded disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t('graph.save')}
                  </button>
                  <button
                    onClick={exitEditMode}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:bg-white/10 rounded disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('graph.cancel')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">{t('graph.name')}</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/60"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">{t('graph.type')}</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/60"
                >
                  {Object.keys(TYPE_COLORS).map((tp) => (
                    <option key={tp} value={tp}>{tp.replace(/_/g, " ")}</option>
                  ))}
                  {/* 当前类型不在预设列表里时也保留 */}
                  {!TYPE_COLORS[editType] && editType && (
                    <option value={editType}>{editType}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">{t('graph.description')}</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/60 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">{t('graph.tags_comma')}</label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder={t('graph.tags_placeholder')}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-gray-500 outline-none focus:border-cyan-500/60"
                />
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <span className="text-xs text-gray-500 uppercase">{t("app.title")}</span>
              <p className="text-white font-medium">{selectedNode.name}</p>
            </div>

            <div>
              <span className="text-xs text-gray-500 uppercase">{t("graph.type")}</span>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10"
                  style={{ color: getThemeColor(selectedNode.type) }}
                >
                  {TYPE_ICONS[selectedNode.type] || <Info className="w-4 h-4" />}
                </div>
                <span style={{ color: getThemeColor(selectedNode.type) }}>{selectedNode.type.replace(/_/g, " ")}</span>
              </div>
            </div>

            {selectedNode.description && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t("graph.description")}</span>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">{selectedNode.description}</p>
              </div>
            )}

            {/* 连接数 */}
            <div>
              <span className="text-xs text-gray-500 uppercase">{t('graph.connections_label')}</span>
              <p className="text-purple-400 font-mono">
                {t('graph.connections_suffix').replace('{count}', String(connectionCounts[selectedNode.id] || 0))}
              </p>
            </div>

            {/* 访问频率 */}
            <div>
              <span className="text-xs text-gray-500 uppercase">{t('graph.access_frequency')}</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (selectedNode.access_count || 0) * 5)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-gray-400 font-mono">
                  {selectedNode.access_count || 0}
                </span>
              </div>
            </div>

            {selectedNode.source_file && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t("graph.source_file")}</span>
                <p className="text-gray-300 text-sm font-mono truncate">{selectedNode.source_file}</p>
              </div>
            )}

            {selectedNode.tags && selectedNode.tags.length > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t("graph.tags")}</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {selectedNode.tags.map((tag, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveTag(tag)}
                      className="px-2 py-0.5 bg-cyan-900/30 text-cyan-400 text-xs rounded-full border border-cyan-800/50 hover:bg-cyan-800/40 hover:text-cyan-200 transition-colors"
                      title={t('graph.filter_by_tag')}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 邻居列表 */}
            {neighbors.length > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t('graph.neighbors_label').replace('{count}', String(neighbors.length))}</span>
                <ul className="mt-1 space-y-1 max-h-48 overflow-y-auto pr-1">
                  {neighbors.map((n, i) => (
                    <li key={`${n.entity.id}-${i}`}>
                      <button
                        onClick={() => focusNodeById(n.entity.id)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/5 hover:bg-cyan-900/20 border border-transparent hover:border-cyan-800/40 transition-colors group"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getThemeColor(n.entity.type) }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs text-gray-200 group-hover:text-cyan-300 truncate">
                            {n.entity.name}
                          </span>
                          <span className="block text-[10px] text-gray-500">
                            {n.direction === "out" ? "→" : "←"} {n.type.replace(/_/g, " ")}
                          </span>
                        </span>
                        <span
                          className="text-[10px] text-gray-500 font-mono shrink-0"
                          title={t('graph.relationship_weight')}
                        >
                          w{n.weight.toFixed(1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Embedding 状态 */}
            <div>
              <span className="text-xs text-gray-500 uppercase">{t('graph.vector_index')}</span>
              <p className={`text-sm ${selectedNode.embedding ? "text-green-400" : "text-gray-600"}`}>
                {selectedNode.embedding
                  ? t('graph.indexed').replace('{dims}', String(selectedNode.embedding.length))
                  : t('graph.not_indexed')}
              </p>
            </div>

            {/* 最后访问 + 衰减提示 */}
            {selectedNode.last_accessed && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t('graph.last_accessed')}</span>
                <p className="text-gray-300 text-sm">
                  {relativeTime(selectedNode.last_accessed)}
                  <span className="text-gray-500 text-xs ml-2">
                    ({new Date(selectedNode.last_accessed).toLocaleString()})
                  </span>
                </p>
                {(() => {
                  const days = (Date.now() - new Date(selectedNode.last_accessed).getTime()) / 86400000;
                  if (days > 30) {
                    return (
                      <p className="text-amber-400/80 text-[11px] mt-1">
                        {t('graph.long_idle')}
                      </p>
                    );
                  }
                  if (days > 7) {
                    return <p className="text-gray-500 text-[11px] mt-1">{t('graph.recent_idle')}</p>;
                  }
                  return null;
                })()}
              </div>
            )}

            <div>
              <span className="text-xs text-gray-500 uppercase">{t("graph.created_at")}</span>
              <p className="text-gray-400 text-sm">
                {relativeTime(selectedNode.created_at)}
                <span className="text-gray-500 text-xs ml-2">
                  ({new Date(selectedNode.created_at).toLocaleString()})
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {gAnswer && (
        <aside style={{ width: answerWidth }} className="relative hidden shrink-0 flex-col border-l border-white/10 bg-gray-950/95 md:flex">
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = answerWidth;
              let latest = startW;
              const onMove = (ev: MouseEvent) => { latest = Math.min(720, Math.max(300, startW + (startX - ev.clientX))); setAnswerWidth(latest); };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                try { localStorage.setItem('omni_answer_width', String(latest)); } catch { /* */ }
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-cyan-500/40"
            title="拖动左边缘调整宽度"
          />
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <Brain className="h-4 w-4 text-cyan-300" />
            <h3 className="text-sm font-semibold text-cyan-300">{t('cmd.answer_title')}</h3>
            <button
              onClick={() => { setGAnswer(null); setCmdInput(""); setFollowInput(""); setSelectedNode(null); }}
              className="ml-auto flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-200"
              title={t('cmd.done')}
            >
              <Check className="h-3.5 w-3.5" />
              {t('cmd.done')}
            </button>
          </div>
          <div ref={answerScrollRef} className="flex-1 min-h-0 overflow-y-auto p-4">
            {gAnswer.turns.map((turn, ti) => {
              const isLast = ti === gAnswer.turns.length - 1;
              return (
                <div key={ti} className={ti > 0 ? 'mt-5 border-t border-white/5 pt-5' : ''}>
                  <p className="mb-3 text-xs text-gray-500"><span className="text-gray-600">{t('cmd.you_asked')}</span>{turn.question}</p>
                  <div className="text-base font-semibold leading-relaxed text-white">{turn.conclusion || t('cmd.no_answer')}</div>
                  {turn.questions.length > 0 && (
                    <div className="mt-3 rounded-lg border border-violet-700/30 bg-violet-950/20 p-3">
                      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-violet-300/80">{t('cmd.clarify')}</div>
                      <div className="flex flex-col gap-1.5">
                        {turn.questions.map((q, i) => (
                          <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-violet-100/90">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                            <span>{q}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {turn.reasons.length > 0 && (
                    <>
                      <div className="mt-4 mb-2 text-[11px] uppercase tracking-wider text-gray-500">{t('cmd.reasons')}</div>
                      <div className="flex flex-col gap-2.5">
                        {turn.reasons.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-gray-300">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/80" />
                            <span>
                              {r.text}
                              {r.entityIds.length > 0 && (
                                <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                                  {r.entityIds.map((id) => {
                                    const s = turn.sources.find((x) => x.id === id);
                                    if (!s) return null;
                                    return (
                                      <button
                                        key={id}
                                        onMouseEnter={() => setHovered(id)}
                                        onMouseLeave={() => setHovered(null)}
                                        onClick={() => focusNodeById(id)}
                                        className="inline-flex max-w-[140px] items-center gap-1 rounded-md border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-0.5 text-[11px] text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-900/40"
                                      >
                                        <span className="truncate">{s.name}</span>
                                      </button>
                                    );
                                  })}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {!!turn.conclusion && (
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={() => copyAnswer(turn)} title={t('actions.copy')}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300">
                        <Copy className="h-3 w-3" /> {t('actions.copy')}
                      </button>
                      <button onClick={() => favoriteAnswer(turn)} title={t('actions.favorite')}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:border-yellow-500/40 hover:text-yellow-300">
                        <Bookmark className="h-3 w-3" /> {t('actions.favorite')}
                      </button>
                    </div>
                  )}
                  {isLast && turn.isDecision && !!turn.conclusion && turn.reasons.length > 0 && !turn.savedAsDecision && (
                    <button
                      onClick={saveDecision}
                      disabled={gSaving}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_0_14px_rgba(34,211,238,0.35)] transition-all hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {gSaving ? t('cmd.saving') : t('cmd.save_decision')}
                    </button>
                  )}
                  {turn.savedAsDecision && (
                    <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-green-700/40 bg-green-950/20 px-3 py-2 text-[12.5px] font-medium text-green-300">
                      <Check className="h-3.5 w-3.5" /> {t('cmd.decision_saved')}
                    </div>
                  )}
                </div>
              );
            })}
            {gLoading && (
              <div className={gAnswer.turns.length > 0 ? 'mt-5 border-t border-white/5 pt-5' : ''}>
                {gPendingQ && (
                  <p className="mb-3 text-xs text-gray-500"><span className="text-gray-600">{t('cmd.you_asked')}</span>{gPendingQ}</p>
                )}
                <div className="flex items-center gap-2 text-[13px] text-gray-500">
                  <span className="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                  {t('cmd.thinking')}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 p-3">
            {gLastTurn && gLastTurn.sources.length > 0 && (
              <div className="mb-2 px-1 text-[11px] text-gray-500">{t('cmd.sources_count').replace('{n}', String(gLastTurn.sources.length))}</div>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
              <input
                value={followInput}
                onChange={(e) => setFollowInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); followUp(); } }}
                placeholder={t('cmd.follow_placeholder')}
                disabled={gLoading}
                className="w-full bg-transparent text-[13px] text-gray-100 placeholder:text-gray-500 outline-none disabled:opacity-50"
              />
              {gLoading ? (
                <span className="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              ) : (
                <button onClick={followUp} disabled={!followInput.trim()} className="shrink-0 text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-30" title={t('cmd.send')}>
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      {!selectedNode && !gAnswer && (
        <aside className="hidden w-80 shrink-0 border-l border-white/10 bg-gray-950/95 p-4 md:flex md:flex-col md:gap-4">
          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
          <div>
            <div className="flex items-center gap-2 text-cyan-300">
              <Network className="h-4 w-4" />
              <h3 className="text-sm font-semibold">{t('graph.overview_title')}</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              {graphSummary.totalNodes > 0 ? t('graph.overview_hint') : t('graph.overview_empty_hint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: t('graph.total_nodes'), value: graphSummary.totalNodes, color: 'text-cyan-300' },
              { label: t('graph.total_edges'), value: graphSummary.totalEdges, color: 'text-purple-300' },
              { label: t('graph.type_count'), value: graphSummary.typeCount, color: 'text-yellow-300' },
              { label: t('graph.recent_nodes'), value: graphSummary.recentCount, color: 'text-green-300' },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-white/10 bg-black/25 p-3">
                <div className={`font-mono text-lg font-bold ${item.color}`}>{item.value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>

          {graphSummary.topTypes.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-gray-500">{t('graph.type_distribution')}</span>
                <span className="text-[10px] text-gray-600">{t('graph.click_to_filter')}</span>
              </div>
              <div className="space-y-2">
                {graphSummary.topTypes.map(([type, count]) => {
                  const pct = graphSummary.totalNodes > 0 ? (count / graphSummary.totalNodes) * 100 : 0;
                  const color = getThemeColor(type);
                  return (
                    <button
                      key={type}
                      onClick={() => setActiveType(type)}
                      className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-left hover:border-cyan-500/30 hover:bg-cyan-950/20 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{type.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-[10px] text-gray-500">{count}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {graphSummary.strongestNodes.length > 0 && (
            <div className="shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-gray-500">{t('graph.high_signal_nodes')}</span>
                <span className="text-[10px] text-gray-600">{is3D ? t('graph.camera_hint_3d') : t('graph.camera_hint_2d')}</span>
              </div>
              <div className="space-y-1.5">
                {graphSummary.strongestNodes.map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => focusNodeById(entity.id)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2 text-left hover:border-cyan-500/30 hover:bg-cyan-950/20 transition-colors"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-xs"
                      style={{ color: getThemeColor(entity.type), backgroundColor: hexToRgba(getThemeColor(entity.type), 0.12) }}
                    >
                      {TYPE_GLYPHS[entity.type] || '•'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-gray-200 group-hover:text-cyan-200">{entity.name}</span>
                      <span className="block truncate text-[10px] text-gray-500">{entity.type.replace(/_/g, ' ')} · {connectionCounts[entity.id] || 0} {t('graph.connections_label_html')}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          </div>

          <div className="shrink-0 rounded-lg border border-cyan-500/15 bg-cyan-950/15 p-3">
            <div className="flex items-start gap-2">
              <MousePointer2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
              <p className="text-xs leading-5 text-gray-400">{t('graph.click_to_edit_hint')}</p>
            </div>
          </div>
        </aside>
      )}

      {isMultiSelect && !gAnswer && (
        <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-gray-950/95 px-4 py-3 shadow-2xl shadow-cyan-950/30">
          <div className="flex items-center gap-3">
            <span className="text-sm text-cyan-300 font-medium">
              {t('graph.selected_count').replace('{count}', String(selectedNodeIds.size))}
            </span>
            <div className="flex-1" />
            <button
              onClick={handleBatchDelete}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-300 hover:text-red-200 hover:bg-red-900/30 border border-red-800/40 rounded-lg disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('graph.batch_delete')}
            </button>
            <button
              onClick={() => setShowBatchTagInput((v) => !v)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-300 hover:text-yellow-200 hover:bg-yellow-900/30 border border-yellow-800/40 rounded-lg disabled:opacity-40 transition-colors"
            >
              <Tags className="w-3.5 h-3.5" />
              {t('graph.batch_tag')}
            </button>
            <div className="w-px h-6 bg-white/10" />
            <button
              onClick={() => { setSelectedNodeIds(new Set()); setSelectedNode(null); }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              {t('graph.deselect')} <span className="text-[10px] text-gray-500">Esc</span>
            </button>
          </div>
          {showBatchTagInput && (
            <div className="flex items-center gap-2 border-t border-white/5 pt-2">
              <Tags className="w-3.5 h-3.5 text-yellow-400" />
              <input
                value={batchTagText}
                onChange={(e) => setBatchTagText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBatchTag(); }}
                placeholder={t('graph.batch_tag_placeholder')}
                className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-gray-500 outline-none focus:border-yellow-500/60"
                autoFocus
              />
              <button
                onClick={handleBatchTag}
                disabled={busy || !batchTagText.trim()}
                className="px-2 py-1 text-xs text-yellow-300 hover:bg-yellow-900/30 rounded disabled:opacity-40 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {dialog}
    </div>
  );
}
