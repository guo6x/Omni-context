import { parseBody, sendResponse, sendError } from '../routes.js';
// 全库 dump / restore 端点。目的是让用户对数据有完全控制权：
// 任何时候都能拿走完整 JSON 备份，或在新机器上还原。
// 注意：这里直接 SELECT 全表，绕过 Memory/Entity 上层的访问计数副作用，
// 因为备份逻辑不应触发 last_accessed / access_count 写放大。
const EXPORT_VERSION = 1;
function bufferToBase64(buf) {
    if (buf === null || buf === undefined)
        return null;
    if (Buffer.isBuffer(buf))
        return buf.toString('base64');
    // sqlite3 driver 在某些平台返回 Uint8Array
    if (buf instanceof Uint8Array)
        return Buffer.from(buf).toString('base64');
    return null;
}
function base64ToBuffer(b64) {
    if (!b64)
        return null;
    try {
        return Buffer.from(b64, 'base64');
    }
    catch {
        return null;
    }
}
export const handleAdminRoutes = [
    {
        method: 'GET',
        path: '/api/admin/export',
        handler: async (req, res, ctx) => {
            const entities = await ctx.db.all('SELECT * FROM entities');
            const relationships = await ctx.db.all('SELECT * FROM relationships');
            const coreMemory = await ctx.db.all('SELECT * FROM core_memory');
            const archivalMemory = await ctx.db.all('SELECT * FROM archival_memory');
            const notifications = await ctx.db.all('SELECT * FROM notifications');
            const dump = {
                version: EXPORT_VERSION,
                exportedAt: new Date().toISOString(),
                entities: entities.map((row) => ({
                    ...row,
                    embedding: bufferToBase64(row.embedding),
                })),
                relationships,
                coreMemory,
                archivalMemory: archivalMemory.map((row) => ({
                    ...row,
                    embedding: bufferToBase64(row.embedding),
                })),
                notifications,
            };
            const datePart = new Date().toISOString().slice(0, 10);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="omni-context-backup-${datePart}.json"`);
            res.end(JSON.stringify(dump));
        },
    },
    {
        method: 'POST',
        path: '/api/admin/import',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const mode = body.mode === 'replace' ? 'replace' : 'merge';
            if (!body || typeof body !== 'object' || body.version !== EXPORT_VERSION) {
                return sendError(res, 400, `Unsupported backup version (expected ${EXPORT_VERSION})`);
            }
            const counts = {
                entities: 0,
                relationships: 0,
                coreMemory: 0,
                archivalMemory: 0,
                notifications: 0,
            };
            // 收集已存在的 ID（merge 模式下用来跳过冲突）
            const existing = {
                entities: new Set(),
                relationships: new Set(),
                coreMemory: new Set(),
                archivalMemory: new Set(),
                notifications: new Set(),
            };
            try {
                await ctx.db.withTransaction(async () => {
                    if (mode === 'replace') {
                        // 关系先删，避免 FK 报错；FTS / vec 索引由后续插入时不再同步导致脱节，
                        // 这里一并清掉以保证一致性
                        await ctx.db.run('DELETE FROM relationships');
                        await ctx.db.run('DELETE FROM entities');
                        await ctx.db.run('DELETE FROM core_memory');
                        await ctx.db.run('DELETE FROM archival_memory');
                        await ctx.db.run('DELETE FROM notifications');
                        try {
                            await ctx.db.run('DELETE FROM fts_entities');
                        }
                        catch { /* FTS 可选 */ }
                        try {
                            await ctx.db.run('DELETE FROM vec_entities');
                        }
                        catch { /* vec 可选 */ }
                    }
                    else {
                        for (const r of await ctx.db.all('SELECT id FROM entities'))
                            existing.entities.add(r.id);
                        for (const r of await ctx.db.all('SELECT id FROM relationships'))
                            existing.relationships.add(r.id);
                        for (const r of await ctx.db.all('SELECT key FROM core_memory'))
                            existing.coreMemory.add(r.key);
                        for (const r of await ctx.db.all('SELECT id FROM archival_memory'))
                            existing.archivalMemory.add(r.id);
                        for (const r of await ctx.db.all('SELECT id FROM notifications'))
                            existing.notifications.add(r.id);
                    }
                    for (const e of body.entities || []) {
                        if (mode === 'merge' && existing.entities.has(e.id))
                            continue;
                        const embeddingBlob = base64ToBuffer(e.embedding);
                        await ctx.db.run(`INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                            e.id,
                            e.name,
                            e.type,
                            e.description ?? null,
                            e.source_file ?? null,
                            e.tags ?? null,
                            embeddingBlob,
                            e.metadata ?? null,
                            e.created_at ?? new Date().toISOString(),
                            e.updated_at ?? new Date().toISOString(),
                            e.last_accessed ?? new Date().toISOString(),
                            e.access_count ?? 0,
                        ]);
                        counts.entities++;
                    }
                    for (const r of body.relationships || []) {
                        if (mode === 'merge' && existing.relationships.has(r.id))
                            continue;
                        await ctx.db.run(`INSERT INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                            r.id,
                            r.source_id,
                            r.target_id,
                            r.type,
                            r.description ?? null,
                            r.weight ?? 1.0,
                            r.created_at ?? new Date().toISOString(),
                            r.last_activated ?? new Date().toISOString(),
                        ]);
                        counts.relationships++;
                    }
                    for (const c of body.coreMemory || []) {
                        if (mode === 'merge' && existing.coreMemory.has(c.key))
                            continue;
                        await ctx.db.run(`INSERT INTO core_memory (key, value, category, last_accessed, access_count, summary)
               VALUES (?, ?, ?, ?, ?, ?)`, [
                            c.key,
                            c.value,
                            c.category,
                            c.last_accessed ?? new Date().toISOString(),
                            c.access_count ?? 0,
                            c.summary ?? null,
                        ]);
                        counts.coreMemory++;
                    }
                    for (const a of body.archivalMemory || []) {
                        if (mode === 'merge' && existing.archivalMemory.has(a.id))
                            continue;
                        const embeddingBlob = base64ToBuffer(a.embedding);
                        await ctx.db.run(`INSERT INTO archival_memory (id, content, summary, tags, embedding, importance, created_at, archived_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                            a.id,
                            a.content,
                            a.summary ?? null,
                            a.tags ?? null,
                            embeddingBlob,
                            a.importance ?? 0,
                            a.created_at ?? new Date().toISOString(),
                            a.archived_at ?? new Date().toISOString(),
                        ]);
                        counts.archivalMemory++;
                    }
                    for (const n of body.notifications || []) {
                        if (mode === 'merge' && existing.notifications.has(n.id))
                            continue;
                        await ctx.db.run(`INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                            n.id,
                            n.title,
                            n.content,
                            n.type,
                            n.related_entities ?? null,
                            n.read_status ? 1 : 0,
                            n.created_at ?? new Date().toISOString(),
                        ]);
                        counts.notifications++;
                    }
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return sendError(res, 500, `Import failed: ${msg}`);
            }
            sendResponse(res, 200, { mode, imported: counts });
        },
    },
];
