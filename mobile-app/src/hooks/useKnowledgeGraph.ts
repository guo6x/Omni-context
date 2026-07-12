import { useState, useEffect, useCallback } from 'react';
import { api } from '@/services/api';
import * as localDb from '@/services/localDb';
import { KnowledgeGraph, KnowledgeNode } from '@/types';

interface UseKnowledgeGraphReturn {
  graph: KnowledgeGraph | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectedNode: KnowledgeNode | null;
  setSelectedNode: (node: KnowledgeNode | null) => void;
}

export function useKnowledgeGraph(): UseKnowledgeGraphReturn {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nodes = await localDb.getKnowledgeNodes();
      const edges = await localDb.getKnowledgeEdges();
      
      if (nodes.length > 0) {
        setGraph({ nodes, edges });
      } else if (api.isConfigured()) {
        const result = await api.getKnowledgeGraph();
        if (result.success && result.data) {
          setGraph(result.data);
          for (const node of result.data.nodes) {
            await localDb.addKnowledgeNode(node);
          }
          for (const edge of result.data.edges) {
            await localDb.addKnowledgeEdge(edge);
          }
        } else {
          setError(result.error ?? 'Failed to load knowledge graph');
          setGraph({ nodes: [], edges: [] });
        }
      } else {
        setGraph({ nodes: [], edges: [] });
      }
    } catch (err) {
      setError((err as Error).message);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  return {
    graph,
    loading,
    error,
    refresh: loadGraph,
    selectedNode,
    setSelectedNode,
  };
}
