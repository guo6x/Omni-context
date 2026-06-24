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

interface MemoryManagerProps {
  onClose: () => void;
  initialType?: string;
  initialCoreOnly?: boolean;
  initialUnlinkedOnly?: boolean;
}

export default function MemoryManager({
  onClose,
  initialType = '',
  initialCoreOnly = false,
  initialUnlinkedOnly = false,
}: MemoryManagerProps) {
  const toast = useToast();
  const [tab, setTab] = useState<'browse' | 'import' | 'favorites'>('browse');

  // ── 浏览 ──
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [source, setSource] = useState('');
  const [type, setType] = useState(initialType);
  const [coreOnly, setCoreOnly] = useState(initialCoreOnly);
  const [unlinkedOnly, setUnlinkedOnly] = useState(initialUnlinkedOnly);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<ReviewItem | null>(null);
  const [detailItem, setDetailItem] = useState<ReviewItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (source) params.set('source', source);
      if (type) params.set('type', type);
      if (coreOnly) params.set('coreOnly', 'true');
      if (unlinkedOnly) params.set('unlinkedOnly', 'true');
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
  }, [source, type, coreOnly, unlinkedOnly, q, toast]);

  useEffect(() => { if (tab === 'browse') load(); }, [tab, source, type, coreOnly, unlinkedOnly, load]);

  // ── 收藏夹（存在 archival、打"收藏"标签的记忆）──
  const [favs, setFavs] = useState<Array<{ id: string; content: string; summary?: string; createdAt?: string }>>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favDetail, setFavDetail] = useState<{ id: string; content: string; summary?: string; createdAt?: string } | null>(null);
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
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-[var(--color-fg)] font-semibold"><Database className="w-4 h-4 text-cyan-400" /> 记忆管理</div>
          <button onClick={onClose} className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-accent)]/10 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {(['browse', 'favorites', 'import'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === k ? 'bg-[var(--color-accent)]/15 text-[var(--color-fg)] font-medium border border-[var(--color-accent)]/30' : 'text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-accent)]/5'}`}>
              {k === 'browse' ? '浏览' : k === 'favorites' ? '收藏' : '导入'}
            </button>
          ))}
        </div>

        {tab === 'browse' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2 flex-wrap">
              {(type || coreOnly || unlinkedOnly) && (
                <div className="flex items-center gap-1.5">
                  {type && (
                    <button
                      onClick={() => setType('')}
                      className="text-xs rounded-md px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    >
                      类型：{type} ×
                    </button>
                  )}
                  {coreOnly && (
                    <button
                      onClick={() => setCoreOnly(false)}
                      className="text-xs rounded-md px-2.5 py-1 border border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                    >
                      仅核心原则 ×
                    </button>
                  )}
                  {unlinkedOnly && (
                    <button
                      onClick={() => setUnlinkedOnly(false)}
                      className="text-xs rounded-md px-2.5 py-1 border border-amber-500/40 bg-amber-500/10 text-amber-300"
                    >
                      仅孤立内容 ×
                    </button>
                  )}
                </div>
              )}
              {SOURCE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setSource(f.key)}
                  className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${source === f.key ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium' : 'border-[var(--color-border)] text-[var(--color-fgMuted)] hover:text-[var(--color-fg)]'}`}>
                  {f.label}{f.key && counts[f.key === '__user__' ? 'user' : f.key] != null ? ` ${counts[f.key === '__user__' ? 'user' : f.key]}` : ''}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 bg-[var(--color-bgSubtle)]/50">
                <Search className="w-3.5 h-3.5 text-[var(--color-fgMuted)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
                  placeholder="搜索…" className="bg-transparent text-sm text-[var(--color-fg)] py-1.5 w-40 outline-none placeholder:text-[var(--color-fgMuted)]/50" />
              </div>
              <button onClick={load} className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] transition-colors"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            {mergeFrom && <div className="px-5 pt-2 text-xs text-amber-500">合并模式：点另一条把「{mergeFrom.name}」并入它 · <button onClick={() => setMergeFrom(null)} className="underline font-semibold text-[var(--color-accent)]">取消</button></div>}
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {items.map((it) => {
                const b = sourceBadge(it);
                const isCurrentMergeFrom = mergeFrom && mergeFrom.id === it.id;
                return (
                  <div key={it.id} className={`flex items-start gap-2 py-2.5 border-t border-[var(--color-border)]/40 cursor-pointer hover:bg-[var(--color-accent)]/5 transition-colors ${isCurrentMergeFrom ? 'bg-[var(--color-accent)]/10 border-l-2 border-l-[var(--color-accent)] pl-1' : ''}`}
                    onClick={() => mergeFrom ? doMerge(it) : setDetailItem(it)}>
                    <button onClick={(e) => { e.stopPropagation(); toggleCore(it); }} title="设/撤核心" className="mt-0.5">
                      <Star className={`w-4 h-4 ${it.isCore ? 'text-yellow-400 fill-yellow-400' : 'text-[var(--color-fgMuted)]/40 hover:text-yellow-400'}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--color-fg)] truncate font-medium">{it.name} <span className="text-[10px] text-[var(--color-fgMuted)] bg-[var(--color-bgSubtle)] px-1 rounded ml-1">{it.type}{it.isCore ? ' · 核心' : ''}</span></div>
                      {it.description && <div className="text-xs text-[var(--color-fgMuted)] line-clamp-1 mt-0.5">{it.description}</div>}
                    </div>
                    <span className={`text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap self-center ${b.cls}`}>{b.text}</span>
                    <div className="flex items-center gap-2 whitespace-nowrap self-center ml-2">
                      <button onClick={(e) => { e.stopPropagation(); setMergeFrom(it); }} className="text-xs text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] transition-colors">合并</button>
                      <button onClick={(e) => { e.stopPropagation(); del(it); }} className="text-[var(--color-fgMuted)] hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {!loading && items.length === 0 && <div className="text-center text-[var(--color-fgMuted)] text-sm py-10">没有匹配的记忆</div>}
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="p-5 overflow-y-auto">
            <div className="text-sm text-[var(--color-fg)] font-medium">从 AI 聊天记录导入</div>
            <div className="text-xs text-[var(--color-fgMuted)] mt-1 leading-relaxed">把你和 ChatGPT / Claude / Gemini 的历史对话变成大脑记忆。对话的原始日期会保留，所以"上个月想了啥"也能召回。</div>
            <div onClick={() => !importing && fileRef.current?.click()}
              className={`mt-4 border border-dashed border-[var(--color-border)] rounded-xl py-8 text-center transition-colors ${importing ? 'opacity-60' : 'cursor-pointer hover:bg-[var(--color-accent)]/5 hover:border-[var(--color-accent)]/50'}`}>
              <FileUp className="w-6 h-6 mx-auto text-[var(--color-accent)] animate-pulse" />
              <div className="text-sm mt-2 text-[var(--color-fg)] font-medium">{importing ? '处理中…' : '选择导出文件'}</div>
              <div className="text-[11px] text-[var(--color-fgMuted)] mt-1">conversations.json / chat.html（ChatGPT/Claude） · My Activity（Gemini，HTML 或 JSON 都行）</div>
            </div>
            <input ref={fileRef} type="file" accept=".json,.html,.htm,application/json,text/html" className="hidden" onChange={onFile} />
            <div className="mt-4 flex items-center gap-2 text-xs text-[var(--color-fgMuted)]">
              导入最近 <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} placeholder="全部"
                className="w-16 text-center bg-[var(--color-bgSubtle)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-fg)] outline-none" /> 段（留空 = 全部）
            </div>
            {(importMsg || prog) && (
              <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bgSubtle)]/50 p-3">
                <div className="text-xs text-[var(--color-fg)]">{importMsg}</div>
                {prog && (
                  <>
                    <div className="text-xs text-[var(--color-fgMuted)] mt-1">抽取 <b className="text-[var(--color-fg)]">{prog.done}/{prog.total}</b> 段 · 已生成 <b className="text-[var(--color-accent)]">{prog.entities}</b> 条记忆</div>
                    <div className="h-1.5 bg-[var(--color-bgSubtle)] rounded mt-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-400 to-purple-500 animate-shimmer-fast" style={{ width: `${prog.total ? Math.round(prog.done / prog.total * 100) : 0}%` }} /></div>
                  </>
                )}
              </div>
            )}
            <div className="text-[11px] text-[var(--color-fgMuted)] mt-4">每段对话会跑一次 LLM 抽取（用你配置的模型）。导入在后台进行，可关闭此窗口。</div>
          </div>
        )}

        {tab === 'favorites' && (
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-5 pt-3 flex items-center gap-2">
              <div className="text-xs text-[var(--color-fgMuted)]">收藏的洞见 · 共 {favs.length} 条（在洞察通知 / 问大脑里点 ★ 收藏）</div>
              <button onClick={loadFavs} className="ml-auto p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] transition-colors"><RefreshCw className={`w-4 h-4 ${favLoading ? 'animate-spin' : ''}`} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-2 flex-1">
              {favs.length === 0 && !favLoading && (
                <div className="text-sm text-[var(--color-fgMuted)] text-center py-12">还没有收藏。看到好洞见时点一下 ★ 就收进这里。</div>
              )}
              {favs.map((it) => (
                <div key={it.id} className="group flex items-start gap-2 py-2.5 border-t border-[var(--color-border)]/40">
                  <Bookmark className="w-4 h-4 text-yellow-400 fill-yellow-400/30 mt-0.5 shrink-0" />
                  <button onClick={() => setFavDetail(it)} title="点击放大查看" className="min-w-0 flex-1 text-left">
                    {it.summary && <div className="text-sm text-[var(--color-fg)] truncate font-semibold group-hover:text-[var(--color-accent)] transition-colors">{it.summary}</div>}
                    <div className="text-xs text-[var(--color-fgMuted)] whitespace-pre-wrap line-clamp-4 mt-0.5">{it.content}</div>
                    {it.createdAt && <div className="text-[10px] text-[var(--color-fgMuted)]/40 mt-1">{it.createdAt.slice(0, 10)}</div>}
                  </button>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button onClick={() => copyFav(it.content)} title="复制" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeFav(it.id)} title="取消收藏" className="p-1.5 text-[var(--color-fgMuted)] hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {favDetail && (
          <div className="absolute inset-0 z-10 flex flex-col rounded-2xl bg-[var(--color-bg)] border border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 min-w-0 text-[var(--color-fg)] font-semibold">
                <Bookmark className="w-4 h-4 text-yellow-400 fill-yellow-400/30 shrink-0" />
                <span className="truncate">{favDetail.summary || '收藏'}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => copyFav(favDetail.content)} title="复制" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] rounded-lg transition-colors"><Copy className="w-4 h-4" /></button>
                <button onClick={() => setFavDetail(null)} title="返回" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] rounded-lg transition-colors"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-[var(--color-fg)] whitespace-pre-wrap leading-relaxed">{favDetail.content}</div>
            {favDetail.createdAt && <div className="px-5 py-2 text-[10px] text-[var(--color-fgMuted)]/40 border-t border-[var(--color-border)]/40">{favDetail.createdAt.slice(0, 10)}</div>}
          </div>
        )}

        {detailItem && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-[var(--color-bg)] border border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 min-w-0 text-[var(--color-fg)] font-semibold">
                <Database className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                <span className="truncate">{detailItem.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => {
                  navigator.clipboard.writeText(detailItem.description || detailItem.name);
                  toast.success('描述已复制');
                }} title="复制描述" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-accent)] rounded-lg transition-colors">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => setDetailItem(null)} title="返回" className="p-1.5 text-[var(--color-fgMuted)] hover:text-[var(--color-fg)] rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 基本元数据展示 */}
              <div className="grid grid-cols-2 gap-4 bg-[var(--color-bgSubtle)]/50 p-4 rounded-xl border border-[var(--color-border)]/40 text-xs">
                <div>
                  <span className="text-[var(--color-fgMuted)]">实体类型</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.type}</div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">来源</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">
                    {detailItem.source === 'external_ai' ? '外部 AI' : detailItem.source === 'import' ? '导入' : detailItem.source === 'auto_sediment' ? '自动沉淀' : '你写的'}
                  </div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">创建时间</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.created_at || '未知'}</div>
                </div>
                <div>
                  <span className="text-[var(--color-fgMuted)]">访问次数</span>
                  <div className="text-[var(--color-fg)] font-medium mt-1">{detailItem.access_count ?? 0} 次</div>
                </div>
              </div>

              {/* 标签列表 */}
              {detailItem.tags && detailItem.tags.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--color-fgMuted)]">标签</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {detailItem.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2.5 py-0.5 rounded-full border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 text-[var(--color-accent)] font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 描述内容 */}
              <div className="flex flex-col flex-1">
                <span className="text-xs text-[var(--color-fgMuted)] mb-2 font-medium">描述内容</span>
                <div className="flex-1 min-h-[150px] p-4 bg-[var(--color-bgSubtle)] rounded-xl border border-[var(--color-border)] text-[var(--color-fg)] text-sm whitespace-pre-wrap leading-relaxed select-text overflow-y-auto">
                  {detailItem.description || <span className="text-[var(--color-fgMuted)] italic">暂无描述</span>}
                </div>
              </div>

              {/* 溯源信息 */}
              {detailItem.provenance && (
                <div className="text-[10px] text-[var(--color-fgMuted)]/60 border-t border-[var(--color-border)]/40 pt-3">
                  <span>溯源信息：</span>
                  {detailItem.provenance.platform && <span>平台 ({detailItem.provenance.platform}) </span>}
                  {detailItem.provenance.tool && <span>工具 ({detailItem.provenance.tool}) </span>}
                  {detailItem.provenance.at && <span>时间 ({detailItem.provenance.at}) </span>}
                </div>
              )}
            </div>
            
            {/* 底部动作条 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bgSubtle)]/30 rounded-b-2xl">
              <button 
                onClick={() => {
                  toggleCore(detailItem);
                  setDetailItem(prev => prev ? { ...prev, isCore: !prev.isCore } : null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  detailItem.isCore 
                    ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20' 
                    : 'border-[var(--color-border)] hover:bg-[var(--color-bgSubtle)] text-[var(--color-fg)]'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${detailItem.isCore ? 'fill-yellow-500' : ''}`} />
                {detailItem.isCore ? '核心记忆' : '设为核心'}
              </button>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setMergeFrom(detailItem);
                    setDetailItem(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bgSubtle)] text-xs text-[var(--color-fg)] transition-colors"
                >
                  合并此实体
                </button>
                <button
                  onClick={() => {
                    del(detailItem);
                    setDetailItem(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                >
                  删除实体
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
