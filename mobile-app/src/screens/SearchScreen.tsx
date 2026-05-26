import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '@/services/api';
import { useSettings } from '@/hooks/useSettings';
import { useHUD } from '@/components/HUD';

type SearchStackParamList = {
  SearchMain: undefined;
  EntityDetail: { entityId: string; entityName: string };
  MemoryDetail: { item: any };
};

type SearchNav = NativeStackNavigationProp<SearchStackParamList>;

interface SearchResultItem {
  type: 'entity' | 'archival' | 'core';
  data: any;
  section: string;
}

function getTypeLabel(type: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    principle: t('search.type_principle'),
    evidence: t('search.type_evidence'),
    concept: t('search.type_concept'),
    tool: t('search.type_tool'),
    person: t('search.type_person'),
    project: t('search.type_project'),
    code_snippet: t('search.type_code'),
    architecture_pattern: t('search.type_arch'),
    bug_vulnerability: t('search.type_bug'),
    business_logic: t('search.type_biz'),
  };
  return map[type] || type;
}

export function SearchScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<SearchNav>();
  const { showMessage } = useHUD();
  const { serverUrl } = useSettings();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 300ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.slice(0, 200));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      setError(null);
      return;
    }

    if (!api.isConfigured()) {
      setError(t('search.not_configured'));
      return;
    }

    setIsLoading(true);
    setError(null);

    const limit = 5;

    Promise.allSettled([
      api.searchEntities(debouncedQuery, limit),
      api.searchArchival(debouncedQuery, limit),
      api.searchCore(debouncedQuery, limit),
    ]).then((outcomes) => {
      setIsLoading(false);
      setHasSearched(true);

      const items: SearchResultItem[] = [];
      let errorsCount = 0;

      if (outcomes[0].status === 'fulfilled' && outcomes[0].value.success) {
        (outcomes[0].value.data || []).forEach((e: any) => {
          items.push({ type: 'entity', data: e, section: t('search.section_entities') });
        });
      } else if (outcomes[0].status === 'rejected') errorsCount++;

      if (outcomes[1].status === 'fulfilled' && outcomes[1].value.success) {
        (outcomes[1].value.data || []).forEach((a: any) => {
          items.push({ type: 'archival', data: a, section: t('search.section_archival') });
        });
      } else if (outcomes[1].status === 'rejected') errorsCount++;

      if (outcomes[2].status === 'fulfilled' && outcomes[2].value.success) {
        (outcomes[2].value.data || []).forEach((c: any) => {
          items.push({ type: 'core', data: c, section: t('search.section_core') });
        });
      } else if (outcomes[2].status === 'rejected') errorsCount++;

      if (errorsCount === 3) {
        setError(t('search.connect_error'));
      }

      setResults(items);
    }).catch(() => {
      setIsLoading(false);
      setError(t('search.connect_error'));
    });
  }, [debouncedQuery, t]);

  const handleSelect = useCallback((item: SearchResultItem) => {
    if (item.type === 'entity') {
      navigation.navigate('EntityDetail', {
        entityId: item.data.id,
        entityName: item.data.name || item.data.id,
      });
    } else {
      navigation.navigate('MemoryDetail', { item: item.data });
    }
  }, [navigation]);

  const renderItem = ({ item }: { item: SearchResultItem }) => {
    if (item.type === 'entity') {
      const entity = item.data;
      return (
        <TouchableOpacity
          className="bg-black/40 border border-white/10 rounded-xl p-4 mb-2"
          onPress={() => handleSelect(item)}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center justify-between mb-2">
            <View className="bg-cyan-500/20 px-2 py-0.5 rounded">
              <Text className="text-cyan-400 text-xs font-medium">
                {getTypeLabel(entity.type, t)}
              </Text>
            </View>
            <View className="bg-white/5 px-2 py-0.5 rounded">
              <Text className="text-gray-400 text-xs">{t('search.entity')}</Text>
            </View>
          </View>
          <Text className="text-[#e8e8e8] text-base font-semibold mb-1">{entity.name}</Text>
          {entity.description ? (
            <Text className="text-gray-400 text-sm" numberOfLines={2}>{entity.description}</Text>
          ) : null}
          {entity.tags && entity.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 mt-2">
              {entity.tags.map((tag: string) => (
                <View key={tag} className="bg-white/5 px-2 py-0.5 rounded">
                  <Text className="text-gray-500 text-xs">{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </TouchableOpacity>
      );
    }

    if (item.type === 'archival') {
      const archResult = item.data;
      const archItem = archResult.item || archResult;
      return (
        <TouchableOpacity
          className="bg-black/40 border border-white/10 rounded-xl p-4 mb-2"
          onPress={() => handleSelect(item)}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center justify-between mb-2">
            <View className="bg-purple-500/20 px-2 py-0.5 rounded">
              <Text className="text-purple-400 text-xs">{t('search.archival')}</Text>
            </View>
            {archResult.relevanceScore != null ? (
              <Text className="text-gray-500 text-xs">
                {Math.round(archResult.relevanceScore * 100)}%
              </Text>
            ) : null}
          </View>
          <Text className="text-[#e8e8e8] text-sm" numberOfLines={3}>
            {archItem.summary || archItem.content || JSON.stringify(archItem).slice(0, 200)}
          </Text>
          {archItem.tags && archItem.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 mt-2">
              {archItem.tags.map((tag: string) => (
                <View key={tag} className="bg-white/5 px-2 py-0.5 rounded">
                  <Text className="text-gray-500 text-xs">{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </TouchableOpacity>
      );
    }

    // core
    const coreItem = item.data;
    return (
      <TouchableOpacity
        className="bg-black/40 border border-white/10 rounded-xl p-4 mb-2"
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center justify-between mb-2">
          <View className="bg-green-500/20 px-2 py-0.5 rounded">
            <Text className="text-green-400 text-xs">{t('search.core')}</Text>
          </View>
        </View>
        <Text className="text-[#e8e8e8] text-sm font-medium mb-1">{coreItem.key}</Text>
        <Text className="text-gray-400 text-sm" numberOfLines={2}>
          {coreItem.summary || (typeof coreItem.value === 'string' ? coreItem.value : JSON.stringify(coreItem.value)).slice(0, 200)}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderSection = (title: string, type: string) => {
    const sectionItems = results.filter(r => r.type === type);
    if (sectionItems.length === 0) return null;
    return (
      <View className="mb-4">
        <Text className="text-gray-400 text-sm font-medium mb-2 px-1">{title}</Text>
        {sectionItems.map((item, index) => (
          <View key={`${item.type}-${item.data.id || index}`}>
            {renderItem({ item })}
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <View className="px-5 py-4 border-b border-white/10">
        <Text className="text-[#e8e8e8] text-2xl font-bold mb-4">{t('search.title')}</Text>

        <View className="flex-row items-center bg-black/40 border border-white/10 rounded-xl px-4">
          <Text className="text-gray-400 mr-2 text-base">?</Text>
          <TextInput
            className="flex-1 py-3 text-[#e8e8e8] text-base"
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              className="ml-2 p-1"
              onPress={() => setQuery('')}
            >
              <Text className="text-gray-500 text-lg">x</Text>
            </TouchableOpacity>
          )}
        </View>

        {!api.isConfigured() && (
          <View className="mt-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <Text className="text-yellow-400 text-sm">{t('search.not_configured')}</Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text className="text-gray-400 mt-4">{t('common.loading')}</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-gray-400 text-lg mb-2">&#9888;</Text>
          <Text className="text-red-400 text-base text-center">{error}</Text>
        </View>
      ) : hasSearched && results.length === 0 ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-gray-400 text-lg mb-2">&#128269;</Text>
          <Text className="text-gray-400 text-base text-center">{t('search.no_results')}</Text>
        </View>
      ) : !hasSearched ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-gray-600 text-lg mb-2">&#128269;</Text>
          <Text className="text-gray-500 text-base text-center">{t('search.start_search_hint')}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item, index) => `${item.type}-${item.data.id || index}`}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}
