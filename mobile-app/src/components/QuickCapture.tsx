import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useHUD } from './HUD';
import { syncService } from '@/services/syncService';
import { Memory } from '@/types';
import { colors, spacing, typography } from '@/utils/theme';
import { useTranslation } from 'react-i18next';

const MEMORY_TYPES: Memory['type'][] = ['note', 'task', 'idea', 'reference'];

export function QuickCapture() {
  const { t } = useTranslation();
  const { showMessage } = useHUD();
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [type, setType] = useState<Memory['type']>('note');
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    if (!content.trim()) {
      showMessage(t('capture.placeholder'), 'warning');
      return;
    }

    setIsCapturing(true);

    try {
      const memory: Memory = {
        // Date.now() 单独使用在快速连续点击下会撞 ID；加上随机后缀
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        content: content.trim(),
        type,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        synced: false,
      };

      await syncService.addMemory(memory);
      
      setContent('');
      setTags('');
      showMessage(t('capture.success'), 'success');
    } catch (error) {
      showMessage((error as Error).message, 'error');
    } finally {
      setIsCapturing(false);
    }
  }, [content, tags, type, showMessage, t]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0a0b12]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="p-5"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6">
          <Text className="text-gray-400 text-sm font-medium mb-2">{t('memory.content')}</Text>
          <TextInput
            className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base min-h-[120px]"
            value={content}
            onChangeText={setContent}
            placeholder={t('capture.placeholder')}
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View className="mb-6">
          <Text className="text-gray-400 text-sm font-medium mb-2">{t('memory.type')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {MEMORY_TYPES.map(memoryType => (
              <TouchableOpacity
                key={memoryType}
                className={`px-4 py-2 rounded-full border ${type === memoryType ? 'bg-cyan-500 border-cyan-500' : 'bg-black/40 border-white/10'}`}
                onPress={() => setType(memoryType)}
              >
                <Text
                  className={`text-sm ${type === memoryType ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}
                >
                  {t(`memory.${memoryType}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="mb-6">
          <Text className="text-gray-400 text-sm font-medium mb-2">{t('memory.tags')}</Text>
          <TextInput
            className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base"
            value={tags}
            onChangeText={setTags}
            placeholder={t('capture.tagsPlaceholder')}
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          className={`bg-cyan-400 rounded-xl p-4 items-center mt-4 shadow-[0_0_15px_rgba(34,211,238,0.5)] ${isCapturing ? 'opacity-60' : ''}`}
          onPress={handleCapture}
          disabled={isCapturing}
          accessibilityRole="button"
          accessibilityLabel={isCapturing ? t('capture.capturing') : t('capture.capture')}
          accessibilityState={{ disabled: isCapturing, busy: isCapturing }}
        >
          <Text className="text-[#0a0b12] text-lg font-bold">
            {isCapturing ? t('capture.capturing') : t('capture.capture')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
