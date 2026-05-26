"use client";

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { ChevronDown, ChevronUp, Copy, FolderOpen, Zap, CheckCircle, AlertCircle } from 'lucide-react';
import { McpClientMeta } from '@/lib/mcp-clients';

interface McpClientCardProps {
  client: McpClientMeta;
  status: {
    installed: boolean;
    configured: boolean;
    config_path: string;
  };
  serverCmd: {
    command: string;
    args: string[];
  } | null;
  onInstall: (id: string) => Promise<void>;
  onOpenFolder: (id: string) => Promise<void>;
}

export default function McpClientCard({
  client,
  status,
  serverCmd,
  onInstall,
  onOpenFolder,
}: McpClientCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const toast = useToast();

  const nodePath = serverCmd?.command || 'node';
  const proxyPath = serverCmd?.args?.[0] || 'mcp-proxy.js';

  // 格式化复制的文本
  const handleCopyText = (type: 'json' | 'command' | 'args' | 'yaml') => {
    let text = '';
    if (type === 'json') {
      if (client.id === 'continue') {
        text = JSON.stringify({
          experimental: {
            modelContextProtocolServers: {
              "omni-context": {
                command: nodePath,
                args: [proxyPath]
              }
            }
          }
        }, null, 2);
      } else if (client.id === 'zed') {
        text = JSON.stringify({
          context_servers: {
            "omni-context": {
              command: nodePath,
              args: [proxyPath]
            }
          }
        }, null, 2);
      } else {
        text = JSON.stringify({
          mcpServers: {
            "omni-context": {
              command: nodePath,
              args: [proxyPath]
            }
          }
        }, null, 2);
      }
    } else if (type === 'yaml') {
      // Goose YAML 格式
      text = `mcpServers:\n  omni-context:\n    command: "${nodePath.replace(/\\/g, '\\\\')}"\n    args:\n      - "${proxyPath.replace(/\\/g, '\\\\')}"`;
    } else if (type === 'command') {
      text = nodePath;
    } else if (type === 'args') {
      text = proxyPath;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        toast.success(t('settings.mcp_copied'));
      })
      .catch((err) => {
        toast.error(t('toast.copy_failed'), String(err));
      });
  };

  const handleInstallClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onInstall(client.id);
    } finally {
      setBusy(false);
    }
  };

  const getLogo = () => {
    // 根据 ID 绘制极简、高保真的 SVG 图标
    const style = "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white shadow-inner";
    
    switch (client.id) {
      case 'claude':
        return (
          <div className={`${style} bg-[#D97706]/90 border border-[#B45309]`}>
            <span className="text-lg">Cl</span>
          </div>
        );
      case 'cursor':
        return (
          <div className={`${style} bg-[#0284C7]/90 border border-[#0369A1]`}>
            <span className="text-lg">Cu</span>
          </div>
        );
      case 'windsurf':
        return (
          <div className={`${style} bg-[#0D9488]/90 border border-[#0F766E]`}>
            <span className="text-lg">W</span>
          </div>
        );
      case 'trae':
        return (
          <div className={`${style} bg-[#4F46E5]/90 border border-[#4338CA]`}>
            <span className="text-lg">T</span>
          </div>
        );
      case 'lmstudio':
        return (
          <div className={`${style} bg-[#16A34A]/90 border border-[#15803D]`}>
            <span className="text-lg">LM</span>
          </div>
        );
      case 'cline':
        return (
          <div className={`${style} bg-[#EA580C]/90 border border-[#C2410C]`}>
            <span className="text-lg">Cn</span>
          </div>
        );
      case 'roo':
        return (
          <div className={`${style} bg-[#DB2777]/90 border border-[#BE185D]`}>
            <span className="text-lg">R</span>
          </div>
        );
      case 'continue':
        return (
          <div className={`${style} bg-[#2563EB]/90 border border-[#1D4ED8]`}>
            <span className="text-lg">Co</span>
          </div>
        );
      case 'zed':
        return (
          <div className={`${style} bg-[#475569]/90 border border-[#334155]`}>
            <span className="text-lg">Z</span>
          </div>
        );
      case 'goose':
        return (
          <div className={`${style} bg-[#7C3AED]/90 border border-[#6D28D9]`}>
            <span className="text-lg">G</span>
          </div>
        );
      case 'cherrystudio':
        return (
          <div className={`${style} bg-[#E11D48]/90 border border-[#BE123C]`}>
            <span className="text-lg">Ch</span>
          </div>
        );
      case 'chatbox':
        return (
          <div className={`${style} bg-[#0891B2]/90 border border-[#0E7490]`}>
            <span className="text-lg">CB</span>
          </div>
        );
      default:
        return (
          <div className={`${style} bg-gray-700/90 border border-gray-600`}>
            <span className="text-lg">AI</span>
          </div>
        );
    }
  };

  const showStatus = client.supports === 'auto';

  return (
    <div className="glass-panel p-4 flex flex-col gap-4 border border-white/5 bg-white/5 hover:bg-white/10 transition-all rounded-xl relative overflow-hidden">
      {/* 状态背景线条效果 */}
      {showStatus && status.configured && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 blur-2xl rounded-full" />
      )}

      {/* 头部：Logo + 名字 + 状态 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {getLogo()}
          <div>
            <h4 className="text-white font-bold text-base flex items-center gap-2">
              {client.name}
            </h4>
            <div className="text-xs text-gray-400 mt-0.5">
              {client.supports === 'auto' ? t('settings.mcp_auto_supported') : t('settings.mcp_manual_required')}
            </div>
          </div>
        </div>

        {showStatus && (
          <div>
            {status.configured ? (
              <span className="px-2.5 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-xs font-semibold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('settings.mcp_connected')}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 bg-white/5 text-gray-400 border border-white/10 rounded-full text-xs flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {t('settings.mcp_not_connected')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 说明 / 配置文件路径 */}
      <div className="text-xs text-gray-400 bg-black/20 p-2.5 rounded-lg border border-white/5 font-mono break-all whitespace-pre-line">
        <span className="text-gray-500 block mb-0.5">{t('settings.mcp_config_path')}:</span>
        {status.config_path || t(client.config_path_template)}
      </div>

      {/* 提示：守护进程必须运行 */}
      <div className="text-2xs text-cyan-400/80 bg-cyan-950/20 px-2 py-1 rounded border border-cyan-900/30 flex items-center gap-1.5 font-medium leading-none">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping inline-block" />
        {t('settings.mcp_hint_running')}
      </div>

      {/* 操作按钮区 */}
      <div className="flex items-center gap-2 mt-auto">
        {client.supports === 'auto' ? (
          <button
            onClick={handleInstallClick}
            disabled={busy}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
              status.configured
                ? 'bg-green-600/20 hover:bg-green-600/30 text-green-400 border-green-500/30'
                : 'bg-cyan-500 text-black hover:bg-cyan-400 border-transparent'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {status.configured ? t('settings.mcp_reconnect') : t('settings.mcp_one_click')}
          </button>
        ) : (
          <>
            {client.id === 'goose' ? (
              <button
                onClick={() => handleCopyText('yaml')}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 rounded-lg transition-all"
              >
                <Copy className="w-3.5 h-3.5" />
                {t('settings.mcp_copy_yaml')}
              </button>
            ) : client.id === 'cherrystudio' || client.id === 'chatbox' || client.id === 'other' ? (
              <div className="flex-1 flex gap-1">
                <button
                  onClick={() => handleCopyText('command')}
                  title={t('settings.mcp_copy_cmd_tooltip')}
                  className="flex-1 flex items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 rounded-lg transition-all text-2xs truncate"
                >
                  <Copy className="w-3 h-3" />
                  {t('settings.mcp_copy_command')}
                </button>
                <button
                  onClick={() => handleCopyText('args')}
                  title={t('settings.mcp_copy_args_tooltip')}
                  className="flex-1 flex items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 rounded-lg transition-all text-2xs truncate"
                >
                  <Copy className="w-3 h-3" />
                  {t('settings.mcp_copy_args')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleCopyText('json')}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 rounded-lg transition-all"
              >
                <Copy className="w-3.5 h-3.5" />
                {t('settings.mcp_copy_json')}
              </button>
            )}
          </>
        )}

        {status.config_path && (
          <button
            onClick={() => onOpenFolder(client.id)}
            title={t('settings.mcp_open_folder_tooltip')}
            className="p-2 bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 展开指南 */}
      <div className="border-t border-white/5 pt-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full text-left"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span>{expanded ? t('settings.mcp_collapse_guide') : t('settings.mcp_view_steps')}</span>
        </button>

        {expanded && (
          <div className="mt-3 flex flex-col gap-2 text-xs text-gray-400 leading-relaxed border border-white/5 p-3 rounded-lg bg-black/10">
            <div className="font-bold text-gray-300">{t('settings.mcp_steps_title')}</div>
            <ol className="list-decimal pl-4 space-y-1.5">
              {client.steps.map((step, idx) => (
                <li key={idx}>{t(step)}</li>
              ))}
            </ol>
            <div className="text-gray-500 border-t border-white/5 pt-2 mt-1">
              <span className="font-bold">{t('settings.mcp_reload_hint')}:</span> {t(client.reload_hint)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
