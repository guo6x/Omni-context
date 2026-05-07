"use client";

import { X, Check, RotateCcw, Palette, Keyboard, Sliders, Globe } from 'lucide-react';
import { useState } from 'react';
import { KeyboardShortcut, AppSettings } from '@/hooks/useSettings';
import { useTranslation } from '@/hooks/useTranslation';

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

type Tab = 'shortcuts' | 'appearance' | 'behavior' | 'llm';

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

  const tabs = [
    { id: 'shortcuts' as Tab, icon: <Keyboard className="w-4 h-4" />, label: t('settings.shortcuts') },
    { id: 'appearance' as Tab, icon: <Palette className="w-4 h-4" />, label: t('settings.appearance') },
    { id: 'behavior' as Tab, icon: <Sliders className="w-4 h-4" />, label: t('settings.behavior') },
    { id: 'llm' as Tab, icon: <Globe className="w-4 h-4" />, label: t('settings.llm_provider') || '大模型配置' },
  ];

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
                      key: 'startWithSystem',
                      name: t('settings.start_with_system'),
                      description: t('settings.start_with_system_desc'),
                      value: settings.behavior.startWithSystem,
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="p-4 bg-black/20 rounded-lg border border-white/5 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-white font-medium">{item.name}</div>
                        <div className="text-xs text-gray-500">{item.description}</div>
                      </div>
                      <button
                        onClick={() =>
                          onUpdateBehavior({
                            [item.key]: !settings.behavior[item.key as keyof AppSettings['behavior']],
                          })
                        }
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
                  ))}
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
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10 bg-black/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            {t('settings.close')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Check className="w-4 h-4" />
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
