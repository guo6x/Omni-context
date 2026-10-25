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
import RetainedPanel from "@/components/RetainedPanel";
import ModalDialog from "@/components/ModalDialog";
import { Zap, Settings, Minimize2, HelpCircle, Bell, X, Upload, AlertCircle, Sparkles, PictureInPicture2, Search, Scale, ChevronDown, ChevronUp, MoreHorizontal, Brain, RefreshCw } from "lucide-react";
import { LogoMark } from "@/components/BrandMark";
import { Entity, Relationship } from "@shared/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useCapturePolicySyncStatus, useSettings, syncLlmToBrainServer } from "@/hooks/useSettings";
import { useOmniContext } from "@/hooks/useOmniContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";
import DecisionTimeline from "@/components/DecisionTimeline";
import ControlCenter from "@/components/ControlCenter";
import WorkspaceNavigation, { WorkspaceSection } from "@/components/WorkspaceNavigation";
import { useConfirm } from "@/components/ConfirmDialog";
import { apiFetch } from '@/lib/api-client';
import { resolveNodeCap } from '@/lib/device';
import { isCapturePolicyRevokedError } from '@/lib/capture-policy-presentation';

function activeElementForReturn(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

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
  const [showUpload, setShowUploadState] = useState(false);
  const uploadVisibleRef = useRef(false);
  const uploadDispatchEpochRef = useRef(0);
  const uploadReturnFocusRef = useRef<HTMLElement | null>(null);
  const setShowUpload = useCallback((visible: boolean) => {
    if (visible && !uploadVisibleRef.current) uploadReturnFocusRef.current = activeElementForReturn();
    uploadVisibleRef.current = visible;
    if (!visible) uploadDispatchEpochRef.current += 1;
    setShowUploadState(visible);
  }, []);
  const [showHardware, setShowHardware] = useState(false);
  const [emptyDismissed, setEmptyDismissed] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [showDecisionLog, setShowDecisionLog] = useState(false);
  const [showControlCenter, setShowControlCenter] = useState(false);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>("ask");
  const memoryManagerReturnFocusRef = useRef<HTMLElement | null>(null);
  const openMemoryManager = useCallback(() => {
    if (!showMemoryManager) memoryManagerReturnFocusRef.current = activeElementForReturn();
    setShowMemoryManager(true);
  }, [showMemoryManager]);
  const closeMemoryManager = useCallback(() => {
    setShowMemoryManager(false);
    setWorkspaceSection("ask");
  }, []);
  const [askRequest, setAskRequest] = useState<{ id: number; question: string }>();
  const [memoryManagerFilter, setMemoryManagerFilter] = useState<{ type?: string; coreOnly?: boolean; unlinkedOnly?: boolean }>({});
  const [memoryManagerFilterRequestId, setMemoryManagerFilterRequestId] = useState(0);
  const navigateWorkspace = (section: WorkspaceSection) => {
    setWorkspaceSection(section);
    setShowDecisionLog(section === "journey");
    if (section === "library") openMemoryManager();
    else setShowMemoryManager(false);
    setShowControlCenter(section === "advanced");
  };
  // 启动遮罩兜底：brain-server 长时间起不来时也要放行进 App（由离线横幅接管），避免遮罩锁死 UI
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  const [focusEntityId, setFocusEntityId] = useState<string | undefined>(undefined);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showOfflineDetails, setShowOfflineDetails] = useState(false);
  const dropZoneRef = useRef<FileDropZoneRef>(null);
  const isPrecipitating = useRef(false);
  const { confirm, dialog } = useConfirm();

  const { settings, showSettings, setShowSettings, updateShortcut, resetShortcuts, updateAppearance, updateBehavior, updateLlmProvider } = useSettings();
  // The settings panel also subscribes to this status, but a failed tray toggle
  // must remain visible after the panel is closed. Keep the fail-closed state in
  // the main window with a direct subscription and expose an explicit retry.
  const {
    error: capturePolicySyncError,
    pending: capturePolicySyncPending,
    retry: retryCapturePolicySync,
    retrying: retryingCapturePolicySync,
  } = useCapturePolicySyncStatus();
  const capturePolicyNeedsSafeRecovery = isCapturePolicyRevokedError(capturePolicySyncError);
  const { status, hasConnectedOnce, addLog, triggerPrecipitate, triggerDecision, triggerReset, refreshTrigger } = useOmniContext();
  const { t, language, setLanguage } = useTranslation();
  const toast = useToast();
  const policySyncHudPreviousRef = useRef<{ status: typeof hudStatus; message: string } | null>(null);

  // Keep an already-open floating HUD consistent with the main-window
  // fail-closed state. The main banner remains the durable recovery surface;
  // this broadcast only updates HUD content and never forces a window to show.
  useEffect(() => {
    if (capturePolicySyncError) {
      if (!policySyncHudPreviousRef.current) {
        policySyncHudPreviousRef.current = { status: hudStatus, message: hudMessage };
      }
      const revocationUnconfirmed = capturePolicySyncError.includes('无法确认原生捕获已停止');
      const message = revocationUnconfirmed
        ? language === 'zh'
          ? '无法确认原生捕获已停止；请立即停止捕获并退出应用。'
          : 'Native capture may still be active. Stop capture and exit the app now.'
        : capturePolicyNeedsSafeRecovery
          ? language === 'zh'
            ? '本机捕获保持撤销；此前的隐私设置未能保存或确认。请先保存“保持暂停”。'
            : 'Native capture remains revoked because the privacy change was not saved or confirmed. Save with capture paused first.'
        : language === 'zh'
          ? '捕获保持拒绝，直到隐私策略同步成功。'
          : 'Capture remains blocked until the privacy policy synchronization succeeds.';
      setHudStatus('error');
      setHudMessage(message);
      void pushFloatingHUD('error', message);
      return;
    }

    // A successful retry clears the warning. Restore whatever the HUD was
    // showing before the policy failure instead of leaving a stale error.
    const previous = policySyncHudPreviousRef.current;
    if (!previous) return;
    policySyncHudPreviousRef.current = null;
    setHudStatus(previous.status);
    setHudMessage(previous.message);
    void pushFloatingHUD(previous.status, previous.message || t('hud.welcome'));
  }, [capturePolicySyncError, hudMessage, hudStatus, language, t]);

  const [settingsTab, setSettingsTab] = useState<'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'mcp' | 'diagnostics' | 'privacy' | 'about'>('shortcuts');
  const [showWizardForce, setShowWizardForce] = useState(false);
  // The onboarding wizard owns the import state. Keep a synchronous mirror so
  // the outer focus-trap Escape handler cannot hide the only recovery surface.
  const onboardingImportPendingRef = useRef(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const graphRequestRef = useRef(0);

  // 提到组件 scope，方便上传成功 / 手动操作后重拉
  const fetchGraphData = useCallback(async () => {
    const requestId = ++graphRequestRef.current;
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
      if (requestId !== graphRequestRef.current) return;
      setEntities(data.entities || []);
      setRelationships(data.relationships || []);
      setGraphTotal(typeof data.total === 'number' ? data.total : (data.entities || []).length);
    } catch (error) {
      // 第一次 brain-server 还没起就别打扰用户；只在已有数据时刷新失败提示
      if (requestId === graphRequestRef.current && entities.length > 0) {
        toast.error(t('toast.refresh_failed'), String(error));
      }
    } finally {
      if (requestId === graphRequestRef.current) setIsLoadingGraph(false);
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
        if (res.ok) {
          const data = await res.json();
          if (active) setInsightHighlights(Array.isArray(data) ? data : []);
        } else await res.arrayBuffer();
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
          const dispatchEpoch = uploadDispatchEpochRef.current;

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
              if (dispatchEpoch !== uploadDispatchEpochRef.current) return;
              // 自动弹出上传弹窗
              setShowUpload(true);

              // 构造伪 FileLike 对象
              const tauriFiles = files.map((f) => new TauriFileLike(f.name, f.size, f.path));

              // 稍微加个延迟，等 modal 完全渲染和 ref 挂载好
              setTimeout(() => {
                if (uploadVisibleRef.current && dispatchEpoch === uploadDispatchEpochRef.current && dropZoneRef.current) {
                  void dropZoneRef.current.handleFiles(tauriFiles);
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
  }, [confirm, t, toast, setShowUpload]);

  // 当拖拽模式被卡住时，按 Esc 键可以退出
  useEffect(() => {
    if (!isDraggingFile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDraggingFile(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDraggingFile]);

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
      // 显示 toast 提醒用户抓屏已暂停，并提供打开设置的指引
      const settingsHint = t('hud.capture_paused_hint') || '请在设置 → 行为中开启抓取';
      toast.warning(paused, settingsHint);
      if (settings.behavior.autoHUD) {
        setTimeout(async () => {
          await toggleFloatingHUD(false);
          setFloatingHudOn(false);
        }, 3000);
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
    // Static browser previews do not provide Tauri IPC; keep desktop-only shortcuts inert there.
    if (typeof window === 'undefined' || typeof (window as any).__TAURI_IPC__ !== 'function') return;
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
        <div data-testid="startup-splash" role="status" aria-live="polite" className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background">
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
            aria-label={floatingHudOn ? t('header.hide_hud') : t('header.show_hud')}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { fetchGraphData(); toast.success('已刷新图谱'); }}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title="刷新图谱（看新加进来的记忆）"
            aria-label="刷新图谱（看新加进来的记忆）"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title={t('nav.more')}
              aria-label={t('nav.more')}
              data-testid="header-more-menu"
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
                    data-testid="header-decision-log"
                  >
                    <Scale className="w-4 h-4 text-cyan-400" />
                    {t('nav.decision_log')}
                  </button>
                  <button
                    onClick={() => { setShowControlCenter(true); setShowMoreMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Scale className="w-4 h-4 text-emerald-400" />
                    Control Center
                  </button>
                  <button
                    onClick={() => { openMemoryManager(); setShowMoreMenu(false); }}
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
            aria-label={t('nav.settings')}
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
        <button
          type="button"
          onClick={() => { setSettingsTab('llm'); setShowSettings(true); }}
          className="w-full px-4 py-2 bg-amber-950/40 border-b border-amber-900/60 flex items-center gap-3 text-left cursor-pointer hover:bg-amber-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-amber-200 truncate">
            {t('onboarding.warning_banner')}
          </div>
        </button>
      )}

      {/* A native-policy sync failure can be triggered from the tray while this
          window is hidden. Keep the safe-deny state visible in the main window
          until an explicit retry confirms the native policy. */}
      {capturePolicySyncPending && (
        <div role="status" aria-live="polite" className="border-b border-cyan-700/50 bg-cyan-950/30 px-4 py-2">
          <div className="flex items-center gap-3 text-xs text-cyan-100">
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-cyan-300" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {language === 'zh'
                ? '正在由本机确认隐私策略；暂停或恢复尚未确认，已开始的捕获/提交可能仍在收尾。请等待状态确认后再判断。'
                : 'The native privacy policy is being confirmed. Pause/resume is not confirmed yet, and an already-started capture or submission may still be finishing. Wait for confirmation before assuming its state.'}
            </span>
          </div>
        </div>
      )}
      {capturePolicySyncError && (
        <div
          data-testid="capture-policy-sync-alert"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="border-b border-amber-700/70 bg-amber-950/50 px-4 py-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-100">
                {language === 'zh'
                  ? '隐私策略未能同步到本机。'
                  : 'The privacy policy could not be synchronized to this device.'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
                        {capturePolicySyncError.includes('无法确认原生捕获已停止')
                          ? language === 'zh'
                            ? '无法确认原生捕获已停止；请立即停止捕获并退出应用。'
                            : 'Native capture may still be active. Stop capture and exit the app now.'
                          : capturePolicyNeedsSafeRecovery
                            ? language === 'zh'
                              ? '本机捕获保持撤销；此前的隐私设置未能保存或确认。请先保存“保持暂停”，再单独选择是否恢复。'
                              : 'Native capture remains revoked because the privacy change was not saved or confirmed. Save with capture paused before separately choosing whether to resume.'
                          : language === 'zh'
                            ? '捕获保持拒绝，直到隐私策略同步成功。'
                            : 'Capture remains blocked until the privacy policy synchronization succeeds.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {capturePolicySyncError.includes('无法确认原生捕获已停止') ? (
                <button
                  type="button"
                  data-testid="capture-policy-sync-exit"
                  onClick={async () => {
                    try {
                      await invoke('quit_app');
                    } catch (error) {
                      toast.error(language === 'zh' ? '无法安全退出 Omni-Context' : 'Unable to exit Omni-Context safely', String(error));
                    }
                  }}
                  className="rounded-md border border-red-500/80 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-950/70"
                >
                  {language === 'zh' ? '退出 Omni-Context' : 'Exit Omni-Context'}
                </button>
              ) : !capturePolicyNeedsSafeRecovery && <button
                type="button"
                onClick={() => void retryCapturePolicySync()}
                disabled={retryingCapturePolicySync || capturePolicySyncPending}
                aria-busy={retryingCapturePolicySync}
                data-testid="capture-policy-sync-retry"
                className="inline-flex items-center gap-2 rounded-md border border-amber-500/80 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-900/60 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retryingCapturePolicySync ? 'animate-spin' : ''}`} aria-hidden="true" />
                {retryingCapturePolicySync
                  ? (language === 'zh' ? '正在重试…' : 'Retrying…')
                  : (language === 'zh' ? '重试同步' : 'Retry sync')}
              </button>}
              {!capturePolicySyncError.includes('无法确认原生捕获已停止') && <button
                type="button"
                onClick={() => { setSettingsTab('privacy'); setShowSettings(true); }}
                data-testid="capture-policy-sync-open-settings"
                className="rounded-md px-2 py-1.5 text-xs text-amber-200/90 transition-colors hover:bg-amber-900/40 hover:text-amber-100"
              >
                {language === 'zh' ? '打开隐私设置' : 'Open privacy settings'}
              </button>}
            </div>
          </div>
        </div>
      )}

      <WorkspaceNavigation activeSection={workspaceSection} onNavigate={navigateWorkspace} />

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
          askRequest={askRequest}
          onReviewDecisions={() => { setWorkspaceSection('journey'); setShowDecisionLog(true); }}
          onOpenLlmSettings={() => { setSettingsTab('llm'); setShowSettings(true); }}
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
            onShowDecisionLog={() => { setWorkspaceSection("journey"); setShowDecisionLog(true); }}
            onConnectMcp={() => { setSettingsTab('mcp'); setShowSettings(true); }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onDismiss={() => setEmptyDismissed(true)}
          />
        )}

        <RetainedPanel visible={showUpload} name="upload" modal>
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowUpload(false)}
          >
            <ModalDialog
              active={showUpload}
              titleId="upload-dialog-title"
              onDismiss={() => setShowUpload(false)}
              returnFocusRef={uploadReturnFocusRef}
              className="bg-[#0a0b12]/95 w-full max-w-md max-h-full overflow-y-auto p-6 rounded-2xl border border-white/10"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="upload-dialog-title" className="flex items-center gap-2 text-white font-semibold">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  {t('upload.title')}
                </h2>
                <button
                  onClick={() => setShowUpload(false)}
                  className="text-gray-400 hover:text-white"
                  aria-label={t('upload.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <FileDropZone
                ref={dropZoneRef}
                onDataChanged={fetchGraphData}
                onSuccess={(r) => {
                  if (r.partial) {
                    toast.warning(t('toast.file_partial').replace('{filename}', r.filename), r.countsKnown === true
                      ? t('toast.file_partial_detail').replace('{entities}', String(r.entities))
                      : t('toast.file_counts_unknown'));
                  } else {
                    toast.success(t('toast.file_extracted').replace('{filename}', r.filename), r.countsKnown === true
                      ? t('toast.file_extracted_detail').replace('{entities}', String(r.entities)).replace('{relationships}', String(r.relationships))
                      : t('toast.file_counts_unknown'));
                  }
                }}
                onError={(filename, msg) => {
                  toast.error(t('toast.file_upload_failed').replace('{filename}', filename), msg);
                }}
              />
            </ModalDialog>
          </div>
        </RetainedPanel>

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
        
        <InsightsInbox
          isOpen={showInsights}
          onClose={() => setShowInsights(false)}
          onSelectEntity={(id) => {
            setFocusEntityId(id);
          }}
          entities={entities}
          onOpenMemoryManager={(filter) => {
            setWorkspaceSection("library");
            setMemoryManagerFilter(filter);
            setMemoryManagerFilterRequestId((requestId) => requestId + 1);
            openMemoryManager();
          }}
        />
        <RetainedPanel visible={showMemoryManager} name="library" modal>
          <ModalDialog
            active={showMemoryManager}
            titleId="memory-manager-dialog-title"
            onDismiss={closeMemoryManager}
            returnFocusRef={memoryManagerReturnFocusRef}
          >
            <MemoryManager
              onDataChanged={fetchGraphData}
              initialType={memoryManagerFilter.type}
              initialCoreOnly={memoryManagerFilter.coreOnly}
              initialUnlinkedOnly={memoryManagerFilter.unlinkedOnly}
              filterRequestId={memoryManagerFilterRequestId}
              onClose={closeMemoryManager}
            />
          </ModalDialog>
        </RetainedPanel>

        <HardwarePairingPanel isOpen={showHardware} onClose={() => setShowHardware(false)} />

        {/* 搜索 / 问大脑 / 决策助手已由图谱命令栏统一替代 */}

        <DecisionTimeline
          isOpen={showDecisionLog}
          onClose={() => { setShowDecisionLog(false); setWorkspaceSection("ask"); }}
          onSelectEntity={(id) => {
            setFocusEntityId(id);
          }}
        />

        <ControlCenter isOpen={showControlCenter} onClose={() => { setShowControlCenter(false); setWorkspaceSection("ask"); }} />

        {/* [通用] 首次启动引导 */}
        <RetainedPanel visible={!settings.behavior.onboarded || showWizardForce} name="onboarding" modal>
          <ModalDialog
            active={!settings.behavior.onboarded || showWizardForce}
            titleId="onboarding-dialog-title"
            onDismiss={() => {
              if (onboardingImportPendingRef.current) return;
              updateBehavior({ onboarded: true });
              setShowWizardForce(false);
            }}
          >
            <OnboardingWizard
              settings={settings}
              visible={!settings.behavior.onboarded || showWizardForce}
              onImportComplete={fetchGraphData}
              onImportPendingChange={(pending) => { onboardingImportPendingRef.current = pending; }}
              onAskImported={() => {
                navigateWorkspace('ask');
                updateBehavior({ onboarded: true });
                setShowWizardForce(false);
                setEmptyDismissed(true);
                setAskRequest({ id: Date.now(), question: t('ask.imported_prompt') });
              }}
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
          </ModalDialog>
        </RetainedPanel>
      </main>

      {isDraggingFile && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-cyan-950/60 border-4 border-dashed border-cyan-400 m-4 rounded-2xl pointer-events-auto cursor-pointer transition-all duration-200"
          onClick={() => setIsDraggingFile(false)}
        >
          {/* 右上角关闭按钮 */}
          <button 
            onClick={(e) => { e.stopPropagation(); setIsDraggingFile(false); }}
            className="absolute top-6 right-6 p-2 rounded-full bg-black/40 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 hover:text-white transition-all hover:scale-115"
            title="关闭遮罩"
          >
            <X className="w-5 h-5" />
          </button>

          <div 
            className="flex flex-col items-center gap-4 bg-black/70 p-8 rounded-2xl border border-cyan-500/30 shadow-[0_0_50px_rgba(6,182,212,0.3)] cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <Upload className="w-12 h-12 text-cyan-400 animate-bounce" />
            <p className="text-lg font-bold text-white tracking-widest uppercase">
              {t("drag_drop.overlay_hint")}
            </p>
            <p className="text-xs text-gray-400 tracking-wide mt-1">
              {language === 'zh' ? '提示：点击空白处或按 Esc 键可关闭' : 'Tip: Click empty space or press Esc to close'}
            </p>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
