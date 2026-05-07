"use client";

import { useState } from "react";
import { Terminal, Play, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

export default function Console() {
  const { t } = useTranslation();
  
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "1",
      timestamp: new Date(),
      message: t('app.description') + " " + t('hud.success'),
      type: "success",
    },
    {
      id: "2",
      timestamp: new Date(),
      message: "UDP " + t('status.udp_listener') + " - 9090",
      type: "info",
    },
    {
      id: "3",
      timestamp: new Date(),
      message: t('hud.listening'),
      type: "info",
    },
  ]);

  const clearLogs = () => {
    setLogs([]);
  };

  const addDemoLog = () => {
    const demoMessages = [
      { message: "UDP: precipitate", type: "info" as const },
      { message: t('hud.success'), type: "success" as const },
      { message: t('shortcuts.precipitate_desc'), type: "info" as const },
      { message: "Brain Server...", type: "info" as const },
      { message: t('hud.precipitate_success'), type: "success" as const },
    ];
    const random = demoMessages[Math.floor(Math.random() * demoMessages.length)];
    setLogs((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        timestamp: new Date(),
        ...random,
      },
    ]);
  };

  const typeColors = {
    info: "text-cyan-400",
    success: "text-green-400",
    warning: "text-yellow-400",
    error: "text-red-400",
  };

  const typeLabels = {
    info: "INFO",
    success: "OK",
    warning: "WARN",
    error: "ERR",
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/30">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <span className="font-semibold text-white">{t('console.title')}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addDemoLog}
            className="flex items-center gap-1 px-3 py-1.5 bg-cyan-900/30 text-cyan-400 hover:bg-cyan-900/50 rounded-lg transition-colors text-sm border border-cyan-800"
          >
            <Play className="w-3 h-3" />
            {t('console.simulate')}
          </button>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded-lg transition-colors text-sm border border-red-800"
          >
            <Trash2 className="w-3 h-3" />
            {t('console.clear')}
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1">
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3">
            <span className="text-gray-500 shrink-0">
              [{log.timestamp.toLocaleTimeString()}]
            </span>
            <span className={`shrink-0 font-semibold ${typeColors[log.type]}`}>
              [{typeLabels[log.type]}]
            </span>
            <span className="text-gray-300">{log.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-gray-500 italic">{t('console.empty')}</div>
        )}
      </div>
    </div>
  );
}
