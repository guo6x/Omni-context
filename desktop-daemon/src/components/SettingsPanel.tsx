"use client";

import { X, Check, RotateCcw, Palette, Keyboard, Sliders, Globe, Database as DatabaseIcon, Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw, Share2, Search, Lightbulb, Camera, GitBranch, ChevronDown, ChevronRight, Shield, Info } from 'lucide-react';
import { useRef, useState, useEffect, useMemo, createElement } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { KeyboardShortcut, AppSettings } from '@/hooks/useSettings';
import { LLM_PRESETS, LlmPreset } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { BRAIN_URL } from '@/lib/config';
import { MCP_CLIENTS } from '@/lib/mcp-clients';
import { MCP_SCENARIOS } from '@/lib/mcp-scenarios';
import { findSystemConflict, normalizeShortcut } from '@/lib/known-system-shortcuts';
import McpClientCard from './McpClientCard';

// autostart 插件调用。非 Tauri 环境静默降级。
async function autostartEnable() {
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('plugin:autostart|enable');
  } catch {}
}
async function autostartDisable() {
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    await invoke('plugin:autostart|disable');
  } catch {}
}
async function autostartIsEnabled(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke<boolean>('plugin:autostart|is_enabled');
  } catch {
    return false;
  }
}

interface SettingsPanelProps {
  settings: AppSettings;
  language: 'zh' | 'en';
  onUpdateShortcut: (id: string, shortcut: string) => void;
  onResetShortcuts: () => void;
  onUpdateAppearance: (updates: Partial<AppSettings['appearance']>) => void;
  onUpdateBehavior: (updates: Partial<AppSettings['behavior']>) => void;
  onUpdateLlmProvider: (updates: Partial<AppSettings['llmProvider']>) => void;
  onUpdateLanguage: (lang: 'zh' | 'en') => void;
  onClose: () => void;
}

type Tab = 'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'mcp' | 'diagnostics' | 'privacy' | 'about';

