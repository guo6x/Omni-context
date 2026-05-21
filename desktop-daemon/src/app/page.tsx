"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import HUD from "@/components/HUD";
import FloatingHUD from "@/components/FloatingHUD";
import GraphViewer from "@/components/GraphViewer";
import Console from "@/components/Console";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import SettingsPanel from "@/components/SettingsPanel";
import InsightsInbox from "@/components/InsightsInbox";
import EmptyState from "@/components/EmptyState";
import FileDropZone from "@/components/FileDropZone";
import HardwarePairingPanel from "@/components/HardwarePairingPanel";
import { Database, Terminal, Zap, Settings, Minimize2, HelpCircle, Bell, X, Upload, AlertCircle, PictureInPicture2 } from "lucide-react";
import { LogoMark } from "@/components/BrandMark";
import { Entity, Relationship } from "@shared/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings, syncLlmToBrainServer } from "@/hooks/useSettings";
import { useOmniContext } from "@/hooks/useOmniContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";

type ViewMode = "graph" | "console";

// 调用 Tauri window API；非 Tauri 环境（Next.js 浏览器调试）下静默降级
async function tauriMinimize() {
  if (typeof window === 'undefined') return;
  try {
    const mod = await import('@tauri-apps/api/window');
    await mod.appWindow.minimize();
  } catch (e) {
    console.warn('appWindow.minimize 不可用，可能不在 Tauri 环境:', e);
  }
}

// 给悬浮 HUD 窗口推送状态。在非 Tauri 环境无副作用。
async function pushFloatingHUD(status: string, message: string) {
  if (typeof window === 'undefined') return;
  try {
    const { appWindow } = await import('@tauri-apps/api/window');
    // emit 默认广播到所有窗口，HUD 窗口监听 `hud-update`
    await appWindow.emit('hud-update', { status, message });
  } catch {}
}

// 切换悬浮 HUD 窗口显示
async function toggleFloatingHUD(forceShow?: boolean) {
  if (typeof window === 'undefined') return null;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/window');
    const hudWin = WebviewWindow.getByLabel('hud');
    if (!hudWin) return null;
    const isVisible = await hudWin.isVisible();
    const shouldShow = forceShow !== undefined ? forceShow : !isVisible;
    if (shouldShow) {
      await hudWin.show();
      // alwaysOnTop 已配置；不抢焦点，让主窗口保留 keyboard focus
    } else {
      await hudWin.hide();
    }
    return shouldShow;
  } catch (e) {
    console.warn('floating HUD 控制失败', e);
    return null;
  }
}

function isHudWindowSync(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri 注入 __TAURI_METADATA__，里面 currentWindow.label === 'hud'
  const meta: any = (window as any).__TAURI_METADATA__;
  return meta?.currentWindow?.label === 'hud';
}

export default function Home() {
  const [isHudWindow, setIsHudWindow] = useState<boolean>(isHudWindowSync());

  // SSR/CSR mismatch 保护：客户端再确认一遍 label
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        if (!cancelled) setIsHudWindow(appWindow.label === 'hud');
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (isHudWindow) {
    return <FloatingHUD />;
  }

  return <MainApp />;
}

