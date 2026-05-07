"use client";

import { useState, useEffect } from "react";
import HUD from "@/components/HUD";
import GraphViewer from "@/components/GraphViewer";
import Console from "@/components/Console";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import SettingsPanel from "@/components/SettingsPanel";
import InsightsInbox from "@/components/InsightsInbox";
import { Database, Terminal, Brain, Zap, Settings, Minimize2, HelpCircle, Bell } from "lucide-react";
import { Entity, Relationship } from "@shared/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings } from "@/hooks/useSettings";
import { useOmniContext } from "@/hooks/useOmniContext";
import { useTranslation } from "@/hooks/useTranslation";

type ViewMode = "graph" | "console";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [showHUD, setShowHUD] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [hudMessage, setHudMessage] = useState("");
  const [hudStatus, setHudStatus] = useState<"listening" | "processing" | "success" | "error">("listening");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  const { settings, showSettings, setShowSettings, updateShortcut, resetShortcuts, updateAppearance, updateBehavior, updateLlmProvider } = useSettings();
  const { status, addLog, triggerPrecipitate, triggerDecision, triggerReset, refreshTrigger } = useOmniContext();
  const { t, language, setLanguage } = useTranslation();

  useEffect(() => {
    // 自动拉取真实的图谱数据
    const fetchGraphData = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/graph/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ depth: 3 }),
        });
        if (response.ok) {
          const data = await response.json();
          setEntities(data.entities || []);
          setRelationships(data.relationships || []);
        }
      } catch (error) {
        console.warn('获取图谱数据失败:', error);
      }
    };
    fetchGraphData();
  }, [refreshTrigger]); // 当提取完成后，refreshTrigger 会变，触发重加载

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
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-cyan-400 animate-pulse-glow" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-white leading-tight">{t('app.title')}</h1>
              <p className="hidden sm:block text-xs text-gray-400 truncate">{t('app.subtitle')}</p>
            </div>
          </div>
          
          <div className="hidden xl:flex items-center gap-4 ml-8">
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title={t('nav.minimize')}
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowInsights(!showInsights)}
            className="p-2 text-cyan-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors relative"
            title="Insights"
          >
            <Bell className="w-4 h-4 animate-pulse" />
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
          <GraphViewer entities={entities} relationships={relationships} />
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
        
        <InsightsInbox isOpen={showInsights} onClose={() => setShowInsights(false)} />
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
