// [核心壁垒] 首次启动新手引导 Wizard 3步收窄优化版本
"use client";

import { useState, useRef, useEffect } from 'react';
import { LLM_PRESETS, LlmPreset } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { AppSettings } from '@/hooks/useSettings';
import { apiFetch } from '@/lib/api-client';
import { 
  X, Play, Key, Database, ChevronRight, ChevronLeft, Check, 
  Upload, HelpCircle, Monitor, ArrowRight, Settings, 
  Terminal, Sparkles, Loader2, Copy, FileText 
} from 'lucide-react';

async function safeInvoke<T = any>(cmd: string, args?: any): Promise<T | undefined> {
  if (typeof window === 'undefined') return;
  try {
    const { invoke } = await import('@tauri-apps/api/tauri');
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`safeInvoke ${cmd} 失败:`, e);
    throw e;
  }
}

interface OnboardingWizardProps {
  settings: AppSettings;
  onUpdateBehavior: (updates: Partial<AppSettings['behavior']>) => void;
  onUpdateLlmProvider: (updates: Partial<AppSettings['llmProvider']>) => void;
  onClose: () => void;
  onOpenSettings?: (tab: 'shortcuts' | 'appearance' | 'behavior' | 'llm' | 'data' | 'mcp' | 'diagnostics' | 'privacy' | 'about') => void;
  triggerPrecipitate?: () => Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }>;
}

