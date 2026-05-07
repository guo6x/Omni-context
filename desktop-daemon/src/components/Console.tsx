"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useOmniContext } from "@/hooks/useOmniContext";

export default function Console() {
  const { t } = useTranslation();
  // 直接复用全局事件流，而不是维护一份本地 demo 日志，
  // 否则 Console 永远只显示假数据，看不到真实事件
  const { logs, addLog } = useOmniContext();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新日志到达时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const visibleLogs = logs.filter((log) => !hidden.has(log.id));

  const clearLogs = () => {
    // useOmniContext 的 logs 来源是 hook 内部 state，外部不能直接清空；
    // 这里通过把现有 id 加入隐藏集合来"软清屏"，新日志仍会出现
    setHidden(new Set(logs.map((l) => l.id)));
    addLog(t('console.clear') || 'Console cleared', 'info');
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
          <span className="text-xs text-gray-500 font-mono">
            {visibleLogs.length}
          </span>
        </div>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded-lg transition-colors text-sm border border-red-800 disabled:opacity-40"
          disabled={visibleLogs.length === 0}
        >
          <Trash2 className="w-3 h-3" />
          {t('console.clear')}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1">
        {visibleLogs.map((log) => (
          <div key={log.id} className="flex gap-3">
            <span className="text-gray-500 shrink-0">
              [{log.timestamp.toLocaleTimeString()}]
            </span>
            <span className={`shrink-0 font-semibold ${typeColors[log.type]}`}>
              [{typeLabels[log.type]}]
            </span>
            <span className="text-gray-300 break-all">{log.message}</span>
          </div>
        ))}
        {visibleLogs.length === 0 && (
          <div className="text-gray-500 italic">{t('console.empty')}</div>
        )}
      </div>
    </div>
  );
}
