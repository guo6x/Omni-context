"use client";

import { useState, useEffect } from "react";
import HUD from "@/components/HUD";
import GraphViewer from "@/components/GraphViewer";
import Console from "@/components/Console";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import SettingsPanel from "@/components/SettingsPanel";
import { Database, Terminal, Brain, Zap, Settings, Minimize2, HelpCircle } from "lucide-react";
import { Entity, Relationship } from "@shared/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings } from "@/hooks/useSettings";
import { useOmniContext } from "@/hooks/useOmniContext";
import { useTranslation } from "@/hooks/useTranslation";

const mockEntities: Entity[] = [
  {
    id: "1",
    name: "React 最佳实践",
    type: "principle",
    description: "保持组件简洁，单一职责",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_file: "App.tsx",
    tags: ["React", "前端", "最佳实践"],
  },
  {
    id: "2",
    name: "useState Hook",
    type: "concept",
    description: "管理组件状态的基本 Hook",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ["React", "Hooks"],
  },
  {
    id: "3",
    name: "防抖函数",
    type: "code_snippet",
    description: "延迟执行，防止频繁触发",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_file: "utils.ts",
    tags: ["JavaScript", "性能"],
  },
  {
    id: "4",
    name: "用户授权检查",
    type: "principle",
    description: "所有 API 请求必须携带有效 token",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_file: "auth.ts",
    tags: ["安全", "授权"],
  },
];

const mockRelationships: Relationship[] = [
  {
    id: "rel1",
    source_id: "1",
    target_id: "2",
    type: "relates_to",
    weight: 0.8,
    created_at: new Date().toISOString(),
  },
  {
    id: "rel2",
    source_id: "1",
    target_id: "3",
    type: "extends",
    weight: 0.6,
    created_at: new Date().toISOString(),
  },
  {
    id: "rel3",
    source_id: "4",
    target_id: "1",
    type: "depends_on",
    weight: 0.9,
    created_at: new Date().toISOString(),
  },
];

type ViewMode = "graph" | "console";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [showHUD, setShowHUD] = useState(false);
  const [hudMessage, setHudMessage] = useState("");
  const [hudStatus, setHudStatus] = useState<"listening" | "processing" | "success" | "error">("listening");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const { settings, showSettings, setShowSettings, updateShortcut, resetShortcuts, updateAppearance, updateBehavior, updateLlmProvider } = useSettings();
  const { status, addLog, triggerPrecipitate, triggerDecision, triggerReset } = useOmniContext();
  const { t, language, setLanguage } = useTranslation();

  useKeyboardShortcuts([
    ...settings.keyboardShortcuts.map((s) => ({
      id: s.id,
      key: s.current.split('+').pop() || '',
      ctrl: s.current.includes('ctrl') || s.current.includes('cmd'),
      shift: s.current.includes('shift'),
      alt: s.current.includes('alt'),
      category: s.category,
      description: s.description,
      action: () => {
        switch (s.id) {
          case 'precipitate':
            handlePrecipitate();
            break;
          case 'decision':
            handleDecision();
            break;
          case 'reset':
            handleReset();
            break;
          case 'graphView':
            setViewMode('graph');
            break;
          case 'consoleView':
            setViewMode('console');
            break;
          case 'toggleHUD':
            setShowHUD(prev => !prev);
            break;
          case 'openSettings':
            setShowSettings(prev => !prev);
            break;
        }
      },
    })),
    {
      id: 'showHelp',
      key: '?',
      ctrl: false,
      shift: true,
      alt: false,
      action: () => setShowShortcuts(prev => !prev),
      description: t('shortcuts.help_desc'),
      category: t('settings.category.view'),
    },
  ]);

  const handlePrecipitate = () => {
    setHudMessage(t('hud.precipitate'));
    setHudStatus("processing");
    setShowHUD(true);
    addLog(t('shortcuts.precipitate_desc'), "info");
    triggerPrecipitate();
    
    setTimeout(() => {
      setHudMessage(t('hud.precipitate_success'));
      setHudStatus("success");
      
      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 1500);
  };

  const handleDecision = () => {
    setHudMessage(t('hud.decision'));
    setHudStatus("processing");
    setShowHUD(true);
    addLog(t('shortcuts.decision_desc'), "info");
    triggerDecision();
    
    setTimeout(() => {
      setHudMessage(t('hud.decision_success'));
      setHudStatus("success");
      
      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 1500);
  };

  const handleReset = () => {
    setHudMessage(t('hud.reset'));
    setHudStatus("processing");
    setShowHUD(true);
    addLog(t('shortcuts.reset_desc'), "warning");
    triggerReset();
    
    setTimeout(() => {
      setHudMessage(t('hud.reset_success'));
      setHudStatus("success");
      
      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 800);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHUD(true);
      setHudMessage(t('hud.welcome'));
      setHudStatus("listening");
      setTimeout(() => setShowHUD(false), 4000);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  if (isMinimized) {
    return (
      <div className="flex flex-col h-screen w-screen bg-[#0a0b12] items-center justify-center">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex flex-col items-center gap-3 p-6 glass-panel rounded-2xl hover:border-cyan-800 transition-all hover:scale-105"
        >
          <Brain className="w-12 h-12 text-cyan-400 animate-pulse" />
          <span className="text-white font-medium">{t('app.description')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0b12] overflow-hidden" style={{ '--accent-color': settings.appearance.accentColor } as React.CSSProperties}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-cyan-400 animate-pulse-glow" />
            <div>
              <h1 className="text-xl font-bold text-white">{t('app.title')}</h1>
              <p className="text-xs text-gray-400">{t('app.subtitle')}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 ml-8">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status.brain_server_running ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
              <span className="text-xs text-gray-400">{t('status.brain_server')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status.udp_listener_running ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
              <span className="text-xs text-gray-400">{t('status.udp_listener')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3 text-yellow-400" />
              <span className="text-xs text-gray-400">{t('status.shortcuts_available')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title={t('nav.minimize')}
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">{t('nav.help')}</span>
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">{t('nav.settings')}</span>
          </button>
          <button
            onClick={() => setViewMode('graph')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              viewMode === 'graph'
                ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-800'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Database className="w-4 h-4" />
            <span className="hidden sm:inline">{t('nav.graph')}</span>
          </button>
          <button
            onClick={() => setViewMode('console')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              viewMode === 'console'
                ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-800'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span className="hidden sm:inline">{t('nav.console')}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {viewMode === 'graph' ? (
          <GraphViewer entities={mockEntities} relationships={mockRelationships} />
        ) : (
          <Console />
        )}
        
        {showShortcuts && (
          <ShortcutsHelp 
            shortcuts={settings.keyboardShortcuts.map((s) => ({
              ...s,
              key: s.current.split('+').pop() || '',
              ctrl: s.current.includes('ctrl') || s.current.includes('cmd'),
              shift: s.current.includes('shift'),
              alt: s.current.includes('alt'),
            }))} 
            onClose={() => setShowShortcuts(false)} 
          />
        )}

        {showSettings && (
          <SettingsPanel
            settings={settings}
            language={language}
            onUpdateShortcut={updateShortcut}
            onResetShortcuts={resetShortcuts}
            onUpdateAppearance={updateAppearance}
            onUpdateBehavior={updateBehavior}
            onUpdateLlmProvider={updateLlmProvider}
            onUpdateLanguage={setLanguage}
            onClose={() => setShowSettings(false)}
          />
        )}
      </main>

      <HUD
        isVisible={showHUD}
        onClose={() => setShowHUD(false)}
        status={hudStatus}
        message={hudMessage}
      />
    </div>
  );
}
