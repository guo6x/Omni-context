"use client";

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';
import { THEMES, ThemeId } from '@/lib/themes';
import { createCapturePolicySynchronizer } from '@/lib/capture-policy-sync';
import { capturePolicySyncErrorFromSave, persistSettingsWhileLocked } from '@/lib/settings-persistence';

async function safeInvoke(cmd: string, args?: any) {
  if (typeof window === 'undefined') return;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke(cmd, args);
  } catch (e) {
    console.warn(`safeInvoke ${cmd} 失败:`, e);
  }
}

let capturePolicySyncError: string | null = null;
let capturePolicySyncPending = false;
let capturePolicySyncOperations = 0;
const capturePolicySyncSubscribers = new Set<(error: string | null, pending: boolean) => void>();
let capturePolicySynchronizer: ReturnType<typeof createCapturePolicySynchronizer> | null = null;
const CAPTURE_POLICY_LOCK_NAME = 'omnicontext-settings-and-capture-policy-v1';
let fallbackSettingsQueue: Promise<void> = Promise.resolve();

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window as any;
  return Boolean(host.__TAURI_IPC__ || host.__TAURI_INTERNALS__ || host.__TAURI__);
}

function runExclusiveSettingsLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: { request: <R>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<R>) => Promise<R> } }).locks;
  if (lockManager?.request) {
    return lockManager.request(CAPTURE_POLICY_LOCK_NAME, { mode: 'exclusive' }, operation) as unknown as Promise<T>;
  }
  if (isTauriRuntime()) {
    return Promise.reject(new Error('Cross-window settings coordination is unavailable; privacy changes were not applied.'));
  }

  const task = fallbackSettingsQueue.then(operation, operation);
  fallbackSettingsQueue = task.then(() => undefined, () => undefined);
  return task;
}

function publishCapturePolicySyncResult(error: unknown = null) {
  const message = error ? '无法确认隐私设置已同步到本机硬件监听器。' : null;
  capturePolicySyncError = message;
  capturePolicySyncSubscribers.forEach((subscriber) => subscriber(message, capturePolicySyncPending));
  if (error) console.error('同步本机硬件隐私策略失败:', error);
}

function publishCapturePolicySyncPending(pending: boolean) {
  capturePolicySyncPending = pending;
  capturePolicySyncSubscribers.forEach((subscriber) => subscriber(capturePolicySyncError, pending));
}

async function enqueueCapturePolicySync(): Promise<boolean> {
  if (!isTauriRuntime()) {
    publishCapturePolicySyncResult();
    return true;
  }
  return withCapturePolicySyncActivity(() => getCapturePolicySynchronizer().sync());
}

function getCapturePolicySynchronizer() {
  if (!capturePolicySynchronizer) {
    capturePolicySynchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => localStorage.getItem('omnicontext-settings'),
      invokeNative: async (command, args) => {
        const { invoke } = await import('@tauri-apps/api/tauri');
        return invoke(command, args);
      },
      defaults: DEFAULT_SETTINGS.behavior,
      runExclusive: runExclusiveSettingsLock,
      onResult: publishCapturePolicySyncResult,
    });
  }
  return capturePolicySynchronizer;
}

async function withCapturePolicySyncActivity<T>(operation: () => Promise<T>): Promise<T> {
  capturePolicySyncOperations += 1;
  publishCapturePolicySyncPending(true);
  try {
    return await operation();
  } finally {
    capturePolicySyncOperations -= 1;
    if (capturePolicySyncOperations === 0) publishCapturePolicySyncPending(false);
  }
}

