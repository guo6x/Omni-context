// 首次启动引导：价值优先的 4 步路径
// ① 选大脑(LLM，必需引擎) ② 灌满+证明懂你 ③ 接第二个 AI(跨 AI 魔法) ④ 沉淀习惯
"use client";

import { useState, useRef, useEffect } from 'react';
import { LLM_PRESETS } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { AppSettings } from '@/hooks/useSettings';
import { apiFetch } from '@/lib/api-client';
import {
  X, Key, Database, ChevronRight, ChevronLeft, Check, Upload,
  ArrowRight, Loader2, Copy, Brain, Sparkles,
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

const TOTAL_STEPS = 4;

export default function OnboardingWizard({
  settings, onUpdateBehavior, onUpdateLlmProvider, onClose, onOpenSettings,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const { t } = useTranslation();
  const toast = useToast();

  // ① LLM
  const [selectedPresetId, setSelectedPresetId] = useState('deepseek');
  const [apiUrl, setApiUrl] = useState('https://api.deepseek.com/v1');
  const [apiKey, setApiKey] = useState(settings.llmProvider.apiKey);
  const [model, setModel] = useState('deepseek-chat');
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>(
    settings.llmProvider.apiKey ? 'idle' : 'idle'
  );
  const [testError, setTestError] = useState('');

  // ② 导入 + 证明
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [proof, setProof] = useState('');

  // ③ 跨 AI
  const [selectedClient, setSelectedClient] = useState<'claude' | 'cursor' | 'cline' | 'other'>('claude');
  const [mcpState, setMcpState] = useState<'idle' | 'connecting' | 'success' | 'failed'>('idle');

  useEffect(() => {
    const ds = LLM_PRESETS.find((p) => p.id === 'deepseek');
    if (ds) { setApiUrl(ds.apiUrl); setModel(ds.defaultModel); }
  }, []);

  const selectPreset = (id: string) => {
    setSelectedPresetId(id);
    const p = LLM_PRESETS.find((x) => x.id === id);
    if (p) { setApiUrl(id === 'custom' ? '' : p.apiUrl); setModel(id === 'custom' ? '' : p.defaultModel); }
    setTestState('idle'); setTestError('');
  };

  const testLlm = async () => {
    setTestState('testing'); setTestError('');
    try {
      const res = await apiFetch('/api/settings/llm', { method: 'POST', body: JSON.stringify({ apiUrl, apiKey, model }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.healthy) {
        setTestState('success');
        onUpdateLlmProvider({ apiUrl, apiKey, model });
        toast.success(t('onboarding.test_success'));
      } else { setTestState('failed'); setTestError(data.warning || t('onboarding.test_failed')); }
    } catch (err) { setTestState('failed'); setTestError(String(err)); }
  };

  // ② 导入：聊天记录(.json 走 import/chat)或文档/笔记(走 ingest/file)，完成后跑"证明"
  const runProof = async () => {
    try {
      const r = await apiFetch('/api/mcp/tool/ask_memory', { method: 'POST', body: JSON.stringify({ arguments: { query: '根据我导入的记录，我最常想、最在意的是什么？简短列几条。' } }) });
      const d = await r.json().catch(() => ({}));
      if (d.reply) setProof(d.reply);
    } catch { /* 证明失败不阻塞 */ }
  };

  const pollJob = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/ingest/job/${jobId}`);
        const j = await r.json();
        if (j.importProgress) setImportMsg(`抽取 ${j.importProgress.done}/${j.importProgress.total} 段 · 已生成 ${j.importProgress.entities} 条记忆`);
        else if (j.result) setImportMsg(`已生成 ${j.result.entities ?? 0} 条记忆`);
        if (j.status === 'success') { clearInterval(timer); setImporting(false); setImportMsg('完成，正在读懂你…'); runProof(); }
        else if (j.status === 'failed' || j.status === 'cancelled') { clearInterval(timer); setImporting(false); setImportMsg('导入中断'); }
      } catch { /* keep polling */ }
    }, 1500);
  };

  const processImport = async (file: File) => {
    setImporting(true); setProof(''); setImportMsg('解析中…');
    try {
      const lower = file.name.toLowerCase();
      // .json 先按聊天记录试；失败再当普通文件
      if (lower.endsWith('.json')) {
        const text = await file.text();
        const r = await apiFetch('/api/import/chat', { method: 'POST', body: JSON.stringify({ text }) });
        if (r.ok) { const { jobId, platform, parsed } = await r.json(); setImportMsg(`识别为 ${platform} · ${parsed} 段对话，抽取中`); pollJob(jobId); return; }
      }
      // 普通文档/笔记 → ingest
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + 0x8000, bytes.length))) as any);
      const base64 = btoa(binary);
      let contentType = file.type || 'text/plain';
      if (lower.endsWith('.md')) contentType = 'text/markdown';
      else if (lower.endsWith('.pdf')) contentType = 'application/pdf';
      else if (lower.endsWith('.json')) contentType = 'application/json';
      const r2 = await apiFetch('/api/ingest/file', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType, base64 }) });
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok) throw new Error(d2.error || '上传失败');
      setImportMsg('抽取中…'); pollJob(d2.jobId);
    } catch (err) { setImporting(false); setImportMsg('出错：' + String(err)); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  // ③ 一键接入
  const connectMcp = async () => {
    if (selectedClient === 'other') { setStep(4); return; }
    setMcpState('connecting');
    try {
      await safeInvoke('mcp_install_to', { clientId: selectedClient });
      try { const token = await safeInvoke<string>('get_local_api_token'); if (token) await safeInvoke('set_clipboard', { text: token }); } catch { /* */ }
      setMcpState('success');
      toast.success(t('settings.mcp_install_success'));
    } catch (e) { console.error(e); setMcpState('failed'); toast.error(t('onboarding.client_connect_failed')); }
  };

  const complete = () => { onUpdateBehavior({ onboarded: true }); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
      <div className="bg-[#0a0b12]/95 w-full max-w-2xl rounded-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 text-sm tracking-wide">Omni-Context</span>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? 'w-6 bg-cyan-400' : s < step ? 'w-2 bg-cyan-600/40' : 'w-2 bg-white/10'}`} />
            ))}
          </div>
          <button onClick={complete} className="text-gray-400 hover:text-white text-xs flex items-center gap-1">{t('onboarding.skip')} <X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {/* ① LLM */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Brain className="w-5 h-5 text-cyan-400" /> 先选个"思考引擎"</h2>
                <p className="text-xs text-gray-400 leading-relaxed">你的大脑负责记忆，思考交给一个 AI。选一个、填 key、测通——之后导入和回答都靠它。便宜的就够用。</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'deepseek', emoji: '🐳', name: 'DeepSeek', cost: '极便宜' },
                  { id: 'ollama', emoji: '🏠', name: 'Ollama', cost: '本地·免费' },
                  { id: 'openai', emoji: '🤖', name: 'GPT-4o mini', cost: '便宜' },
                  { id: 'custom', emoji: '⚙️', name: '自定义', cost: '任意' },
                ].map((p) => (
                  <button key={p.id} onClick={() => selectPreset(p.id)} className={`p-3 rounded-xl border text-center transition-all ${selectedPresetId === p.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="text-lg">{p.emoji}</div><div className="font-bold text-xs truncate mt-1">{p.name}</div><div className="text-[9px] text-gray-500">{p.cost}</div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={apiUrl} onChange={(e) => { setApiUrl(e.target.value); setSelectedPresetId('custom'); setTestState('idle'); }} placeholder="API URL" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
                <input value={model} onChange={(e) => { setModel(e.target.value); setSelectedPresetId('custom'); setTestState('idle'); }} placeholder="Model" className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
              </div>
              <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestState('idle'); }} placeholder={t('onboarding.apikey_placeholder')} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-cyan-500" />
              <button onClick={testLlm} disabled={testState === 'testing'} className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border ${testState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : testState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {testState === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.testing')}</> : testState === 'success' ? <><Check className="w-4 h-4" />{t('onboarding.test_success')}</> : <span>{t('onboarding.test_btn')}</span>}
              </button>
              {testState === 'failed' && <p className="text-[10px] text-rose-400 text-center">{testError}</p>}
            </div>
          )}

          {/* ② 导入 + 证明 */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Upload className="w-5 h-5 text-cyan-400" /> 把你的大脑灌满</h2>
                <p className="text-xs text-gray-400 leading-relaxed">空大脑没用。拖入你和 AI 的<b>聊天记录导出</b>(ChatGPT/Claude/Gemini)，或任何<b>文档/笔记</b>(md/txt/pdf)——30 秒，变成记得你的大脑。对话原始日期会保留。</p>
              </div>
              <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.[0]) processImport(e.dataTransfer.files[0]); }}
                onClick={() => !importing && fileRef.current?.click()}
                className={`border-2 rounded-xl p-6 min-h-[150px] flex flex-col justify-center items-center text-center transition-all ${dragOver ? 'border-cyan-400 bg-cyan-950/10' : 'border-dashed border-cyan-900/60 bg-white/5 hover:border-cyan-600/40'} ${importing ? 'opacity-70' : 'cursor-pointer'}`}>
                {importing ? <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /> : <Upload className="w-8 h-8 text-cyan-400" />}
                <div className="text-sm font-semibold text-white mt-2">{importing ? '处理中…' : '拖入或选择文件'}</div>
                <div className="text-[10px] text-gray-500 mt-1">聊天记录 conversations.json / My Activity.json · 或 md/txt/pdf 文档笔记</div>
              </div>
              <input ref={fileRef} type="file" accept=".json,.md,.txt,.pdf,application/json" className="hidden" onChange={(e) => { if (e.target.files?.[0]) processImport(e.target.files[0]); }} />
              {importMsg && <div className="text-xs text-gray-300 bg-gray-800/50 border border-white/10 rounded-lg p-2.5">{importMsg}</div>}
              {proof && (
                <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 to-purple-950/10 p-4">
                  <div className="text-[11px] text-cyan-400 mb-1.5 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> 它已经开始懂你了——还没接任何外部 AI：</div>
                  <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{proof}</div>
                </div>
              )}
            </div>
          )}

          {/* ③ 跨 AI */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-cyan-400" /> 现在，换个 AI 试试</h2>
                <p className="text-xs text-gray-400 leading-relaxed">一键把大脑接到任何 AI。接上后去那个 AI 里问一句关于你自己的事——它会答出你导入的东西，<b>而你从没在它那说过</b>。这就是"换谁来想都还是你"。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ id: 'claude', name: 'Claude Desktop' }, { id: 'cursor', name: 'Cursor' }, { id: 'cline', name: 'Cline (VS Code)' }, { id: 'other', name: '稍后/其他' }].map((c) => (
                  <button key={c.id} onClick={() => { setSelectedClient(c.id as any); setMcpState('idle'); }} className={`p-4 rounded-xl border text-left transition-all ${selectedClient === c.id ? 'bg-cyan-950/20 border-cyan-400 text-white' : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/10'}`}>
                    <div className="font-semibold text-sm flex items-center justify-between">{c.name}{selectedClient === c.id && <Check className="w-4 h-4 text-cyan-400" />}</div>
                  </button>
                ))}
              </div>
              <button onClick={connectMcp} disabled={mcpState === 'connecting'} className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border ${mcpState === 'success' ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400' : mcpState === 'failed' ? 'bg-rose-950/30 border-rose-500 text-rose-400' : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'}`}>
                {mcpState === 'connecting' ? <><Loader2 className="w-4 h-4 animate-spin" />{t('onboarding.client_connecting')}</> : mcpState === 'success' ? <><Check className="w-4 h-4" />已接入，重启该 AI 客户端即可</> : selectedClient === 'other' ? <><span>{t('onboarding.next')}</span><ArrowRight className="w-4 h-4" /></> : <><Copy className="w-4 h-4" /><span>一键接入（自动复制配置/token）</span></>}
              </button>
            </div>
          )}

          {/* ④ 习惯 */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><Database className="w-5 h-5 text-cyan-400" /> 让它越用越是你</h2>
                <p className="text-xs text-gray-400 leading-relaxed">以后每个想明白的点、每个决策——按一下<b>沉淀热键</b>(可在设置改，已是全局，任意窗口前都能按)抓当前屏幕，或对任何接入的 AI 说"记一下"。攒得越多，它越懂你怎么想。</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-center">
                <div className="text-xs text-gray-400">全局沉淀热键</div>
                <div className="text-lg font-mono text-cyan-300 mt-1">Ctrl + Shift + P</div>
              </div>
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/10 p-3 text-center text-xs text-cyan-200/90">透镜帮你看清，下注的手一直是你的。它只负责记住你走过的路。</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div>
            {step > 1 ? (
              <button onClick={() => setStep((s) => s - 1)} className="px-4 py-2 text-xs text-gray-400 hover:text-white flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {t('onboarding.prev')}</button>
            ) : (
              onOpenSettings && <button onClick={() => { complete(); setTimeout(() => onOpenSettings('llm'), 200); }} className="text-[11px] text-cyan-400/80 hover:text-cyan-300 hover:underline">{t('onboarding.advanced_setup')}</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < TOTAL_STEPS && step !== 1 && (
              <button onClick={() => setStep((s) => s + 1)} className="px-4 py-2 text-xs text-gray-400 hover:text-white">{t('onboarding.skip')}</button>
            )}
            {step < TOTAL_STEPS ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={step === 1 && testState !== 'success'} className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
                {t('onboarding.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={complete} className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"><Check className="w-4 h-4" /> {t('onboarding.start_app')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
