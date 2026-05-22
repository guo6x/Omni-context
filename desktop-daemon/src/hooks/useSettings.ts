"use client";

import { useState, useEffect, useCallback } from 'react';
import { BRAIN_URL } from '@/lib/config';

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
    name: '沉淀',
    description: '捕获当前屏幕并提取知识',
    default: 'ctrl+shift+p',
    current: 'ctrl+shift+p',
    category: '操作',
  },
  {
    id: 'decision',
    name: '决策',
    description: '查询相关决策建议',
    default: 'ctrl+shift+d',
    current: 'ctrl+shift+d',
    category: '操作',
  },
  {
    id: 'reset',
    name: '重置',
    description: '重置当前状态',
    default: 'ctrl+shift+r',
    current: 'ctrl+shift+r',
    category: '操作',
  },
  {
    id: 'graphView',
    name: '图谱视图',
    description: '切换到知识图谱视图',
    default: 'ctrl+shift+g',
    current: 'ctrl+shift+g',
    category: '视图',
  },
  {
    id: 'consoleView',
    name: '控制台视图',
    description: '切换到系统控制台',
    default: 'ctrl+shift+c',
    current: 'ctrl+shift+c',
    category: '视图',
  },
  {
    id: 'toggleHUD',
    name: 'HUD 显示',
    description: '显示/隐藏 HUD 悬浮窗',
    default: 'ctrl+shift+h',
    current: 'ctrl+shift+h',
    category: '视图',
  },
  {
    id: 'openSettings',
    name: '设置面板',
    description: '打开/关闭设置面板',
    default: 'ctrl+,',
    current: 'ctrl+,',
    category: '系统',
  },
  {
    id: 'connectHardware',
    name: '连接硬件',
    description: '搜索并配对 ESP32 神经末梢（实验性）',
    default: 'ctrl+shift+e',
    current: 'ctrl+shift+e',
    category: '硬件',
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
    behavior: { ...DEFAULT_SETTINGS.behavior, ...(stored.behavior || {}) },
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
      if (savedSettings) {
        setSettings(mergeWithDefaults(JSON.parse(savedSettings)));
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
    saveSettings({
      ...settings,
      behavior: { ...settings.behavior, ...updates },
    });
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
