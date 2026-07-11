"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { X, Wifi, Trash2, Link as LinkIcon, Unlink, Check, RefreshCw } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useToast } from "@/hooks/useToast";

interface HardwarePairingPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DeviceInfo {
  device_id: string;
  ip: string | null;
  last_seen: string | null;
  last_command: string | null;
  packets: number;
  paired: boolean;
  alias: string | null;
  key_version: number;
  revoked_at: string | null;
}

const REFRESH_INTERVAL_MS = 2000;


export default function HardwarePairingPanel({ isOpen, onClose }: HardwarePairingPanelProps) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceIdDraft, setDeviceIdDraft] = useState("");
  const [credentialDraft, setCredentialDraft] = useState("");
  const [aliasDraft, setAliasDraft] = useState<string>("");
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  // 强制定期刷新相对时间显示
  const [, setTick] = useState(0);
  const { t } = useTranslation();
  const toast = useToast();
  const isMounted = useRef(true);

  function formatRelative(iso: string): string {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return t('hardware.unknown');
    const diff = Date.now() - then;
    if (diff < 0) return t('hardware.just_now');
    if (diff < 2_000) return t('hardware.just_now');
    if (diff < 60_000) return t('hardware.seconds_ago').replace('{n}', String(Math.floor(diff / 1000)));
    if (diff < 3_600_000) return t('hardware.minutes_ago').replace('{n}', String(Math.floor(diff / 60_000)));
    if (diff < 86_400_000) return t('hardware.hours_ago').replace('{n}', String(Math.floor(diff / 3_600_000)));
    return new Date(then).toLocaleString();
  }

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<DeviceInfo[]>("list_hardware_devices");
      if (!isMounted.current) return;
      setDevices(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      if (!isMounted.current) return;
      // Tauri 环境外（如 next dev 浏览器）静默处理
      const msg = String(e);
      if (!msg.includes("__TAURI_IPC__") && !msg.includes("not available")) {
        setError(msg);
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    const tickTimer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(tickTimer);
    };
  }, [isOpen, refresh]);

  const handleConfirmPair = async () => {
    const deviceId = deviceIdDraft.trim();
    const credential = credentialDraft.trim();
    if (!deviceId || !credential) return;
    setBusyDeviceId(deviceId);
    try {
      const alias = aliasDraft.trim();
      await invoke("pair_hardware_device", {
        deviceId,
        credential,
        alias: alias.length > 0 ? alias : null,
      });
      toast.success(t('toast.hw_pair_success'), deviceId);
      setDeviceIdDraft("");
      setCredentialDraft("");
      setAliasDraft("");
      await refresh();
    } catch (e) {
      toast.error(t('toast.hw_pair_failed'), String(e));
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleUnpair = async (deviceId: string) => {
    setBusyDeviceId(deviceId);
    try {
      await invoke("unpair_hardware_device", { deviceId });
      toast.success(t('toast.hw_unpaired'), deviceId);
      await refresh();
    } catch (e) {
      toast.error(t('toast.hw_unpair_failed'), String(e));
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleForget = async (deviceId: string) => {
    setBusyDeviceId(deviceId);
    try {
      await invoke("forget_hardware_device", { deviceId });
      toast.success(t('toast.hw_forgotten'), deviceId);
      await refresh();
    } catch (e) {
      toast.error(t('toast.hw_forget_failed'), String(e));
    } finally {
      setBusyDeviceId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#0a0b12]/95 w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
              <Wifi className="w-5 h-5 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-white font-semibold text-base">{t('hardware.title')}</h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {t('hardware.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={refresh}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-40"
              title={t('hardware.refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              title={t('hardware.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          <form
            className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConfirmPair();
            }}
          >
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <LinkIcon className="h-4 w-4" />
              Secure device pairing
            </div>
            <p className="text-xs leading-5 text-gray-400">
              Enter the device ID and one-time credential shown on the ESP32 serial console. The credential is stored locally and never displayed again.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={deviceIdDraft}
                onChange={(event) => setDeviceIdDraft(event.target.value)}
                placeholder="Device ID"
                autoComplete="off"
                maxLength={128}
                className="px-3 py-2 text-xs rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/50"
              />
              <input
                value={credentialDraft}
                onChange={(event) => setCredentialDraft(event.target.value)}
                placeholder="64-character credential"
                type="password"
                autoComplete="new-password"
                maxLength={256}
                className="px-3 py-2 text-xs rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={aliasDraft}
                onChange={(event) => setAliasDraft(event.target.value)}
                placeholder={t('hardware.alias_placeholder')}
                maxLength={64}
                className="flex-1 px-3 py-2 text-xs rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500/50"
              />
              <button
                type="submit"
                disabled={!deviceIdDraft.trim() || credentialDraft.trim().length < 64 || busyDeviceId !== null}
                className="px-4 py-2 text-xs rounded-lg border border-cyan-500/30 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40"
              >
                {t('hardware.confirm')}
              </button>
            </div>
          </form>

          {devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <Wifi className="w-7 h-7 opacity-40" />
              </div>
              <p className="text-sm text-gray-300">{t('hardware.empty')}</p>
              <p className="text-xs mt-2 max-w-sm leading-5 text-gray-500">
                {t('hardware.empty_hint')}
              </p>
            </div>
          ) : (
            devices.map((dev) => {
              const isBusy = busyDeviceId === dev.device_id;
              return (
                <div
                  key={dev.device_id}
                  className={`rounded-xl border p-4 transition-colors ${
                    dev.paired
                      ? "border-cyan-500/40 bg-cyan-500/5"
                      : "border-white/10 bg-white/[0.02] hover:border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-white">{dev.device_id}</span>
                        {dev.alias && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                            {dev.alias}
                          </span>
                        )}
                        {dev.paired && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex items-center gap-1">
                            <Check className="w-3 h-3" /> {t('hardware.paired')}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-400">
                        <div>
                          <span className="text-gray-500">{t('hardware.last_seen')}</span>
                          <div
                            className="text-gray-300 mt-0.5"
                            title={dev.last_seen ? new Date(dev.last_seen).toLocaleString() : undefined}
                          >
                            {dev.last_seen ? formatRelative(dev.last_seen) : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">{t('hardware.last_command')}</span>
                          <div className="text-gray-300 mt-0.5 font-mono truncate" title={dev.last_command ?? undefined}>
                            {dev.last_command || "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500">{t('hardware.packets')}</span>
                          <div className="text-gray-300 mt-0.5">{dev.packets} · key v{dev.key_version}</div>
                        </div>
                      </div>
                      {dev.ip && <div className="mt-2 font-mono text-[11px] text-gray-500">{dev.ip}</div>}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {dev.paired && (
                        <>
                          <button
                            onClick={() => handleUnpair(dev.device_id)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            {t('hardware.unpair')}
                          </button>
                          <button
                            onClick={() => handleForget(dev.device_id)}
                            disabled={isBusy}
                            className="p-1.5 text-xs rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                            title={t('hardware.remove_from_list')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {!dev.paired && (
                        <button
                          onClick={() => handleForget(dev.device_id)}
                          disabled={isBusy}
                          className="p-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:text-red-300 hover:border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                          title={t('hardware.remove_from_list')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 text-xs text-gray-500">
          {t('hardware.footer_refresh').replace('{total}', String(devices.length))}
          {devices.length > 0 && ' ' + t('hardware.footer_paired').replace('{count}', String(devices.filter((d) => d.paired).length))}
        </div>
      </div>
    </div>
  );
}
