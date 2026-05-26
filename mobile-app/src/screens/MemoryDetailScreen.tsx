import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';

type SearchStackParamList = {
  MemoryDetail: { item: any };
};

export function MemoryDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<SearchStackParamList, 'MemoryDetail'>>();
  const navigation = useNavigation();
  const rawItem = route.params.item;

  // 解构归档搜索结果
  const item = rawItem.item || rawItem;
  const relevanceScore = rawItem.relevanceScore;
  const matchType = rawItem.matchType;

  const content = item.content || (typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2));
  const summary = item.summary;
  const tags = item.tags || [];
  const key = item.key;
  const category = item.category;
  const createdAt = item.createdAt || item.created_at || item.archivedAt || '';
  const importance = item.importance;
  const accessCount = item.accessCount || item.access_count;

  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-white/10">
        <TouchableOpacity
          className="mr-4 p-1"
          onPress={() => navigation.goBack()}
        >
          <Text className="text-cyan-400 text-base">{'<'}</Text>
        </TouchableOpacity>
        <Text className="text-[#e8e8e8] text-lg font-bold flex-1" numberOfLines={1}>
          {t('search.memory_detail')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* Meta info */}
        <View className="bg-black/40 border border-white/10 rounded-xl p-4 mb-4">
          <View className="flex-row flex-wrap gap-2 mb-3">
            {key && (
              <View className="bg-green-500/20 px-3 py-1 rounded-full">
                <Text className="text-green-400 text-sm font-medium">{key}</Text>
              </View>
            )}
            {category && (
              <View className="bg-white/5 px-3 py-1 rounded-full">
                <Text className="text-gray-400 text-sm">{category}</Text>
              </View>
            )}
            {matchType && (
              <View className="bg-purple-500/20 px-3 py-1 rounded-full">
                <Text className="text-purple-400 text-sm">{matchType}</Text>
              </View>
            )}
          </View>

          {tags.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mb-3">
              {tags.map((tag: string) => (
                <View key={tag} className="bg-white/5 px-3 py-1 rounded-full">
                  <Text className="text-gray-400 text-xs">{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View className="flex-row flex-wrap gap-x-6 gap-y-1">
            {relevanceScore != null && (
              <Text className="text-gray-500 text-xs">
                {t('search.relevance')}: {Math.round(relevanceScore * 100)}%
              </Text>
            )}
            {importance != null && (
              <Text className="text-gray-500 text-xs">
                {t('search.importance')}: {Math.round(importance * 100)}%
              </Text>
            )}
            {accessCount != null && (
              <Text className="text-gray-500 text-xs">
                {t('search.access_count')}: {accessCount}
              </Text>
            )}
            {createdAt ? (
              <Text className="text-gray-500 text-xs">
                {t('search.created')}: {new Date(createdAt).toLocaleDateString()}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Summary */}
        {summary && (
          <View className="bg-black/40 border border-white/10 rounded-xl p-4 mb-4">
            <Text className="text-gray-400 text-sm font-medium mb-2 uppercase">
              {t('search.summary')}
            </Text>
            <Text className="text-gray-300 text-base leading-6">{summary}</Text>
          </View>
        )}

        {/* Full content */}
        <View className="bg-black/40 border border-white/10 rounded-xl p-4">
          <Text className="text-gray-400 text-sm font-medium mb-2 uppercase">
            {t('search.content')}
          </Text>
          <Text className="text-[#e8e8e8] text-sm leading-6" selectable>
            {content}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
