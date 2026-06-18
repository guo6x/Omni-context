import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHUD } from '@/components/HUD';
import { syncService } from '@/services/syncService';
import { Entity, EntityType } from '@/types';
import { format } from 'date-fns';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type LibraryStackParamList = {
  LibraryMain: undefined;
  EntityDetail: { entityId: string; entityName: string; entity?: Entity };
};

// 实体类型颜色映射
const TYPE_COLORS: Record<EntityType, string> = {
  principle: '#f97316',
  evidence: '#22c55e',
  concept: '#22d3ee',
  tool: '#a855f7',
  person: '#ec4899',
  project: '#f59e0b',
  code_snippet: '#14b8a6',
  architecture_pattern: '#8b5cf6',
  bug_vulnerability: '#ef4444',
  business_logic: '#06b6d4',
  critical_review: '#f43f5e',
  capture_snapshot: '#71717a',
  memory: '#64748b',
  note: '#64748b',
  task: '#eab308',
  idea: '#f472b6',
  reference: '#71717a',
};

// 实体类型显示名称
const TYPE_LABELS: Record<EntityType, string> = {
  principle: '原则',
  evidence: '证据',
  concept: '概念',
  tool: '工具',
  person: '人物',
  project: '项目',
  code_snippet: '代码',
  architecture_pattern: '架构',
  bug_vulnerability: '漏洞',
  business_logic: '业务',
  critical_review: '评价',
  capture_snapshot: '快照',
  memory: '记忆',
  note: '笔记',
  task: '任务',
  idea: '想法',
  reference: '参考',
};

// 显示的类型筛选选项
const FILTER_TYPES: EntityType[] = ['note', 'task', 'idea', 'reference', 'concept', 'project'];

// 优化后的列表项组件（记忆化）
const EntityItem = memo(({ 
  item, 
  onSelect 
}: { 
  item: Entity, 
  onSelect?: (entity: Entity) => void 
}) => {
  return (
    <Pressable 
      style={styles.itemContainer}
      onPress={() => onSelect?.(item)}
    >
      <View style={[styles.itemAccent, { backgroundColor: TYPE_COLORS[item.type] }]} />
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {item.name}
        </Text>
        {item.description ? (
          <Text style={styles.itemDescription} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.itemMetaRow}>
          <Text style={styles.itemTypeLabel}>{TYPE_LABELS[item.type]}</Text>
          <Text style={styles.itemDate}>
            {format(new Date(item.created_at), 'MM/dd HH:mm')}
          </Text>
        </View>
        {item.tags && item.tags.length > 0 ? (
          <View style={styles.itemTagsRow}>
            {item.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={styles.itemTag}>
                <Text style={styles.itemTagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {(item as any).synced === false ? (
        <View style={styles.syncIndicator} />
      ) : null}
    </Pressable>
  );
});

// 筛选按钮组件
const FilterButton = memo(({
  type,
  selected,
  onPress
}: {
  type: EntityType | null,
  selected: boolean,
  onPress: () => void
}) => {
  return (
    <Pressable
      style={[
        styles.filterButton,
        selected && (type ? { backgroundColor: TYPE_COLORS[type] } : styles.filterButtonSelected)
      ]}
      onPress={onPress}
    >
      <Text style={[
        styles.filterButtonText,
        selected && styles.filterButtonTextSelected
      ]}>
        {type ? TYPE_LABELS[type] : '全部'}
      </Text>
    </Pressable>
  );
});

export function MemoryListScreen() {
  const { showMessage } = useHUD();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<EntityType | null>(null);

  const loadEntities = useCallback(async () => {
    try {
      const data = await syncService.getEntities();
      setEntities(data);
    } catch (error) {
      showMessage((error as Error).message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showMessage]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncService.fullSync();
    } catch (error) {
      console.warn('Refresh sync failed:', error);
    } finally {
      loadEntities();
    }
  }, [loadEntities]);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await syncService.searchEntities(query);
      setEntities(results);
    } else {
      loadEntities();
    }
  }, [loadEntities]);

  const handleEntitySelect = useCallback((entity: Entity) => {
    navigation.navigate('EntityDetail', {
      entityId: entity.id,
      entityName: entity.name,
      entity,
    });
  }, [navigation]);

  const handleTypeSelect = useCallback((type: EntityType | null) => {
    setSelectedType(type);
  }, []);

  const filteredEntities = selectedType
    ? entities.filter(e => e.type === selectedType)
    : entities;

  const renderEntity = useCallback(({ item }: { item: Entity }) => (
    <EntityItem item={item} onSelect={handleEntitySelect} />
  ), [handleEntitySelect]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>知识库</Text>
        <Text style={styles.headerSubtitle}>{entities.length} 条本地内容</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder="搜索..."
          placeholderTextColor="#64748b"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContainer}
      >
        <FilterButton
          type={null}
          selected={selectedType === null}
          onPress={() => handleTypeSelect(null)}
        />
        {FILTER_TYPES.map((type) => (
          <FilterButton
            key={type}
            type={type}
            selected={selectedType === type}
            onPress={() => handleTypeSelect(type)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={filteredEntities}
        renderItem={renderEntity}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={10}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#22d3ee"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Text style={styles.emptyIcon}>◎</Text>
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery ? '没有匹配的实体' : '还没有记忆'}
            </Text>
            <Text style={styles.emptyDescription}>
              {searchQuery
                ? '尝试更短的关键词或不同的拼写'
                : '同步桌面数据，或从“记录”页开始添加内容。'}
            </Text>
            {!searchQuery ? (
              <Pressable
                style={styles.emptySyncButton}
                onPress={handleRefresh}
              >
                <Text style={styles.emptySyncButtonText}>立即同步</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0b12',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0,
  },
  headerTitle: {
    color: '#e8e8e8',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#77818b',
    fontSize: 13,
    marginTop: 4,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  searchInput: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#e8e8e8',
    fontSize: 16,
  },
  filtersContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#151a1f',
  },
  filterButtonSelected: {
    backgroundColor: '#22d3ee',
    borderColor: '#22d3ee',
  },
  filterButtonText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  filterButtonTextSelected: {
    color: '#0a0b12',
    fontWeight: 'bold',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9ca3af',
    marginTop: 16,
  },
  itemContainer: {
    flexDirection: 'row',
    backgroundColor: '#13181d',
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#252d34',
  },
  itemAccent: {
    width: 4,
  },
  itemContent: {
    flex: 1,
    padding: 16,
  },
  itemTitle: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemDescription: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTypeLabel: {
    color: '#6b7280',
    fontSize: 12,
  },
  itemDate: {
    color: '#6b7280',
    fontSize: 12,
  },
  itemTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  itemTag: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  itemTagText: {
    color: '#22d3ee',
    fontSize: 12,
  },
  syncIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#eab308',
    position: 'absolute',
    top: 8,
    right: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDescription: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  emptySyncButton: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#22d3ee',
  },
  emptySyncButtonText: {
    color: '#0a0b12',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
