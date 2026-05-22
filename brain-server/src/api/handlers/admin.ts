import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { v4 as uuidv4 } from 'uuid';
import { CONCEPTS, TOOLS, PRINCIPLES, MIXED, ARCHIVAL, CORE_MEMORIES, NOTIFICATIONS, REL_TYPES } from '../../demo-data.js';

// 全库 dump / restore 端点。目的是让用户对数据有完全控制权：
// 任何时候都能拿走完整 JSON 备份，或在新机器上还原。
// 注意：这里直接 SELECT 全表，绕过 Memory/Entity 上层的访问计数副作用，
// 因为备份逻辑不应触发 last_accessed / access_count 写放大。

const EXPORT_VERSION = 1;

function bufferToBase64(buf: any): string | null {
  if (buf === null || buf === undefined) return null;
  if (Buffer.isBuffer(buf)) return buf.toString('base64');
  // sqlite3 driver 在某些平台返回 Uint8Array
  if (buf instanceof Uint8Array) return Buffer.from(buf).toString('base64');
  return null;
}

function base64ToBuffer(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

interface DumpShape {
  version: number;
  exportedAt: string;
  entities: any[];
  relationships: any[];
  coreMemory: any[];
  archivalMemory: any[];
  notifications: any[];
}

export const handleAdminRoutes = [
  {
    method: 'GET' as const,
    path: '/api/admin/export',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const entities = await ctx.db.all<any>('SELECT * FROM entities');
      const relationships = await ctx.db.all<any>('SELECT * FROM relationships');
      const coreMemory = await ctx.db.all<any>('SELECT * FROM core_memory');
      const archivalMemory = await ctx.db.all<any>('SELECT * FROM archival_memory');
      const notifications = await ctx.db.all<any>('SELECT * FROM notifications');

      const dump: DumpShape = {
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
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="omni-context-backup-${datePart}.json"`
      );
      res.end(JSON.stringify(dump));
    },
  },
  {
    method: 'POST' as const,
    path: '/api/admin/import',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<DumpShape & { mode?: 'merge' | 'replace' }>(req);
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
        entities: new Set<string>(),
        relationships: new Set<string>(),
        coreMemory: new Set<string>(),
        archivalMemory: new Set<string>(),
        notifications: new Set<string>(),
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
            try { await ctx.db.run('DELETE FROM fts_entities'); } catch { /* FTS 可选 */ }
            try { await ctx.db.run('DELETE FROM vec_entities'); } catch { /* vec 可选 */ }
          } else {
            for (const r of await ctx.db.all<any>('SELECT id FROM entities')) existing.entities.add(r.id);
            for (const r of await ctx.db.all<any>('SELECT id FROM relationships')) existing.relationships.add(r.id);
            for (const r of await ctx.db.all<any>('SELECT key FROM core_memory')) existing.coreMemory.add(r.key);
            for (const r of await ctx.db.all<any>('SELECT id FROM archival_memory')) existing.archivalMemory.add(r.id);
            for (const r of await ctx.db.all<any>('SELECT id FROM notifications')) existing.notifications.add(r.id);
          }

          for (const e of body.entities || []) {
            if (mode === 'merge' && existing.entities.has(e.id)) continue;
            const embeddingBlob = base64ToBuffer(e.embedding);
            await ctx.db.run(
              `INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
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
              ]
            );
            counts.entities++;
          }

          for (const r of body.relationships || []) {
            if (mode === 'merge' && existing.relationships.has(r.id)) continue;
            await ctx.db.run(
              `INSERT INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                r.id,
                r.source_id,
                r.target_id,
                r.type,
                r.description ?? null,
                r.weight ?? 1.0,
                r.created_at ?? new Date().toISOString(),
                r.last_activated ?? new Date().toISOString(),
              ]
            );
            counts.relationships++;
          }

          for (const c of body.coreMemory || []) {
            if (mode === 'merge' && existing.coreMemory.has(c.key)) continue;
            await ctx.db.run(
              `INSERT INTO core_memory (key, value, category, last_accessed, access_count, summary)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                c.key,
                c.value,
                c.category,
                c.last_accessed ?? new Date().toISOString(),
                c.access_count ?? 0,
                c.summary ?? null,
              ]
            );
            counts.coreMemory++;
          }

          for (const a of body.archivalMemory || []) {
            if (mode === 'merge' && existing.archivalMemory.has(a.id)) continue;
            const embeddingBlob = base64ToBuffer(a.embedding);
            await ctx.db.run(
              `INSERT INTO archival_memory (id, content, summary, tags, embedding, importance, created_at, archived_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                a.id,
                a.content,
                a.summary ?? null,
                a.tags ?? null,
                embeddingBlob,
                a.importance ?? 0,
                a.created_at ?? new Date().toISOString(),
                a.archived_at ?? new Date().toISOString(),
              ]
            );
            counts.archivalMemory++;
          }

          for (const n of body.notifications || []) {
            if (mode === 'merge' && existing.notifications.has(n.id)) continue;
            await ctx.db.run(
              `INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                n.id,
                n.title,
                n.content,
                n.type,
                n.related_entities ?? null,
                n.read_status ? 1 : 0,
                n.created_at ?? new Date().toISOString(),
              ]
            );
            counts.notifications++;
          }
        });

        try {
          await ctx.db.reindexEntities();
        } catch (reindexErr) {
          console.error('[Import] Reindexing entities failed:', reindexErr);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendError(res, 500, `Import failed: ${msg}`);
      }

      sendResponse(res, 200, { mode, imported: counts });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/admin/seed-demo',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      // 1. 幂等保护：检查实体表是否已有数据
      const entityCountRow = await ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM entities');
      const entityCount = entityCountRow ? entityCountRow.c : 0;
      if (entityCount > 0) {
        return sendResponse(res, 200, { skipped: true, reason: '图谱已非空' });
      }

      // 2. 汇总所有示例实体，并在事务开启前计算其 embedding
      const allEntities: any[] = [];
      CONCEPTS.forEach(c => allEntities.push({ id: uuidv4(), name: c.name, type: 'concept' as const, description: c.desc, tags: c.tags }));
      TOOLS.forEach(t => allEntities.push({ id: uuidv4(), name: t.name, type: 'tool' as const, description: t.desc, tags: t.tags }));
      PRINCIPLES.forEach(p => allEntities.push({ id: uuidv4(), name: p.name, type: 'principle' as const, description: p.desc, tags: p.tags, metadata: { isCore: true } }));
      MIXED.forEach(m => allEntities.push({ id: uuidv4(), name: m.name, type: m.type, description: m.desc, tags: m.tags }));

      const entitiesWithEmbeddings = [];
      for (const ent of allEntities) {
        let embedding: number[] | undefined;
        try {
          const embeddingText = `${ent.name}: ${ent.description || ''}`;
          const embRes = await ctx.embeddingService.embed(embeddingText);
          embedding = embRes.embedding;
        } catch (e) {
          console.warn(`[seed-demo] Generating embedding failed for entity "${ent.name}":`, e);
        }
        entitiesWithEmbeddings.push({ ...ent, embedding });
      }

      const archivalWithEmbeddings = [];
      for (const arch of ARCHIVAL) {
        let embedding: number[] | undefined;
        try {
          const embRes = await ctx.embeddingService.embed(arch.content);
          embedding = embRes.embedding;
        } catch (e) {
          console.warn(`[seed-demo] Generating embedding failed for archival memory:`, e);
        }
        archivalWithEmbeddings.push({ ...arch, embedding });
      }

      const counts = {
        entities: 0,
        relationships: 0,
        coreMemory: 0,
        archivalMemory: 0,
        notifications: 0,
      };

      try {
        await ctx.db.withTransaction(async () => {
          // 1. 写入实体
          for (const ent of entitiesWithEmbeddings) {
            await ctx.db.addEntity({
              id: ent.id,
              name: ent.name,
              type: ent.type,
              description: ent.description,
              tags: ent.tags,
              metadata: ent.metadata,
              embedding: ent.embedding,
            });
            counts.entities++;
          }

          // 2. 随机生成 36 条关系
          const ids = entitiesWithEmbeddings.map(e => e.id);
          const seen = new Set<string>();
          let relCount = 0;
          let attempts = 0;

          const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
          const randFloat = (min: number, max: number): number => Math.random() * (max - min) + min;

          while (relCount < 36 && attempts < 400) {
            attempts++;
            const a = pick(ids);
            const b = pick(ids);
            if (a === b) continue;
            const t = pick(REL_TYPES) as any;
            const key = `${a}->${b}:${t}`;
            if (seen.has(key)) continue;
            seen.add(key);

            await ctx.db.addRelationship({
              source_id: a,
              target_id: b,
              type: t,
              weight: Number(randFloat(0.4, 1.6).toFixed(2)),
            });
            counts.relationships++;
            relCount++;
          }

          // 3. 写入冷记忆 archival_memory
          for (const a of archivalWithEmbeddings) {
            await ctx.archivalMemory.add(a.content, {
              summary: a.content.slice(0, 60) + '…',
              tags: a.tags,
              importance: a.importance,
              embedding: a.embedding,
            });
            counts.archivalMemory++;
          }

          // 4. 写入热记忆 core_memory
          for (const c of CORE_MEMORIES) {
            await ctx.coreMemory.set(c.key, c.value, c.category);
            counts.coreMemory++;
          }

          // 5. 写入通知 notifications
          for (const n of NOTIFICATIONS) {
            const relEntities: string[] = [];
            const count = Math.floor(Math.random() * 2) + 2; // 2 或 3
            for (let i = 0; i < count; i++) {
              relEntities.push(pick(ids));
            }
            await ctx.db.addNotification({
              title: n.title,
              content: n.content,
              type: 'insight',
              related_entities: relEntities,
            });
            counts.notifications++;
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendError(res, 500, `Seed failed: ${msg}`);
      }

      sendResponse(res, 200, { success: true, imported: counts });
    },
  },
];