function MainApp() {
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [showHUD, setShowHUD] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [hudMessage, setHudMessage] = useState("");
  const [hudStatus, setHudStatus] = useState<"listening" | "processing" | "success" | "error">("listening");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [showHardware, setShowHardware] = useState(false);
  const [emptyDismissed, setEmptyDismissed] = useState(false);

  const { settings, showSettings, setShowSettings, updateShortcut, resetShortcuts, updateAppearance, updateBehavior, updateLlmProvider } = useSettings();
  const { status, addLog, triggerPrecipitate, triggerDecision, triggerReset, refreshTrigger } = useOmniContext();
  const { t, language, setLanguage } = useTranslation();
  const toast = useToast();

  // 提到组件 scope，方便上传成功 / 手动操作后重拉
  const fetchGraphData = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3001/api/graph/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth: 3 }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setEntities(data.entities || []);
      setRelationships(data.relationships || []);
    } catch (error) {
      // 第一次 brain-server 还没起就别打扰用户；只在已有数据时刷新失败提示
      if (entities.length > 0) {
        toast.error(t('toast.refresh_failed') || '刷新图谱失败', String(error));
      }
    }
    // toast / t / entities.length 在依赖列表里反而会抖动，这里只跟随 refreshTrigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchGraphData();
  }, [refreshTrigger, fetchGraphData]);

  // 启动时 brain-server 就绪后，以及配置变更后，同步 LLM 配置到 brain-server
  useEffect(() => {
    if (status.brain_server_running) {
      syncLlmToBrainServer(settings.llmProvider);
    }
  }, [settings.llmProvider, status.brain_server_running]);

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
          case 'connectHardware':
            handleConnectHardware();
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
    const initial = t('hud.precipitate');
    setHudMessage(initial);
    setHudStatus("processing");
    setShowHUD(true);
    pushFloatingHUD("processing", initial);
    addLog(t('shortcuts.precipitate_desc'), "info");
    triggerPrecipitate();

    setTimeout(() => {
      const done = t('hud.precipitate_success');
      setHudMessage(done);
      setHudStatus("success");
      pushFloatingHUD("success", done);

      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 1500);
  };

  const handleDecision = () => {
    const initial = t('hud.decision');
    setHudMessage(initial);
    setHudStatus("processing");
    setShowHUD(true);
    pushFloatingHUD("processing", initial);
    addLog(t('shortcuts.decision_desc'), "info");
    triggerDecision();

    setTimeout(() => {
      const done = t('hud.decision_success');
      setHudMessage(done);
      setHudStatus("success");
      pushFloatingHUD("success", done);

      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 1500);
  };

  const handleConnectHardware = useCallback(() => {
    setShowHardware(true);
  }, []);

  const handleRestartBrainServer = useCallback(async () => {
    try {
      await invoke('restart_brain_server');
      toast.success('Brain Server 重启中', '请等待数秒，状态会自动刷新。');
    } catch (e) {
      toast.error('重启失败', String(e));
    }
  }, [toast]);

  const handleReset = () => {
    const initial = t('hud.reset');
    setHudMessage(initial);
    setHudStatus("processing");
    setShowHUD(true);
    pushFloatingHUD("processing", initial);
    addLog(t('shortcuts.reset_desc'), "warning");
    triggerReset();

    setTimeout(() => {
      const done = t('hud.reset_success');
      setHudMessage(done);
      setHudStatus("success");
      pushFloatingHUD("success", done);

      if (settings.behavior.autoHUD) {
        setTimeout(() => setShowHUD(false), 2000);
      }
    }, 800);
  };

  // 悬浮 HUD 当前显示状态（用于按钮高亮）
  const [floatingHudOn, setFloatingHudOn] = useState(false);
  const handleToggleFloatingHUD = useCallback(async () => {
    const next = await toggleFloatingHUD();
    if (next !== null) {
      setFloatingHudOn(next);
      if (next) {
        // 显示后推一次当前状态
        pushFloatingHUD(hudStatus, hudMessage || t('hud.welcome'));
      }
    }
  }, [hudStatus, hudMessage, t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHUD(true);
      setHudMessage(t('hud.welcome'));
      setHudStatus("listening");
      setTimeout(() => setShowHUD(false), 4000);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // 若用户在设置里开启了「默认弹出悬浮 HUD」，启动后自动显示一次
  const floatingHudAutoShown = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (floatingHudAutoShown.done) return;
    if (!settings.behavior.defaultFloatingHUD) return;
    floatingHudAutoShown.done = true;
    (async () => {
      const next = await toggleFloatingHUD(true);
      if (next) {
        setFloatingHudOn(true);
        pushFloatingHUD("listening", t('hud.welcome'));
      }
    })();
  }, [settings.behavior.defaultFloatingHUD, floatingHudAutoShown, t]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0b12] overflow-hidden" style={{ '--accent-color': settings.appearance.accentColor } as React.CSSProperties}>
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-3">
            <LogoMark size={36} className="animate-pulse-glow shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-white leading-tight tracking-wide">
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, #7df9ff 0%, #00f2fe 60%, #a855f7 100%)',
                  }}
                >
                  {t('app.title')}
                </span>
              </h1>
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
            onClick={handleToggleFloatingHUD}
            className={`p-2 rounded-lg transition-colors ${
              floatingHudOn
                ? 'text-cyan-300 bg-cyan-900/30 border border-cyan-700/40'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title={floatingHudOn ? '隐藏悬浮 HUD' : '弹出悬浮 HUD（主窗口最小化也可见）'}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
          <button
            onClick={tauriMinimize}
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

      {!status.brain_server_running && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/60 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-300 shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-red-100 truncate">
            Brain Server 离线 —— 文件上传 / 知识图谱 / 通知等功能不可用。可能原因：Node.js 不在 PATH，或 brain-server/dist 未构建。
          </div>
          <button
            onClick={handleRestartBrainServer}
            className="text-xs px-3 py-1 bg-red-800/40 hover:bg-red-700/40 rounded text-red-100 shrink-0 transition-colors"
          >
            重启
          </button>
        </div>
      )}

      <main className="flex-1 overflow-hidden relative">
        {viewMode === 'graph' ? (
          <GraphViewer
            entities={entities}
            relationships={relationships}
            onDataChanged={fetchGraphData}
          />
        ) : (
          <Console />
        )}

        {viewMode === 'graph' && entities.length === 0 && !emptyDismissed && (
          <EmptyState
            onCapture={handlePrecipitate}
            onDecision={handleDecision}
            onUploadClick={() => setShowUpload(true)}
            onShowShortcuts={() => setShowShortcuts(true)}
            onDismiss={() => setEmptyDismissed(true)}
          />
        )}

        {showUpload && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUpload(false)}
          >
            <div
              className="glass-panel w-full max-w-md p-6 rounded-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  上传文件
                </div>
                <button
                  onClick={() => setShowUpload(false)}
                  className="text-gray-400 hover:text-white"
                  aria-label="close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <FileDropZone
                onSuccess={(r) => {
                  toast.success(`${r.filename} 已抽取`, `${r.entities} 实体 / ${r.relationships} 关系`);
                  fetchGraphData();
                }}
                onError={(filename, msg) => {
                  toast.error(`${filename} 上传失败`, msg);
                }}
              />
            </div>
          </div>
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

        <HardwarePairingPanel isOpen={showHardware} onClose={() => setShowHardware(false)} />
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