export default function SettingsPanel({
  settings,
  language,
  onUpdateShortcut,
  onResetShortcuts,
  onUpdateAppearance,
  onUpdateBehavior,
  onUpdateLlmProvider,
  onUpdateLanguage,
  onClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('shortcuts');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempShortcut, setTempShortcut] = useState('');
  const { t } = useTranslation();
  const toast = useToast();

  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  
  const [llmTestState, setLlmTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [llmTestError, setLlmTestError] = useState('');
  const [embeddingReloading, setEmbeddingReloading] = useState(false);
  const [pairCodeInfo, setPairCodeInfo] = useState<{ code: string; lan_ip: string; port: number } | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'available' | 'no-update' | 'error'>('idle');
  const [updateVersion, setUpdateVersion] = useState('');

  const [mcpStatuses, setMcpStatuses] = useState<any[]>([]);
  const [mcpServerCmd, setMcpServerCmd] = useState<any>(null);
  const [scenarioExpanded, setScenarioExpanded] = useState(true);

  const fetchMcpData = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const statuses = await invoke<any[]>('mcp_get_clients_status');
      const cmd = await invoke<any>('mcp_get_server_command');
      setMcpStatuses(statuses);
      setMcpServerCmd(cmd);
    } catch (e) {
      console.error('获取 MCP 状态失败:', e);
    }
  };

  useEffect(() => {
    if (activeTab === 'mcp') {
      fetchMcpData();
    }
  }, [activeTab]);

  const fetchPairCode = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const info = await invoke<{ code: string; lan_ip: string; port: number }>('get_pair_code');
      setPairCodeInfo(info);
    } catch {
      setPairCodeInfo(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'data') {
      fetchPairCode();
    }
  }, [activeTab]);

  const handleRegeneratePairCode = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const info = await invoke<{ code: string; lan_ip: string; port: number }>('regenerate_pair_code');
      setPairCodeInfo(info);
      toast.success(t('settings.pair_code_regenerated'));
    } catch (e) {
      toast.error(t('settings.pair_code_regen_failed'), String(e));
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateStatus('idle');
    try {
      const { checkUpdate, installUpdate } = await import('@tauri-apps/api/updater');
      const { shouldUpdate, manifest } = await checkUpdate();
      if (shouldUpdate && manifest) {
        setUpdateStatus('available');
        setUpdateVersion(manifest.version);
        const updateMsg = t('settings.update_available').replace('{version}', manifest.version);
        const dismissId = toast.info(
          updateMsg,
          manifest.body || '',
          {
            action: (
              <button
                onClick={async () => {
                  toast.dismiss(dismissId);
                  try {
                    await installUpdate();
                    toast.success(t('settings.update_complete'));
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    toast.error(t('settings.update_download_failed'), msg);
                  }
                }}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-colors ml-2"
              >
                {t('settings.update_click_to_update')}
              </button>
            ),
          }
        );
      } else {
        setUpdateStatus('no-update');
        toast.success(t('settings.update_no_update'));
      }
    } catch (e) {
      setUpdateStatus('error');
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t('settings.update_check_failed'), msg);
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleMcpInstall = async (clientId: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('mcp_install_to', { clientId });
      toast.success(t('settings.mcp_install_success'));
      fetchMcpData();
    } catch (e) {
      toast.error(t('toast.mcp_install_failed'), String(e));
    }
  };

  const handleMcpOpenFolder = async (clientId: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('mcp_open_config_folder', { clientId });
    } catch (e) {
      toast.error(t('toast.mcp_open_folder_failed'), String(e));
    }
  };

  const handleTestLlmConnection = async () => {
    setLlmTestState('testing');
    setLlmTestError('');
    try {
      const res = await fetch(`${BRAIN_URL}/api/settings/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: settings.llmProvider.apiUrl,
          apiKey: settings.llmProvider.apiKey,
          model: settings.llmProvider.model,
        }),
      });
      const data = await res.json();
      if (res.ok && data.healthy) {
        setLlmTestState('success');
        toast.success(t('onboarding.test_success'));
      } else {
        setLlmTestState('failed');
        setLlmTestError(data.warning || t('onboarding.test_failed'));
      }
    } catch (err) {
      setLlmTestState('failed');
      setLlmTestError(String(err));
    }
  };

  const fetchDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const res = await fetch(`${BRAIN_URL}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDiagnosticsData(data);
    } catch (err) {
      setDiagnosticsError(t('settings.diagnostics_backend_offline'));
      setDiagnosticsData(null);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const handleEmbeddingReload = async () => {
    setEmbeddingReloading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${BRAIN_URL}/api/admin/embedding/reload`, {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('settings.embedding_reloaded'));
      await fetchDiagnostics();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('settings.embedding_reload_failed'), msg);
    } finally {
      setEmbeddingReloading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      fetchDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleShortcutKeyDown = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];
    if (e.ctrlKey) keys.push('ctrl');
    if (e.metaKey) keys.push('cmd');
    if (e.shiftKey) keys.push('shift');
    if (e.altKey) keys.push('alt');

    const pressedKey = e.key.toLowerCase();
    if (!['ctrl', 'cmd', 'shift', 'alt', 'meta'].includes(pressedKey)) {
      keys.push(pressedKey);
    }

    setTempShortcut(keys.join('+'));

    if (e.key === 'Enter') {
      finishEditing(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setTempShortcut('');
    }
  };

  const finishEditing = (id: string) => {
    if (!tempShortcut) return;
    const conflict = shortcutConflict;
    if (conflict) {
      const conflictLabel = conflict.type === 'omni'
        ? t('graph.conflict_with_omni').replace('{name}', t(conflict.name))
        : t('graph.conflict_with_system').replace('{name}', language === 'zh' ? conflict.labelZh : conflict.labelEn);
      const ok = window.confirm(`${conflictLabel}\n\n${t('graph.conflict_confirm')}`);
      if (!ok) return;
    }
    onUpdateShortcut(id, tempShortcut);
    setEditingId(null);
    setTempShortcut('');
  };

  // 快捷键冲突检测（实时，在编辑时计算）
  const shortcutConflict = useMemo<{
    type: 'omni'; name: string; id: string;
  } | {
    type: 'system'; labelZh: string; labelEn: string;
  } | null>(() => {
    if (!editingId || !tempShortcut) return null;
    const normalized = normalizeShortcut(tempShortcut);
    // 检查 omni 快捷键
    const omniConflict = settings.keyboardShortcuts.find(
      s => s.id !== editingId && normalizeShortcut(s.current) === normalized
    );
    if (omniConflict) return { type: 'omni', name: omniConflict.name, id: omniConflict.id };
    // 检查系统快捷键
    const sysConflict = findSystemConflict(tempShortcut);
    if (sysConflict) return { type: 'system', labelZh: sysConflict.labelZh, labelEn: sysConflict.labelEn };
    return null;
  }, [editingId, tempShortcut, settings.keyboardShortcuts]);

  const startEditing = (shortcut: KeyboardShortcut) => {
    setEditingId(shortcut.id);
    setTempShortcut(shortcut.current);
  };

  // ===== 数据管理：备份/恢复 =====
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dataBusy, setDataBusy] = useState(false);

  const handleExportAll = async () => {
    if (dataBusy) return;
    setDataBusy(true);
    try {
      const res = await fetch(`${BRAIN_URL}/api/admin/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const datePart = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `omni-context-backup-${datePart}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('toast.backup_downloaded'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('toast.export_failed'), msg);
    } finally {
      setDataBusy(false);
    }
  };

  const handleRestoreClick = () => {
    if (dataBusy) return;
    fileInputRef.current?.click();
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // 主线程后续会换成 toast；当前用 confirm/alert 把流程跑通即可。
    const merge = window.confirm(t('toast.restore_mode_prompt'));
    const mode = merge ? 'merge' : 'replace';
    setDataBusy(true);
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsText(file);
      });
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(t('toast.invalid_backup_json'));
      }
      const res = await fetch(`${BRAIN_URL}/api/admin/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, mode }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result?.error || `HTTP ${res.status}`);
      }
      const c = result?.imported || {};
      toast.success(
        t('toast.restore_success').replace('{mode}', mode),
        t('toast.restore_detail')
          .replace('{entities}', String(c.entities ?? 0))
          .replace('{relationships}', String(c.relationships ?? 0))
          .replace('{core}', String(c.coreMemory ?? 0))
          .replace('{archival}', String(c.archivalMemory ?? 0))
          .replace('{notifications}', String(c.notifications ?? 0)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('toast.restore_failed'), msg);
    } finally {
      setDataBusy(false);
    }
  };

  const tabs = [
    { id: 'shortcuts' as Tab, icon: <Keyboard className="w-4 h-4" />, label: t('settings.shortcuts') },
    { id: 'appearance' as Tab, icon: <Palette className="w-4 h-4" />, label: t('settings.appearance') },
    { id: 'behavior' as Tab, icon: <Sliders className="w-4 h-4" />, label: t('settings.behavior') },
    { id: 'llm' as Tab, icon: <Globe className="w-4 h-4" />, label: t('settings.llm_provider') },
    { id: 'data' as Tab, icon: <DatabaseIcon className="w-4 h-4" />, label: t('settings.data') },
    { id: 'mcp' as Tab, icon: <Share2 className="w-4 h-4" />, label: t('settings.mcp_tab') },
    { id: 'diagnostics' as Tab, icon: <Activity className="w-4 h-4" />, label: t('settings.diagnostics') },
    { id: 'privacy' as Tab, icon: <Shield className="w-4 h-4" />, label: t('settings.privacy_title') },
    { id: 'about' as Tab, icon: <Info className="w-4 h-4" />, label: t('settings.about') },
  ];

  // 启动时以 OS 实际状态对账
  useEffect(() => {
    (async () => {
      const osEnabled = await autostartIsEnabled();
      if (osEnabled !== settings.behavior.startWithSystem) {
        onUpdateBehavior({ startWithSystem: osEnabled });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = [...new Set(settings.keyboardShortcuts.map(s => s.category))];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="glass-panel w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">{t('settings.title')}</h2>
            <div className="px-2 py-1 bg-cyan-900/30 border border-cyan-800 rounded text-xs text-cyan-400">
              v0.1.0
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-white/10 rounded-full p-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 侧边栏 */}
          <div className="w-48 border-r border-white/10 p-2 bg-black/20">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors text-left ${
                  activeTab === tab.id
                    ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-800'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'shortcuts' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{t('settings.shortcuts')}</h3>
                  </div>
                  <button
                    onClick={onResetShortcuts}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t('settings.reset_defaults')}
                  </button>
                </div>

                {categories.map((category) => (
                  <div key={category} className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                      {t(`settings.category.${category.toLowerCase()}`) || category}
                    </h4>
                    <div className="space-y-2">
                      {settings.keyboardShortcuts
                        .filter((s) => s.category === category)
                        .map((shortcut) => (
                          <div key={shortcut.id}>
                            <div
                              className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5 hover:border-white/10 transition-colors"
                            >
                            <div>
                              <div className="text-white font-medium">{t(shortcut.name)}</div>
                              <div className="text-xs text-gray-500">{t(shortcut.description)}</div>
                            </div>
                            {editingId === shortcut.id ? (
                              <button
                                onKeyDown={(e) => handleShortcutKeyDown(e, shortcut.id)}
                                onClick={() => finishEditing(shortcut.id)}
                                className="px-3 py-1.5 bg-cyan-900/40 border border-cyan-400 text-cyan-400 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/50 animate-pulse"
                              >
                                {tempShortcut || t('settings.press_any_key')}
                              </button>
                            ) : (
                              <button
                                onClick={() => startEditing(shortcut)}
                                className="px-3 py-1.5 bg-white/5 border border-white/10 text-gray-300 rounded-lg font-mono text-sm hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 transition-colors"
                              >
                                {shortcut.current}
                              </button>
                            )}
                          </div>
                          {editingId === shortcut.id && shortcutConflict && (
                            <div className="mt-1 px-3 py-1.5 bg-amber-950/30 border border-amber-800/40 rounded-lg">
                              <div className="flex items-center gap-2 text-amber-400 text-xs">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>
                                  {shortcutConflict.type === 'omni'
                                    ? t('graph.conflict_with_omni').replace('{name}', t(shortcutConflict.name))
                                    : t('graph.conflict_with_system').replace('{name}', language === 'zh' ? shortcutConflict.labelZh : shortcutConflict.labelEn)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.appearance')}</h3>
                </div>

                <div className="space-y-4">
                  {/* 语言设置 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-cyan-400" />
                        <div>
                          <div className="text-white font-medium">{t('settings.language')}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onUpdateLanguage('zh')}
                          className={`px-4 py-2 rounded-lg border transition-colors ${
                            language === 'zh'
                              ? 'bg-cyan-900/40 text-cyan-400 border-cyan-800'
                              : 'text-gray-400 hover:text-white hover:bg-white/5 border-white/10'
                          }`}
                        >
                          {t('settings.language_zh')}
                        </button>
                        <button
                          onClick={() => onUpdateLanguage('en')}
                          className={`px-4 py-2 rounded-lg border transition-colors ${
                            language === 'en'
                              ? 'bg-cyan-900/40 text-cyan-400 border-cyan-800'
                              : 'text-gray-400 hover:text-white hover:bg-white/5 border-white/10'
                          }`}
                        >
                          {t('settings.language_en')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 主题设置 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-medium">{t('settings.theme')}</div>
                      </div>
                      <div className="flex gap-2">
                        {([
                          { key: 'dark', label: t('settings.theme_dark') },
                          { key: 'light', label: t('settings.theme_light') },
                          { key: 'auto', label: t('settings.theme_auto') },
                        ] as const).map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => onUpdateAppearance({ theme: key })}
                            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                              settings.appearance.theme === key
                                ? 'bg-cyan-900/40 text-cyan-400 border-cyan-800'
                                : 'text-gray-400 hover:text-white hover:bg-white/5 border-white/10'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 强调色设置 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-medium">{t('settings.accent_color')}</div>
                      </div>
                      <div className="flex gap-2">
                        {[
                          { color: '#22d3ee', name: 'cyan' },
                          { color: '#a855f7', name: 'purple' },
                          { color: '#f472b6', name: 'pink' },
                          { color: '#10b981', name: 'green' },
                          { color: '#f59e0b', name: 'amber' },
                        ].map(({ color, name }) => (
                          <button
                            key={name}
                            onClick={() => onUpdateAppearance({ accentColor: color })}
                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                              settings.appearance.accentColor === color
                                ? 'border-white shadow-lg'
                                : 'border-transparent'
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'behavior' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.behavior')}</h3>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      key: 'autoHUD',
                      name: t('settings.auto_hud'),
                      description: t('settings.auto_hud_desc'),
                      value: settings.behavior.autoHUD,
                    },
                    {
                      key: 'autoMinimize',
                      name: t('settings.auto_minimize'),
                      description: t('settings.auto_minimize_desc'),
                      value: settings.behavior.autoMinimize,
                    },
                    {
                      key: 'defaultFloatingHUD',
                      name: t('settings.default_floating_hud'),
                      description: t('settings.default_floating_hud_desc'),
                      value: settings.behavior.defaultFloatingHUD,
                    },
                    {
                      key: 'startWithSystem',
                      name: t('settings.start_with_system'),
                      description: t('settings.start_with_system_desc'),
                      value: settings.behavior.startWithSystem,
                    },
                  ].map((item) => {
                    return (
                      <div
                        key={item.key}
                        className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-white font-medium">
                            {item.name}
                          </div>
                          <div className="text-xs text-gray-500">{item.description}</div>
                        </div>
                        <button
                          onClick={() => {
                            const newValue = !settings.behavior[item.key as keyof AppSettings['behavior']];
                            onUpdateBehavior({ [item.key]: newValue });
                            if (item.key === 'startWithSystem') {
                              newValue ? autostartEnable() : autostartDisable();
                            }
                          }}
                          className={`w-14 h-7 rounded-full transition-colors relative ${
                            settings.behavior[item.key as keyof AppSettings['behavior']]
                              ? 'bg-cyan-600'
                              : 'bg-gray-700'
                          }`}
                        >
                          <div
                            className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                              settings.behavior[item.key as keyof AppSettings['behavior']]
                                ? 'transform translate-x-7'
                                : ''
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* [通用] 关闭行为 */}
                <div className="mt-4 p-4 bg-black/20 rounded-lg border border-white/5 space-y-3">
                  <div>
                    <div className="text-white font-medium">{t('settings.close_action')}</div>
                    <div className="text-xs text-gray-500">{t('settings.close_action_desc')}</div>
                  </div>
                  <div className="flex gap-6 mt-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="closeAction"
                        value="minimize_to_tray"
                        checked={settings.behavior.closeAction !== 'exit'}
                        onChange={() => onUpdateBehavior({ closeAction: 'minimize_to_tray' })}
                        className="text-cyan-600 focus:ring-cyan-500 bg-black/40 border-white/10"
                      />
                      {t('settings.close_action_minimize')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="closeAction"
                        value="exit"
                        checked={settings.behavior.closeAction === 'exit'}
                        onChange={() => onUpdateBehavior({ closeAction: 'exit' })}
                        className="text-cyan-600 focus:ring-cyan-500 bg-black/40 border-white/10"
                      />
                      {t('settings.close_action_exit')}
                    </label>
                  </div>
                </div>

                {/* [通用] 打开数据目录 */}
                <div className="mt-4 p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{t('settings.open_data_dir')}</div>
                    <div className="text-xs text-gray-500">{t('settings.open_data_dir_desc')}</div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { invoke } = await import('@tauri-apps/api/tauri');
                        await invoke('open_data_folder');
                      } catch (e) {
                        toast.error(t('toast.cannot_open_dir'), String(e));
                      }
                    }}
                    className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg text-sm transition-colors"
                  >
                    {t('settings.open_dir')}
                  </button>
                </div>

                {/* [通用] 重新启动新手引导 */}
                <div className="mt-4 p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{t('onboarding.restart_tour')}</div>
                    <div className="text-xs text-gray-500">{t('settings.restart_tour_desc')}</div>
                  </div>
                  <button
                    onClick={() => {
                      onUpdateBehavior({ onboarded: false });
                      onClose();
                    }}
                    className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg text-sm transition-colors"
                  >
                    {t('settings.start_tour')}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.llm_provider')}</h3>
                  <p className="text-xs text-gray-400 mt-1">{t('settings.llm_desc')}</p>
                </div>

                <div className="space-y-4">
                  {/* [通用] 推荐服务商预设卡片组 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-3">
                    <label className="text-sm font-medium text-white block">{t('onboarding.preset_label')}</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
                      {LLM_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            if (preset.id !== 'custom') {
                              onUpdateLlmProvider({
                                apiUrl: preset.apiUrl,
                                model: preset.defaultModel,
                              });
                            } else {
                              onUpdateLlmProvider({
                                apiUrl: '',
                                model: '',
                              });
                            }
                            setLlmTestState('idle');
                          }}
                          className={`p-2 rounded-lg border text-left transition-all ${
                            settings.llmProvider.apiUrl === preset.apiUrl && (preset.id === 'custom' || settings.llmProvider.model === preset.defaultModel)
                              ? 'bg-cyan-900/40 border-cyan-400 text-white'
                              : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                          }`}
                        >
                          <div className="text-xs font-bold truncate flex items-center gap-1.5">
                            <span>{preset.emoji}</span>
                            <span>{t(preset.name)}</span>
                          </div>
                          <div className="text-[10px] text-gray-500 truncate mt-0.5">{t(preset.cost)}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* API URL */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block">API URL</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                      value={settings.llmProvider.apiUrl}
                      onChange={(e) => {
                        onUpdateLlmProvider({ apiUrl: e.target.value });
                        setLlmTestState('idle');
                      }}
                      placeholder={t('settings.llm_api_placeholder')}
                    />
                  </div>

                  {/* API Key */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block">API Key</label>
                    <input
                      type="password"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                      value={settings.llmProvider.apiKey}
                      onChange={(e) => {
                        onUpdateLlmProvider({ apiKey: e.target.value });
                        setLlmTestState('idle');
                      }}
                      placeholder={t('settings.llm_key_placeholder')}
                    />
                  </div>

                  {/* Model */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block font-sans">{t('settings.llm_model_label')}</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                      value={settings.llmProvider.model}
                      onChange={(e) => {
                        onUpdateLlmProvider({ model: e.target.value });
                        setLlmTestState('idle');
                      }}
                      placeholder={t('settings.llm_model_placeholder')}
                    />
                  </div>

                  {/* [通用] 测试连接 */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleTestLlmConnection}
                      disabled={llmTestState === 'testing' || !settings.llmProvider.apiUrl}
                      className={`py-2.5 px-4 rounded-lg text-sm font-semibold border transition-all ${
                        llmTestState === 'success'
                          ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400'
                          : llmTestState === 'failed'
                          ? 'bg-rose-950/30 border-rose-500 text-rose-400 hover:bg-rose-900/20'
                          : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'
                      }`}
                    >
                      {llmTestState === 'testing'
                        ? t('onboarding.testing')
                        : llmTestState === 'success'
                        ? `🎉 ${t('onboarding.test_success')}`
                        : t('onboarding.test_btn')}
                    </button>
                    {llmTestState === 'failed' && (
                      <p className="text-xs text-rose-400 text-center leading-relaxed">
                        {llmTestError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.data')}</h3>
                  <p className="text-xs text-gray-400 mt-1">{t('settings.dock_desc')}</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">{t('settings.export_all')}</div>
                      <div className="text-xs text-gray-500">{t('settings.export_desc')}</div>
                    </div>
                    <button
                      onClick={handleExportAll}
                      disabled={dataBusy}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {dataBusy ? t('settings.processing') : t('settings.export_json')}
                    </button>
                  </div>

                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">{t('settings.restore')}</div>
                      <div className="text-xs text-gray-500">{t('settings.restore_desc')}</div>
                    </div>
                    <button
                      onClick={handleRestoreClick}
                      disabled={dataBusy}
                      className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {dataBusy ? t('settings.processing') : t('settings.choose_backup')}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={handleRestoreFile}
                      className="hidden"
                    />
                  </div>

                  {/* 配对码区块：移动端 LAN 连接鉴权 */}
                  {pairCodeInfo && (
                    <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-4">
                      <div>
                        <div className="text-white font-medium">{t('settings.pair_code_title')}</div>
                        <div className="text-xs text-gray-500 mt-1">{t('settings.pair_code_desc')}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="bg-black/30 border border-white/10 rounded-lg p-3">
                          <QRCodeSVG
                            value={`omni://pair?host=${pairCodeInfo.lan_ip}&port=${pairCodeInfo.port}&code=${pairCodeInfo.code}`}
                            size={120}
                            bgColor="#0a0b12"
                            fgColor="#7df9ff"
                            level="M"
                          />
                        </div>
                        <div className="flex-1 space-y-3">
                          <div>
                            <span className="text-xs text-gray-500">{t('settings.pair_code_label')}</span>
                            <p className="text-2xl font-mono text-cyan-400 tracking-[0.3em]">{pairCodeInfo.code}</p>
                          </div>
                          <div className="text-xs text-gray-500">
                            {pairCodeInfo.lan_ip}:{pairCodeInfo.port}
                          </div>
                          <button
                            onClick={handleRegeneratePairCode}
                            className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-700 hover:text-amber-400 text-gray-300 rounded-lg transition-colors"
                          >
                            {t('settings.pair_code_regenerate')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.privacy_title')}</h3>
                  <p className="text-xs text-gray-400 mt-1">{t('settings.privacy_pause_desc')}</p>
                </div>

                <div className="space-y-4">
                  {/* 暂停抓取 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">{t('settings.privacy_pause')}</div>
                      <div className="text-xs text-gray-500">{t('settings.privacy_pause_desc')}</div>
                    </div>
                    <button
                      onClick={() => onUpdateBehavior({ capturePaused: !settings.behavior.capturePaused })}
                      className={`w-14 h-7 rounded-full transition-colors relative ${
                        settings.behavior.capturePaused ? 'bg-amber-600' : 'bg-gray-700'
                      }`}
                    >
                      <div
                        className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                          settings.behavior.capturePaused ? 'transform translate-x-7' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* 敏感应用排除列表 */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-3">
                    <div>
                      <div className="text-white font-medium">{t('settings.privacy_blocklist_label')}</div>
                      <div className="text-xs text-gray-500 mt-1">{t('settings.privacy_blocklist_hint')}</div>
                    </div>
                    <textarea
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono min-h-[180px] resize-y"
                      value={(settings.behavior.captureBlocklist || []).join('\n')}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split('\n')
                          .map((l) => l.trim())
                          .filter((l) => l.length > 0);
                        onUpdateBehavior({ captureBlocklist: lines });
                      }}
                      placeholder={t('settings.privacy_blocklist_placeholder')}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.about')}</h3>
                  <p className="text-xs text-gray-400 mt-1">{t('app.subtitle')}</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">{t('settings.version')}</div>
                      <div className="text-xs text-gray-500">Omni-Context Desktop</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-cyan-900/30 border border-cyan-800 rounded text-xs text-cyan-400 font-mono">
                        v0.1.0
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-black/20 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-medium">{t('settings.update_title')}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {updateStatus === 'available'
                            ? t('settings.update_available').replace('{version}', updateVersion)
                            : updateStatus === 'no-update'
                            ? t('settings.update_no_update')
                            : updateStatus === 'error'
                            ? t('settings.update_check_failed')
                            : t('settings.update_title')}
                        </div>
                      </div>
                      <button
                        onClick={handleCheckUpdate}
                        disabled={updateChecking}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                          updateStatus === 'available'
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                            : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300'
                        } disabled:opacity-50`}
                      >
                        <RefreshCw className={`w-4 h-4 ${updateChecking ? 'animate-spin' : ''}`} />
                        {updateChecking
                          ? t('settings.update_downloading')
                          : updateStatus === 'available'
                          ? t('settings.update_click_to_update')
                          : t('settings.update_refresh')}
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-3">
                    <div className="text-white font-medium">{t('app.title')}</div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Omni-Context - {t('app.subtitle')}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t('settings.version')}: v0.1.0
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'diagnostics' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{t('settings.diagnostics')}</h3>
                    <p className="text-xs text-gray-400 mt-1">{t('settings.diagnostics_desc')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const { invoke } = await import('@tauri-apps/api/tauri');
                          await invoke('open_logs_folder');
                        } catch (e) {
                          toast.error(t('toast.cannot_open_dir'), String(e));
                        }
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg transition-colors"
                    >
                      <DatabaseIcon className="w-4 h-4" />
                      {t('settings.open_logs_dir')}
                    </button>
                    <button
                      onClick={fetchDiagnostics}
                      disabled={diagnosticsLoading}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${diagnosticsLoading ? 'animate-spin' : ''}`} />
                      {t('settings.diagnostics_refresh')}
                    </button>
                  </div>
                </div>

                {diagnosticsLoading && (
                  <div className="p-12 text-center bg-black/20 rounded-lg border border-white/5 flex flex-col items-center justify-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                    <span className="text-sm text-gray-400">{t('settings.diagnostics_loading')}</span>
                  </div>
                )}

                {!diagnosticsLoading && diagnosticsError && (
                  <div className="p-6 bg-red-950/30 border border-red-800/50 rounded-lg space-y-3">
                    <div className="flex items-center gap-2 text-red-400 font-semibold">
                      <XCircle className="w-5 h-5" />
                      <span>{t('settings.diagnostics_backend_offline')}</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {t('settings.diagnostics_offline_detail')}
                    </p>
                  </div>
                )}

                {!diagnosticsLoading && !diagnosticsError && diagnosticsData && (
                  <div className="space-y-4 animate-fade-in">
                    {/* 总体状态看板 */}
                    <div className={`p-4 rounded-lg border flex items-center justify-between transition-all ${
                      diagnosticsData.ok
                        ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-400'
                        : 'bg-amber-950/20 border-amber-800/40 text-amber-400'
                    }`}>
                      <div className="flex items-center gap-3">
                        {diagnosticsData.ok ? (
                          <CheckCircle className="w-6 h-6 animate-pulse" />
                        ) : (
                          <AlertTriangle className="w-6 h-6 animate-bounce" />
                        )}
                        <div>
                          <div className="font-semibold text-sm">
                            {diagnosticsData.ok ? t('settings.diagnostics_healthy') : t('settings.diagnostics_degraded')}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {diagnosticsData.ok ? t('settings.diagnostics_healthy_detail') : t('settings.diagnostics_degraded_detail')}
                          </div>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-mono border ${
                        diagnosticsData.ok
                          ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                          : 'bg-amber-950/40 border-amber-800 text-amber-400'
                      }`}>
                        {diagnosticsData.ok ? 'HEALTHY' : 'DEGRADED'}
                      </span>
                    </div>

                    {/* 各组件状态卡片 */}
                    <div className="grid grid-cols-1 gap-3">
                      {/* Embedding */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <DatabaseIcon className="w-5 h-5 text-cyan-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">{t('settings.diagnostics_embedding_label')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {diagnosticsData.embedding.mode === 'api' ? (
                                <>{t('settings.diagnostics_embedding_remote_api')} (<span className="font-mono text-cyan-400">{diagnosticsData.embedding.apiUrl || '—'}</span>)</>
                              ) : diagnosticsData.embedding.status === 'local' ? (
                                <>{t('settings.diagnostics_embedding_local_model')} <span className="font-mono text-cyan-400">{diagnosticsData.embedding.model}</span> {t('settings.diagnostics_status_ready')}</>
                              ) : diagnosticsData.embedding.status === 'hash-fallback' ? (
                                <>{t('settings.diagnostics_label_mode')}<span className="font-mono text-red-400">hash-fallback</span> · {t('settings.diagnostics_label_model')}<span className="font-mono text-gray-300">{diagnosticsData.embedding.model}</span></>
                              ) : (
                                <>{t('settings.diagnostics_label_mode')}<span className="font-mono text-cyan-400">{diagnosticsData.embedding.status}</span> · {t('settings.diagnostics_label_model')}<span className="font-mono text-gray-300">{diagnosticsData.embedding.model}</span></>
                              )}
                            </div>
                            {diagnosticsData.embedding.status === 'hash-fallback' && (
                              <div className="mt-2 text-xs text-red-400/90 bg-red-950/30 border border-red-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">{t('settings.diagnostics_embedding_hash_warn')}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            {diagnosticsData.embedding.status === 'hash-fallback' ? (
                              <>
                                <XCircle className="w-4 h-4 text-red-500" />
                                <span className="text-xs text-red-500 font-medium">{t('settings.diagnostics_status_hash_fallback')}</span>
                              </>
                            ) : diagnosticsData.embedding.status === 'pending' ? (
                              <>
                                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                                <span className="text-xs text-amber-500 font-medium">{t('settings.diagnostics_status_initializing')}</span>
                              </>
                            ) : (
                              <>
                                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                <span className="text-xs text-emerald-500 font-medium">{t('settings.diagnostics_status_ready')}</span>
                              </>
                            )}
                          </div>
                          {(diagnosticsData.embedding.status === 'hash-fallback' || diagnosticsData.embedding.status === 'pending') && (
                            <button
                              onClick={handleEmbeddingReload}
                              disabled={embeddingReloading}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <RefreshCw className={`w-3 h-3 ${embeddingReloading ? 'animate-spin' : ''}`} />
                              {embeddingReloading ? t('settings.embedding_reloading') : t('settings.embedding_reload')}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* LLM */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Sliders className="w-5 h-5 text-purple-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">{t('settings.diagnostics_llm_label')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {t('settings.diagnostics_llm_model_prefix')}<span className="font-mono text-gray-300">{diagnosticsData.llm.model}</span> · {t('settings.diagnostics_llm_api_prefix')}<span className="font-mono text-gray-400">{diagnosticsData.llm.apiUrl}</span>
                            </div>
                            {!diagnosticsData.llm.enabled && (
                              <div className="mt-2 text-xs text-amber-400/90 bg-amber-950/30 border border-amber-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">{t('settings.diagnostics_llm_disconnected_warn_title')}</span>{t('settings.diagnostics_llm_disconnected_warn_body')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.llm.enabled ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">{t('settings.diagnostics_status_connected')}</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                              <span className="text-xs text-amber-500 font-medium">{t('settings.diagnostics_status_disconnected')}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* OCR */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Globe className="w-5 h-5 text-rose-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">{t('settings.diagnostics_ocr_label')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {diagnosticsData.ocr.ready ? t('settings.diagnostics_ocr_ready_detail') : t('settings.diagnostics_ocr_missing_detail')}
                            </div>
                            {!diagnosticsData.ocr.ready && (
                              <div className="mt-2 text-xs text-red-400/90 bg-red-950/30 border border-red-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">{t('settings.diagnostics_ocr_missing_warn_title')}</span>{t('settings.diagnostics_ocr_missing_warn_body')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.ocr.ready ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">{t('settings.diagnostics_status_installed')}</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-4 h-4 text-red-500" />
                              <span className="text-xs text-red-500 font-medium">{t('settings.diagnostics_status_missing')}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Agent */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Activity className="w-5 h-5 text-emerald-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">{t('settings.diagnostics_agent_label')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {diagnosticsData.agent.running ? t('settings.diagnostics_agent_running_detail') : t('settings.diagnostics_agent_stopped_detail')}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.agent.running ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">{t('settings.diagnostics_status_running')}</span>
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-amber-500" />
                              <span className="text-xs text-amber-500 font-medium">{t('settings.diagnostics_status_suspended')}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Database */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <DatabaseIcon className="w-5 h-5 text-amber-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">{t('settings.diagnostics_database_label')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {t('settings.diagnostics_db_entities_prefix')}<span className="font-mono text-cyan-400">{diagnosticsData.db.entities}</span>{t('settings.diagnostics_db_entities_suffix')}{t('settings.diagnostics_db_relationships_infix')}<span className="font-mono text-cyan-400">{diagnosticsData.db.relationships}</span>{t('settings.diagnostics_db_relationships_suffix')}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-xs text-emerald-500 font-medium">{t('settings.diagnostics_status_normal')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'mcp' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.mcp_title')}</h3>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{t('settings.mcp_desc')}</p>
                </div>

                {/* 能力预览 */}
                <div className="p-4 bg-black/20 rounded-lg border border-cyan-900/40 space-y-3">
                  <button
                    onClick={() => setScenarioExpanded(!scenarioExpanded)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <span className="text-sm font-semibold text-cyan-400">
                      {t('settings.mcp.scenario_title')}
                    </span>
                    {scenarioExpanded ? (
                      <ChevronDown className="w-4 h-4 text-cyan-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-cyan-400" />
                    )}
                  </button>
                  {scenarioExpanded && (
                    <div className="space-y-2.5 pt-1">
                      {MCP_SCENARIOS.map((scenario) => {
                        const iconEl = (() => {
                          const icons: Record<string, React.ComponentType<{ className?: string }>> = {
                            Search, Lightbulb, Camera, GitBranch, AlertTriangle,
                          };
                          const C = icons[scenario.icon];
                          return C ? createElement(C, { className: 'w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5' }) : null;
                        })();
                        return (
                          <div
                            key={scenario.id}
                            className="flex items-start gap-3 p-2.5 rounded-lg bg-black/30 border border-white/5 hover:border-cyan-800/50 transition-colors"
                          >
                            {iconEl}
                            <div className="flex-1 min-w-0">
                              <div className="text-white text-sm font-medium">
                                {t(scenario.titleKey)}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                <span className="text-gray-500">{t('settings.mcp.scenario_prompt_label')} </span>
                                <span className="text-gray-300 italic">"{t(scenario.promptKey)}"</span>
                              </div>
                            </div>
                            <div className="flex-shrink-0 relative group">
                              <code className="px-1.5 py-0.5 bg-cyan-950/40 border border-cyan-800/40 rounded text-[10px] text-cyan-400 font-mono">
                                {scenario.tool}
                              </code>
                              <div className="absolute bottom-full right-0 mb-1 w-56 p-2 bg-gray-900 border border-white/10 rounded-lg text-[10px] text-gray-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                {scenario.toolDescription}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 一键配置组 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-cyan-400/90 uppercase tracking-wider border-b border-white/5 pb-1">
                    {t('settings.mcp_auto_section')}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {MCP_CLIENTS.filter(c => c.supports === 'auto').map(client => {
                      const status = mcpStatuses.find(s => s.id === client.id) || {
                        installed: false,
                        configured: false,
                        config_path: '',
                      };
                      return (
                        <McpClientCard
                          key={client.id}
                          client={client}
                          status={status}
                          serverCmd={mcpServerCmd}
                          onInstall={handleMcpInstall}
                          onOpenFolder={handleMcpOpenFolder}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* 手动配置组 */}
                <div className="space-y-4 pt-4">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider border-b border-white/5 pb-1">
                    {t('settings.mcp_manual_section')}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {MCP_CLIENTS.filter(c => c.supports === 'manual').map(client => {
                      const status = mcpStatuses.find(s => s.id === client.id) || {
                        installed: false,
                        configured: false,
                        config_path: '',
                      };
                      return (
                        <McpClientCard
                          key={client.id}
                          client={client}
                          status={status}
                          serverCmd={mcpServerCmd}
                          onInstall={handleMcpInstall}
                          onOpenFolder={handleMcpOpenFolder}
                        />
                      );
                    })}

                    {/* 兜底卡片：其他 MCP 客户端 */}
                    <McpClientCard
                      client={{
                        id: 'other',
                        name: t('mcp.other_name'),
                        logo: 'other',
                        supports: 'manual',
                        config_path_template: t('mcp.other_config_path'),
                        json_field: t('mcp.other_json_field'),
                        reload_hint: t('mcp.other_reload_hint'),
                        steps: [
                          t('mcp.other_step_0'),
                          t('mcp.other_step_1'),
                          t('mcp.other_step_2'),
                        ]
                      }}
                      status={{
                        installed: true,
                        configured: false,
                        config_path: '',
                      }}
                      serverCmd={mcpServerCmd}
                      onInstall={handleMcpInstall}
                      onOpenFolder={handleMcpOpenFolder}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部：设置在每次修改时已通过 useSettings 自动持久化，
             这里只保留单一的"完成"按钮，避免 Save / Close 看起来是两种语义。 */}
        <div className="flex items-center justify-between gap-3 p-4 border-t border-white/10 bg-black/20">
          <span className="text-xs text-gray-500">
            {t('settings.autosaved')}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Check className="w-4 h-4" />
            {t('settings.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