export function useCapturePolicySyncStatus() {
  const [status, setStatus] = useState({ error: capturePolicySyncError, pending: capturePolicySyncPending });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const subscriber = (error: string | null, pending: boolean) => setStatus({ error, pending });
    capturePolicySyncSubscribers.add(subscriber);
    setStatus({ error: capturePolicySyncError, pending: capturePolicySyncPending });
    return () => {
      capturePolicySyncSubscribers.delete(subscriber);
    };
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await enqueueCapturePolicySync();
    } finally {
      setRetrying(false);
    }
  }, []);

  return { error: status.error, pending: status.pending, retry, retrying };
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
    theme: ThemeId;
    accentColor: string;
    /** 图谱总览最多显示节点数；0 = 按设备自动 */
    graphNodeCap: number;
  };
  behavior: {
    autoHUD: boolean;
    autoMinimize: boolean;
    startWithSystem: boolean;
    defaultFloatingHUD: boolean;
    closeAction: 'minimize_to_tray' | 'exit';
    onboarded: boolean;
    onboarded_v2: boolean;
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
    id: 'reset',
    name: 'shortcuts.reset',
    description: 'shortcuts.reset_desc',
    default: 'ctrl+shift+r',
    current: 'ctrl+shift+r',
    category: 'action',
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

function normalizeKeyboardShortcuts(stored: unknown): KeyboardShortcut[] {
  if (!Array.isArray(stored)) return DEFAULT_SHORTCUTS;

  const storedById = new Map(
    stored
      .filter((s): s is KeyboardShortcut => Boolean(s && typeof s === 'object' && 'id' in s))
      .map((s) => [s.id, s])
  );

  return DEFAULT_SHORTCUTS.map((shortcut) => ({
    ...shortcut,
    current: storedById.get(shortcut.id)?.current || shortcut.default,
  }));
}

const DEFAULT_SETTINGS: AppSettings = {
  keyboardShortcuts: DEFAULT_SHORTCUTS,
  appearance: {
    theme: 'neutral-dark',
    accentColor: '#3b82f6',
    graphNodeCap: 0,
  },
  behavior: {
    autoHUD: true,
    autoMinimize: false,
    startWithSystem: false,
    defaultFloatingHUD: false,
    closeAction: 'minimize_to_tray',
    onboarded: false,
    onboarded_v2: false,
    capturePaused: true,
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
  
  // 兼容老版本主题切换
  let theme: ThemeId = 'neutral-dark';
  if (stored.appearance && stored.appearance.theme) {
    const oldTheme = stored.appearance.theme;
    if (oldTheme === 'dark' || oldTheme === 'auto') {
      theme = 'cyberpunk';
    } else if (oldTheme === 'light') {
      theme = 'soft-light';
    } else {
      theme = oldTheme as ThemeId;
    }
  }

  return {
    keyboardShortcuts: normalizeKeyboardShortcuts(stored.keyboardShortcuts),
    appearance: { 
      ...DEFAULT_SETTINGS.appearance, 
      ...(stored.appearance || {}),
      theme
    },
    behavior: {
      ...DEFAULT_SETTINGS.behavior,
      ...(stored.behavior || {}),
      onboarded_v2: (stored.behavior || {}).onboarded_v2 ?? false,
      // captureBlocklist 不参与浅合并：优先取存储值，存储值为空数组则保留（用户显式清空），
      // 存储值不存在则回退到默认列表
      captureBlocklist: Array.isArray((stored.behavior || {}).captureBlocklist)
        ? (stored.behavior || {}).captureBlocklist
        : DEFAULT_SETTINGS.behavior.captureBlocklist,
    },
    llmProvider: { ...DEFAULT_SETTINGS.llmProvider, ...(stored.llmProvider || {}) },
  };
}

function readSettingsFromStorage(persisted = localStorage.getItem('omnicontext-settings')): AppSettings {
  const stored = persisted ? JSON.parse(persisted) : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const merged = mergeWithDefaults(stored);
  const onboardedFlag = localStorage.getItem('omni_onboarded') === 'true';
  const onboardedV2Flag = localStorage.getItem('omni_onboarded_v2') === 'true';
  merged.behavior.onboarded = merged.behavior.onboarded || onboardedFlag;
  merged.behavior.onboarded_v2 = merged.behavior.onboarded_v2 || onboardedV2Flag;
  return merged;
}



export async function syncLlmToBrainServer(llmProvider: { apiUrl: string; apiKey: string; model: string }) {
  try {
    const response = await apiFetch('/api/settings/llm', {
      method: 'POST',
      body: JSON.stringify(llmProvider),
    });
    // The background sync ignores the payload, but must still release its body.
    await response.arrayBuffer();
  } catch {
    // brain-server 未就绪时静默失败
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { error: capturePolicySyncError } = useCapturePolicySyncStatus();

  const [showSettings, setShowSettings] = useState(false);

  // 加载本地存储
  useEffect(() => {
    void enqueueCapturePolicySync();
    try {
      const loadedSettings = readSettingsFromStorage();
      setSettings(loadedSettings);
      if (loadedSettings.behavior.closeAction) {
        safeInvoke('set_close_behavior', { behavior: loadedSettings.behavior.closeAction }).catch(() => {});
      }
    } catch (error) {
      console.warn('加载设置失败:', error);
    }

  }, []);

  useEffect(() => {
    let active = true;
    const reconcileFromAnotherWindow = async () => {
      const synchronized = await enqueueCapturePolicySync();
      if (!active || !synchronized) return;
      try {
        setSettings(readSettingsFromStorage());
      } catch (error) {
        console.warn('同步其他窗口的设置失败:', error);
      }
    };
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'omnicontext-settings') void reconcileFromAnotherWindow();
    };
    window.addEventListener('storage', syncFromStorage);
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen('settings-changed', () => {
      void reconcileFromAnotherWindow();
    })).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => {});
    return () => {
      active = false;
      window.removeEventListener('storage', syncFromStorage);
      unlisten?.();
    };
  }, []);

  // 应用主题到 <html> 根元素
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const themeId = settings.appearance.theme;
    const themeObj = THEMES[themeId] || THEMES['neutral-dark'];
    
    // 写入 CSS 自定义属性
    for (const [k, v] of Object.entries(themeObj)) {
      if (typeof v === 'string') {
        html.style.setProperty(`--color-${k}`, v);
      }
    }
    html.dataset.theme = themeId;

    html.classList.remove('dark', 'light');
    if (themeId === 'soft-light' || themeId === 'sepia') {
      html.classList.add('light');
    } else {
      html.classList.add('dark');
    }
  }, [settings.appearance.theme]);

  // 保存到本地存储。更新器在跨窗口锁内读取最新持久值后运行，避免旧 React 快照整包覆盖。
  const saveSettings = useCallback(async (
    update: (current: AppSettings) => AppSettings,
    capturePolicyUpdate = false,
  ): Promise<boolean> => {
    const storageKey = 'omnicontext-settings';
    try {
      const persist = () => getCapturePolicySynchronizer().withExclusive((syncLatestPolicy, invalidatePolicy) =>
        persistSettingsWhileLocked({
          storage: localStorage,
          storageKey,
          defaults: DEFAULT_SETTINGS.behavior,
          currentFromStorage: readSettingsFromStorage,
          update,
          isNativeRuntime: isTauriRuntime(),
          invalidateCapturePolicy: invalidatePolicy,
          syncCapturePolicy: async () => {
            try {
              await syncLatestPolicy();
              publishCapturePolicySyncResult(null);
            } catch (error) {
              publishCapturePolicySyncResult(error);
              throw error;
            }
          },
        }),
      );
      const result = capturePolicyUpdate
        ? await withCapturePolicySyncActivity(persist)
        : await persist();

      if (!result.ok) {
        if (result.settings) setSettings(result.settings);
        const policySyncError = capturePolicySyncErrorFromSave(capturePolicyUpdate, result);
        if (policySyncError !== null) publishCapturePolicySyncResult(policySyncError);
        return false;
      }

      setSettings(result.settings);
      const themeId = result.settings.appearance.theme;
      import('@tauri-apps/api/event').then(({ emit }) => {
        emit('theme-changed', { themeId }).catch(() => {});
        // The event contains no settings or credentials; other windows read
        // the durable store only after confirming its native policy.
        emit('settings-changed').catch(() => {});
      }).catch(() => {});
      return true;
    } catch (error) {
      console.warn('保存设置失败:', error);
      if (capturePolicyUpdate) publishCapturePolicySyncResult(error);
      return false;
    }
  }, []);

  // 更新单个快捷键
  const updateShortcut = useCallback((id: string, newShortcut: string) => {
    void saveSettings((current) => ({
      ...current,
      keyboardShortcuts: current.keyboardShortcuts.map((s) =>
        s.id === id ? { ...s, current: newShortcut } : s
      ),
    }));
  }, [saveSettings]);

  // 重置快捷键到默认
  const resetShortcuts = useCallback(() => {
    void saveSettings((current) => ({
      ...current,
      keyboardShortcuts: DEFAULT_SHORTCUTS.map((s) => ({
        ...s,
        current: s.default,
      })),
    }));
  }, [saveSettings]);

  // 更新外观设置
  const updateAppearance = useCallback((updates: Partial<AppSettings['appearance']>) => {
    void saveSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, ...updates },
    }));
  }, [saveSettings]);

  // 更新行为设置
  const updateBehavior = useCallback(async (updates: Partial<AppSettings['behavior']>) => {
    const capturePolicyUpdate = updates.capturePaused !== undefined || updates.captureBlocklist !== undefined;
    const saved = await saveSettings((current) => ({
      ...current,
      behavior: { ...current.behavior, ...updates },
    }), capturePolicyUpdate);
    if (!saved) return false;
    
    if (updates.closeAction !== undefined) {
      safeInvoke('set_close_behavior', { behavior: updates.closeAction }).catch(() => {});
    }
    if (updates.onboarded !== undefined) {
      localStorage.setItem('omni_onboarded', String(updates.onboarded));
    }
    if (updates.onboarded_v2 !== undefined) {
      localStorage.setItem('omni_onboarded_v2', String(updates.onboarded_v2));
    }
    if (updates.startWithSystem !== undefined) {
      if (updates.startWithSystem) {
        safeInvoke('plugin:autostart|enable').catch(() => {});
      } else {
        safeInvoke('plugin:autostart|disable').catch(() => {});
      }
    }
    return true;
  }, [saveSettings]);

  // 更新大模型设置
  const updateLlmProvider = useCallback((updates: Partial<AppSettings['llmProvider']>) => {
    void saveSettings((current) => ({
      ...current,
      llmProvider: { ...current.llmProvider, ...updates },
    }));
  }, [saveSettings]);

  return {
    settings,
    capturePolicySyncError,
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
