"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Brain, Code, FileText, Zap, Shield, TrendingUp, Info, Maximize2, RotateCcw, Search, Network, MousePointer2, Pencil, Trash2, GitMerge, Check, X, GitBranch, Clock } from "lucide-react";
import { Entity, Relationship } from "@shared/types";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ConfirmDialog";

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

function relativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} 个月前`;
  const yr = Math.floor(mo / 12);
  return `${yr} 年前`;
}

interface GraphViewer3DProps {
  entities: Entity[];
  relationships: Relationship[];
  onDataChanged?: () => void;
}

const BRAIN_URL = "http://localhost:3001";

export default function GraphViewer3D({ entities, relationships, onDataChanged }: GraphViewer3DProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ForceGraph, setForceGraph] = useState<any>(null);
  const [is3D, setIs3D] = useState(true);
  const [query, setQuery] = useState("");
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

  // 将 entities 和 relationships 转化为图谱数据
  const graphData = useMemo(() => {
    // 先算每个节点的连接数（用于节点大小 + 详情面板）
    const connCount: Record<string, number> = {};
    relationships.forEach((r) => {
      connCount[r.source_id] = (connCount[r.source_id] || 0) + 1;
      connCount[r.target_id] = (connCount[r.target_id] || 0) + 1;
    });

    const nodes: GraphNode[] = visibleEntities.map((entity) => {
      const conn = connCount[entity.id] || 0;
      // 大小综合 access_count + 连接度：枢纽节点更大，孤立节点小
      const score = (entity.access_count || 0) * 0.6 + conn * 1.2;
      return {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        val: Math.max(4, Math.min(25, score + 5)),
        color: TYPE_COLORS[entity.type] || "#94a3b8",
        glyph: TYPE_GLYPHS[entity.type] || '•',
        accessCount: entity.access_count || 0,
        connections: conn,
        lastAccessed: entity.last_accessed,
      };
    });

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
      const base = RELATIONSHIP_COLORS[rel.type] || '#64748b';
      // 透明度反映权重，让强关系更亮
      const alpha = Math.min(1, (rel.weight || 1) * 0.35 + 0.35);
      const color = hexToRgba(base, alpha);
      return {
        source: rel.source_id,
        target: rel.target_id,
        type: rel.type,
        description: rel.description,
        weight: rel.weight,
        color,
      };
    });

    return { nodes, links };
  }, [relationships, visibleEntities, mstMode]);

  const handleNodeClick = useCallback(
    (node: any) => {
      const entity = entities.find((e) => e.id === node.id);
      setSelectedNode(entity || null);

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
      const res = await fetch(`${BRAIN_URL}/api/entities/${selectedNode.id}`, {
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
      toast.success("已保存", `${editName} 更新成功`);
      setEditMode(false);
      onDataChanged?.();
    } catch (err) {
      toast.error("保存失败", String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedNode, busy, editName, editType, editDesc, editTags, toast, onDataChanged]);

  const handleDelete = useCallback(async () => {
    if (!selectedNode || busy) return;
    const ok = await confirm({
      title: "删除节点",
      message: `确认删除节点 "${selectedNode.name}"？\n\n它的所有关系也会一起被清除，操作不可撤销。`,
      confirmText: "删除",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`${BRAIN_URL}/api/entities/${selectedNode.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("已删除", `${selectedNode.name} 及其关系已移除`);
      setSelectedNode(null);
      onDataChanged?.();
    } catch (err) {
      toast.error("删除失败", String(err));
    } finally {
      setBusy(false);
    }
  }, [selectedNode, busy, toast, onDataChanged, confirm]);

  const handleMerge = useCallback(
    async (targetId: string) => {
      if (!selectedNode || busy) return;
      const target = entities.find((e) => e.id === targetId);
      if (!target) return;
      const ok = await confirm({
        title: "合并节点",
        message: `把 "${selectedNode.name}" 合并到 "${target.name}"？\n\n源节点的关系和标签会迁移到目标节点，源节点会被删除。`,
        confirmText: "合并",
        destructive: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await fetch(`${BRAIN_URL}/api/entities/${selectedNode.id}/merge`, {
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
          "合并完成",
          `迁移 ${data.moved} 条关系，丢弃 ${data.dropped} 条自环`
        );
        setMergeMode(false);
        setMergeQuery("");
        // 切换选中到合并目标
        setSelectedNode(target);
        onDataChanged?.();
      } catch (err) {
        toast.error("合并失败", String(err));
      } finally {
        setBusy(false);
      }
    },
    [selectedNode, busy, entities, toast, onDataChanged, confirm]
  );

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
  }, [selectedNode?.id]);

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
      const isSelected = selectedNode?.id === node.id;
      // 选中某个节点时，其它节点会被淡化以突出焦点
      const dimmed = !!selectedNode && !isSelected && !isHover;
      const sizeScale = isHover || isSelected ? 1.25 : 1;
      const nodeSize = (node.val || 5) * sizeScale;

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

      // 边框
      ctx.lineWidth = (isHover || isSelected ? 2.5 : 1.5) / globalScale;
      ctx.strokeStyle = isHover || isSelected ? '#ffffff' : hexToRgba(node.color, dimmed ? 0.3 : 0.9);
      ctx.stroke();

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
    [hovered, selectedNode]
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

  // 连接关系数统计
  const connectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    relationships.forEach((r) => {
      counts[r.source_id] = (counts[r.source_id] || 0) + 1;
      counts[r.target_id] = (counts[r.target_id] || 0) + 1;
    });
    return counts;
  }, [relationships]);

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
      ? String(node.description).replace(/</g, "&lt;").slice(0, 140)
      : "";
    const type = String(node.type || "").replace(/_/g, " ");
    const last = node.lastAccessed ? relativeTime(node.lastAccessed) : "";
    return `
      <div style="
        background:rgba(10,11,18,0.95);
        border:1px solid rgba(125,249,255,0.25);
        border-radius:8px;
        padding:8px 10px;
        max-width:260px;
        font-family:Inter,sans-serif;
        color:#e2e8f0;
        box-shadow:0 8px 24px rgba(0,0,0,0.4);
      ">
        <div style="color:#7df9ff;font-weight:600;font-size:12px;">${safeName}</div>
        <div style="color:#94a3b8;font-size:10px;margin-top:2px;">${type} · ${node.connections} 连接 · ${node.accessCount} 次访问${last ? ` · ${last}` : ""}</div>
        ${safeDesc ? `<div style="color:#cbd5e1;font-size:11px;margin-top:6px;line-height:1.4;">${safeDesc}</div>` : ""}
      </div>
    `;
  }, []);

  if (graphLoadError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0b12]">
        <div className="text-center max-w-md px-6">
          <div className="text-red-400 text-sm mb-2">图谱引擎加载失败</div>
          <p className="text-xs text-gray-400 mb-4">
            可能是 react-force-graph 包损坏或内嵌资源缺失。错误信息：
          </p>
          <pre className="text-[10px] text-gray-500 bg-black/40 p-3 rounded text-left overflow-auto max-h-32">
            {graphLoadError}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-1.5 text-xs text-cyan-400 border border-cyan-800 rounded hover:bg-cyan-900/20"
          >
            刷新页面重试
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
          <p className="text-gray-400 text-sm">正在加载 3D 图谱引擎...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 图谱主区域 */}
      <div className="flex-1 relative" ref={containerRef}>
        {/* 控制栏 */}
        <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 max-w-md items-center gap-2 rounded-lg border border-white/10 bg-gray-950/90 px-3 py-2 shadow-2xl shadow-black/30">
            <Search className="h-4 w-4 text-cyan-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索节点 · Enter 跳到第一个匹配"
              className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 outline-none"
            />
          </div>
          <select
            value={activeType}
            onChange={(event) => setActiveType(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-gray-950/90 px-3 text-xs text-gray-200 outline-none hover:border-cyan-500/40"
            aria-label="筛选节点类型"
          >
            <option value="all">全部类型</option>
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
              aria-label="筛选标签"
            >
              <option value="all">全部标签</option>
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
            {is3D ? "2D 模式" : "3D 模式"}
          </button>
          <button
            onClick={handleResetCamera}
            className="h-9 px-3 bg-gray-950/90 border border-white/10 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            重置视角
          </button>
          <button
            onClick={() => setMstMode((v) => !v)}
            className={`h-9 px-3 rounded-lg text-xs border transition-colors flex items-center gap-1 ${
              mstMode
                ? "bg-cyan-900/40 border-cyan-700/50 text-cyan-300"
                : "bg-gray-950/90 border-white/10 text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40"
            }`}
            title="只保留最强骨架关系，裁掉冗余边"
          >
            <GitBranch className="w-3 h-3" />
            {mstMode ? "骨架视图" : "完整视图"}
          </button>
          {timeBounds && (
            <button
              onClick={() => setShowTimeSlider((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs border transition-colors flex items-center gap-1 ${
                showTimeSlider || timeFilter !== null
                  ? "bg-cyan-900/40 border-cyan-700/50 text-cyan-300"
                  : "bg-gray-950/90 border-white/10 text-gray-300 hover:text-white hover:bg-gray-900 hover:border-cyan-500/40"
              }`}
              title="按创建时间回放图谱演化"
            >
              <Clock className="w-3 h-3" />
              时间轴
            </button>
          )}
        </div>

        {/* 时间轴面板 */}
        {showTimeSlider && timeBounds && (
          <div className="absolute top-[60px] left-4 right-4 z-10 flex items-center gap-3 rounded-lg border border-white/10 bg-gray-950/95 px-4 py-2.5 shadow-2xl shadow-black/30">
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
              aria-label="时间轴筛选"
            />
            <span className="shrink-0 text-xs text-gray-300 font-mono w-[150px] text-right">
              {timeFilter === null
                ? "全部时间"
                : `≤ ${new Date(timeFilter).toLocaleDateString()} ${new Date(timeFilter).toLocaleTimeString()}`}
            </span>
            <button
              onClick={() => setTimeFilter(null)}
              disabled={timeFilter === null}
              className="shrink-0 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title="清除时间筛选"
            >
              重置
            </button>
          </div>
        )}

        {/* 图例 */}
        <div className="absolute bottom-4 left-4 z-10 bg-gray-950/90 border border-white/10 rounded-lg p-3 max-w-[240px] shadow-2xl shadow-black/30">
          <p className="text-xs text-gray-500 mb-2 uppercase font-medium">图例</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(TYPE_COLORS)
              .filter(([type]) => visibleEntities.some((e) => e.type === type))
              .map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[10px] text-gray-400 truncate">
                    {type.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* 统计信息 */}
        <div className="absolute bottom-4 right-4 z-10 bg-gray-950/90 border border-white/10 rounded-lg p-3 shadow-2xl shadow-black/30">
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-gray-500">可见节点</span>
              <p className="text-cyan-400 font-mono font-bold">{visibleEntities.length}</p>
            </div>
            <div>
              <span className="text-gray-500">可见关系</span>
              <p className="text-purple-400 font-mono font-bold">{graphData.links.length}</p>
            </div>
          </div>
        </div>

        {graphData.nodes.length === 0 && (
          <div className="absolute inset-0 z-[9] flex items-center justify-center bg-[#0a0b12]/70 px-6 backdrop-blur-sm">
            <div className="max-w-lg rounded-xl border border-cyan-500/20 bg-gray-950/85 p-6 text-center shadow-2xl shadow-cyan-950/30">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
                <Network className="h-6 w-6 text-cyan-300" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                {entities.length === 0 ? "还没有可视化节点" : "没有匹配的节点"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                {entities.length === 0
                  ? "使用沉淀快捷键、浏览器插件或移动端同步内容后，这里会显示实体、证据、原则和它们之间的关系。"
                  : "调整搜索词或节点类型筛选，图谱会实时恢复匹配的上下文。"}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-left text-xs text-gray-400">
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <Brain className="mb-2 h-4 w-4 text-cyan-300" />
                  捕获内容
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <Zap className="mb-2 h-4 w-4 text-yellow-300" />
                  提取关系
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <MousePointer2 className="mb-2 h-4 w-4 text-purple-300" />
                  点击探索
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3D/2D 图谱 */}
        {ForceGraph && graphData.nodes.length > 0 && (
          <ForceGraph
            ref={graphRef}
            graphData={graphData}
            nodeId="id"
            nodeLabel={nodeLabelHtml}
            nodeVal={(node: any) => node.val}
            nodeColor={(node: any) => node.color}
            linkSource="source"
            linkTarget="target"
            linkLabel={(link: any) => `${link.type.replace(/_/g, " ")} · w=${(link.weight || 1).toFixed(2)}`}
            linkColor={(link: any) => link.color}
            linkWidth={(link: any) => Math.max(0.5, (link.weight || 1) * 1.5)}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkCurvature={0.15}
            linkDirectionalParticles={(link: any) => Math.max(1, Math.round((link.weight || 1) * 2))}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleWidth={(link: any) => Math.max(1.5, (link.weight || 1) * 1.2)}
            linkDirectionalParticleColor={(link: any) => link.color}
            onNodeClick={handleNodeClick}
            onNodeHover={(node: any) => setHovered(node?.id || null)}
            onBackgroundClick={() => setSelectedNode(null)}
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

      {/* 详情面板 */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 right-4 z-20 max-h-[55vh] glass-panel border border-white/10 p-4 overflow-y-auto bg-gray-950/95 md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:w-80 md:max-h-none md:border-l">
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
            <div className="flex items-center gap-1 mb-4 pb-3 border-b border-white/5">
              <button
                onClick={enterEditMode}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-cyan-300 hover:bg-cyan-900/20 rounded-md disabled:opacity-40 transition-colors"
                title="编辑节点"
              >
                <Pencil className="w-3.5 h-3.5" />
                编辑
              </button>
              <button
                onClick={() => { setMergeMode(true); setMergeQuery(""); }}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-purple-300 hover:bg-purple-900/20 rounded-md disabled:opacity-40 transition-colors"
                title="合并到另一个节点"
              >
                <GitMerge className="w-3.5 h-3.5" />
                合并
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-red-300 hover:bg-red-900/20 rounded-md disabled:opacity-40 transition-colors ml-auto"
                title="删除节点（连同关系）"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </button>
            </div>
          )}

          {/* 合并选择器 */}
          {mergeMode && (
            <div className="mb-4 p-3 border border-purple-800/40 bg-purple-950/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-purple-300 font-medium flex items-center gap-1">
                  <GitMerge className="w-3.5 h-3.5" />
                  选择合并目标
                </span>
                <button
                  onClick={() => { setMergeMode(false); setMergeQuery(""); }}
                  className="text-gray-400 hover:text-white"
                  title="取消"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                value={mergeQuery}
                onChange={(e) => setMergeQuery(e.target.value)}
                placeholder="搜索目标节点名称 / 类型"
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-gray-500 outline-none focus:border-purple-500/60"
              />
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {mergeCandidates.length === 0 && (
                  <li className="text-xs text-gray-500 px-2 py-1">无匹配节点</li>
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
                        style={{ backgroundColor: TYPE_COLORS[e.type] || "#94a3b8" }}
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
                  编辑节点
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSaveEdit}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-green-300 hover:bg-green-900/30 rounded disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    保存
                  </button>
                  <button
                    onClick={exitEditMode}
                    disabled={busy}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:bg-white/10 rounded disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                    取消
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">名称</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/60"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">类型</label>
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
                <label className="block text-[10px] text-gray-500 uppercase mb-1">描述</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500/60 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">标签（逗号分隔）</label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="tag1, tag2, tag3"
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
                  style={{ color: TYPE_COLORS[selectedNode.type] || "#94a3b8" }}
                >
                  {TYPE_ICONS[selectedNode.type] || <Info className="w-4 h-4" />}
                </div>
                <span className="text-cyan-400">{selectedNode.type.replace(/_/g, " ")}</span>
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
              <span className="text-xs text-gray-500 uppercase">连接数</span>
              <p className="text-purple-400 font-mono">
                {connectionCounts[selectedNode.id] || 0} 条关系
              </p>
            </div>

            {/* 访问频率 */}
            <div>
              <span className="text-xs text-gray-500 uppercase">访问频率</span>
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
                      title="点击按此标签筛选"
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
                <span className="text-xs text-gray-500 uppercase">邻居 ({neighbors.length})</span>
                <ul className="mt-1 space-y-1 max-h-48 overflow-y-auto pr-1">
                  {neighbors.map((n, i) => (
                    <li key={`${n.entity.id}-${i}`}>
                      <button
                        onClick={() => focusNodeById(n.entity.id)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/5 hover:bg-cyan-900/20 border border-transparent hover:border-cyan-800/40 transition-colors group"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: TYPE_COLORS[n.entity.type] || "#94a3b8" }}
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
                          title="关系权重"
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
              <span className="text-xs text-gray-500 uppercase">向量索引</span>
              <p className={`text-sm ${selectedNode.embedding ? "text-green-400" : "text-gray-600"}`}>
                {selectedNode.embedding
                  ? `✓ 已索引 (${selectedNode.embedding.length} 维)`
                  : "✗ 未索引"}
              </p>
            </div>

            {/* 最后访问 + 衰减提示 */}
            {selectedNode.last_accessed && (
              <div>
                <span className="text-xs text-gray-500 uppercase">最后访问</span>
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
                        · 长时间未访问，下次衰减时可能被归档
                      </p>
                    );
                  }
                  if (days > 7) {
                    return <p className="text-gray-500 text-[11px] mt-1">· 近期未访问</p>;
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

      {!selectedNode && (
        <div className="hidden w-80 glass-panel border-l border-white/10 p-4 md:flex items-center justify-center bg-gray-950/95">
          <div className="text-center">
            <Maximize2 className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">{t("graph.no_selection")}</p>
            <p className="text-gray-600 text-xs mt-1">
              {is3D ? "左键拖拽旋转，右键平移，滚轮缩放" : "拖拽平移，滚轮缩放"}
            </p>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
