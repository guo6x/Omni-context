import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useHUD } from './HUD';
import { syncService } from '@/services/syncService';
import { Entity, EntityType } from '@/types';
import { useTranslation } from 'react-i18next';

const ENTITY_TYPES: EntityType[] = ['memory', 'task', 'concept', 'principle', 'decision', 'goal'];

export function QuickCapture() {
  const { t } = useTranslation();
  const { showMessage } = useHUD();
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [type, setType] = useState<EntityType>('memory');
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle && !trimmedContent) {
      showMessage(t('capture.placeholder'), 'warning');
      return;
    }

    setIsCapturing(true);

    try {
      const entity: Entity & { synced?: boolean } = {
        // Date.now() 单独使用在快速连续点击下会撞 ID；加上随机后缀
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        name: trimmedTitle || trimmedContent.slice(0, 60) + (trimmedContent.length > 60 ? '...' : ''),
        type,
        description: trimmedContent,
        tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
        source_file: 'quick_capture',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        access_count: 0,
        synced: false,
      };

      await syncService.addEntity(entity);
      
      setContent('');
      setTitle('');
      setTags('');
      showMessage(t('capture.success'), 'success');
    } catch (error) {
      showMessage((error as Error).message, 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [content, title, tags, type, showMessage, t]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0b0f12]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-7">
          <Text className="text-[#f2f5f4] text-2xl font-bold">快速记录</Text>
          <Text className="text-[#77818b] text-sm mt-1">先记下来，稍后再整理</Text>
        </View>

        <View className="mb-5">
          <Text className="text-[#aab2b9] text-sm font-medium mb-2">标题</Text>
          <TextInput
            className="bg-[#151a1f] border border-[#293139] rounded-lg px-4 py-3 text-[#f2f5f4] text-base"
            value={title}
            onChangeText={setTitle}
            placeholder="一句话概括，可留空"
            placeholderTextColor="#64748b"
            maxLength={100}
          />
        </View>

        <View className="mb-5">
          <View className="flex-row justify-between mb-2">
            <Text className="text-[#aab2b9] text-sm font-medium">{t('memory.content')}</Text>
            <Text className="text-[#65707a] text-xs">{content.length}/5000</Text>
          </View>
          <TextInput
            className="bg-[#151a1f] border border-[#293139] rounded-lg p-4 text-[#f2f5f4] text-base min-h-[180px]"
            value={content}
            onChangeText={setContent}
            placeholder={t('capture.placeholder')}
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={5000}
          />
        </View>

        <View className="mb-5">
          <Text className="text-[#aab2b9] text-sm font-medium mb-2">{t('memory.type')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {ENTITY_TYPES.map(entityType => (
              <TouchableOpacity
                key={entityType}
                className={`px-4 py-2 rounded-md border ${type === entityType ? 'bg-[#45c8b0] border-[#45c8b0]' : 'bg-[#151a1f] border-[#293139]'}`}
                onPress={() => setType(entityType)}
              >
                <Text
                  className={`text-sm ${type === entityType ? 'text-[#071411] font-bold' : 'text-[#98a2aa]'}`}
                >
                  {t(`memory.${entityType}`) || entityType}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="mb-5">
          <Text className="text-[#aab2b9] text-sm font-medium mb-2">{t('memory.tags')}</Text>
          <TextInput
            className="bg-[#151a1f] border border-[#293139] rounded-lg px-4 py-3 text-[#f2f5f4] text-base"
            value={tags}
            onChangeText={setTags}
            placeholder={t('capture.tagsPlaceholder')}
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          className={`bg-[#45c8b0] rounded-lg p-4 items-center mt-3 ${isCapturing ? 'opacity-60' : ''}`}
          onPress={handleCapture}
          disabled={isCapturing}
          accessibilityRole="button"
          accessibilityLabel={isCapturing ? t('capture.capturing') : t('capture.capture')}
          accessibilityState={{ disabled: isCapturing, busy: isCapturing }}
        >
          <Text className="text-[#071411] text-base font-bold">
            {isCapturing ? t('capture.capturing') : t('capture.capture')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
