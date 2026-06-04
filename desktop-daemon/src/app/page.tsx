"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import FloatingHUD from "@/components/FloatingHUD";
import GraphViewer from "@/components/GraphViewer";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import SettingsPanel from "@/components/SettingsPanel";
import InsightsInbox from "@/components/InsightsInbox";
import MemoryManager from "@/components/MemoryManager";
import EmptyState from "@/components/EmptyState";
import FileDropZone, { FileDropZoneRef, ACCEPTED_EXTENSIONS, TauriFileLike } from "@/components/FileDropZone";
import HardwarePairingPanel from "@/components/HardwarePairingPanel";
import OnboardingWizard from "@/components/OnboardingWizard";
import { Zap, Settings, Minimize2, HelpCircle, Bell, X, Upload, AlertCircle, Sparkles, PictureInPicture2, Search, Scale, ChevronDown, ChevronUp, MoreHorizontal, Brain, RefreshCw } from "lucide-react";
import { LogoMark } from "@/components/BrandMark";
import { Entity, Relationship } from "@shared/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettings, syncLlmToBrainServer } from "@/hooks/useSettings";
import { useOmniContext } from "@/hooks/useOmniContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";
import DecisionTimeline from "@/components/DecisionTimeline";
import { useConfirm } from "@/components/ConfirmDialog";
import { apiFetch } from '@/lib/api-client';
import { resolveNodeCap } from '@/lib/device';

