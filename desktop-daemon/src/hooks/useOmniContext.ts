"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";

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

export function useOmniContext() {
  const [status, setStatus] = useState<SystemStatus>({
    brain_server_running: false,
    udp_listener_running: true,
    last_event: null,
  });

  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  const triggerPrecipitate = useCallback(async () => {
    addLog("开始执行沉淀操作...", "info");
    try {
      addLog("正在捕获屏幕与剪贴板...", "info");
      const screenshot = await invoke<string>("capture_screen");
      const clipboard = await invoke<string>("get_clipboard");

      addLog("正在通过 Brain Server (LLM) 进行深度图谱提取...", "info");
      const response = await fetch("http://localhost:3001/api/graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshot,
          clipboard,
        }),
      });

      if (!response.ok) {
        throw new Error(`Brain Server 返回错误: ${response.statusText}`);
      }

      const result = await response.json();
      addLog(`提取成功！新增节点: ${result.entities}, 关系: ${result.relationships}`, "success");
      
      // 触发 React 重新拉取 Graph 数据
      setRefreshTrigger(prev => prev + 1);

    } catch (error) {
      console.error(error);
      addLog(`沉淀操作失败: ${String(error)}`, "error");
    }
  }, [addLog]);

  const triggerDecision = useCallback(async () => {
    addLog("触发决策查询", "info");
    setRefreshTrigger(prev => prev + 1);
  }, [addLog]);

  const triggerReset = useCallback(() => {
    addLog("触发重置操作", "warning");
    console.log("重置操作已触发");
  }, [addLog]);

  useEffect(() => {
    // 真实检测 Brain Server 状态
    const checkBrainServer = async () => {
      try {
        const res = await fetch("http://localhost:3001/health");
        if (res.ok && !status.brain_server_running) {
          setStatus((prev) => ({ ...prev, brain_server_running: true }));
          addLog("Brain Server 已连接并正常运行", "success");
        }
      } catch (e) {
        if (status.brain_server_running) {
          setStatus((prev) => ({ ...prev, brain_server_running: false }));
          addLog("Brain Server 连接断开", "error");
        }
      }
    };

    const timer = setInterval(checkBrainServer, 3000);
    checkBrainServer();

    return () => clearInterval(timer);
  }, [addLog, status.brain_server_running]);

  return {
    status,
    logs,
    addLog,
    triggerPrecipitate,
    triggerDecision,
    triggerReset,
    refreshTrigger,
  };
}
