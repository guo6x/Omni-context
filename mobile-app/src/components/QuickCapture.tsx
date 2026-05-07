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
        id: Date.now().toString(),
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.label}>{t('memory.content')}</Text>
          <TextInput
            style={styles.contentInput}
            value={content}
            onChangeText={setContent}
            placeholder={t('capture.placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t('memory.type')}</Text>
          <View style={styles.typeContainer}>
            {MEMORY_TYPES.map(memoryType => (
              <TouchableOpacity
                key={memoryType}
                style={[
                  styles.typeButton,
                  type === memoryType && styles.typeButtonActive,
                ]}
                onPress={() => setType(memoryType)}
              >
                <Text
                  style={[
                    styles.typeText,
                    type === memoryType && styles.typeTextActive,
                  ]}
                >
                  {t(`memory.${memoryType}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t('memory.tags')}</Text>
          <TextInput
            style={styles.input}
            value={tags}
            onChangeText={setTags}
            placeholder={t('capture.tagsPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
          onPress={handleCapture}
          disabled={isCapturing}
        >
          <Text style={styles.captureButtonText}>
            {isCapturing ? t('capture.capturing') : t('capture.capture')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contentInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 120,
  },
  typeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  typeTextActive: {
    color: colors.background,
    fontWeight: typography.fontWeights.bold,
  },
  captureButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  captureButtonDisabled: {
    opacity: 0.6,
  },
  captureButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
  },
});
