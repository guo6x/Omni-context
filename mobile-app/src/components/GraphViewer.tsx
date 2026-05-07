import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Svg, {
  G,
  Circle,
  Line,
  Text as SvgText,
} from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { KnowledgeGraph, KnowledgeNode, KnowledgeEdge } from '@/types';
import { colors } from '@/utils/theme';

interface GraphViewerProps {
  graph: KnowledgeGraph | null;
  onNodePress?: (node: KnowledgeNode) => void;
  selectedNodeId?: string | null;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 1.5;

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
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const nodesWithPositions = useMemo(() => {
    if (!graph) return [];
    return calculateNodePositions(graph.nodes);
  }, [graph]);

  const edges = graph?.edges ?? [];

  // Gesture 对象在每次渲染时重新创建会让 react-native-gesture-handler 反复
  // 注册/卸载 worklet，浪费帧时间。useMemo 让 SharedValue 维持稳定句柄。
  const composedGesture = useMemo(() => {
    const pinchGesture = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = savedScale.value * e.scale;
      })
      .onEnd(() => {
        savedScale.value = scale.value;
      });

    const panGesture = Gesture.Pan()
      .onUpdate((e) => {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      })
      .onEnd(() => {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      });

    return Gesture.Simultaneous(pinchGesture, panGesture);
    // SharedValue 引用本身稳定，依赖留空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

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
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.graphContainer, animatedStyle]}>
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
      </GestureDetector>
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
