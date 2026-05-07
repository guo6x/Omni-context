import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { GraphViewer } from '@/components/GraphViewer';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useHUD } from '@/components/HUD';
import { KnowledgeNode } from '@/types';
import { syncService } from '@/services/syncService';
import { colors } from '@/utils/theme';

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
    addNode,
  } = useKnowledgeGraph();

  const [showNodeModal, setShowNodeModal] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeType, setNewNodeType] = useState<KnowledgeNode['type']>('concept');

  useEffect(() => {
    if (error) {
      showMessage(error, 'error');
    }
  }, [error, showMessage]);

  const handleNodePress = useCallback((node: KnowledgeNode) => {
    setSelectedNode(node);
  }, [setSelectedNode]);

  const handleAddNode = useCallback(async () => {
    if (!newNodeLabel.trim()) {
      showMessage('请输入节点名称', 'warning');
      return;
    }

    try {
      const node: KnowledgeNode = {
        id: Date.now().toString(),
        label: newNodeLabel.trim(),
        type: newNodeType,
        connections: [],
        weight: 1,
        color: colors.nodeTypes[newNodeType],
      };

      await addNode(node);
      setShowNodeModal(false);
      setNewNodeLabel('');
      showMessage('节点添加成功', 'success');
    } catch (err) {
      showMessage((err as Error).message, 'error');
    }
  }, [newNodeLabel, newNodeType, addNode, showMessage]);

  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-white/10">
        <Text className="text-[#e8e8e8] text-2xl font-bold">{t('knowledgeGraph.title')}</Text>
        <TouchableOpacity 
          className="w-9 h-9 rounded-full bg-cyan-400 items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.5)]"
          onPress={() => setShowNodeModal(true)}
        >
          <Text className="text-[#0a0b12] text-2xl font-bold leading-6 mt-[-2px]">+</Text>
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
        <View className="absolute bottom-[100px] left-4 right-4 bg-black/40 rounded-2xl p-4 border border-white/10 backdrop-blur-xl">
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

      <Modal
        visible={showNodeModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNodeModal(false)}
      >
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-[#0a0b12] border-t border-white/10 rounded-t-3xl p-5">
            <Text className="text-[#e8e8e8] text-xl font-bold mb-5 text-center">{t('knowledgeGraph.addNode')}</Text>
            
            <TextInput
              className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-4"
              value={newNodeLabel}
              onChangeText={setNewNodeLabel}
              placeholder="节点名称"
              placeholderTextColor="#64748b"
            />

            <Text className="text-gray-400 text-sm mb-2">{t('knowledgeGraph.type')}</Text>
            <View className="flex-row gap-2 mb-6">
              {(['concept', 'entity', 'topic'] as const).map(type => (
                <TouchableOpacity
                  key={type}
                  className={`flex-1 py-2 rounded-lg items-center border ${newNodeType === type ? 'bg-cyan-500 border-cyan-500' : 'bg-black/40 border-white/10'}`}
                  onPress={() => setNewNodeType(type)}
                >
                  <Text className={`text-sm ${newNodeType === type ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
                    {t(`knowledgeGraph.${type}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row gap-4">
              <TouchableOpacity
                className="flex-1 py-3 rounded-xl bg-black/40 border border-white/10 items-center"
                onPress={() => setShowNodeModal(false)}
              >
                <Text className="text-gray-400 text-base">{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                className="flex-1 py-3 rounded-xl bg-cyan-400 items-center" 
                onPress={handleAddNode}
              >
                <Text className="text-[#0a0b12] text-base font-bold">{t('common.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
