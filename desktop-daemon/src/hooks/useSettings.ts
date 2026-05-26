"use client";

import { useState, useEffect, useCallback } from 'react';
import { BRAIN_URL } from '@/lib/config';

async function safeInvoke(cmd: string, args?: any) {
  if (typeof window === 'undefined') return;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke(cmd, args);
  } catch (e) {
    console.warn(`safeInvoke ${cmd} 失败:`, e);
  }
}

export interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  default: string;
  current: string;
  category: string;
}

export interface AppSettings {
  keyboardShortcuts: KeyboardShortcut[];
  appearance: {
    theme: 'dark' | 'light' | 'auto';
    accentColor: string;
  };
  behavior: {
    autoHUD: boolean;
    autoMinimize: boolean;
    startWithSystem: boolean;
    defaultFloatingHUD: boolean;
    closeAction: 'minimize_to_tray' | 'exit';
    onboarded: boolean;
    capturePaused: boolean;
    captureBlocklist: string[];
  };
  llmProvider: {
    apiUrl: string;
    apiKey: string;
    model: string;
  };
}

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'precipitate',
    name: 'shortcuts.precipitate',
    description: 'shortcuts.precipitate_desc',
    default: 'ctrl+shift+p',
    current: 'ctrl+shift+p',
    category: 'action',
  },
  {
    id: 'decision',
    name: 'shortcuts.decision',
    description: 'shortcuts.decision_desc',
    default: 'ctrl+shift+d',
    current: 'ctrl+shift+d',
    category: 'action',
  },
  {
    id: 'reset',
    name: 'shortcuts.reset',
    description: 'shortcuts.reset_desc',
    default: 'ctrl+shift+r',
    current: 'ctrl+shift+r',
    category: 'action',
  },
  {
    id: 'graphView',
    name: 'shortcuts.graph_view',
    description: 'shortcuts.graph_view_desc',
    default: 'ctrl+shift+g',
    current: 'ctrl+shift+g',
    category: 'view',
  },
  {
    id: 'consoleView',
    name: 'shortcuts.console_view',
    description: 'shortcuts.console_view_desc',
    default: 'ctrl+shift+c',
    current: 'ctrl+shift+c',
    category: 'view',
  },
  {
    id: 'toggleHUD',
    name: 'shortcuts.toggle_hud',
    description: 'shortcuts.toggle_hud_desc',
    default: 'ctrl+shift+h',
    current: 'ctrl+shift+h',
    category: 'view',
  },
  {
    id: 'openSettings',
    name: 'shortcuts.open_settings',
    description: 'shortcuts.open_settings_desc',
    default: 'ctrl+,',
    current: 'ctrl+,',
    category: 'system',
  },
  {
    id: 'connectHardware',
    name: 'shortcuts.connect_hardware',
    description: 'shortcuts.connect_hardware_desc',
    default: 'ctrl+shift+e',
    current: 'ctrl+shift+e',
    category: 'hardware',
  },
];

const DEFAULT_SETTINGS: AppSettings = {
  keyboardShortcuts: DEFAULT_SHORTCUTS,
  appearance: {
    theme: 'dark',
    accentColor: '#22d3ee',
  },
  behavior: {
    autoHUD: true,
    autoMinimize: false,
    startWithSystem: false,
    defaultFloatingHUD: false,
    closeAction: 'minimize_to_tray',
    onboarded: false,
    capturePaused: false,
    captureBlocklist: [
      'KeePass',
      '1Password',
      'Bitwarden',
      'WeChat',
      '微信',
      'QQ',
      'Telegram',
      'Signal',
      'Bank',
    ],
  },
  llmProvider: {
    apiUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen2.5:7b',
  },
};

// 与磁盘上的旧版本 settings 合并：保证新增字段有默认值，
// 否则升级后访问 settings.llmProvider.apiKey 等会直接 crash。
function mergeWithDefaults(stored: any): AppSettings {
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
  return {
    keyboardShortcuts: Array.isArray(stored.keyboardShortcuts) && stored.keyboardShortcuts.length > 0
      ? stored.keyboardShortcuts
      : DEFAULT_SETTINGS.keyboardShortcuts,
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(stored.appearance || {}) },
    behavior: {
      ...DEFAULT_SETTINGS.behavior,
      ...(stored.behavior || {}),
      // captureBlocklist 不参与浅合并：优先取存储值，存储值为空数组则保留（用户显式清空），
      // 存储值不存在则回退到默认列表
      captureBlocklist: Array.isArray((stored.behavior || {}).captureBlocklist)
        ? (stored.behavior || {}).captureBlocklist
        : DEFAULT_SETTINGS.behavior.captureBlocklist,
    },
    llmProvider: { ...DEFAULT_SETTINGS.llmProvider, ...(stored.llmProvider || {}) },
  };
}



