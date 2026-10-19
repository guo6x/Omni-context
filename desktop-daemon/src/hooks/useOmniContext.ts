"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { apiFetch } from '../lib/api-client';

interface SystemStatus {
  brain_server_running: boolean;
  udp_listener_running: boolean;
  last_event: string | null;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

const HEALTH_PROBE_INTERVAL_MS = 3000;
const HEALTH_PROBE_TIMEOUT_MS = 10_000;

/** Native credential IPC and response bodies can ignore cancellation. */
function readBrainHealth(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const abortReason = () => signal.reason !== undefined
      ? signal.reason
      : new DOMException('Stopped checking Brain Server health', 'AbortError');
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }

    void (async () => {
      const response = await apiFetch('/health', { method: 'GET', signal });
      if (signal.aborted) throw abortReason();
      // Drain the small payload under the same deadline, including non-2xx.
      await response.arrayBuffer();
      return response.ok;
    })().then(
      (healthy) => { signal.removeEventListener('abort', onAbort); resolve(healthy); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

export function useOmniContext() {
  const [status, setStatus] = useState<SystemStatus>({
    brain_server_running: false,
    udp_listener_running: true,
    last_event: null,
  });
  const brainServerRunningRef = useRef(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 冷启动时 brain-server 还没起，需要一个「曾经连上过」标志来区分
  // 「首次启动加载中」（显示启动遮罩）和「中途断连」（显示离线横幅）。
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "1",
      timestamp: new Date(),
      message: "Omni-Context 桌面守护进程已启动",
      type: "success",
    },
    {
      id: "2",
      timestamp: new Date(),
      message: "UDP 监听器已绑定到端口 9090",
      type: "info",
    },
    {
      id: "3",
      timestamp: new Date(),
      message: "等待触发信号...",
      type: "info",
    },
  ]);

  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    const newLog: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      message,
      type,
    };
    setLogs((prev) => [...prev, newLog]);
  }, []);

  const triggerPrecipitate = useCallback(async (): Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }> => {
    addLog("开始执行沉淀操作...", "info");
    try {
      addLog("正在捕获屏幕与剪贴板...", "info");
      const screenshot = await invoke<string>("capture_screen");
      const clipboard = await invoke<string>("get_clipboard");

      addLog("正在通过 Brain Server (LLM) 进行深度图谱提取...", "info");
      const response = await apiFetch('/api/graph/extract', {
        method: "POST",
        body: JSON.stringify({
          screenshot,
          clipboard,
        }),
      });

      if (!response.ok) {
        throw new Error(`Brain Server 返回错误: ${response.statusText}`);
      }

      const result = await response.json();
      const entityCount = Array.isArray(result.entities) ? result.entities.length : 0;
      const relationshipCount = Array.isArray(result.relationships) ? result.relationships.length : 0;
      addLog(`提取成功！新增节点: ${entityCount}, 关系: ${relationshipCount}`, "success");

      // 触发 React 重新拉取 Graph 数据
      setRefreshTrigger(prev => prev + 1);

      return { ok: true, entities: entityCount, relationships: relationshipCount };

    } catch (error) {
      console.error(error);
      addLog(`沉淀操作失败: ${String(error)}`, "error");
      return { ok: false, error: String(error) };
    }
  }, [addLog]);

  const triggerDecision = useCallback(async () => {
    addLog("触发决策查询", "info");
    setRefreshTrigger(prev => prev + 1);
  }, [addLog]);

  const triggerReset = useCallback(async (): Promise<{ ok: true }> => {
    setLogs(prev => {
      const baseline = prev.slice(0, 3);
      return [...baseline, {
        id: Date.now().toString(),
        timestamp: new Date(),
        message: "会话已重置",
        type: "success" as const,
      }];
    });
    return { ok: true };
  }, []);

  useEffect(() => {
    let active = true;
    let nextProbe: ReturnType<typeof setTimeout> | undefined;
    let probeDeadline: ReturnType<typeof setTimeout> | undefined;
    let currentRequest: AbortController | null = null;

    const updateConnection = (running: boolean) => {
      if (!active) return;
      if (running) setHasConnectedOnce(true);
      if (brainServerRunningRef.current === running) return;
      brainServerRunningRef.current = running;
      setStatus((prev) => ({ ...prev, brain_server_running: running }));
      addLog(running ? "Brain Server 已连接并正常运行" : "Brain Server 连接断开", running ? "success" : "error");
      // 离线 → 在线时主动触发图谱拉取，避免 EmptyState 卡死。
      if (running) setRefreshTrigger((prev) => prev + 1);
    };

    // A completed/aborted probe schedules the next one; no overlapping interval
    // requests or effect restarts when connection state changes.
    const checkBrainServer = async () => {
      if (!active || currentRequest) return;
      const controller = new AbortController();
      currentRequest = controller;
      const deadline = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
      probeDeadline = deadline;
      try {
        const healthy = await readBrainHealth(controller.signal);
        if (active && !controller.signal.aborted) updateConnection(healthy);
      } catch {
        if (active) updateConnection(false);
      } finally {
        clearTimeout(deadline);
        if (probeDeadline === deadline) probeDeadline = undefined;
        if (currentRequest === controller) currentRequest = null;
        if (active) nextProbe = setTimeout(() => { void checkBrainServer(); }, HEALTH_PROBE_INTERVAL_MS);
      }
    };

    void checkBrainServer();
    return () => {
      active = false;
      clearTimeout(nextProbe);
      clearTimeout(probeDeadline);
      currentRequest?.abort();
    };
  }, [addLog]);

  return {
    status,
    hasConnectedOnce,
    logs,
    addLog,
    triggerPrecipitate,
    triggerDecision,
    triggerReset,
    refreshTrigger,
  };
}
