import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useHUD } from '@/components/HUD';
import { syncService } from '@/services/syncService';
import { Memory } from '@/types';
import { colors, spacing, typography } from '@/utils/theme';
import { format } from 'date-fns';

const TYPE_COLORS: Record<Memory['type'], string> = {
  note: colors.primary,
  task: colors.secondary,
  idea: colors.accent,
  reference: colors.success,
};

export function MemoryListScreen() {
  const { t } = useTranslation();
  const { showMessage } = useHUD();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<Memory['type'] | null>(null);

  const loadMemories = useCallback(async () => {
    try {
      const data = await syncService.getMemories();
      setMemories(data);
    } catch (error) {
      showMessage((error as Error).message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showMessage]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadMemories();
  }, [loadMemories]);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await syncService.searchMemories(query);
      setMemories(results);
    } else {
      loadMemories();
    }
  }, [loadMemories]);

  const filteredMemories = selectedType
    ? memories.filter(m => m.type === selectedType)
    : memories;

  const renderMemory = useCallback(({ item }: { item: Memory }) => (
    <TouchableOpacity style={styles.memoryCard} activeOpacity={0.7}>
      <View style={[styles.typeIndicator, { backgroundColor: TYPE_COLORS[item.type] }]} />
      <View style={styles.memoryContent}>
        <Text style={styles.memoryText} numberOfLines={3}>
          {item.content}
        </Text>
        <View style={styles.memoryMeta}>
          <Text style={styles.memoryType}>{t(`memory.${item.type}`)}</Text>
          <Text style={styles.memoryDate}>
            {format(item.createdAt, 'MM/dd HH:mm')}
          </Text>
        </View>
        {item.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {item.tags.slice(0, 3).map(tag => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {!item.synced && <View style={styles.unsyncedIndicator} />}
    </TouchableOpacity>
  ), [t]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('memory.title')}</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder={t('common.search')}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, !selectedType && styles.filterButtonActive]}
          onPress={() => setSelectedType(null)}
        >
          <Text style={[styles.filterText, !selectedType && styles.filterTextActive]}>
            全部
          </Text>
        </TouchableOpacity>
        {(['note', 'task', 'idea', 'reference'] as const).map(type => (
          <TouchableOpacity
            key={type}
            style={[
              styles.filterButton,
              selectedType === type && { backgroundColor: TYPE_COLORS[type] },
            ]}
            onPress={() => setSelectedType(type)}
          >
            <Text
              style={[
                styles.filterText,
                selectedType === type && styles.filterTextActive,
              ]}
            >
              {t(`memory.${type}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredMemories}
        renderItem={renderMemory}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('memory.noMemories')}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
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
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.md,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  filterButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  filterTextActive: {
    color: colors.background,
    fontWeight: typography.fontWeights.bold,
  },
  listContent: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  memoryCard: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeIndicator: {
    width: 4,
  },
  memoryContent: {
    flex: 1,
    padding: spacing.md,
  },
  memoryText: {
    color: colors.text,
    fontSize: typography.fontSizes.md,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  memoryMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memoryType: {
    color: colors.textMuted,
    fontSize: typography.fontSizes.xs,
  },
  memoryDate: {
    color: colors.textMuted,
    fontSize: typography.fontSizes.xs,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tag: {
    backgroundColor: colors.backgroundTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    color: colors.primary,
    fontSize: typography.fontSizes.xs,
  },
  unsyncedIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.fontSizes.md,
  },
});
