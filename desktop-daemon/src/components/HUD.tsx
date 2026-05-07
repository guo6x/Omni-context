"use client";

import { useState, useEffect } from "react";
import { X, Activity, Database, Zap } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "@/hooks/useTranslation";

interface HUDProps {
  isVisible: boolean;
  onClose: () => void;
  message?: string;
  status?: "listening" | "processing" | "success" | "error";
}

export default function HUD({ isVisible, onClose, message, status = "listening" }: HUDProps) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const { t } = useTranslation();

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  if (!isVisible) return null;

  const statusIcon = {
    listening: <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />,
    processing: <Zap className="w-5 h-5 text-yellow-400 animate-pulse" />,
    success: <Database className="w-5 h-5 text-green-400" />,
    error: <X className="w-5 h-5 text-red-400" />,
  };

  const statusText = {
    listening: t('hud.listening'),
    processing: t('hud.processing'),
    success: t('hud.success'),
    error: t('hud.error'),
  };

  return (
    <div className="fixed top-20 right-4 z-50">
      <div className="glass-panel p-6 min-w-[320px] border-l-4 border-l-cyan-400">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {statusIcon[currentStatus]}
            <h3 className="text-lg font-semibold text-cyan-400">Omni-Context HUD</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">{t('hud.listening').split('...')[0]}：</span>
            <span className={clsx(
              currentStatus === "success" ? "text-green-400" :
              currentStatus === "error" ? "text-red-400" :
              "text-cyan-400"
            )}>
              {statusText[currentStatus]}
            </span>
          </div>
          
          {message && (
            <div className="text-sm text-gray-300 bg-black/30 p-3 rounded-lg border border-white/10">
              {message}
            </div>
          )}
          
          <div className="flex gap-2 mt-4">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse delay-75" />
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse delay-150" />
          </div>
        </div>
      </div>
    </div>
  );
}
