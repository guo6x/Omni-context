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
import { colors, spacing, typography } from '@/utils/theme';
import { syncService } from '@/services/syncService';

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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('knowledgeGraph.title')}</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowNodeModal(true)}>
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      ) : (
        <GraphViewer
          graph={graph}
          onNodePress={handleNodePress}
          selectedNodeId={selectedNode?.id}
        />
      )}

      {selectedNode && (
        <View style={styles.nodeDetails}>
          <View style={styles.nodeDetailsHeader}>
            <View style={[styles.nodeTypeIndicator, { backgroundColor: selectedNode.color }]} />
            <Text style={styles.nodeLabel}>{selectedNode.label}</Text>
            <TouchableOpacity onPress={() => setSelectedNode(null)}>
              <Text style={styles.closeButton}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.nodeDetailsContent}>
            <Text style={styles.nodeDetailText}>
              {t('knowledgeGraph.type')}: {t(`knowledgeGraph.${selectedNode.type}`)}
            </Text>
            <Text style={styles.nodeDetailText}>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('knowledgeGraph.addNode')}</Text>
            
            <TextInput
              style={styles.input}
              value={newNodeLabel}
              onChangeText={setNewNodeLabel}
              placeholder="节点名称"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>{t('knowledgeGraph.type')}</Text>
            <View style={styles.typeContainer}>
              {(['concept', 'entity', 'topic'] as const).map(type => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeButton,
                    newNodeType === type && { backgroundColor: colors.nodeTypes[type] },
                  ]}
                  onPress={() => setNewNodeType(type)}
                >
                  <Text style={[styles.typeText, newNodeType === type && styles.typeTextActive]}>
                    {t(`knowledgeGraph.${type}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowNodeModal(false)}
              >
                <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleAddNode}>
                <Text style={styles.confirmButtonText}>{t('common.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: typography.fontSizes.xxl,
    fontWeight: typography.fontWeights.bold,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 24,
    fontWeight: typography.fontWeights.bold,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  nodeDetails: {
    position: 'absolute',
    bottom: 100,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nodeDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  nodeTypeIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  nodeLabel: {
    flex: 1,
    color: colors.text,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
  },
  closeButton: {
    color: colors.textMuted,
    fontSize: 24,
  },
  nodeDetailsContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  nodeDetailText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.backgroundSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.md,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.sm,
  },
  typeContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  typeText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  typeTextActive: {
    color: colors.background,
    fontWeight: typography.fontWeights.bold,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.md,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
  },
});
