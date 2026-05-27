"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, Database, Zap, X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "@/hooks/useTranslation";
import { useTheme } from "@/hooks/useTheme";

type HudStatus = "listening" | "processing" | "success" | "warning" | "error";

interface HudPayload {
  status?: HudStatus;
  message?: string;
}

const statusColors: Record<HudStatus, { glow: string; text: string; bg: string }> = {
  listening: { glow: "rgba(6,182,212,0.35)", text: "#22d3ee", bg: "rgba(6,182,212,0.08)" },
  processing: { glow: "rgba(250,204,21,0.35)", text: "#facc15", bg: "rgba(250,204,21,0.08)" },
  success: { glow: "rgba(34,197,94,0.35)", text: "#4ade80", bg: "rgba(34,197,94,0.08)" },
  warning: { glow: "rgba(251,191,36,0.35)", text: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
  error: { glow: "rgba(239,68,68,0.35)", text: "#f87171", bg: "rgba(239,68,68,0.08)" },
};

/**
 * 真·桌面级悬浮 HUD —— 跑在独立 Tauri 窗口（label="hud"）里。
 * 通过 Tauri 事件 `hud-update` 接收主窗口推过来的状态；
 * 通过 `hud-close` 自我隐藏。窗口本身是 frameless + transparent +
 * alwaysOnTop + skipTaskbar，所以主窗口最小化后这块还在。
 */
export default function FloatingHUD() {
  const { t } = useTranslation();
  const { themeId, currentTheme } = useTheme();
  const [status, setStatus] = useState<HudStatus>("listening");
  const [message, setMessage] = useState<string>(t('hud.waiting'));
  const [visible, setVisible] = useState(false);

  // 让窗口本身和 body 都透明
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

  // 拖拽 HUD 窗口
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    try {
      const { appWindow } = await import("@tauri-apps/api/window");
      await appWindow.startDragging();
    } catch {}
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
          setVisible(true);
        });
        unlistenClose = await appWindow.listen("hud-close", async () => {
          setVisible(false);
          setTimeout(async () => {
            await appWindow.hide();
          }, 200);
        });
      } catch (e) {
        console.warn("[FloatingHUD] tauri event listen failed", e);
      }
    })();

    return () => {
      unlistenUpdate?.();
      unlistenClose?.();
    };
  }, []);

  useEffect(() => {
    setVisible(true);
  }, []);

  const handleHide = async () => {
    setVisible(false);
    setTimeout(async () => {
      try {
        const { appWindow } = await import("@tauri-apps/api/window");
        await appWindow.hide();
      } catch {}
    }, 200);
  };

  const colors = statusColors[status];

  const statusIcon = {
    listening: <Activity className="w-3.5 h-3.5" style={{ color: colors.text }} />,
    processing: <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: colors.text }} />,
    success: <CheckCircle2 className="w-3.5 h-3.5" style={{ color: colors.text }} />,
    warning: <AlertTriangle className="w-3.5 h-3.5" style={{ color: colors.text }} />,
    error: <X className="w-3.5 h-3.5" style={{ color: colors.text }} />,
  } as const;

  return (
    <div
      className="w-screen h-screen flex items-center justify-center bg-transparent select-none"
      data-tauri-drag-region
      onMouseDown={handleDragStart}
    >
      <div
        data-tauri-drag-region
        onMouseDown={handleDragStart}
        className={clsx(
          "w-[340px] rounded-2xl p-4 transition-all duration-300",
          visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        )}
        style={{
          background: "rgba(15,15,20,0.92)",
          backdropFilter: "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: "blur(20px) saturate(1.4)",
          border: `1px solid rgba(255,255,255,0.08)`,
          boxShadow: `
            0 0 30px ${colors.glow},
            0 0 60px ${colors.glow.replace("0.35", "0.12")},
            0 8px 32px rgba(0,0,0,0.5),
            inset 0 1px 0 rgba(255,255,255,0.04)
          `,
        }}
      >
        {/* 处理中时卡片左上角有流动光条 */}
        {status === "processing" && (
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl overflow-hidden">
            <div
              className="h-full animate-shimmer"
              style={{
                background: "linear-gradient(90deg, transparent 0%, #facc15 50%, transparent 100%)",
                width: "200%",
              }}
            />
          </div>
        )}

        {/* Header */}
        <div
          className="flex items-center justify-between mb-3"
          data-tauri-drag-region
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2.5" data-tauri-drag-region onMouseDown={handleDragStart}>
            {statusIcon[status]}
            <h3
              className="text-[13px] font-bold tracking-[0.15em] uppercase bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  themeId === 'cyberpunk'
                    ? "linear-gradient(90deg, #7df9ff 0%, #00f2fe 60%, #a855f7 100%)"
                    : `linear-gradient(90deg, ${currentTheme.accent} 0%, ${currentTheme.accentHover} 100%)`,
              }}
            >
              OMNI-CONTEXT
            </h3>
          </div>
          <button
            onClick={handleHide}
            className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
            title={t('header.hide_hud')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Message */}
        <div
          className="text-xs leading-relaxed rounded-lg px-3 py-2.5 border transition-colors duration-300"
          style={{
            color: "rgba(226,232,240,0.9)",
            background: colors.bg,
            borderColor: `${colors.text}20`,
          }}
        >
          {message}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-2.5 text-[10px]">
          <span style={{ color: "rgba(148,163,184,0.6)" }}>{t('hud.drag_hint')}</span>
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: colors.text }}
            />
            <span className="font-mono uppercase tracking-wider" style={{ color: colors.text }}>
              {status}
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
