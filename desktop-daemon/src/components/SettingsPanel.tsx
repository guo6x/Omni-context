"use client";

import { X, Check, RotateCcw, Palette, Keyboard, Sliders, Globe, Database as DatabaseIcon, Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { KeyboardShortcut, AppSettings } from '@/hooks/useSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { BRAIN_URL } from '@/lib/config';

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

type Tab = 'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'diagnostics';

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

  const fetchDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const res = await fetch(`${BRAIN_URL}/api/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDiagnosticsData(data);
    } catch (err) {
      setDiagnosticsError('后端离线');
      setDiagnosticsData(null);
    } finally {
      setDiagnosticsLoading(false);
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
    if (tempShortcut) {
      onUpdateShortcut(id, tempShortcut);
    }
    setEditingId(null);
    setTempShortcut('');
  };

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
      toast.success('备份已下载');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('导出失败', msg);
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
    const merge = window.confirm(
      '恢复模式选择：\n\n点击「确定」= 合并 (merge)：保留现有数据，仅追加备份中不存在的记录。\n点击「取消」= 替换 (replace)：先清空当前数据库再导入备份。\n\n替换是不可逆操作，请确认你已经有当前数据的副本。'
    );
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
        throw new Error('备份文件不是有效的 JSON');
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
        `恢复成功 (${mode})`,
        `entities=${c.entities ?? 0} · relationships=${c.relationships ?? 0} · ` +
          `core=${c.coreMemory ?? 0} · archival=${c.archivalMemory ?? 0} · ` +
          `notifications=${c.notifications ?? 0}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('恢复失败', msg);
    } finally {
      setDataBusy(false);
    }
  };

  const tabs = [
    { id: 'shortcuts' as Tab, icon: <Keyboard className="w-4 h-4" />, label: t('settings.shortcuts') },
    { id: 'appearance' as Tab, icon: <Palette className="w-4 h-4" />, label: t('settings.appearance') },
    { id: 'behavior' as Tab, icon: <Sliders className="w-4 h-4" />, label: t('settings.behavior') },
    { id: 'llm' as Tab, icon: <Globe className="w-4 h-4" />, label: t('settings.llm_provider') || '大模型配置' },
    { id: 'data' as Tab, icon: <DatabaseIcon className="w-4 h-4" />, label: t('settings.data') || '数据管理' },
    { id: 'diagnostics' as Tab, icon: <Activity className="w-4 h-4" />, label: '系统自检' },
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
                          <div
                            key={shortcut.id}
                            className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5 hover:border-white/10 transition-colors"
                          >
                            <div>
                              <div className="text-white font-medium">{shortcut.name}</div>
                              <div className="text-xs text-gray-500">{shortcut.description}</div>
                            </div>
                            {editingId === shortcut.id ? (
                              <button
                                onKeyDown={(e) => handleShortcutKeyDown(e, shortcut.id)}
                                onClick={() => finishEditing(shortcut.id)}
                                className="px-3 py-1.5 bg-cyan-900/40 border border-cyan-400 text-cyan-400 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/50 animate-pulse"
                              >
                                {tempShortcut || '按任意键'}
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
                          中文
                        </button>
                        <button
                          onClick={() => onUpdateLanguage('en')}
                          className={`px-4 py-2 rounded-lg border transition-colors ${
                            language === 'en'
                              ? 'bg-cyan-900/40 text-cyan-400 border-cyan-800'
                              : 'text-gray-400 hover:text-white hover:bg-white/5 border-white/10'
                          }`}
                        >
                          English
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
                      name: '默认弹出悬浮 HUD',
                      description: '应用启动后自动显示桌面悬浮 HUD（主窗口最小化也可见）',
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
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.llm_provider') || '大模型配置 (LLM)'}</h3>
                  <p className="text-xs text-gray-400 mt-1">配置云端或本地大模型，用于知识图谱的深度语义提取。修改后需重启应用生效。</p>
                </div>

                <div className="space-y-4">
                  {/* API URL */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block">API URL</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      value={settings.llmProvider.apiUrl}
                      onChange={(e) => onUpdateLlmProvider({ apiUrl: e.target.value })}
                      placeholder="例如: https://api.openai.com/v1 或 http://localhost:11434/v1"
                    />
                  </div>

                  {/* API Key */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block">API Key</label>
                    <input
                      type="password"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      value={settings.llmProvider.apiKey}
                      onChange={(e) => onUpdateLlmProvider({ apiKey: e.target.value })}
                      placeholder="sk-... (Ollama等本地模型留空即可)"
                    />
                  </div>

                  {/* Model */}
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-2">
                    <label className="text-sm font-medium text-white block">模型名称 (Model)</label>
                    <input
                      type="text"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      value={settings.llmProvider.model}
                      onChange={(e) => onUpdateLlmProvider({ model: e.target.value })}
                      placeholder="例如: gpt-4o, qwen2.5:7b"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">{t('settings.data') || '数据管理 / Data'}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    导出整个 Omni-Context 数据库为 JSON 备份，或在新机器上从备份恢复。数据完全归你所有。
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">导出全部数据</div>
                      <div className="text-xs text-gray-500">
                        包含 entities / relationships / coreMemory / archivalMemory / notifications。
                      </div>
                    </div>
                    <button
                      onClick={handleExportAll}
                      disabled={dataBusy}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {dataBusy ? '处理中…' : '导出 JSON'}
                    </button>
                  </div>

                  <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">从备份恢复</div>
                      <div className="text-xs text-gray-500">
                        选择之前导出的 JSON 文件。会询问合并 (merge) 或替换 (replace)。
                      </div>
                    </div>
                    <button
                      onClick={handleRestoreClick}
                      disabled={dataBusy}
                      className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {dataBusy ? '处理中…' : '选择备份文件'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={handleRestoreFile}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'diagnostics' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">系统自检</h3>
                    <p className="text-xs text-gray-400 mt-1">检测核心组件的健康状态，并及时发现潜在的故障与降级风险。</p>
                  </div>
                  <button
                    onClick={fetchDiagnostics}
                    disabled={diagnosticsLoading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${diagnosticsLoading ? 'animate-spin' : ''}`} />
                    重新检测
                  </button>
                </div>

                {diagnosticsLoading && (
                  <div className="p-12 text-center bg-black/20 rounded-lg border border-white/5 flex flex-col items-center justify-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                    <span className="text-sm text-gray-400">正在诊断系统状态，请稍候...</span>
                  </div>
                )}

                {!diagnosticsLoading && diagnosticsError && (
                  <div className="p-6 bg-red-950/30 border border-red-800/50 rounded-lg space-y-3">
                    <div className="flex items-center gap-2 text-red-400 font-semibold">
                      <XCircle className="w-5 h-5" />
                      <span>后端服务离线</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      无法连接到本地服务端 (<span className="font-mono">{BRAIN_URL}</span>)。请确保脑端服务 (brain-server) 已启动并在运行中。
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
                            {diagnosticsData.ok ? '系统运行良好' : '系统已降级'}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {diagnosticsData.ok ? '所有核心组件均处于健康状态，性能优异。' : '检测到降级项，部分高级特征已失效或处于受限状态。'}
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
                            <div className="text-white text-sm font-medium">向量生成 (Embedding)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              模式: <span className="font-mono text-cyan-400">{diagnosticsData.embedding.status}</span> · 模型: <span className="font-mono text-gray-300">{diagnosticsData.embedding.model}</span>
                            </div>
                            {diagnosticsData.embedding.status === 'hash-fallback' && (
                              <div className="mt-2 text-xs text-amber-400/90 bg-amber-950/30 border border-amber-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">⚠️ 降级警告：</span>本地向量模型加载失败，已降级为简单哈希向量。向量检索已降级，语义搜索不准。
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.embedding.status === 'hash-fallback' ? (
                            <>
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                              <span className="text-xs text-amber-500 font-medium">哈希降级</span>
                            </>
                          ) : diagnosticsData.embedding.status === 'pending' ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                              <span className="text-xs text-amber-500 font-medium">初始化中</span>
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">已就绪</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* LLM */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Sliders className="w-5 h-5 text-purple-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">大语言模型 (LLM)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              模型: <span className="font-mono text-gray-300">{diagnosticsData.llm.model}</span> · 接口: <span className="font-mono text-gray-400">{diagnosticsData.llm.apiUrl}</span>
                            </div>
                            {!diagnosticsData.llm.enabled && (
                              <div className="mt-2 text-xs text-amber-400/90 bg-amber-950/30 border border-amber-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">⚠️ 连接提示：</span>LLM 未连接，只有正则抽取。高级深度语义提取已被禁用。
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.llm.enabled ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">已连接</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                              <span className="text-xs text-amber-500 font-medium">未连接</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* OCR */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Globe className="w-5 h-5 text-rose-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">文字识别 (OCR)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {diagnosticsData.ocr.ready ? '内置文本提取引擎语言包完整。' : '未检测到内置 OCR 识别语言包。'}
                            </div>
                            {!diagnosticsData.ocr.ready && (
                              <div className="mt-2 text-xs text-red-400/90 bg-red-950/30 border border-red-900/40 p-2 rounded leading-relaxed">
                                <span className="font-semibold">❌ 故障警告：</span>语言包未就位。OCR 无法正常识别截图中的文本，请检查 models/tessdata 目录。
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.ocr.ready ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">已就位</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-4 h-4 text-red-500" />
                              <span className="text-xs text-red-500 font-medium">语言包缺失</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Agent */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <Activity className="w-5 h-5 text-emerald-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">智能分析引擎 (Proactive Agent)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {diagnosticsData.agent.running ? '智能引擎后台轮询任务正常运行。' : '智能引擎后台任务已挂起。'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diagnosticsData.agent.running ? (
                            <>
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-xs text-emerald-500 font-medium">运行中</span>
                            </>
                          ) : (
                            <>
                              <div className="w-2 h-2 rounded-full bg-amber-500" />
                              <span className="text-xs text-amber-500 font-medium">已挂起</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Database */}
                      <div className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between">
                        <div className="flex items-start gap-3">
                          <DatabaseIcon className="w-5 h-5 text-amber-400 mt-0.5" />
                          <div>
                            <div className="text-white text-sm font-medium">知识图谱数据库 (Database)</div>
                            <div className="text-xs text-gray-400 mt-1">
                              已索引实体: <span className="font-mono text-cyan-400">{diagnosticsData.db.entities}</span> 个 · 关联关系: <span className="font-mono text-cyan-400">{diagnosticsData.db.relationships}</span> 条
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-xs text-emerald-500 font-medium">正常</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 底部：设置在每次修改时已通过 useSettings 自动持久化，
             这里只保留单一的"完成"按钮，避免 Save / Close 看起来是两种语义。 */}
        <div className="flex items-center justify-between gap-3 p-4 border-t border-white/10 bg-black/20">
          <span className="text-xs text-gray-500">
            {t('settings.autosaved') || '改动会即时保存'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Check className="w-4 h-4" />
            {t('settings.done') || t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
