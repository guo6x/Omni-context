"use client";

import { useEffect, useState } from "react";
import { Activity, Database, Zap, X, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "@/hooks/useTranslation";

type HudStatus = "listening" | "processing" | "success" | "warning" | "error";

interface HudPayload {
  status?: HudStatus;
  message?: string;
}

/**
 * 真·桌面级悬浮 HUD —— 跑在独立 Tauri 窗口（label="hud"）里。
 * 通过 Tauri 事件 `hud-update` 接收主窗口推过来的状态；
 * 通过 `hud-close` 自我隐藏。窗口本身是 frameless + transparent +
 * alwaysOnTop + skipTaskbar，所以主窗口最小化后这块还在。
 */
export default function FloatingHUD() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HudStatus>("listening");
  const [message, setMessage] = useState<string>(t('hud.waiting'));
  const [pulse, setPulse] = useState(0);

  // 让窗口本身和 body 都透明（Tauri transparent:true 需要页面也透明，否则黑色矩形会盖住）
  useEffect(() => {
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
    };
  }, []);

  useEffect(() => {
    let unlistenUpdate: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;

    (async () => {
      try {
        const { appWindow } = await import("@tauri-apps/api/window");
        unlistenUpdate = await appWindow.listen<HudPayload>("hud-update", (event) => {
          if (event.payload.status) setStatus(event.payload.status);
          if (event.payload.message !== undefined) setMessage(event.payload.message);
          setPulse((p) => p + 1);
        });
        unlistenClose = await appWindow.listen("hud-close", async () => {
          await appWindow.hide();
        });
      } catch (e) {
        // 非 Tauri 环境（开发预览）静默
        console.warn("[FloatingHUD] tauri event listen failed", e);
      }
    })();

    return () => {
      unlistenUpdate?.();
      unlistenClose?.();
    };
  }, []);

  const handleHide = async () => {
    try {
      const { appWindow } = await import("@tauri-apps/api/window");
      await appWindow.hide();
    } catch {}
  };

  const statusIcon = {
    listening: <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />,
    processing: <Zap className="w-4 h-4 text-yellow-400 animate-pulse" />,
    success: <Database className="w-4 h-4 text-green-400" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    error: <X className="w-4 h-4 text-red-400" />,
  } as const;

  const accent = {
    listening: "border-l-cyan-400",
    processing: "border-l-yellow-400",
    success: "border-l-green-400",
    warning: "border-l-amber-400",
    error: "border-l-red-400",
  } as const;

  return (
    // 整窗背景透明，整个组件可拖拽（data-tauri-drag-region）
    <div
      className="w-screen h-screen flex items-center justify-center bg-transparent select-none"
      data-tauri-drag-region
    >
      <div
        data-tauri-drag-region
        className={clsx(
          "w-[340px] rounded-xl border border-white/15 bg-[#0a0b12]/90 backdrop-blur-md shadow-2xl shadow-black/50 p-4 border-l-4 transition-colors",
          accent[status]
        )}
      >
        <div className="flex items-center justify-between mb-2" data-tauri-drag-region>
          <div className="flex items-center gap-2" data-tauri-drag-region>
            {statusIcon[status]}
            <h3
              className="text-sm font-bold tracking-wider bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #7df9ff 0%, #00f2fe 60%, #a855f7 100%)",
              }}
            >
              OMNI-CONTEXT
            </h3>
          </div>
          <button
            onClick={handleHide}
            className="text-gray-400 hover:text-white transition-colors"
            title={t('header.hide_hud')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div
          key={pulse}
          className="text-xs text-gray-200 bg-black/40 rounded-md px-2.5 py-2 border border-white/5 animate-pulse"
          style={{ animationIterationCount: 1, animationDuration: "0.6s" }}
        >
          {message}
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
          <span>{t('hud.drag_hint')}</span>
          <span className="font-mono">{status}</span>
        </div>
      </div>
    </div>
  );
}
