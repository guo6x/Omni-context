'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Brain, Send, X, Loader2, ArrowUpRight, Plus, Sparkles, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { apiFetch } from '@/lib/api-client';

interface Source {
  id: string;
  name: string;
  type: string;
  description?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  error?: boolean;
}

interface AskBrainProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity?: (id: string) => void;
  llmConfigured?: boolean;
  onConfigureLlm?: () => void;
}

export default function AskBrain({
  isOpen,
  onClose,
  onSelectEntity,
  llmConfigured = true,
  onConfigureLlm,
}: AskBrainProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      // 打开时聚焦输入框
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || loading) return;

      const history = [...messages, { role: 'user' as const, content: question }];
      setMessages(history);
      setInput('');
      setLoading(true);

      try {
        const res = await apiFetch('/api/mcp/tool/ask_memory', {
          method: 'POST',
          body: JSON.stringify({
            arguments: { messages: history.map((m) => ({ role: m.role, content: m.content })) },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          if (res.status === 400 && body.includes('LLM')) {
            throw new Error('LLM_NOT_CONFIGURED');
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { reply: string; sources?: Source[] };
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply || '', sources: data.sources || [] },
        ]);
      } catch (e) {
        const msg = String(e).includes('LLM_NOT_CONFIGURED')
          ? t('ask.error_no_llm')
          : t('ask.error_generic');
        setMessages((prev) => [...prev, { role: 'assistant', content: msg, error: true }]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, t],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  if (!isOpen) return null;

  const examples: string[] = [t('ask.example_1'), t('ask.example_2'), t('ask.example_3')];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] p-4 bg-black/75 transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl border border-cyan-500/20 bg-slate-950/85 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col max-h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-black/40 shrink-0">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-white tracking-wide">{t('ask.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
                title={t('ask.new_chat')}
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('ask.new_chat')}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10 transition-colors"
              title="Esc"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* LLM 未配置提示 */}
        {!llmConfigured && (
          <div className="flex items-center gap-3 px-5 py-3 bg-amber-950/30 border-b border-amber-800/30 text-sm text-amber-200 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{t('ask.need_llm')}</span>
            {onConfigureLlm && (
              <button
                onClick={onConfigureLlm}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 transition-colors shrink-0"
              >
                {t('ask.go_configure')}
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-8 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-cyan-300" />
              </div>
              <div>
                <p className="text-base font-medium text-white">{t('ask.empty_title')}</p>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">{t('ask.empty_hint')}</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => send(ex)}
                    className="text-left text-sm text-gray-300 bg-white/[0.03] border border-white/10 rounded-lg px-3.5 py-2.5 hover:border-cyan-500/40 hover:bg-cyan-950/20 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${m.role === 'user' ? '' : 'w-full'}`}>
                <div
                  className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-cyan-600/20 border border-cyan-500/30 text-cyan-50'
                      : m.error
                      ? 'bg-red-950/30 border border-red-800/30 text-red-200'
                      : 'bg-white/[0.04] border border-white/10 text-gray-100'
                  }`}
                >
                  {m.content}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.sources.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          onSelectEntity?.(s.id);
                          onClose();
                        }}
                        title={s.description || s.type}
                        className="inline-flex items-center gap-1 text-[11px] text-cyan-300 bg-cyan-950/30 border border-cyan-900/40 rounded-md px-2 py-1 hover:border-cyan-500/50 hover:bg-cyan-900/40 transition-colors max-w-[200px]"
                      >
                        <span className="truncate">{s.name}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 bg-white/[0.04] border border-white/10">
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/10 bg-black/40 px-4 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={t('ask.placeholder')}
              disabled={loading}
              className="flex-1 max-h-32 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm resize-none outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="flex items-center justify-center w-10 h-10 shrink-0 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              title={t('ask.send')}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5 px-1">{t('ask.footer_hint')}</p>
        </div>
      </div>
    </div>
  );
}
