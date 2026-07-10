import React, { useMemo, useCallback, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
} from 'react-native';
import Svg, {
  G,
  Circle,
  Line,
  Text as SvgText,
} from 'react-native-svg';
import { KnowledgeGraph, KnowledgeNode } from '@/types';
import { colors } from '@/utils/theme';

interface GraphViewerProps {
  graph: KnowledgeGraph | null;
  onNodePress?: (node: KnowledgeNode) => void;
  selectedNodeId?: string | null;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 1.5;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

function calculateNodePositions(nodes: KnowledgeNode[]): KnowledgeNode[] {
  if (nodes.length === 0) return [];

  const centerX = GRAPH_SIZE / 2;
  const centerY = GRAPH_SIZE / 2;
  const radius = GRAPH_SIZE * 0.35;

  return nodes.map((node, index) => {
    if (node.x !== undefined && node.y !== undefined) {
      return node;
    }
    const angle = (2 * Math.PI * index) / nodes.length;
    return {
      ...node,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
}

export function GraphViewer({ graph, onNodePress, selectedNodeId }: GraphViewerProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const startScale = useRef(1);
  const lastTranslate = useRef({ x: 0, y: 0 });
  const startDistance = useRef<number | null>(null);

  const nodesWithPositions = useMemo(() => {
    if (!graph) return [];
    return calculateNodePositions(graph.nodes);
  }, [graph]);

  const edges = graph?.edges ?? [];

  const panResponder = useMemo(() => {
    const getTouchDistance = (touches: Array<{ pageX: number; pageY: number }>) => {
      if (touches.length < 2) return null;
      const [a, b] = touches;
      return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, gestureState) => (
        event.nativeEvent.touches.length >= 2 ||
        Math.abs(gestureState.dx) > 4 ||
        Math.abs(gestureState.dy) > 4
      ),
      onPanResponderGrant: (event) => {
        startScale.current = lastScale.current;
        startDistance.current = getTouchDistance(event.nativeEvent.touches);
      },
      onPanResponderMove: (event, gestureState) => {
        const distance = getTouchDistance(event.nativeEvent.touches);
        if (distance && startDistance.current) {
          const nextScale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, startScale.current * (distance / startDistance.current)),
          );
          scale.setValue(nextScale);
          lastScale.current = nextScale;
          return;
        }

        const nextX = lastTranslate.current.x + gestureState.dx;
        const nextY = lastTranslate.current.y + gestureState.dy;
        translateX.setValue(nextX);
        translateY.setValue(nextY);
      },
      onPanResponderRelease: (_, gestureState) => {
        lastTranslate.current = {
          x: lastTranslate.current.x + gestureState.dx,
          y: lastTranslate.current.y + gestureState.dy,
        };
        startDistance.current = null;
      },
      onPanResponderTerminate: () => {
        startDistance.current = null;
      },
    });
  }, []);

  const animatedStyle = {
    transform: [
      { translateX },
      { translateY },
      { scale },
    ],
  };

  const handleNodePress = useCallback((node: KnowledgeNode) => {
    onNodePress?.(node);
  }, [onNodePress]);

  if (!graph || nodesWithPositions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无知识节点</Text>
        <Text style={styles.emptySubtext}>添加记忆后将自动生成知识图谱</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.graphContainer, animatedStyle]}
        {...panResponder.panHandlers}
      >
        <Svg width={GRAPH_SIZE} height={GRAPH_SIZE}>
          <G>
            {edges.map(edge => {
              const sourceNode = nodesWithPositions.find(n => n.id === edge.source);
              const targetNode = nodesWithPositions.find(n => n.id === edge.target);
              if (!sourceNode || !targetNode) return null;
              const sourceX = sourceNode.x ?? GRAPH_SIZE / 2;
              const sourceY = sourceNode.y ?? GRAPH_SIZE / 2;
              const targetX = targetNode.x ?? GRAPH_SIZE / 2;
              const targetY = targetNode.y ?? GRAPH_SIZE / 2;

              return (
                <Line
                  key={edge.id}
                  x1={sourceX}
                  y1={sourceY}
                  x2={targetX}
                  y2={targetY}
                  stroke={colors.textMuted}
                  strokeWidth={1 + edge.weight * 0.5}
                  opacity={0.3}
                />
              );
            })}
          </G>

          <G>
            {nodesWithPositions.map(node => {
              const isSelected = selectedNodeId === node.id;
              const nodeRadius = 20 + node.weight * 5;
              const nodeX = node.x ?? GRAPH_SIZE / 2;
              const nodeY = node.y ?? GRAPH_SIZE / 2;

              return (
                <G key={node.id}>
                  {isSelected && (
                    <Circle
                      cx={nodeX}
                      cy={nodeY}
                      r={nodeRadius + 8}
                      fill="none"
                      stroke={colors.primary}
                      strokeWidth={2}
                      opacity={0.5}
                    />
                  )}
                  <Circle
                    cx={nodeX}
                    cy={nodeY}
                    r={nodeRadius}
                    fill={node.color}
                    onPress={() => handleNodePress(node)}
                  />
                  <SvgText
                    x={nodeX}
                    y={nodeY + nodeRadius + 15}
                    fill={colors.text}
                    fontSize={12}
                    textAnchor="middle"
                  >
                    {node.label.length > 10 ? `${node.label.slice(0, 10)}...` : node.label}
                  </SvgText>
                </G>
              );
            })}
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graphContainer: {
    width: GRAPH_SIZE,
    height: GRAPH_SIZE,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
