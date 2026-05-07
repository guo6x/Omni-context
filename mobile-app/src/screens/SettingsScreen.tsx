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

interface SettingItemProps {
  label: string;
  value?: string;
  children?: React.ReactNode;
  onPress?: () => void;
}

function SettingItem({ label, value, children, onPress }: SettingItemProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between p-4 border-b border-white/10"
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text className="text-[#e8e8e8] text-base">{label}</Text>
      {children || (value && <Text className="text-gray-400 text-sm">{value}</Text>)}
    </TouchableOpacity>
  );
}

interface SettingSectionProps {
  title: string;
  children?: React.ReactNode;
}

function SettingSection({ title, children }: SettingSectionProps) {
  return (
    <View className="mt-6 px-5">
      <Text className="text-gray-400 text-sm font-medium mb-2 uppercase tracking-widest">{title}</Text>
      <View className="bg-black/40 rounded-xl overflow-hidden border border-white/10">{children}</View>
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
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <View className="px-5 py-4 border-b border-white/10">
          <Text className="text-[#e8e8e8] text-2xl font-bold">{t('settings.title')}</Text>
        </View>

        <SettingSection title={t('settings.theme')}>
          <SettingItem label={t('settings.dark')}>
            <Switch
              value={theme === 'dark'}
              onValueChange={(value: boolean) => setTheme(value ? 'dark' : 'light')}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
            />
          </SettingItem>
        </SettingSection>

        <SettingSection title={t('settings.language')}>
          <View className="flex-row p-4 gap-2">
            <TouchableOpacity
              className={`flex-1 py-2 rounded-lg items-center ${language === 'zh' ? 'bg-cyan-500' : 'bg-white/5'}`}
              onPress={() => setLanguage('zh')}
            >
              <Text className={`text-base ${language === 'zh' ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
                {t('settings.chinese')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-2 rounded-lg items-center ${language === 'en' ? 'bg-cyan-500' : 'bg-white/5'}`}
              onPress={() => setLanguage('en')}
            >
              <Text className={`text-base ${language === 'en' ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
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
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
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
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
            />
          </SettingItem>

          <View className="flex-row items-center justify-between p-4">
            <Text className="text-gray-400 text-sm">
              {t('sync.pending')}: {status.pending}
            </Text>
            <TouchableOpacity
              className={`bg-cyan-400 px-4 py-2 rounded-lg ${isSyncing ? 'opacity-60' : ''}`}
              onPress={handleSyncNow}
              disabled={isSyncing}
            >
              <Text className="text-[#0a0b12] text-sm font-bold">
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
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
            />
          </SettingItem>
        </SettingSection>

        <SettingSection title={t('settings.about')}>
          <SettingItem label={t('settings.version')} value="1.0.0" />
        </SettingSection>

        <TouchableOpacity className="mx-5 mt-8 p-4 rounded-xl bg-red-500/20 items-center border border-red-500/50" onPress={handleClearData}>
          <Text className="text-red-400 text-base font-bold">{t('settings.clearData')}</Text>
        </TouchableOpacity>

        {showServerInput && (
          <View className="absolute inset-0 bg-black/70 justify-center items-center p-5 z-50">
            <View className="bg-[#0a0b12] border border-white/10 rounded-2xl p-5 w-full max-w-sm">
              <Text className="text-[#e8e8e8] text-lg font-bold mb-4 text-center">{t('settings.serverUrl')}</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-4"
                value={serverUrlInput}
                onChangeText={setServerUrlInput}
                placeholder="https://api.example.com"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <View className="flex-row gap-4">
                <TouchableOpacity
                  className="flex-1 py-3 rounded-xl bg-black/40 border border-white/10 items-center"
                  onPress={() => setShowServerInput(false)}
                >
                  <Text className="text-gray-400 text-base">{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-3 rounded-xl bg-cyan-400 items-center" onPress={handleSaveServerUrl}>
                  <Text className="text-[#0a0b12] text-base font-bold">{t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


