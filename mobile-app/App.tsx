import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from '@/navigation/AppNavigator';
import { HUDProvider } from '@/components/HUD';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import { syncService } from '@/services/syncService';
import '@/locales';

function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  const serverUrl = useSettings((s) => s.serverUrl);
  const authToken = useSettings((s) => s.authToken);
  const autoSync = useSettings((s) => s.autoSync);
  const syncEnabled = useSettings((s) => s.syncEnabled);

  // 初始化本地 SQLite 数据库
  useEffect(() => {
    syncService.initialize().catch((err) => {
      console.error('Failed to initialize local database:', err);
    });
  }, []);

  // 配置 API 客户端
  useEffect(() => {
    if (serverUrl && serverUrl.trim()) {
      api.configure({ 
        baseUrl: serverUrl.trim(), 
        authToken: authToken?.trim()
      });
    }
  }, [serverUrl, authToken]);

  // 控制自动同步生命周期
  useEffect(() => {
    if (syncEnabled && autoSync && serverUrl && serverUrl.trim()) {
      syncService.startAutoSync();
    } else {
      syncService.stopAutoSync();
    }
    return () => {
      syncService.stopAutoSync();
    };
  }, [syncEnabled, autoSync, serverUrl]);

  return <>{children}</>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HUDProvider>
          <ApiConfigProvider>
            <NavigationContainer>
              <StatusBar style="light" />
              <AppNavigator />
            </NavigationContainer>
          </ApiConfigProvider>
        </HUDProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
