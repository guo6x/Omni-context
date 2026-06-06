import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { AppNavigator } from '@/navigation/AppNavigator';
import { HUDProvider } from '@/components/HUD';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import './locales';

function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  const serverUrl = useSettings((s) => s.serverUrl);
  const authToken = useSettings((s) => s.authToken);
  useEffect(() => {
    if (serverUrl && serverUrl.trim()) {
      api.configure({ 
        baseUrl: serverUrl.trim(), 
        authToken: authToken?.trim()
      });
    }
  }, [serverUrl, authToken]);
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