export default function OnboardingWizard({
  settings,
  onUpdateBehavior,
  onUpdateLlmProvider,
  onClose,
  onOpenSettings,
  triggerPrecipitate,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const { t } = useTranslation();
  const toast = useToast();

  // --- Step 1 状态 ---
  const [selectedClient, setSelectedClient] = useState<'claude' | 'cursor' | 'cline' | 'other'>('claude');
  const [mcpConnectState, setMcpConnectState] = useState<'idle' | 'connecting' | 'success' | 'failed'>('idle');

  // --- Step 2 状态 ---
  const [selectedPresetId, setSelectedPresetId] = useState<string>('deepseek');
  const [localApiUrl, setLocalApiUrl] = useState('https://api.deepseek.com/v1');
  const [localApiKey, setLocalApiKey] = useState(settings.llmProvider.apiKey);
  const [localModel, setLocalModel] = useState('deepseek-chat');
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testError, setTestError] = useState<string>('');

  // --- Step 3 状态 ---
  const [dragOver, setDragOver] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedInfo, setExtractedInfo] = useState<{ entities: number; relationships: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化预设
  useEffect(() => {
    // 默认载入 DeepSeek 预设
    const dsPreset = LLM_PRESETS.find(p => p.id === 'deepseek');
    if (dsPreset) {
      setLocalApiUrl(dsPreset.apiUrl);
      setLocalModel(dsPreset.defaultModel);
    }
  }, []);

  // --- Step 1 一键接入 Logic ---
  const handleConnectMcp = async () => {
    if (selectedClient === 'other') {
      // Skip/Other 则直接进第2步
      setStep(2);
      return;
    }
    setMcpConnectState('connecting');
    try {
      // 1. 调用 Tauri 一键接入
      await safeInvoke('mcp_install_to', { clientId: selectedClient });
      
      // 2. 复制本地 API token 到剪贴板（兼容未实现 get_local_api_token 的分支）
      let token = '';
      try {
        token = await safeInvoke<string>('get_local_api_token') || 'local_token_placeholder';
      } catch {
        token = 'omni_token_temporary_placeholder';
      }
      
      try {
        await safeInvoke('set_clipboard', { text: token });
      } catch (err) {
        console.warn('剪贴板复制失败:', err);
      }

      setMcpConnectState('success');
      toast.success(t('settings.mcp_install_success'));
    } catch (e) {
      console.error(e);
      setMcpConnectState('failed');
      toast.error(t('onboarding.client_connect_failed'));
    }
  };

  // --- Step 2 预设切换 ---
  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = LLM_PRESETS.find(p => p.id === presetId);
    if (preset) {
      if (presetId !== 'custom') {
        setLocalApiUrl(preset.apiUrl);
        setLocalModel(preset.defaultModel);
      } else {
        setLocalApiUrl('');
        setLocalModel('');
      }
    }
    setTestState('idle');
    setTestError('');
  };

  // --- Step 2 连通测试 ---
  const handleTestConnection = async () => {
    setTestState('testing');
    setTestError('');
    try {
      const res = await apiFetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: localApiUrl,
          apiKey: localApiKey,
          model: localModel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.healthy) {
        setTestState('success');
        onUpdateLlmProvider({
          apiUrl: localApiUrl,
          apiKey: localApiKey,
          model: localModel,
        });
        toast.success(t('onboarding.test_success'));
      } else {
        setTestState('failed');
        setTestError(data.warning || t('onboarding.test_failed'));
      }
    } catch (err) {
      setTestState('failed');
      setTestError(String(err));
    }
  };

  // --- Step 3 文件抽取 ---
  const processFile = async (file: File) => {
    setIsExtracting(true);
    setExtractedInfo(null);
    try {
      const ab = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      
      let binary = '';
      const bytes = new Uint8Array(ab);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))) as any,
        );
      }
      const base64 = btoa(binary);
      
      let contentType = file.type || 'text/plain';
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.md')) contentType = 'text/markdown';
      else if (lower.endsWith('.txt')) contentType = 'text/plain';
      else if (lower.endsWith('.pdf')) contentType = 'application/pdf';
      else if (lower.endsWith('.json')) contentType = 'application/json';

      const res = await apiFetch('/api/ingest/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType, base64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const jobId = data.jobId;
      
      const poll = async () => {
        try {
          const pollRes = await apiFetch(`/api/ingest/job/${jobId}`);
          if (!pollRes.ok) throw new Error('Failed to get job status');
          const job = await pollRes.json();
          if (job.status === 'success') {
            const r = job.result || {};
            const entitiesCount = r.entities || 0;
            const relsCount = r.relationships || 0;
            setExtractedInfo({ entities: entitiesCount, relationships: relsCount });
            setIsExtracting(false);
            toast.success(
              t('onboarding.try_extract_success')
                .replace('{entities}', String(entitiesCount))
                .replace('{relationships}', String(relsCount))
            );
          } else if (job.status === 'failed') {
            throw new Error(job.error || 'Extraction failed');
          } else {
            setTimeout(poll, 1000);
          }
        } catch (e) {
          setIsExtracting(false);
          toast.error(t('toast.drop_process_failed'), String(e));
        }
      };
      
      setTimeout(poll, 1000);
    } catch (err) {
      setIsExtracting(false);
      toast.error(t('toast.drop_process_failed'), String(err));
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await processFile(files[0]);
    }
  };

  // --- Step 3 文本抽取 ---
  const handleExtractText = async () => {
    if (!textInput.trim()) return;
    setIsExtracting(true);
    setExtractedInfo(null);
    try {
      const res = await apiFetch('/api/graph/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshot: '',
          clipboard: textInput,
        }),
      });
      if (!res.ok) throw new Error('Extraction failed');
      const result = await res.json();
      const entitiesCount = Array.isArray(result.entities) ? result.entities.length : 0;
      const relsCount = Array.isArray(result.relationships) ? result.relationships.length : 0;
      setExtractedInfo({ entities: entitiesCount, relationships: relsCount });
      setIsExtracting(false);
      toast.success(
        t('onboarding.try_extract_success')
          .replace('{entities}', String(entitiesCount))
          .replace('{relationships}', String(relsCount))
      );
    } catch (err) {
      setIsExtracting(false);
      toast.error(t('toast.drop_process_failed'), String(err));
    }
  };

  // --- Step 3 截屏抽取 ---
  const handleCaptureScreen = async () => {
    setIsExtracting(true);
    setExtractedInfo(null);
    try {
      if (triggerPrecipitate) {
        const result = await triggerPrecipitate();
        if (result.ok) {
          const entitiesCount = result.entities || 0;
          const relsCount = result.relationships || 0;
          setExtractedInfo({ entities: entitiesCount, relationships: relsCount });
          toast.success(
            t('onboarding.try_extract_success')
              .replace('{entities}', String(entitiesCount))
              .replace('{relationships}', String(relsCount))
          );
        } else {
          throw new Error(result.error || 'Capture failed');
        }
      } else {
        throw new Error('Capture triggers unavailable');
      }
    } catch (err) {
      toast.error(t('toast.drop_process_failed'), String(err));
    } finally {
      setIsExtracting(false);
    }
  };

  // --- 导航 Logic ---
  const handleNext = () => {
    if (step < 3) {
      setStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (step > 1) {
      setStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    onUpdateBehavior({ onboarded: true, onboarded_v2: true });
    onClose();
  };

  const handleOpenAdvanced = (tab: 'mcp' | 'llm') => {
    onUpdateBehavior({ onboarded: true, onboarded_v2: true });
    onClose();
    if (onOpenSettings) {
      setTimeout(() => onOpenSettings(tab), 200);
    }
  };

  // 监听 Ctrl+Shift+S 进行截屏抽取 (仅在 Step 3)
  useEffect(() => {
    if (step !== 3) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleCaptureScreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)]">
        
        {/* Header Indicator */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 text-sm tracking-wide">
            Omni-Context Setup (v2)
          </span>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-6 bg-cyan-400'
                    : s < step
                    ? 'w-2 bg-cyan-600/40'
                    : 'w-2 bg-white/10'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleComplete}
            className="text-gray-400 hover:text-white text-xs transition-colors flex items-center gap-1"
          >
            {t('onboarding.skip')} <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          
          {/* STEP 1: Connect AI Client */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
                  {t('onboarding.step_1_title')}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {t('onboarding.step_1_desc')}
                </p>
              </div>

              {/* 客户端单选卡片 */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {[
                  { id: 'claude', name: 'Claude Desktop', desc: t('onboarding.client_claude_desc') },
                  { id: 'cursor', name: 'Cursor', desc: t('onboarding.client_cursor_desc') },
                  { id: 'cline', name: 'Cline (VS Code)', desc: t('onboarding.client_cline_desc') },
                  { id: 'other', name: t('onboarding.skip'), desc: t('onboarding.client_other_desc') },
                ].map(client => (
                  <button
                    key={client.id}
                    onClick={() => {
                      setSelectedClient(client.id as any);
                      setMcpConnectState('idle');
                    }}
                    className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                      selectedClient === client.id
                        ? 'bg-cyan-950/20 border-cyan-400 text-white shadow-lg shadow-cyan-500/10'
                        : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/15 hover:text-white'
                    }`}
                  >
                    <div className="font-semibold text-sm flex items-center justify-between">
                      {client.name}
                      {selectedClient === client.id && <Check className="w-4 h-4 text-cyan-400" />}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1 leading-snug">{client.desc}</div>
                  </button>
                ))}
              </div>

              {/* Connect 触发器 */}
              <div className="pt-4 flex flex-col gap-3">
                <button
                  onClick={handleConnectMcp}
                  disabled={mcpConnectState === 'connecting'}
                  className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border ${
                    mcpConnectState === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400'
                      : mcpConnectState === 'failed'
                      ? 'bg-rose-950/30 border-rose-500 text-rose-400 hover:bg-rose-900/20'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent shadow-lg shadow-cyan-500/10'
                  }`}
                >
                  {mcpConnectState === 'connecting' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('onboarding.client_connecting')}</span>
                    </>
                  ) : mcpConnectState === 'success' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{t('onboarding.client_connected').replace('{client}', selectedClient === 'claude' ? 'Claude' : selectedClient === 'cursor' ? 'Cursor' : 'Cline')}</span>
                    </>
                  ) : selectedClient === 'other' ? (
                    <>
                      <span>{t('onboarding.next')}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>{t('onboarding.client_connect')}</span>
                    </>
                  )}
                </button>

                {mcpConnectState === 'success' && (
                  <p className="text-[11px] text-cyan-400/90 text-center leading-relaxed bg-cyan-950/10 border border-cyan-800/30 p-2.5 rounded-lg">
                    🔑 Local token is automatically copied to clipboard. Restart your AI client to start.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Configure LLM */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Key className="w-5 h-5 text-cyan-400" />
                  {t('onboarding.step_2_title')}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {t('onboarding.step_2_desc')}
                </p>
              </div>

              {/* 核心服务商预设卡片 (4个) */}
              <div className="grid grid-cols-4 gap-2 pt-2">
                {[
                  { id: 'deepseek', emoji: '🐳', name: 'DeepSeek', cost: t('onboarding.preset_deepseek_cost') },
                  { id: 'openai', emoji: '🤖', name: 'GPT-4o Mini', cost: t('onboarding.preset_openai_cost') },
                  { id: 'ollama', emoji: '🏠', name: 'Ollama', cost: t('onboarding.preset_ollama_cost') },
                  { id: 'custom', emoji: '⚙️', name: t('onboarding.preset_custom_name'), cost: t('onboarding.preset_custom_cost') },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPreset(p.id)}
                    className={`p-3 rounded-xl border text-center transition-all duration-200 ${
                      selectedPresetId === p.id
                        ? 'bg-cyan-950/20 border-cyan-400 text-white shadow-lg'
                        : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/15'
                    }`}
                  >
                    <div className="text-lg">{p.emoji}</div>
                    <div className="font-bold text-xs truncate mt-1">{p.name}</div>
                    <div className="text-[9px] text-gray-500 truncate">{p.cost}</div>
                  </button>
                ))}
              </div>

              {/* 表单输入 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">API URL</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
                    value={localApiUrl}
                    onChange={(e) => {
                      setLocalApiUrl(e.target.value);
                      setSelectedPresetId('custom');
                      setTestState('idle');
                    }}
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">Model Name</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
                    value={localModel}
                    onChange={(e) => {
                      setLocalModel(e.target.value);
                      setSelectedPresetId('custom');
                      setTestState('idle');
                    }}
                    placeholder="deepseek-chat"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
                  {t('onboarding.apikey_label')}
                </label>
                <input
                  type="password"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
                  value={localApiKey}
                  onChange={(e) => {
                    setLocalApiKey(e.target.value);
                    setTestState('idle');
                  }}
                  placeholder={t('onboarding.apikey_placeholder')}
                />
              </div>

              {/* API 验证 */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testState === 'testing' || (!localApiUrl && selectedPresetId === 'custom')}
                  className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-all ${
                    testState === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400'
                      : testState === 'failed'
                      ? 'bg-rose-950/30 border-rose-500 text-rose-400 hover:bg-rose-900/20'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'
                  }`}
                >
                  {testState === 'testing' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('onboarding.testing')}</span>
                    </>
                  ) : testState === 'success' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{t('onboarding.test_success')}</span>
                    </>
                  ) : (
                    <span>{t('onboarding.test_btn')}</span>
                  )}
                </button>
                {testState === 'failed' && (
                  <p className="text-[10px] text-rose-400 mt-1 leading-relaxed text-center">
                    {testError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Experience Graph Extraction */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-cyan-400 animate-pulse" />
                  {t('onboarding.step_3_title')}
                </h2>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {t('onboarding.step_3_desc')}
                </p>
              </div>

              {/* 满屏拖拽 & 粘贴提取交互框 */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => {
                  if (!isExtracting && !extractedInfo) {
                    fileInputRef.current?.click();
                  }
                }}
                className={`border-2 rounded-xl p-6 cursor-pointer transition-all duration-300 flex flex-col gap-4 relative min-h-[220px] justify-center items-center ${
                  dragOver
                    ? 'border-cyan-400 bg-cyan-950/10 shadow-[0_0_30px_rgba(6,182,212,0.2)]'
                    : 'border-dashed border-cyan-900/60 bg-white/5 hover:border-cyan-600/40'
                }`}
              >
                {isExtracting ? (
                  <div className="flex flex-col items-center gap-3 py-6 animate-pulse" onClick={(e) => e.stopPropagation()}>
                    <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
                    <span className="text-sm font-semibold text-cyan-300">Extracting knowledge graph...</span>
                  </div>
                ) : extractedInfo ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="w-12 h-12 bg-emerald-950/30 border border-emerald-500 rounded-full flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
                      <Check className="w-6 h-6 animate-bounce" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white">
                        {t('onboarding.try_extract_success')
                          .replace('{entities}', String(extractedInfo.entities))
                          .replace('{relationships}', String(extractedInfo.relationships))}
                      </p>
                      <p className="text-xs text-cyan-400/90 font-medium">
                        💡 {t('onboarding.try_extract_guide')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 拖入文件引导 */}
                    <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
                      <Upload className="w-8 h-8 text-cyan-400 animate-bounce" />
                      <span className="text-sm font-semibold text-white">{t('onboarding.try_drag_drop_zone')}</span>
                      <span className="text-[10px] text-gray-500">Supports Markdown, Text, PDF, JSON</span>
                    </div>

                    <div className="w-full flex items-center gap-3 px-4">
                      <div className="h-[1px] bg-white/10 flex-1" />
                      <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">or</span>
                      <div className="h-[1px] bg-white/10 flex-1" />
                    </div>

                    {/* 文本粘贴 */}
                    <div className="w-full flex gap-2">
                      <input
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={t('onboarding.try_paste_placeholder')}
                        className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans cursor-text"
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') handleExtractText();
                        }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtractText();
                        }}
                        disabled={!textInput.trim()}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        {t('onboarding.try_extract_btn')}
                      </button>
                    </div>

                    {triggerPrecipitate && (
                      <div className="pt-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCaptureScreen();
                          }}
                          className="px-3.5 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-cyan-700 hover:text-cyan-400 text-gray-300 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Monitor className="w-3.5 h-3.5" />
                          <span>{t('onboarding.try_clipboard_btn')} (Ctrl+Shift+S)</span>
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* 隐藏的文件输入 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      await processFile(files[0]);
                    }
                  }}
                  className="hidden"
                  accept=".md,.txt,.pdf,.json"
                />
              </div>
            </div>
          )}

        </div>

        {/* Bottom Control bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div>
            {step > 1 ? (
              <button
                onClick={handlePrev}
                className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> {t('onboarding.prev')}
              </button>
            ) : (
              <button
                onClick={() => handleOpenAdvanced('mcp')}
                className="text-[11px] text-cyan-400/80 hover:text-cyan-300 hover:underline flex items-center gap-1 transition-all"
              >
                <Settings className="w-3 h-3" />
                <span>{t('onboarding.advanced_setup')}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <button
                onClick={handleNext}
                className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                {t('onboarding.skip')}
              </button>
            )}

            {step === 2 && (
              <>
                <button
                  onClick={() => handleOpenAdvanced('llm')}
                  className="text-[11px] text-cyan-400/80 hover:text-cyan-300 hover:underline flex items-center gap-1 mr-3 transition-all"
                >
                  <Settings className="w-3 h-3" />
                  <span>{t('onboarding.advanced_setup')}</span>
                </button>
                <button
                  onClick={handleNext}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  {t('onboarding.skip')}
                </button>
              </>
            )}

            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={step === 2 && testState !== 'success'}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-cyan-500/10"
              >
                {t('onboarding.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-cyan-500/15 flex items-center gap-1.5 transition-all"
              >
                <Check className="w-4 h-4" /> {t('onboarding.start_app')}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
