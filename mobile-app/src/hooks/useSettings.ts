import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from '@/types';

interface SettingsState extends AppSettings {
  setTheme: (theme: 'dark' | 'light') => void;
  setLanguage: (language: 'zh' | 'en') => void;
  setSyncEnabled: (enabled: boolean) => void;
  setServerUrl: (url: string) => void;
  setAutoSync: (autoSync: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'zh',
  syncEnabled: false,
  serverUrl: '',
  autoSync: true,
  notificationsEnabled: true,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setSyncEnabled: (syncEnabled) => set({ syncEnabled }),
      setServerUrl: (serverUrl) => set({ serverUrl }),
      setAutoSync: (autoSync) => set({ autoSync }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      reset: () => set(defaultSettings),
    }),
    {
      name: 'omni-context-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

import React, { createContext, useContext, ReactNode } from 'react';

const SettingsContext = createContext<ReturnType<typeof useSettings> | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within SettingsProvider');
  }
  return context;
}