// 需要"在任意窗口前都能按"的快捷键，注册为系统全局热键（其余保持应用内）
const GLOBAL_SHORTCUT_IDS = ['precipitate'];
// 把 "Ctrl+Shift+P" 转成 Tauri 加速键格式 "CommandOrControl+Shift+P"
function toTauriAccel(current: string): string {
  const mods: string[] = [];
  let key = '';
  for (const raw of (current || '').split('+')) {
    const p = raw.trim().toLowerCase();
    if (['ctrl', 'control', 'cmd', 'command', 'cmdorctrl'].includes(p)) mods.push('CommandOrControl');
    else if (p === 'shift') mods.push('Shift');
    else if (p === 'alt' || p === 'option') mods.push('Alt');
    else if (['meta', 'super', 'win'].includes(p)) mods.push('Super');
    else if (p) key = p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  }
  return [...mods, key].filter(Boolean).join('+');
}


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
  const [showInsights, setShowInsights] = useState(false);
  // 首页「记忆亮点」：page 层轻量轮询未读洞见，让主动浮现被看见（铃铛藏在更多菜单里）
  const [insightHighlights, setInsightHighlights] = useState<Array<{ id: string; title: string; content: string }>>([]);
  const [insightsHidden, setInsightsHidden] = useState(false);
  const [hudMessage, setHudMessage] = useState("");
  const [hudStatus, setHudStatus] = useState<"listening" | "processing" | "success" | "warning" | "error">("listening");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  // 总览视图节点上限（后端 300）下，实际总数 / 已显示数，用于「显示 X / 共 Y」角标
  const [graphTotal, setGraphTotal] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [showHardware, setShowHardware] = useState(false);
  const [emptyDismissed, setEmptyDismissed] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [showDecisionLog, setShowDecisionLog] = useState(false);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  // 启动遮罩兜底：brain-server 长时间起不来时也要放行进 App（由离线横幅接管），避免遮罩锁死 UI
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  const [focusEntityId, setFocusEntityId] = useState<string | undefined>(undefined);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showOfflineDetails, setShowOfflineDetails] = useState(false);
  const dropZoneRef = useRef<FileDropZoneRef>(null);
  const isPrecipitating = useRef(false);
  const { confirm, dialog } = useConfirm();

  const { settings, showSettings, setShowSettings, updateShortcut, resetShortcuts, updateAppearance, updateBehavior, updateLlmProvider } = useSettings();
  const { status, hasConnectedOnce, addLog, triggerPrecipitate, triggerDecision, triggerReset, refreshTrigger } = useOmniContext();
  const { t, language, setLanguage } = useTranslation();
  const toast = useToast();
  const [settingsTab, setSettingsTab] = useState<'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'mcp' | 'diagnostics' | 'privacy' | 'about'>('shortcuts');
  const [showWizardForce, setShowWizardForce] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);

  // 提到组件 scope，方便上传成功 / 手动操作后重拉
  const fetchGraphData = useCallback(async () => {
    setIsLoadingGraph(true);
    try {
      const response = await apiFetch('/api/graph/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth: 3, limit: resolveNodeCap(settings.appearance.graphNodeCap) }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setEntities(data.entities || []);
      setRelationships(data.relationships || []);
      setGraphTotal(typeof data.total === 'number' ? data.total : (data.entities || []).length);
    } catch (error) {
      // 第一次 brain-server 还没起就别打扰用户；只在已有数据时刷新失败提示
      if (entities.length > 0) {
        toast.error(t('toast.refresh_failed'), String(error));
      }
    } finally {
      setIsLoadingGraph(false);
    }
    // toast / t / entities.length 在依赖列表里反而会抖动，这里只跟随 refreshTrigger 和节点上限
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.appearance.graphNodeCap]);

  useEffect(() => {
    fetchGraphData();
  }, [refreshTrigger, fetchGraphData]);

  // 启动遮罩超时兜底：20s 还没首次连上就放行，避免 brain-server 异常时锁死 UI
  useEffect(() => {
    if (hasConnectedOnce) return;
    const timer = setTimeout(() => setSplashTimedOut(true), 20000);
    return () => clearTimeout(timer);
  }, [hasConnectedOnce]);

  // 轻量轮询未读洞见，驱动首页「记忆亮点」浮条
  useEffect(() => {
    let active = true;
    const fetchInsights = async () => {
      try {
        const res = await apiFetch('/api/notifications');
        if (res.ok && active) {
          const data = await res.json();
          setInsightHighlights(Array.isArray(data) ? data : []);
        }
      } catch {
        // brain-server 未就绪时静默
      }
    };
    fetchInsights();
    const timer = setInterval(fetchInsights, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshTrigger]);

  // 监听来自托盘的 open-settings 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const res = await listen('open-settings', () => {
          setShowSettings(true);
        });
        unlisten = res;
      } catch (e) {
        console.warn('无法监听 open-settings 事件:', e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [setShowSettings]);

  // 监听托盘"暂停/恢复抓取"事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const res = await listen('toggle-capture-pause', () => {
          updateBehavior({ capturePaused: !settings.behavior.capturePaused });
        });
        unlisten = res;
      } catch (e) {
        console.warn('无法监听 toggle-capture-pause 事件:', e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [updateBehavior, settings.behavior.capturePaused]);

  // 监听自动更新检查结果（Rust 启动后 30 秒）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ version: string; body: string; date: string }>('update-available', (event) => {
          const { version } = event.payload;
          const versionDismissed = document.cookie.includes(`update-dismissed-${version}`);
          if (versionDismissed) return;

          const dismissId = toast.info(
            t('settings.update_available').replace('{version}', version),
            event.payload.body || '',
            {
              action: (
                <button
                  onClick={async () => {
                    toast.dismiss(dismissId);
                    try {
                      const { installUpdate } = await import('@tauri-apps/api/updater');
                      await installUpdate();
                      // installUpdate 成功后会重启应用
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
        });
      } catch (e) {
        // 非 Tauri 环境静默忽略
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [toast, t]);

  const handleLoadDemo = useCallback(async () => {
    setIsLoadingDemo(true);
    try {
      const response = await apiFetch('/api/admin/seed-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      if (result.skipped) {
        toast.success(t('toast.demo_skipped'), t('toast.demo_skipped_detail'));
      } else {
        toast.success(
          t('toast.demo_loaded'),
          t('toast.demo_loaded_detail')
            .replace('{entities}', String(result.imported.entities))
            .replace('{relationships}', String(result.imported.relationships))
            .replace('{notifications}', String(result.imported.notifications))
        );
        fetchGraphData();
      }
    } catch (error) {
      toast.error(t('toast.demo_load_failed'), String(error));
    } finally {
      setIsLoadingDemo(false);
    }
  }, [toast, fetchGraphData]);

  // 启动时 brain-server 就绪后，以及配置变更后，同步 LLM 配置到 brain-server
  useEffect(() => {
    if (status.brain_server_running) {
      syncLlmToBrainServer(settings.llmProvider);
    }
  }, [settings.llmProvider, status.brain_server_running]);

  // 监听 Tauri 全局文件拖放事件
  useEffect(() => {
    let unlistenHover: (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/tauri");

        unlistenHover = await listen("tauri://file-drop-hover", () => {
          setIsDraggingFile(true);
        });

        unlistenCancelled = await listen("tauri://file-drop-cancelled", () => {
          setIsDraggingFile(false);
        });

        unlistenDrop = await listen<string[]>("tauri://file-drop", async (event) => {
          setIsDraggingFile(false);
          const paths = event.payload;
          if (!paths || paths.length === 0) return;

          try {
            // 调用 Rust 命令，过滤和扫描出支持的物理文件
            const files = await invoke<Array<{ path: string; name: string; size: number }>>(
              "process_dropped_paths",
              {
                paths,
                extensions: ACCEPTED_EXTENSIONS,
              }
            );

            if (files.length === 0) {
              toast.error(t('toast.no_supported_files'), t('toast.no_supported_files_detail'));
              return;
            }

            const proceed = async () => {
              // 自动弹出上传弹窗
              setShowUpload(true);

              // 构造伪 FileLike 对象
              const tauriFiles = files.map((f) => new TauriFileLike(f.name, f.size, f.path));

              // 稍微加个延迟，等 modal 完全渲染和 ref 挂载好
              setTimeout(() => {
                if (dropZoneRef.current) {
                  dropZoneRef.current.handleFiles(tauriFiles);
                }
              }, 200);
            };

            // 如果文件总数超过 50 个，弹出确认框进行提示
            if (files.length > 50) {
              const confirmMsg = t("drag_drop.confirm_message").replace("{count}", String(files.length));
              confirm({
                title: t("drag_drop.confirm_title"),
                message: confirmMsg,
                onConfirm: proceed,
              });
            } else {
              await proceed();
            }
          } catch (err) {
            console.error("文件拖放处理失败:", err);
            toast.error(t('toast.drop_process_failed'), String(err));
          }
        });
      } catch (err) {
        console.warn("无法绑定 Tauri 拖放事件:", err);
      }
    };

    setupListeners();

    return () => {
      if (unlistenHover) unlistenHover();
      if (unlistenCancelled) unlistenCancelled();
      if (unlistenDrop) unlistenDrop();
    };
  }, [confirm, t, toast]);

  const handlePrecipitateRef = useRef<() => void>(() => {});

  useKeyboardShortcuts([
    ...settings.keyboardShortcuts.filter((s) => !GLOBAL_SHORTCUT_IDS.includes(s.id)).map((s) => {
      const current = s.current.toLowerCase();
      return {
        id: s.id,
        key: current.split('+').pop() || '',
        ctrl: current.includes('ctrl') || current.includes('cmd'),
        shift: current.includes('shift'),
        alt: current.includes('alt'),
        category: s.category,
        description: t(s.description),
        action: () => {
          switch (s.id) {
            case 'precipitate':
              handlePrecipitate();
              break;
            case 'reset':
              handleReset();
              break;
            case 'toggleHUD': {
              (async () => {
                const nextHud = await toggleFloatingHUD();
                if (nextHud !== null) {
                  setFloatingHudOn(nextHud);
                  if (nextHud) {
                    pushFloatingHUD(hudStatus || "listening", hudMessage || t('hud.welcome'));
                  }
                }
              })();
              break;
            }
            case 'openSettings':
              setShowSettings(prev => !prev);
              break;
            case 'connectHardware':
              handleConnectHardware();
              break;
          }
        },
      };
    }),
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

  const handlePrecipitate = async (): Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }> => {
    if (isPrecipitating.current) {
      addLog(t('hud.precipitate_in_progress'), "warning");
      return { ok: false, error: t('hud.precipitate_in_progress') };
    }

    // 隐私检查 1：暂停抓取
    if (settings.behavior.capturePaused) {
      const paused = t('hud.capture_paused');
      setHudMessage(paused);
      setHudStatus("warning");
      pushFloatingHUD("warning", paused);
      await toggleFloatingHUD(true);
      setFloatingHudOn(true);
      addLog(paused, "warning");
      if (settings.behavior.autoHUD) {
        setTimeout(async () => {
          await toggleFloatingHUD(false);
          setFloatingHudOn(false);
        }, 2000);
      }
      return { ok: false, error: paused };
    }

    // 隐私检查 2：敏感应用排除
    if (settings.behavior.captureBlocklist.length > 0) {
      try {
        const fgInfo = await invoke<{ title: string; process_name: string }>('get_foreground_window_info');
        const lowerTitle = fgInfo.title.toLowerCase();
        const lowerProc = fgInfo.process_name.toLowerCase();
        for (const rule of settings.behavior.captureBlocklist) {
          if (rule.length === 0) continue;
          const lowerRule = rule.toLowerCase();
          if (lowerTitle.includes(lowerRule) || lowerProc.includes(lowerRule)) {
            const blocked = t('hud.capture_blocked').replace('{app}', fgInfo.process_name || fgInfo.title);
            setHudMessage(blocked);
            setHudStatus("warning");
            pushFloatingHUD("warning", blocked);
            await toggleFloatingHUD(true);
            setFloatingHudOn(true);
            addLog(blocked, "warning");
            if (settings.behavior.autoHUD) {
              setTimeout(async () => {
                await toggleFloatingHUD(false);
                setFloatingHudOn(false);
              }, 2000);
            }
            return { ok: false, error: blocked };
          }
        }
      } catch (e) {
        // 获取前台窗口信息失败，继续执行（非 Windows 平台或 API 失败）
        console.warn('get_foreground_window_info 失败，跳过敏感应用检测:', e);
      }
    }

    isPrecipitating.current = true;

    const initial = t('hud.precipitate');
    setHudMessage(initial);
    setHudStatus("processing");
    pushFloatingHUD("processing", initial);
    await toggleFloatingHUD(true);
    setFloatingHudOn(true);
    addLog(t('shortcuts.precipitate_desc'), "info");

    let finalResult: { ok: boolean; entities?: number; relationships?: number; error?: string } = { ok: false, error: 'Unknown' };

    try {
      const result = await triggerPrecipitate();
      finalResult = result;

      if (result.ok && result.entities !== undefined && result.entities > 0) {
        const done = t('hud.precipitate_success')
          .replace('{entities}', String(result.entities))
          .replace('{relationships}', String(result.relationships ?? 0));
        setHudMessage(done);
        setHudStatus("success");
        pushFloatingHUD("success", done);
      } else if (result.ok && result.entities === 0) {
        const noContent = t('hud.precipitate_no_content');
        setHudMessage(noContent);
        setHudStatus("warning");
        pushFloatingHUD("warning", noContent);
      } else {
        const errMsg = (result.error || 'Unknown error').slice(0, 80);
        const failed = t('hud.precipitate_failed').replace('{error}', errMsg);
        setHudMessage(failed);
        setHudStatus("error");
        pushFloatingHUD("error", failed);
      }
    } catch (e) {
      const errMsg = String(e).slice(0, 80);
      const failed = t('hud.precipitate_failed').replace('{error}', errMsg);
      setHudMessage(failed);
      setHudStatus("error");
      pushFloatingHUD("error", failed);
      finalResult = { ok: false, error: errMsg };
    }

    isPrecipitating.current = false;

    if (settings.behavior.autoHUD) {
      setTimeout(async () => {
        await toggleFloatingHUD(false);
        setFloatingHudOn(false);
      }, 2000);
    }

    return finalResult;
  };

  // 全局热键：把需要"任意窗口前可按"的快捷键注册到系统，触发时跑最新的 handler
  handlePrecipitateRef.current = () => { void handlePrecipitate(); };
  const globalAccels = settings.keyboardShortcuts
    .filter((s) => GLOBAL_SHORTCUT_IDS.includes(s.id))
    .map((s) => `${s.id}:${toTauriAccel(s.current)}`)
    .join(',');
  useEffect(() => {
    const globals = globalAccels.split(',').filter(Boolean).map((x) => {
      const i = x.indexOf(':');
      return { id: x.slice(0, i), accelerator: x.slice(i + 1) };
    }).filter((s) => s.accelerator);
    invoke('register_global_shortcuts', { shortcuts: globals }).catch((e) => console.warn('注册全局热键失败:', e));
    const un = listen<string>('global-shortcut', (e) => {
      if (e.payload === 'precipitate') handlePrecipitateRef.current();
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [globalAccels]);

  const handleConnectHardware = useCallback(() => {
    setShowHardware(true);
  }, []);

  const handleRestartBrainServer = useCallback(async () => {
    try {
      await invoke('restart_brain_server');
      toast.success(t('toast.brain_server_restarting'), t('toast.brain_server_restarting_detail'));
    } catch (e) {
      toast.error(t('toast.restart_failed'), String(e));
    }
  }, [toast]);

  const handleReset = async () => {
    // 清 UI 状态
    setFocusEntityId(undefined);

    // 重置日志（保留前 3 条基线）
    await triggerReset();

    // HUD 反馈：绿字，1.5s 后强制隐藏（不论 autoHUD）
    const done = t('hud.reset_done');
    setHudMessage(done);
    setHudStatus("success");
    pushFloatingHUD("success", done);
    await toggleFloatingHUD(true);
    setFloatingHudOn(true);

    setTimeout(async () => {
      await toggleFloatingHUD(false);
      setFloatingHudOn(false);
    }, 1500);
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
    const timer = setTimeout(async () => {
      setHudMessage(t('hud.welcome'));
      setHudStatus("listening");
      pushFloatingHUD("listening", t('hud.welcome'));
      await toggleFloatingHUD(true);
      setFloatingHudOn(true);
      setTimeout(async () => {
        await toggleFloatingHUD(false);
        setFloatingHudOn(false);
      }, 4000);
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

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden">
      {/* 冷启动遮罩：brain-server 内嵌进程启动较慢，未首次连上前盖一层过渡画面 */}
      {!hasConnectedOnce && !splashTimedOut && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background">
          <LogoMark size={72} className="animate-pulse-glow" />
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-3">
              <span className="block w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span className="text-base font-medium text-white">{t('boot.title')}</span>
            </div>
            <p className="text-xs text-gray-500">{t('boot.hint')}</p>
          </div>
        </div>
      )}
      <header className="relative z-40 flex items-center justify-between gap-2 px-3 sm:px-5 py-2 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-3">
            <LogoMark size={36} className="animate-pulse-glow shrink-0" />
            <div className="hidden min-w-0 sm:block">
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

        <div className="flex shrink-0 items-center gap-1 sm:gap-2 flex-wrap justify-end">
          {/* 搜索 / 问大脑 / 决策 已合并到图谱顶部的命令栏（Ctrl+K 聚焦） */}
          {/* [通用] 常驻上传按钮 */}
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30 border border-cyan-800/40 rounded-lg transition-all"
            title={t('header.upload')}
          >
            <Upload className="w-4 h-4 text-cyan-400" />
            <span className="hidden lg:inline">{t('header.upload')}</span>
          </button>
          <button
            onClick={handleToggleFloatingHUD}
            className={`p-2 rounded-lg transition-colors ${
              floatingHudOn
                ? 'text-cyan-300 bg-cyan-900/30 border border-cyan-700/40'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title={floatingHudOn ? t('header.hide_hud') : t('header.show_hud')}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { fetchGraphData(); toast.success('已刷新图谱'); }}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title="刷新图谱（看新加进来的记忆）"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title={t('nav.more')}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-white/10 bg-gray-900 py-1 shadow-xl shadow-black/30">
                  <button
                    onClick={() => { setShowInsights(!showInsights); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Bell className="w-4 h-4 text-cyan-400" />
                    {t('nav.insights')}
                  </button>
                  <button
                    onClick={() => { setShowDecisionLog(true); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Scale className="w-4 h-4 text-cyan-400" />
                    {t('nav.decision_log')}
                  </button>
                  <button
                    onClick={() => { setShowMemoryManager(true); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Brain className="w-4 h-4 text-cyan-400" />
                    记忆管理
                  </button>
                  <button
                    onClick={() => { setShowShortcuts(!showShortcuts); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <HelpCircle className="w-4 h-4" />
                    {t('nav.help')}
                  </button>
                  <button
                    onClick={() => { tauriMinimize(); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Minimize2 className="w-4 h-4" />
                    {t('nav.minimize')}
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden lg:inline">{t('nav.settings')}</span>
          </button>
        </div>
      </header>

      {!status.brain_server_running && (
        <div className="bg-red-900/30 border-b border-red-800/60">
          <div className="px-4 py-2 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-300 shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-red-100 truncate">
              {t('status_banner.brain_offline_simple')}
            </div>
            <button
              onClick={() => setShowOfflineDetails(!showOfflineDetails)}
              className="text-xs px-3 py-1 bg-red-800/20 hover:bg-red-700/30 rounded text-red-200 shrink-0 transition-colors flex items-center gap-1"
            >
              {showOfflineDetails ? t('status_banner.hide_details') : t('status_banner.show_details')}
              {showOfflineDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <button
              onClick={handleRestartBrainServer}
              className="text-xs px-3 py-1 bg-red-800/40 hover:bg-red-700/40 rounded text-red-100 shrink-0 transition-colors"
            >
              {t('status_banner.restart')}
            </button>
          </div>
          {showOfflineDetails && (
            <div className="px-4 pb-3 text-xs text-red-200/70 leading-relaxed border-t border-red-800/40 pt-2 mx-4">
              {t('status_banner.brain_offline')}
            </div>
          )}
        </div>
      )}

      {/* LLM 未配置警告横幅 */}
      {settings.behavior.onboarded && !settings.llmProvider.apiKey && !settings.llmProvider.apiUrl.includes('localhost') && !settings.llmProvider.apiUrl.includes('127.0.0.1') && (
        <div
          onClick={() => setShowSettings(true)}
          className="px-4 py-2 bg-amber-950/40 border-b border-amber-900/60 flex items-center gap-3 cursor-pointer hover:bg-amber-900/20 transition-colors"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-amber-200 truncate">
            {t('onboarding.warning_banner')}
          </div>
        </div>
      )}

      <main className="flex-1 overflow-hidden relative">
        {isLoadingGraph && (
          <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-cyan-500/30 overflow-hidden">
            <div className="h-full animate-shimmer-fast" style={{
              background: 'linear-gradient(90deg, transparent 0%, #22d3ee 50%, transparent 100%)',
              width: '200%',
            }} />
          </div>
        )}
        <GraphViewer
          entities={entities}
          relationships={relationships}
          onDataChanged={fetchGraphData}
          focusEntityId={focusEntityId}
          onFocusEntityReset={() => setFocusEntityId(undefined)}
        />

        {graphTotal > entities.length && entities.length > 0 && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-10 rounded-md border border-white/10 bg-gray-950/80 px-2.5 py-1 text-[11px] text-gray-400 backdrop-blur-sm">
            {t('graph.showing_count').replace('{shown}', String(entities.length)).replace('{total}', String(graphTotal))}
          </div>
        )}

        {/* 首页「记忆亮点」浮条：让 Agent Loop 的主动洞见被看见 */}
        {insightHighlights.length > 0 && !insightsHidden && entities.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(90%,28rem)]">
            <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-gray-950/90 px-3.5 py-2.5 shadow-2xl shadow-cyan-950/30 backdrop-blur-sm">
              <Sparkles className="w-4 h-4 shrink-0 text-cyan-300 animate-pulse" />
              <button onClick={() => setShowInsights(true)} className="flex-1 min-w-0 text-left">
                <span className="block text-[10px] uppercase tracking-wider text-cyan-400/80">
                  {t('insights.highlights_label')} · {insightHighlights.length}
                </span>
                <span className="block text-sm text-gray-200 truncate">{insightHighlights[0].title}</span>
              </button>
              <button
                onClick={() => setShowInsights(true)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
              >
                {t('insights.highlights_view')}
              </button>
              <button
                onClick={() => setInsightsHidden(true)}
                className="shrink-0 text-gray-500 hover:text-white"
                title={t('insights.close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {entities.length === 0 && !emptyDismissed && (
          <EmptyState
            onLoadDemo={handleLoadDemo}
            isLoadingDemo={isLoadingDemo}
            onUploadClick={() => setShowUpload(true)}
            onShowDecisionLog={() => setShowDecisionLog(true)}
            onConnectMcp={() => { setSettingsTab('mcp'); setShowSettings(true); }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onDismiss={() => setEmptyDismissed(true)}
          />
        )}

        {showUpload && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
            onClick={() => setShowUpload(false)}
          >
            <div
              className="bg-[#0a0b12]/95 w-full max-w-md p-6 rounded-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  {t('upload.title')}
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
                ref={dropZoneRef}
                onSuccess={(r) => {
                  toast.success(t('toast.file_extracted').replace('{filename}', r.filename), t('toast.file_extracted_detail').replace('{entities}', String(r.entities)).replace('{relationships}', String(r.relationships)));
                  fetchGraphData();
                }}
                onError={(filename, msg) => {
                  toast.error(t('toast.file_upload_failed').replace('{filename}', filename), msg);
                }}
              />
            </div>
          </div>
        )}

        {showShortcuts && (
          <ShortcutsHelp 
            shortcuts={settings.keyboardShortcuts.map((s) => {
              const current = s.current.toLowerCase();
              return {
                ...s,
                key: current.split('+').pop() || '',
                ctrl: current.includes('ctrl') || current.includes('cmd'),
                shift: current.includes('shift'),
                alt: current.includes('alt'),
                category: t(`settings.category.${s.category.toLowerCase()}`),
                description: t(s.description),
              };
            })} 
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
            defaultTab={settingsTab}
          />
        )}
        
        <InsightsInbox isOpen={showInsights} onClose={() => setShowInsights(false)} />
        {showMemoryManager && <MemoryManager onClose={() => setShowMemoryManager(false)} />}

        <HardwarePairingPanel isOpen={showHardware} onClose={() => setShowHardware(false)} />

        {/* 搜索 / 问大脑 / 决策助手已由图谱命令栏统一替代 */}

        <DecisionTimeline
          isOpen={showDecisionLog}
          onClose={() => setShowDecisionLog(false)}
          onSelectEntity={(id) => {
            setFocusEntityId(id);
          }}
        />

        {/* [通用] 首次启动引导 */}
        {(!settings.behavior.onboarded || showWizardForce) && (
          <OnboardingWizard
            settings={settings}
            onUpdateBehavior={updateBehavior}
            onUpdateLlmProvider={updateLlmProvider}
            triggerPrecipitate={handlePrecipitate}
            onClose={() => {
              updateBehavior({ onboarded: true });
              setShowWizardForce(false);
            }}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setShowSettings(true);
            }}
          />
        )}
      </main>

      {isDraggingFile && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-cyan-950/60 border-4 border-dashed border-cyan-400 m-4 rounded-2xl pointer-events-none transition-all duration-200">
          <div className="flex flex-col items-center gap-4 bg-black/60 p-8 rounded-2xl border border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.3)] animate-pulse">
            <Upload className="w-12 h-12 text-cyan-400 animate-bounce" />
            <p className="text-lg font-bold text-white tracking-widest uppercase">
              {t("drag_drop.overlay_hint")}
            </p>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
