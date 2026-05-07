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
import { format } from 'date-fns';

const TYPE_COLORS: Record<Memory['type'], string> = {
  note: '#22d3ee', // cyan-400
  task: '#c084fc', // purple-400
  idea: '#9333ea', // purple-600
  reference: '#164e63', // cyan-900
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
    <TouchableOpacity className="flex-row bg-black/40 rounded-xl mb-4 overflow-hidden border border-white/10" activeOpacity={0.7}>
      <View className="w-1" style={{ backgroundColor: TYPE_COLORS[item.type] }} />
      <View className="flex-1 p-4">
        <Text className="text-[#e8e8e8] text-base leading-6 mb-2" numberOfLines={3}>
          {item.content}
        </Text>
        <View className="flex-row justify-between items-center">
          <Text className="text-gray-500 text-xs">{t(`memory.${item.type}`)}</Text>
          <Text className="text-gray-500 text-xs">
            {format(item.createdAt, 'MM/dd HH:mm')}
          </Text>
        </View>
        {item.tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1 mt-2">
            {item.tags.slice(0, 3).map(tag => (
              <View key={tag} className="bg-white/5 px-2 py-0.5 rounded">
                <Text className="text-cyan-400 text-xs">#{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {!item.synced && <View className="w-2 h-2 rounded-full bg-yellow-500 absolute top-2 right-2" />}
    </TouchableOpacity>
  ), [t]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text className="text-gray-400 mt-4">{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <View className="px-5 py-4 border-b border-white/10">
        <Text className="text-[#e8e8e8] text-2xl font-bold">{t('memory.title')}</Text>
      </View>

      <View className="px-5 py-4">
        <TextInput
          className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base"
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder={t('common.search')}
          placeholderTextColor="#64748b"
        />
      </View>

      <View className="flex-row px-5 pb-4 gap-2">
        <TouchableOpacity
          className={`px-4 py-2 rounded-2xl border ${!selectedType ? 'bg-cyan-500 border-cyan-500' : 'bg-black/40 border-white/10'}`}
          onPress={() => setSelectedType(null)}
        >
          <Text className={`text-sm ${!selectedType ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
            全部
          </Text>
        </TouchableOpacity>
        {(['note', 'task', 'idea', 'reference'] as const).map(type => (
          <TouchableOpacity
            key={type}
            className={`px-4 py-2 rounded-2xl border ${selectedType === type ? 'border-transparent' : 'bg-black/40 border-white/10'}`}
            style={selectedType === type ? { backgroundColor: TYPE_COLORS[type] } : {}}
            onPress={() => setSelectedType(type)}
          >
            <Text
              className={`text-sm ${selectedType === type ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}
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
        className="px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#22d3ee"
          />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-16 px-6">
            <View className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 items-center justify-center mb-5 shadow-[0_0_25px_rgba(34,211,238,0.15)]">
              <Text className="text-3xl">🧠</Text>
            </View>
            <Text className="text-[#e8e8e8] text-base font-semibold mb-2">
              {searchQuery ? '没有匹配的记忆' : t('memory.noMemories')}
            </Text>
            <Text className="text-gray-500 text-sm text-center leading-5 max-w-[280px]">
              {searchQuery
                ? '尝试更短的关键词、不同的拼写，或先在 Quick Capture 中沉淀一些内容。'
                : '使用 Quick Capture 快速记录想法、任务或参考资料；它们会自动同步到 Brain Server。'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                className="mt-6 px-5 py-3 rounded-xl bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                onPress={handleRefresh}
                activeOpacity={0.85}
              >
                <Text className="text-[#0a0b12] text-sm font-bold">立即同步</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
