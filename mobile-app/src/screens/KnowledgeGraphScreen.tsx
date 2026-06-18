import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { GraphViewer } from '@/components/GraphViewer';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useHUD } from '@/components/HUD';
import { KnowledgeNode } from '@/types';

export function KnowledgeGraphScreen() {
  const { t } = useTranslation();
  const { showMessage } = useHUD();
  const {
    graph,
    loading,
    error,
    refresh,
    selectedNode,
    setSelectedNode,
  } = useKnowledgeGraph();

  useEffect(() => {
    if (error) {
      showMessage(error, 'error');
    }
  }, [error, showMessage]);

  const handleNodePress = useCallback((node: KnowledgeNode) => {
    setSelectedNode(node);
  }, [setSelectedNode]);

  return (
    <SafeAreaView className="flex-1 bg-[#0b0f12]" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 py-4">
        <View>
          <Text className="text-[#f2f5f4] text-2xl font-bold">{t('knowledgeGraph.title')}</Text>
          <Text className="text-[#77818b] text-sm mt-1">
            {graph?.nodes.length ?? 0} 个节点 · 双指缩放，拖动浏览
          </Text>
        </View>
        <TouchableOpacity
          className="px-3 py-2 rounded-md bg-[#171d21] border border-[#293139]"
          onPress={refresh}
        >
          <Text className="text-[#8fdccb] text-sm font-semibold">刷新</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text className="text-gray-400 mt-4">{t('common.loading')}</Text>
        </View>
      ) : (
        <GraphViewer
          graph={graph}
          onNodePress={handleNodePress}
          selectedNodeId={selectedNode?.id}
        />
      )}

      {selectedNode && (
        <View className="absolute bottom-[82px] left-4 right-4 bg-[#151a1f] rounded-lg p-4 border border-[#2a3239]">
          <View className="flex-row items-center mb-2">
            <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: selectedNode.color || '#22d3ee' }} />
            <Text className="flex-1 text-[#e8e8e8] text-lg font-bold">{selectedNode.label}</Text>
            <TouchableOpacity onPress={() => setSelectedNode(null)}>
              <Text className="text-gray-400 text-2xl leading-6 ml-2">×</Text>
            </TouchableOpacity>
          </View>
          <View className="border-t border-white/10 pt-2">
            <Text className="text-gray-400 text-sm mb-1">
              {t('knowledgeGraph.type')}: {t(`knowledgeGraph.${selectedNode.type}`)}
            </Text>
            <Text className="text-gray-400 text-sm mb-1">
              {t('knowledgeGraph.connections')}: {selectedNode.connections.length}
            </Text>
          </View>
        </View>
      )}

    </SafeAreaView>
  );
}
