import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { api } from '@/services/api';

type SearchStackParamList = {
  EntityDetail: { entityId: string; entityName: string };
};

export function EntityDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<SearchStackParamList, 'EntityDetail'>>();
  const navigation = useNavigation();
  const { entityId, entityName } = route.params;

  const [entity, setEntity] = useState<any>(null);
  const [neighbors, setNeighbors] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isConfigured()) {
      setError(t('search.not_configured'));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // 先搜实体详细信息，再拉图谱上下文
    api.searchEntities(entityName, 1).then((searchResult) => {
      if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
        const found = searchResult.data.find((e: any) => e.id === entityId) || searchResult.data[0];
        setEntity(found);
      }
    }).catch(() => {});

    api.getGraphNeighborhood(entityId).then((result) => {
      setIsLoading(false);
      if (result.success && result.data) {
        setNeighbors(result.data.entities.filter((e: any) => e.id !== entityId));
        setRelationships(result.data.relationships || []);
      } else {
        setError(result.error || t('search.connect_error'));
      }
    }).catch(() => {
      setIsLoading(false);
      setError(t('search.connect_error'));
    });
  }, [entityId, entityName, t]);

  const getTypeLabel = (type: string): string => {
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
  };

  const getRelLabel = (type: string): string => {
    const map: Record<string, string> = {
      derived_from: t('search.rel_derived'),
      relates_to: t('search.rel_relates'),
      depends_on: t('search.rel_depends'),
      belongs_to: t('search.rel_belongs'),
      conflicts_with: t('search.rel_conflicts'),
      extends: t('search.rel_extends'),
    };
    return map[type] || type;
  };

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
          {entityName}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text className="text-gray-400 mt-4">{t('common.loading')}</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-red-400 text-base text-center">{error}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
          {/* Entity info */}
          {entity && (
            <View className="bg-black/40 border border-white/10 rounded-xl p-4 mb-6">
              <View className="flex-row items-center gap-2 mb-3">
                <View className="bg-cyan-500/20 px-3 py-1 rounded-full">
                  <Text className="text-cyan-400 text-sm font-medium">
                    {getTypeLabel(entity.type)}
                  </Text>
                </View>
              </View>
              <Text className="text-[#e8e8e8] text-xl font-bold mb-3">{entity.name}</Text>
              {entity.description ? (
                <Text className="text-gray-300 text-base leading-6 mb-4">{entity.description}</Text>
              ) : (
                <Text className="text-gray-500 text-sm italic mb-4">{t('search.no_description')}</Text>
              )}
              {entity.tags && entity.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2 mb-3">
                  {entity.tags.map((tag: string) => (
                    <View key={tag} className="bg-white/5 px-3 py-1 rounded-full">
                      <Text className="text-gray-400 text-xs">{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Neighbor nodes */}
          <Text className="text-gray-400 text-sm font-medium mb-3 uppercase tracking-widest">
            {t('search.neighbor_nodes')} ({neighbors.length})
          </Text>

          {neighbors.length === 0 ? (
            <Text className="text-gray-500 text-sm text-center py-8">{t('search.no_neighbors')}</Text>
          ) : (
            neighbors.map((node: any) => {
              const rel = relationships.find(
                (r: any) => (r.source_id === entityId && r.target_id === node.id) ||
                          (r.target_id === entityId && r.source_id === node.id)
              );
              return (
                <View
                  key={node.id}
                  className="bg-black/40 border border-white/10 rounded-xl p-4 mb-2"
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View className="bg-white/5 px-2 py-0.5 rounded">
                      <Text className="text-gray-400 text-xs">{getTypeLabel(node.type)}</Text>
                    </View>
                    {rel && (
                      <View className="bg-cyan-500/10 px-2 py-0.5 rounded">
                        <Text className="text-cyan-400 text-xs">{getRelLabel(rel.type)}</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-[#e8e8e8] text-base font-semibold mb-1">{node.name}</Text>
                  {node.description ? (
                    <Text className="text-gray-400 text-sm" numberOfLines={2}>{node.description}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
