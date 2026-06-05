"use client";

import { X, Upload, Trash2, Star, Search, RefreshCw, Database, FileUp, Copy, Bookmark } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/hooks/useToast';

interface ReviewItem {
  id: string;
  name: string;
  type: string;
  description: string;
  tags: string[];
  created_at: string;
  access_count: number;
  isCore: boolean;
  source: string;
  provenance: { source?: string; platform?: string; tool?: string; at?: string } | null;
}

const SOURCE_FILTERS: Array<{ key: string; label: string; cls: string }> = [
  { key: '', label: '全部', cls: 'text-gray-300' },
  { key: '__user__', label: '你写的', cls: 'text-emerald-400' },
  { key: 'external_ai', label: '外部 AI', cls: 'text-purple-400' },
  { key: 'import', label: '导入', cls: 'text-cyan-400' },
  { key: 'auto_sediment', label: '自动沉淀', cls: 'text-amber-400' },
];

function sourceBadge(it: ReviewItem): { text: string; cls: string } {
  const s = it.source || 'user';
  const date = it.created_at ? it.created_at.slice(5, 10) : '';
  if (s === 'external_ai') return { text: `外部AI·${it.provenance?.tool || ''} ${date}`, cls: 'text-purple-300 border-purple-500/40 bg-purple-500/10' };
  if (s === 'import') return { text: `导入·${it.provenance?.platform || ''} ${date}`, cls: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' };
  if (s === 'auto_sediment') return { text: `自动沉淀 ${date}`, cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
  return { text: `你 · ${date}`, cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' };
}

export default function MemoryManager({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'browse' | 'import' | 'favorites'>('browse');

  // ── 浏览 ──
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<ReviewItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (source) params.set('source', source);
      if (q.trim()) params.set('q', q.trim());
      const [r, c] = await Promise.all([
        apiFetch(`/api/entities/review?${params.toString()}`),
        apiFetch('/api/entities/sources'),
      ]);
      const data = await r.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setCounts((await c.json()) || {});
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [source, q, toast]);

  useEffect(() => { if (tab === 'browse') load(); }, [tab, source, load]);

  // ── 收藏夹（存在 archival、打"收藏"标签的记忆）──
  const [favs, setFavs] = useState<Array<{ id: string; content: string; summary?: string; createdAt?: string }>>([]);
  const [favLoading, setFavLoading] = useState(false);
  const loadFavs = useCallback(async () => {
    setFavLoading(true);
    try {
      const r = await apiFetch('/api/memory/archival');
      const data = await r.json();
      setFavs((Array.isArray(data) ? data : []).filter((x: any) => Array.isArray(x.tags) && x.tags.includes('收藏')));
    } catch { toast.error('加载失败'); }
    finally { setFavLoading(false); }
  }, [toast]);
  useEffect(() => { if (tab === 'favorites') loadFavs(); }, [tab, loadFavs]);
  async function copyFav(content: string) {
    try { await navigator.clipboard.writeText(content); toast.success('已复制'); }
    catch { toast.error('复制失败'); }
  }
  async function removeFav(id: string) {
    try { await apiFetch(`/api/memory/archival/${id}`, { method: 'DELETE' }); setFavs((xs) => xs.filter((x) => x.id !== id)); toast.success('已取消收藏'); }
    catch { toast.error('操作失败'); }
  }

  async function callTool(name: string, args: any) {
    const r = await apiFetch(`/api/mcp/tool/${name}`, { method: 'POST', body: JSON.stringify({ arguments: args }) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function toggleCore(it: ReviewItem) {
    try { await callTool('set_core_principle', { id: it.id, isCore: !it.isCore }); setItems((xs) => xs.map((x) => x.id === it.id ? { ...x, isCore: !x.isCore } : x)); }
    catch { toast.error('操作失败'); }
  }
  async function del(it: ReviewItem) {
    if (!confirm(`删除「${it.name}」？不可恢复。`)) return;
    try { await callTool('delete_entity', { id: it.id }); setItems((xs) => xs.filter((x) => x.id !== it.id)); toast.success('已删除'); }
    catch { toast.error('删除失败'); }
  }
  async function doMerge(target: ReviewItem) {
    if (!mergeFrom || mergeFrom.id === target.id) { setMergeFrom(null); return; }
    try {
      await callTool('merge_entities', { keepId: target.id, dropId: mergeFrom.id });
      setItems((xs) => xs.filter((x) => x.id !== mergeFrom.id));
      toast.success(`已并入「${target.name}」`);
    } catch { toast.error('合并失败'); }
    setMergeFrom(null);
  }

  // ── 导入 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState('');
  const [importing, setImporting] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number; entities: number } | null>(null);
  const [importMsg, setImportMsg] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true); setProg(null); setImportMsg('解析中…');
    try {
      const text = await f.text();
      const body: any = { text };
      if (limit.trim() && Number(limit) > 0) body.maxConversations = Number(limit);
      const r = await apiFetch('/api/import/chat', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { setImportMsg('解析失败：' + (await r.text())); setImporting(false); return; }
      const { jobId, platform, parsed, importing: imp } = await r.json();
      setImportMsg(`识别为 ${platform} · 解析到 ${parsed} 段，正在抽取 ${imp} 段`);
      poll(jobId);
    } catch (err: any) {
      setImportMsg('出错：' + (err?.message || err)); setImporting(false);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function poll(jobId: string) {
    const t = setInterval(async () => {
      try {
        const r = await apiFetch(`/api/ingest/job/${jobId}`);
        const j = await r.json();
        if (j.importProgress) setProg(j.importProgress);
        if (j.status === 'success') { clearInterval(t); setImporting(false); setImportMsg('导入完成'); toast.success('导入完成'); }
        else if (j.status === 'failed' || j.status === 'cancelled') { clearInterval(t); setImporting(false); setImportMsg('导入中断'); }
      } catch { /* keep polling */ }
    }, 1500);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-gray-900 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-2 text-white font-semibold"><Database className="w-4 h-4 text-cyan-400" /> 记忆管理</div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {(['browse', 'favorites', 'import'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm rounded-lg ${tab === k ? 'bg-cyan-500/15 text-cyan-300' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
              {k === 'browse' ? '浏览' : k === 'favorites' ? '收藏' : '导入'}
            </button>
          ))}
        </div>

        {tab === 'browse' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2 flex-wrap">
              {SOURCE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setSource(f.key)}
                  className={`text-xs rounded-full px-2.5 py-1 border ${source === f.key ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10' : 'border-white/10 text-gray-400 hover:text-white'}`}>
                  {f.label}{f.key && counts[f.key === '__user__' ? 'user' : f.key] != null ? ` ${counts[f.key === '__user__' ? 'user' : f.key]}` : ''}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-2">
                <Search className="w-3.5 h-3.5 text-gray-500" />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
                  placeholder="搜索…" className="bg-transparent text-sm text-white py-1.5 w-40 outline-none" />
              </div>
              <button onClick={load} className="p-1.5 text-gray-400 hover:text-white"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            {mergeFrom && <div className="px-5 pt-2 text-xs text-amber-300">合并模式：点另一条把「{mergeFrom.name}」并入它 · <button onClick={() => setMergeFrom(null)} className="underline">取消</button></div>}
            <div className="text-xs text-gray-500 px-5 pt-2">共 {total} 条</div>
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {items.map((it) => {
                const b = sourceBadge(it);
                return (
                  <div key={it.id} className={`flex items-start gap-2 py-2.5 border-t border-white/5 ${mergeFrom && mergeFrom.id !== it.id ? 'cursor-pointer hover:bg-cyan-500/5' : ''}`}
                    onClick={() => mergeFrom && doMerge(it)}>
                    <button onClick={(e) => { e.stopPropagation(); toggleCore(it); }} title="设/撤核心" className="mt-0.5">
                      <Star className={`w-4 h-4 ${it.isCore ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">{it.name} <span className="text-[10px] text-gray-500">{it.type}{it.isCore ? ' · 核心' : ''}</span></div>
                      {it.description && <div className="text-xs text-gray-500 line-clamp-1">{it.description}</div>}
                    </div>
                    <span className={`text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap ${b.cls}`}>{b.text}</span>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); setMergeFrom(it); }} className="text-xs text-gray-500 hover:text-white">合并</button>
                      <button onClick={(e) => { e.stopPropagation(); del(it); }} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {!loading && items.length === 0 && <div className="text-center text-gray-500 text-sm py-10">没有匹配的记忆</div>}
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="p-5 overflow-y-auto">
            <div className="text-sm text-gray-300">从 AI 聊天记录导入</div>
            <div className="text-xs text-gray-500 mt-1 leading-relaxed">把你和 ChatGPT / Claude / Gemini 的历史对话变成大脑记忆。对话的原始日期会保留，所以"上个月想了啥"也能召回。</div>
            <div onClick={() => !importing && fileRef.current?.click()}
              className={`mt-4 border border-dashed border-cyan-500/35 rounded-xl py-8 text-center ${importing ? 'opacity-60' : 'cursor-pointer hover:bg-cyan-500/5'}`}>
              <FileUp className="w-6 h-6 mx-auto text-cyan-400" />
              <div className="text-sm mt-2 text-gray-200">{importing ? '处理中…' : '选择导出文件'}</div>
              <div className="text-[11px] text-gray-500 mt-1">conversations.json / chat.html（ChatGPT/Claude） · My Activity（Gemini，HTML 或 JSON 都行）</div>
            </div>
            <input ref={fileRef} type="file" accept=".json,.html,.htm,application/json,text/html" className="hidden" onChange={onFile} />
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              导入最近 <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} placeholder="全部"
                className="w-16 text-center bg-gray-800 border border-white/10 rounded px-2 py-1 text-white outline-none" /> 段（留空 = 全部）
            </div>
            {(importMsg || prog) && (
              <div className="mt-4 rounded-lg border border-white/10 bg-gray-800/50 p-3">
                <div className="text-xs text-gray-300">{importMsg}</div>
                {prog && (
                  <>
                    <div className="text-xs text-gray-400 mt-1">抽取 <b className="text-white">{prog.done}/{prog.total}</b> 段 · 已生成 <b className="text-cyan-300">{prog.entities}</b> 条记忆</div>
                    <div className="h-1.5 bg-gray-700 rounded mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-400 to-purple-500" style={{ width: `${prog.total ? Math.round(prog.done / prog.total * 100) : 0}%` }} /></div>
                  </>
                )}
              </div>
            )}
            <div className="text-[11px] text-gray-500 mt-4">每段对话会跑一次 LLM 抽取（用你配置的模型）。导入在后台进行，可关闭此窗口。</div>
          </div>
        )}

        {tab === 'favorites' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2">
              <div className="text-xs text-gray-500">收藏的洞见 · 共 {favs.length} 条（在洞察通知 / 问大脑里点 ★ 收藏）</div>
              <button onClick={loadFavs} className="ml-auto p-1.5 text-gray-400 hover:text-white"><RefreshCw className={`w-4 h-4 ${favLoading ? 'animate-spin' : ''}`} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {favs.length === 0 && !favLoading && (
                <div className="text-sm text-gray-500 text-center py-12">还没有收藏。看到好洞见时点一下 ★ 就收进这里。</div>
              )}
              {favs.map((it) => (
                <div key={it.id} className="group flex items-start gap-2 py-2.5 border-t border-white/5">
                  <Bookmark className="w-4 h-4 text-yellow-400 fill-yellow-400/30 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {it.summary && <div className="text-sm text-white truncate">{it.summary}</div>}
                    <div className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-4">{it.content}</div>
                    {it.createdAt && <div className="text-[10px] text-gray-600 mt-1">{it.createdAt.slice(0, 10)}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => copyFav(it.content)} title="复制" className="p-1.5 text-gray-500 hover:text-cyan-300"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeFav(it.id)} title="取消收藏" className="p-1.5 text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
