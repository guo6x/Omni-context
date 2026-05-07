import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/hooks/useSettings';
import { useSync } from '@/hooks/useSync';
import { useHUD } from '@/components/HUD';
import { api } from '@/services/api';
import * as localDb from '@/services/localDb';
import { colors, spacing, typography } from '@/utils/theme';

interface SettingItemProps {
  label: string;
  value?: string;
  children?: React.ReactNode;
  onPress?: () => void;
}

function SettingItem({ label, value, children, onPress }: SettingItemProps) {
  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      {children || (value && <Text style={styles.settingValue}>{value}</Text>)}
    </TouchableOpacity>
  );
}

interface SettingSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingSection({ title, children }: SettingSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const { showMessage } = useHUD();
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    syncEnabled,
    setSyncEnabled,
    serverUrl,
    setServerUrl,
    autoSync,
    setAutoSync,
    notificationsEnabled,
    setNotificationsEnabled,
    reset,
  } = useSettings();

  const { status, sync, isSyncing } = useSync();
  const [serverUrlInput, setServerUrlInput] = useState(serverUrl);
  const [showServerInput, setShowServerInput] = useState(false);

  const handleSaveServerUrl = useCallback(() => {
    setServerUrl(serverUrlInput);
    if (serverUrlInput.trim()) {
      api.configure({ baseUrl: serverUrlInput.trim() });
      showMessage('服务器地址已保存', 'success');
    }
    setShowServerInput(false);
  }, [serverUrlInput, setServerUrl, showMessage]);

  const handleSyncNow = useCallback(async () => {
    if (!api.isConfigured()) {
      showMessage(t('sync.notConfigured'), 'warning');
      return;
    }
    await sync();
  }, [sync, showMessage, t]);

  const handleClearData = useCallback(() => {
    Alert.alert(
      t('settings.clearData'),
      t('settings.clearDataConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            await localDb.clearAllData();
            showMessage('数据已清除', 'success');
          },
        },
      ]
    );
  }, [showMessage, t]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('settings.title')}</Text>
        </View>

        <SettingSection title={t('settings.theme')}>
          <SettingItem label={t('settings.dark')}>
            <Switch
              value={theme === 'dark'}
              onValueChange={(value) => setTheme(value ? 'dark' : 'light')}
              trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
              thumbColor={colors.text}
            />
          </SettingItem>
        </SettingSection>

        <SettingSection title={t('settings.language')}>
          <View style={styles.languageButtons}>
            <TouchableOpacity
              style={[styles.languageButton, language === 'zh' && styles.languageButtonActive]}
              onPress={() => setLanguage('zh')}
            >
              <Text style={[styles.languageText, language === 'zh' && styles.languageTextActive]}>
                {t('settings.chinese')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.languageButton, language === 'en' && styles.languageButtonActive]}
              onPress={() => setLanguage('en')}
            >
              <Text style={[styles.languageText, language === 'en' && styles.languageTextActive]}>
                {t('settings.english')}
              </Text>
            </TouchableOpacity>
          </View>
        </SettingSection>

        <SettingSection title={t('settings.sync')}>
          <SettingItem label={t('settings.syncEnabled')}>
            <Switch
              value={syncEnabled}
              onValueChange={setSyncEnabled}
              trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
              thumbColor={colors.text}
            />
          </SettingItem>

          <SettingItem
            label={t('settings.serverUrl')}
            value={serverUrl || t('sync.notConfigured')}
            onPress={() => setShowServerInput(true)}
          />

          <SettingItem label={t('settings.autoSync')}>
            <Switch
              value={autoSync}
              onValueChange={setAutoSync}
              trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
              thumbColor={colors.text}
            />
          </SettingItem>

          <View style={styles.syncStatus}>
            <Text style={styles.syncStatusLabel}>
              {t('sync.pending')}: {status.pending}
            </Text>
            <TouchableOpacity
              style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
              onPress={handleSyncNow}
              disabled={isSyncing}
            >
              <Text style={styles.syncButtonText}>
                {isSyncing ? t('sync.syncing') : t('sync.syncNow')}
              </Text>
            </TouchableOpacity>
          </View>
        </SettingSection>

        <SettingSection title={t('settings.notifications')}>
          <SettingItem label={t('settings.notificationsEnabled')}>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: colors.backgroundTertiary, true: colors.primary }}
              thumbColor={colors.text}
            />
          </SettingItem>
        </SettingSection>

        <SettingSection title={t('settings.about')}>
          <SettingItem label={t('settings.version')} value="1.0.0" />
        </SettingSection>

        <TouchableOpacity style={styles.clearButton} onPress={handleClearData}>
          <Text style={styles.clearButtonText}>{t('settings.clearData')}</Text>
        </TouchableOpacity>

        {showServerInput && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{t('settings.serverUrl')}</Text>
              <TextInput
                style={styles.modalInput}
                value={serverUrlInput}
                onChangeText={setServerUrlInput}
                placeholder="https://api.example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setShowServerInput(false)}
                >
                  <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirmButton} onPress={handleSaveServerUrl}>
                  <Text style={styles.modalConfirmText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
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
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionContent: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingLabel: {
    color: colors.text,
    fontSize: typography.fontSizes.md,
  },
  settingValue: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  languageButtons: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  languageButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  languageButtonActive: {
    backgroundColor: colors.primary,
  },
  languageText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.md,
  },
  languageTextActive: {
    color: colors.background,
    fontWeight: typography.fontWeights.bold,
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  syncStatusLabel: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
  },
  syncButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: colors.background,
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.bold,
  },
  clearButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.text,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.fontSizes.md,
    marginBottom: spacing.md,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    alignItems: 'center',
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.md,
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: colors.background,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
  },
});
