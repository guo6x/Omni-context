"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Brain, Code, FileText, Zap, Shield, TrendingUp, Info, Maximize2, RotateCcw } from "lucide-react";
import { Entity, Relationship } from "@shared/types";
import { useTranslation } from "@/hooks/useTranslation";

// 3D 图谱节点数据结构
interface GraphNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  val: number; // 节点大小
  color: string;
  accessCount: number;
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

interface GraphViewer3DProps {
  entities: Entity[];
  relationships: Relationship[];
}

export default function GraphViewer3D({ entities, relationships }: GraphViewer3DProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ForceGraph, setForceGraph] = useState<any>(null);
  const [is3D, setIs3D] = useState(true);

  // 动态加载 3D 图谱库
  useEffect(() => {
    const loadGraph = async () => {
      try {
        if (is3D) {
          const mod = await import("react-force-graph-3d");
          setForceGraph(() => mod.default);
        } else {
          const mod = await import("react-force-graph-2d");
          setForceGraph(() => mod.default);
        }
      } catch {
        // 如果 3D 库不可用，回退到 2D
        try {
          const mod = await import("react-force-graph-2d");
          setForceGraph(() => mod.default);
          setIs3D(false);
        } catch {
          console.error("[GraphViewer3D] 图谱库加载失败");
        }
      }
    };
    loadGraph();
  }, [is3D]);

  // 将 entities 和 relationships 转化为图谱数据
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      // 节点大小根据 access_count 动态调整
      val: Math.max(2, Math.min(15, (entity.access_count || 0) + 3)),
      color: TYPE_COLORS[entity.type] || "#94a3b8",
      accessCount: entity.access_count || 0,
    }));

    const nodeIds = new Set(entities.map((e) => e.id));
    const links: GraphLink[] = relationships
      .filter((rel) => nodeIds.has(rel.source_id) && nodeIds.has(rel.target_id))
      .map((rel) => ({
        source: rel.source_id,
        target: rel.target_id,
        type: rel.type,
        description: rel.description,
        weight: rel.weight,
        // 边的颜色根据权重变化（权重越高越亮）
        color: `rgba(34, 211, 238, ${Math.min(1, (rel.weight || 1) * 0.3 + 0.2)})`,
      }));

    return { nodes, links };
  }, [entities, relationships]);

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
      }
    },
    [entities, is3D]
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
      const label = node.name;
      const fontSize = Math.max(10 / globalScale, 3);
      const nodeSize = node.val || 5;

      // 绘制节点光晕
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeSize + 2, 0, 2 * Math.PI);
      ctx.fillStyle = `${node.color}33`;
      ctx.fill();

      // 绘制节点
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
      ctx.fillStyle = node.id === hovered ? "#ffffff" : node.color;
      ctx.fill();
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();

      // 绘制标签
      if (globalScale > 0.5) {
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = node.id === hovered ? "#22d3ee" : "#e2e8f0";
        ctx.fillText(label, node.x, node.y + nodeSize + 3);
      }
    },
    [hovered]
  );

  // 节点3D标签
  const nodeThreeObject = useCallback((node: any) => {
    // 3D 模式使用 CSS2D 标签
    if (typeof window === "undefined") return null;
    try {
      const { CSS2DObject } = require("three/examples/jsm/renderers/CSS2DRenderer");
      const div = document.createElement("div");
      div.textContent = node.name;
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

  if (!ForceGraph) {
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
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <button
            onClick={() => setIs3D(!is3D)}
            className="px-3 py-1.5 bg-gray-900/90 border border-gray-700 rounded-lg text-xs text-cyan-400 hover:bg-gray-800 transition-colors"
          >
            {is3D ? "2D 模式" : "3D 模式"}
          </button>
          <button
            onClick={handleResetCamera}
            className="px-3 py-1.5 bg-gray-900/90 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            重置视角
          </button>
        </div>

        {/* 图例 */}
        <div className="absolute bottom-4 left-4 z-10 bg-gray-900/90 border border-gray-700 rounded-lg p-3 max-w-[200px]">
          <p className="text-xs text-gray-500 mb-2 uppercase font-medium">图例</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(TYPE_COLORS)
              .filter(([type]) => entities.some((e) => e.type === type))
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
        <div className="absolute top-4 right-4 z-10 bg-gray-900/90 border border-gray-700 rounded-lg p-3">
          <div className="flex gap-4 text-xs">
            <div>
              <span className="text-gray-500">节点</span>
              <p className="text-cyan-400 font-mono font-bold">{entities.length}</p>
            </div>
            <div>
              <span className="text-gray-500">关系</span>
              <p className="text-purple-400 font-mono font-bold">{relationships.length}</p>
            </div>
          </div>
        </div>

        {/* 3D/2D 图谱 */}
        <ForceGraph
          ref={graphRef}
          graphData={graphData}
          nodeId="id"
          nodeLabel={(node: any) => `${node.name} (${node.type})`}
          nodeVal={(node: any) => node.val}
          nodeColor={(node: any) => node.color}
          linkSource="source"
          linkTarget="target"
          linkLabel={(link: any) => link.type.replace(/_/g, " ")}
          linkColor={(link: any) => link.color}
          linkWidth={(link: any) => Math.max(0.5, (link.weight || 1) * 1.5)}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.15}
          onNodeClick={handleNodeClick}
          onNodeHover={(node: any) => setHovered(node?.id || null)}
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
      </div>

      {/* 详情面板 */}
      {selectedNode && (
        <div className="w-80 glass-panel border-l border-white/10 p-4 overflow-y-auto bg-gray-950/95">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-cyan-400">{t("graph.title")}</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <span className="text-xs text-gray-500 uppercase">{t("app.title")}</span>
              <p className="text-white font-medium">{selectedNode.name}</p>
            </div>

            <div>
              <span className="text-xs text-gray-500 uppercase">{t("graph.type")}</span>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[selectedNode.type] || "#94a3b8" }}
                />
                <span className="text-cyan-400">{selectedNode.type.replace(/_/g, " ")}</span>
              </div>
            </div>

            {selectedNode.description && (
              <div>
                <span className="text-xs text-gray-500 uppercase">{t("graph.description")}</span>
                <p className="text-gray-300 text-sm">{selectedNode.description}</p>
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
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-cyan-900/30 text-cyan-400 text-xs rounded-full border border-cyan-800/50"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
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

            <div>
              <span className="text-xs text-gray-500 uppercase">{t("graph.created_at")}</span>
              <p className="text-gray-400 text-sm">
                {new Date(selectedNode.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {!selectedNode && (
        <div className="w-80 glass-panel border-l border-white/10 p-4 flex items-center justify-center bg-gray-950/95">
          <div className="text-center">
            <Maximize2 className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">{t("graph.no_selection")}</p>
            <p className="text-gray-600 text-xs mt-1">
              {is3D ? "左键拖拽旋转，右键平移，滚轮缩放" : "拖拽平移，滚轮缩放"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
