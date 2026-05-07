"use client";

import { useState, useEffect, useCallback } from "react";

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

  const triggerPrecipitate = useCallback(() => {
    addLog("触发沉淀操作 - 捕获屏幕并提取知识", "info");
    console.log("沉淀操作已触发");
  }, [addLog]);

  const triggerDecision = useCallback(() => {
    addLog("触发决策查询", "info");
    console.log("决策查询已触发");
  }, [addLog]);

  const triggerReset = useCallback(() => {
    addLog("触发重置操作", "warning");
    console.log("重置操作已触发");
  }, [addLog]);

  useEffect(() => {
    // 模拟 Brain Server 启动
    const timer = setTimeout(() => {
      setStatus((prev) => ({ ...prev, brain_server_running: true }));
      addLog("Brain Server 已启动并运行中", "success");
    }, 2000);

    return () => clearTimeout(timer);
  }, [addLog]);

  return {
    status,
    logs,
    addLog,
    triggerPrecipitate,
    triggerDecision,
    triggerReset,
  };
}
