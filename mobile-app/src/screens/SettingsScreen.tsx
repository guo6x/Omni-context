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
    pairCode,
    pairHost,
    pairPort,
    setPairConfig,
    clearPairConfig,
    reset,
  } = useSettings();

  const { status, sync, isSyncing } = useSync();
  const [serverUrlInput, setServerUrlInput] = useState(serverUrl);
  const [showServerInput, setShowServerInput] = useState(false);

  // 配对码输入
  const [pairHostInput, setPairHostInput] = useState(pairHost || '');
  const [pairPortInput, setPairPortInput] = useState(String(pairPort || 3001));
  const [pairCodeInput, setPairCodeInput] = useState(pairCode || '');
  const [showPairInput, setShowPairInput] = useState(false);

  const handleSaveServerUrl = useCallback(() => {
    setServerUrl(serverUrlInput);
    if (serverUrlInput.trim()) {
      api.configure({ baseUrl: serverUrlInput.trim() });
      showMessage(t('sync.serverSaved'), 'success');
    }
    setShowServerInput(false);
  }, [serverUrlInput, setServerUrl, showMessage, t]);

  const handlePair = useCallback(async () => {
    const host = pairHostInput.trim();
    const port = parseInt(pairPortInput, 10) || 3001;
    const code = pairCodeInput.trim();
    if (!host || !code || code.length !== 6) {
      showMessage(t('settings.pairInvalid'), 'warning');
      return;
    }
    const baseUrl = `http://${host}:${port}`;
    api.configure({ baseUrl, authToken: code });
    setServerUrl(baseUrl);
    setPairConfig(host, port, code);
    setShowPairInput(false);
    showMessage(t('settings.pairSuccess'), 'success');
  }, [pairHostInput, pairPortInput, pairCodeInput, setServerUrl, setPairConfig, showMessage, t]);

  const handleClearPair = useCallback(() => {
    clearPairConfig();
    api.clearAuthToken();
    setPairHostInput('');
    setPairCodeInput('');
    setPairPortInput('3001');
    showMessage(t('settings.pairCleared'), 'info');
  }, [clearPairConfig, showMessage, t]);

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

        {/* 配对码：连接桌面 Omni-Context */}
        <SettingSection title={t('settings.pairing')}>
          {pairCode ? (
            <>
              <SettingItem label={t('settings.pairStatus')} value={`${pairHost}:${pairPort}`} />
              <SettingItem
                label={t('settings.pairCodeLabel')}
                value={'•'.repeat(6)}
                onPress={() => setShowPairInput(true)}
              />
              <TouchableOpacity
                className="mx-4 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 items-center"
                onPress={handleClearPair}
              >
                <Text className="text-red-400 text-sm">{t('settings.pairClear')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <SettingItem
              label={t('settings.pairSetup')}
              value={t('settings.pairSetupHint')}
              onPress={() => setShowPairInput(true)}
            />
          )}
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

        {showPairInput && (
          <View className="absolute inset-0 bg-black/70 justify-center items-center p-5 z-50">
            <View className="bg-[#0a0b12] border border-white/10 rounded-2xl p-5 w-full max-w-sm">
              <Text className="text-[#e8e8e8] text-lg font-bold mb-4 text-center">{t('settings.pairSetup')}</Text>
              <Text className="text-gray-400 text-xs mb-3 text-center">{t('settings.pairSetupHint')}</Text>
              <Text className="text-gray-400 text-sm mb-1 ml-1">{t('settings.pairHost')}</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-3"
                value={pairHostInput}
                onChangeText={setPairHostInput}
                placeholder="192.168.1.x"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text className="text-gray-400 text-sm mb-1 ml-1">{t('settings.pairPort')}</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-3"
                value={pairPortInput}
                onChangeText={setPairPortInput}
                placeholder="3001"
                placeholderTextColor="#64748b"
                keyboardType="number-pad"
              />
              <Text className="text-gray-400 text-sm mb-1 ml-1">{t('settings.pairCodeLabel')}</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-2xl text-center mb-5 tracking-widest"
                value={pairCodeInput}
                onChangeText={(text) => setPairCodeInput(text.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor="#64748b"
                keyboardType="number-pad"
                maxLength={6}
              />
              <View className="flex-row gap-4">
                <TouchableOpacity
                  className="flex-1 py-3 rounded-xl bg-black/40 border border-white/10 items-center"
                  onPress={() => setShowPairInput(false)}
                >
                  <Text className="text-gray-400 text-base">{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 py-3 rounded-xl bg-cyan-400 items-center" onPress={handlePair}>
                  <Text className="text-[#0a0b12] text-base font-bold">{t('settings.pairConnect')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


