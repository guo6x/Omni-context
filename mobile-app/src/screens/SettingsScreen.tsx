import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useSettings } from '@/hooks/useSettings';
import { useSync } from '@/hooks/useSync';
import { useHUD } from '@/components/HUD';
import { api } from '@/services/api';
import * as localDb from '@/services/localDb';
import { syncService } from '@/services/syncService';

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
  const navigation = useNavigation<any>();
  const { showMessage } = useHUD();
  const {
    language,
    setLanguage,
    syncEnabled,
    setSyncEnabled,
    serverUrl,
    setServerUrl,
    authToken,
    setAuthToken,
    autoSync,
    setAutoSync,
  } = useSettings();

  const { status, fullSync, isSyncing } = useSync();
  const [serverUrlInput, setServerUrlInput] = useState(serverUrl);
  const [authTokenInput, setAuthTokenInput] = useState(authToken);
  const [showConfigInput, setShowConfigInput] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const handleSaveConfig = useCallback(async () => {
    const normalizedUrl = serverUrlInput.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+(?::\d+)?$/i.test(normalizedUrl)) {
      showMessage('请输入完整地址，例如 http://192.168.1.10:3001', 'warning');
      return;
    }
    if (!authTokenInput || !authTokenInput.trim()) {
      showMessage('请填写配对码', 'warning');
      return;
    }

    setTestingConnection(true);
    api.configure({
      baseUrl: normalizedUrl,
      authToken: authTokenInput.trim(),
      timeout: 8000,
    });
    const connected = await api.healthCheck();
    setTestingConnection(false);
    if (!connected) {
      showMessage('连接失败，请检查地址、局域网和桌面端防火墙', 'error');
      return;
    }

    setServerUrl(normalizedUrl);
    setAuthToken(authTokenInput.trim());
    setSyncEnabled(true);
    showMessage('连接成功，配置已保存', 'success');
    setShowConfigInput(false);
  }, [serverUrlInput, authTokenInput, setServerUrl, setAuthToken, setSyncEnabled, showMessage]);

  const handleSyncNow = useCallback(async () => {
    if (!api.isConfigured()) {
      showMessage('未配置服务器', 'warning');
      return;
    }
    showMessage('正在同步数据...', 'info');
    await fullSync();
    
    const latestStatus = syncService.getStatus();
    if (latestStatus.error) {
      showMessage(`同步失败: ${latestStatus.error}`, 'error');
    } else {
      showMessage('数据同步成功', 'success');
    }
  }, [fullSync, showMessage]);

  const handleClearData = useCallback(() => {
    Alert.alert(
      '清除数据',
      '确定要清除所有本地数据吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            await localDb.clearAllData();
            showMessage('数据已清除', 'success');
          },
        },
      ]
    );
  }, [showMessage]);

  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <View className="px-5 py-4">
          <Text className="text-[#f2f5f4] text-2xl font-bold">设置</Text>
          <Text className="text-[#77818b] text-sm mt-1">连接桌面端并管理本地数据</Text>
        </View>

        <SettingSection title="语言">
          <View className="flex-row p-4 gap-2">
            <TouchableOpacity
              className={`flex-1 py-2 rounded-lg items-center ${language === 'zh' ? 'bg-cyan-500' : 'bg-white/5'}`}
              onPress={() => setLanguage('zh')}
            >
              <Text className={`text-base ${language === 'zh' ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
                中文
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-2 rounded-lg items-center ${language === 'en' ? 'bg-cyan-500' : 'bg-white/5'}`}
              onPress={() => setLanguage('en')}
            >
              <Text className={`text-base ${language === 'en' ? 'text-[#0a0b12] font-bold' : 'text-gray-400'}`}>
                English
              </Text>
            </TouchableOpacity>
          </View>
        </SettingSection>

        <SettingSection title="同步">
          <SettingItem label="启用同步">
            <Switch
              value={syncEnabled}
              onValueChange={setSyncEnabled}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
            />
          </SettingItem>

          <SettingItem
            label="服务器配置"
            value={serverUrl || '未配置'}
            onPress={() => setShowConfigInput(true)}
          />

          <SettingItem
            label="扫码配对"
            onPress={() => navigation.navigate('PairScan')}
          />

          <SettingItem label="自动同步">
            <Switch
              value={autoSync}
              onValueChange={setAutoSync}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#22d3ee' }}
              thumbColor="#e8e8e8"
            />
          </SettingItem>

          <View className="flex-row items-center justify-between p-4">
            <Text className="text-gray-400 text-sm">
              待同步: {status.pending}
            </Text>
            <TouchableOpacity
              className={`bg-cyan-400 px-4 py-2 rounded-lg ${isSyncing ? 'opacity-60' : ''}`}
              onPress={handleSyncNow}
              disabled={isSyncing}
            >
              <Text className="text-[#0a0b12] text-sm font-bold">
                {isSyncing ? '同步中...' : '立即同步'}
              </Text>
            </TouchableOpacity>
          </View>
        </SettingSection>

        <SettingSection title="关于">
          <SettingItem label="版本" value="1.0.0" />
        </SettingSection>

        <TouchableOpacity className="mx-5 mt-8 p-4 rounded-xl bg-red-500/20 items-center border border-red-500/50" onPress={handleClearData}>
          <Text className="text-red-400 text-base font-bold">清除数据</Text>
        </TouchableOpacity>

        <Modal
          visible={showConfigInput}
          transparent
          animationType="fade"
          onRequestClose={() => !testingConnection && setShowConfigInput(false)}
        >
          <View className="flex-1 bg-black/70 justify-center items-center p-5">
            <View className="bg-[#0a0b12] border border-white/10 rounded-2xl p-5 w-full max-w-sm">
              <Text className="text-[#e8e8e8] text-lg font-bold mb-4 text-center">服务器配置</Text>
              
              <Text className="text-gray-400 text-sm mb-1 ml-1">服务器地址</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-4"
                value={serverUrlInput}
                onChangeText={setServerUrlInput}
                placeholder="http://192.168.1.x:3001"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              
              <Text className="text-gray-400 text-sm mb-1 ml-1">配对码（必填）</Text>
              <TextInput
                className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-200 text-base mb-5"
                value={authTokenInput}
                onChangeText={setAuthTokenInput}
                placeholder="桌面端显示的配对码"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              
              <View className="flex-row gap-4">
                <TouchableOpacity
                  className="flex-1 py-3 rounded-xl bg-black/40 border border-white/10 items-center"
                  onPress={() => setShowConfigInput(false)}
                  disabled={testingConnection}
                >
                  <Text className="text-gray-400 text-base">取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 py-3 rounded-xl bg-cyan-400 items-center ${testingConnection ? 'opacity-60' : ''}`}
                  onPress={handleSaveConfig}
                  disabled={testingConnection}
                >
                  {testingConnection ? (
                    <ActivityIndicator color="#0a0b12" />
                  ) : (
                    <Text className="text-[#0a0b12] text-base font-bold">测试并保存</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}