export async function syncLlmToBrainServer(llmProvider: { apiUrl: string; apiKey: string; model: string }) {
  try {
    await fetch(`${BRAIN_URL}/api/settings/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(llmProvider),
    });
  } catch {
    // brain-server 未就绪时静默失败
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [showSettings, setShowSettings] = useState(false);

  // 加载本地存储
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('omnicontext-settings');
      const onboardedFlag = localStorage.getItem('omni_onboarded') === 'true';
      if (savedSettings) {
        const merged = mergeWithDefaults(JSON.parse(savedSettings));
        merged.behavior.onboarded = merged.behavior.onboarded || onboardedFlag;
        setSettings(merged);
        if (merged.behavior.closeAction) {
          safeInvoke('set_close_behavior', { behavior: merged.behavior.closeAction }).catch(() => {});
        }
      } else {
        const defaultSettings = { ...DEFAULT_SETTINGS };
        defaultSettings.behavior.onboarded = onboardedFlag;
        setSettings(defaultSettings);
        safeInvoke('set_close_behavior', { behavior: 'minimize_to_tray' }).catch(() => {});
      }
    } catch (error) {
      console.warn('加载设置失败:', error);
    }
  }, []);

  // 应用主题到 <html> 根元素
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.classList.remove('dark', 'light');
    const theme = settings.appearance.theme;
    if (theme === 'auto') {
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
      html.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      html.classList.add(theme);
    }
  }, [settings.appearance.theme]);

  // 保存到本地存储
  const saveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('omnicontext-settings', JSON.stringify(newSettings));
    } catch (error) {
      console.warn('保存设置失败:', error);
    }
  }, []);

  // 更新单个快捷键
  const updateShortcut = useCallback((id: string, newShortcut: string) => {
    saveSettings({
      ...settings,
      keyboardShortcuts: settings.keyboardShortcuts.map((s) =>
        s.id === id ? { ...s, current: newShortcut } : s
      ),
    });
  }, [settings, saveSettings]);

  // 重置快捷键到默认
  const resetShortcuts = useCallback(() => {
    saveSettings({
      ...settings,
      keyboardShortcuts: DEFAULT_SHORTCUTS.map((s) => ({
        ...s,
        current: s.default,
      })),
    });
  }, [settings, saveSettings]);

  // 更新外观设置
  const updateAppearance = useCallback((updates: Partial<AppSettings['appearance']>) => {
    saveSettings({
      ...settings,
      appearance: { ...settings.appearance, ...updates },
    });
  }, [settings, saveSettings]);

  // 更新行为设置
  const updateBehavior = useCallback((updates: Partial<AppSettings['behavior']>) => {
    const newSettings = {
      ...settings,
      behavior: { ...settings.behavior, ...updates },
    };
    saveSettings(newSettings);
    
    if (updates.closeAction !== undefined) {
      safeInvoke('set_close_behavior', { behavior: updates.closeAction }).catch(() => {});
    }
    if (updates.onboarded !== undefined) {
      localStorage.setItem('omni_onboarded', String(updates.onboarded));
    }
    if (updates.startWithSystem !== undefined) {
      if (updates.startWithSystem) {
        safeInvoke('plugin:autostart|enable').catch(() => {});
      } else {
        safeInvoke('plugin:autostart|disable').catch(() => {});
      }
    }
  }, [settings, saveSettings]);

  // 更新大模型设置
  const updateLlmProvider = useCallback((updates: Partial<AppSettings['llmProvider']>) => {
    saveSettings({
      ...settings,
      llmProvider: { ...settings.llmProvider, ...updates },
    });
  }, [settings, saveSettings]);

  return {
    settings,
    setSettings,
    saveSettings,
    showSettings,
    setShowSettings,
    updateShortcut,
    resetShortcuts,
    updateAppearance,
    updateBehavior,
    updateLlmProvider,
  };
}
