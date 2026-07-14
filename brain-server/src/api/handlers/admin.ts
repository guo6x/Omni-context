import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { v4 as uuidv4 } from 'uuid';
import { CONCEPTS, TOOLS, PRINCIPLES, MIXED, ARCHIVAL, CORE_MEMORIES, NOTIFICATIONS, REL_TYPES } from '../../demo-data.js';
import { exportToObsidianVault } from '../../exporters/obsidian-vault.js';
import { URL } from 'url';

// 全库 dump / restore 端点。目的是让用户对数据有完全控制权：
// 任何时候都能拿走完整 JSON 备份，或在新机器上还原。
// 注意：这里直接 SELECT 全表，绕过 Memory/Entity 上层的访问计数副作用，
// 因为备份逻辑不应触发 last_accessed / access_count 写放大。

const EXPORT_VERSION = 2;
const APP_VERSION = '0.1.1';

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
  schemaVersion?: number;
  appVersion?: string;
  exportedAt: string;
  entities: any[];
  relationships: any[];
  assertions?: any[];
  coreMemory: any[];
  archivalMemory: any[];
  notifications: any[];
  discussions?: any[];
  appMeta?: any[];
  ingestionDocuments?: any[];
  ingestionChunks?: any[];
  entityMergeCandidates?: any[];
  entityMergeAudit?: any[];
  assertionConflictAudit?: any[];
  behaviorEvents?: any[];
  proactiveInsights?: any[];
  deviceConfigurations?: any[];
  embeddingMetadata?: Record<string, unknown>;
  createdIndexesManifest?: any[];
}

const SENSITIVE_META_KEY = /(?:api[_-]?key|token|secret|password|credential|private[_-]?key)/i;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function insertPortableRows(
  ctx: RequestContext,
  table: string,
  rows: any[],
  mode: 'merge' | 'replace',
): Promise<number> {
  if (!rows.length) return 0;
  const columns = await ctx.db.all<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`);
  const allowed = new Set(columns.map((column) => column.name));
  let inserted = 0;
  for (const row of rows) {
    const keys = Object.keys(row).filter((key) => allowed.has(key));
    if (!keys.length) continue;
    const verb = mode === 'merge' ? 'INSERT OR IGNORE' : 'INSERT';
    await ctx.db.run(
      `${verb} INTO ${quoteIdentifier(table)} (${keys.map(quoteIdentifier).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((key) => row[key] ?? null),
    );
    inserted++;
  }
  return inserted;
}

function normalizedEntityKey(row: { type?: unknown; name?: unknown; description?: unknown }): string {
  const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return `${normalize(row.type)}|${normalize(row.name)}|${normalize(row.description)}`;
}

function normalizedEntityNameKey(row: { type?: unknown; name?: unknown }): string {
  const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return `${normalize(row.type)}|${normalize(row.name)}`;
}

function parsePortableMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function tombstoneTimestamp(row: { metadata?: unknown; valid_until?: unknown }): string | null {
  const metadata = parsePortableMetadata(row.metadata);
  const marker = metadata.deleted_at ?? metadata.tombstoned_at;
  if (typeof marker === 'string' && marker) return marker;
  if (metadata.tombstone === true && typeof row.valid_until === 'string') return row.valid_until;
  return null;
}

export const handleAdminRoutes = [
  {
    method: 'GET' as const,
    path: '/api/admin/embedding/manifests',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      sendResponse(res, 200, {
        manifests: await ctx.db.getEmbeddingIndexManifests(),
        rebuildState: await ctx.db.getMeta('embedding_rebuild_state'),
      });
    },
  },
  {
    method: 'GET' as const,
    path: '/api/admin/embedding/integrity',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      sendResponse(res, 200, await ctx.db.scanEmbeddingIntegrity());
    },
  },
  {
    method: 'POST' as const,
    path: '/api/admin/embedding/rebuild',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ confirm?: boolean }>(req);
      if (body.confirm !== true) return sendError(res, 400, 'confirm=true is required for explicit rebuild');
      try {
        const counts = await ctx.db.rebuildAllEmbeddings(ctx.embeddingService);
        sendResponse(res, 200, { counts, integrity: await ctx.db.scanEmbeddingIntegrity() });
      } catch (error) {
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    method: 'GET' as const,
    path: '/api/admin/embedding/status',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const info = ctx.embeddingService.getInfo();
      const healthy = info.status !== 'hash-fallback';
      sendResponse(res, 200, {
        mode: info.mode,
        status: info.status,
        model: info.model,
        healthy,
        apiUrl: info.apiUrl,
      });
    },
  },
  {
    method: 'GET' as const,
    path: '/api/admin/export',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const url = new URL(req.url || '', 'http://localhost');
      const format = url.searchParams.get('format');

      if (format === 'obsidian-vault') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="omni-vault-${timestamp}.zip"`
        );
        try {
          await exportToObsidianVault(ctx.db, res);
        } catch (err) {
          console.error('[Export Obsidian Vault] Failed:', err);
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      const entities = await ctx.db.all<any>('SELECT * FROM entities');
      const relationships = await ctx.db.all<any>('SELECT * FROM relationships');
      const assertions = await ctx.db.all<any>('SELECT * FROM assertions');
      const coreMemory = await ctx.db.all<any>('SELECT * FROM core_memory');
      const archivalMemory = await ctx.db.all<any>('SELECT * FROM archival_memory');
      const notifications = await ctx.db.all<any>('SELECT * FROM notifications');
      const schemaVersion = (await ctx.db.get<{ version: number }>('SELECT COUNT(*) AS version FROM migrations'))?.version || 0;
      const appMeta = (await ctx.db.all<any>('SELECT * FROM app_meta'))
        .filter((row) => !SENSITIVE_META_KEY.test(String(row.key || '')));
      const deviceConfigurations = (await ctx.db.all<any>(
        'SELECT device_id, device_type, scopes, issued_at, expires_at, revoked_at, last_used_at FROM device_tokens',
      )).map((row) => ({ ...row, credentials_exported: false }));
      const createdIndexesManifest = await ctx.db.all<any>(
        `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      const indexManifests = await ctx.db.getEmbeddingIndexManifests();
      const rebuildState = await ctx.db.getMeta('embedding_rebuild_state');

      const dump: DumpShape = {
        version: EXPORT_VERSION,
        schemaVersion,
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        entities: entities.map((row) => ({
          ...row,
          embedding: bufferToBase64(row.embedding),
        })),
        relationships,
        assertions,
        coreMemory,
        archivalMemory: archivalMemory.map((row) => ({
          ...row,
          embedding: bufferToBase64(row.embedding),
        })),
        notifications,
        discussions: await ctx.db.all<any>('SELECT * FROM discussions'),
        appMeta,
        ingestionDocuments: await ctx.db.all<any>('SELECT * FROM ingestion_documents'),
        ingestionChunks: await ctx.db.all<any>('SELECT * FROM ingestion_chunks'),
        entityMergeCandidates: await ctx.db.all<any>('SELECT * FROM entity_merge_candidates'),
        entityMergeAudit: await ctx.db.all<any>('SELECT * FROM entity_merge_audit'),
        assertionConflictAudit: await ctx.db.all<any>('SELECT * FROM assertion_conflict_audit'),
        behaviorEvents: await ctx.db.all<any>('SELECT * FROM behavior_events'),
        proactiveInsights: await ctx.db.all<any>('SELECT * FROM proactive_insights'),
        deviceConfigurations,
        embeddingMetadata: {
          service: ctx.embeddingService.getInfo(),
          indexManifests,
          rebuildRequired: Boolean(rebuildState) || indexManifests.length !== 2,
          rebuildState: rebuildState ? JSON.parse(rebuildState) : null,
        },
        createdIndexesManifest,
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

      if (!body || typeof body !== 'object' || ![1, EXPORT_VERSION].includes(body.version)) {
        return sendError(res, 400, `Unsupported backup version (expected 1 or ${EXPORT_VERSION})`);
      }

      const counts = {
        entities: 0,
        relationships: 0,
        assertions: 0,
        coreMemory: 0,
        archivalMemory: 0,
        notifications: 0,
        supplemental: 0,
      };
      const mergeReport = {
        policy: 'local-id-wins; exact-semantic-remap; name-collision-preserve-version; tombstone-soft-close; relationship-endpoint-remap',
        sameIdConflicts: 0,
        semanticEntityRemaps: 0,
        preservedVersions: 0,
        tombstonesApplied: 0,
        relationshipRemaps: 0,
        semanticRelationshipDeduplications: 0,
        semanticAssertionDeduplications: 0,
      };
      const entityIdRemap = new Map<string, string>();

      // 收集已存在的 ID（merge 模式下用来跳过冲突）
      const existing = {
        entities: new Set<string>(),
        relationships: new Set<string>(),
        assertions: new Set<string>(),
        coreMemory: new Set<string>(),
        archivalMemory: new Set<string>(),
        notifications: new Set<string>(),
      };

      try {
        await ctx.db.withTransaction(async () => {
          if (mode === 'replace') {
            // Assertion 同时引用关系两端实体，必须最先删除；FTS / vec 索引由后续插入时不再同步导致脱节，
            // 这里一并清掉以保证一致性
            await ctx.db.run('DELETE FROM proactive_insights');
            await ctx.db.run('DELETE FROM behavior_events');
            await ctx.db.run('DELETE FROM assertion_conflict_audit');
            await ctx.db.run('DELETE FROM entity_merge_audit');
            await ctx.db.run('DELETE FROM entity_merge_candidates');
            await ctx.db.run('DELETE FROM ingestion_chunks');
            await ctx.db.run('DELETE FROM ingestion_documents');
            await ctx.db.run('DELETE FROM discussions');
            await ctx.db.run('DELETE FROM app_meta');
            await ctx.db.run('DELETE FROM assertions');
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
            for (const r of await ctx.db.all<any>('SELECT id FROM assertions')) existing.assertions.add(r.id);
            for (const r of await ctx.db.all<any>('SELECT key FROM core_memory')) existing.coreMemory.add(r.key);
            for (const r of await ctx.db.all<any>('SELECT id FROM archival_memory')) existing.archivalMemory.add(r.id);
            for (const r of await ctx.db.all<any>('SELECT id FROM notifications')) existing.notifications.add(r.id);
          }

          const existingEntityRows = mode === 'merge'
            ? await ctx.db.all<any>('SELECT id, type, name, description, valid_from, updated_at, metadata FROM entities')
            : [];
          const exactEntityIndex = new Map(existingEntityRows.map((row) => [normalizedEntityKey(row), row]));
          const namedEntityIndex = new Map(existingEntityRows.map((row) => [normalizedEntityNameKey(row), row]));
          const pendingVersionLinks: Array<{ importedId: string; existingId: string; importedIsNewer: boolean }> = [];

          for (const e of body.entities || []) {
            if (mode === 'merge' && existing.entities.has(e.id)) {
              entityIdRemap.set(e.id, e.id);
              mergeReport.sameIdConflicts++;
              const tombstoneAt = tombstoneTimestamp(e);
              if (tombstoneAt) {
                await ctx.db.run(
                  `UPDATE entities SET valid_until = COALESCE(valid_until, ?),
                   metadata = json_set(COALESCE(metadata, '{}'), '$.tombstone_imported_at', ?)
                   WHERE id = ?`,
                  [tombstoneAt, new Date().toISOString(), e.id],
                );
                mergeReport.tombstonesApplied++;
              }
              continue;
            }
            if (mode === 'merge') {
              const exact = exactEntityIndex.get(normalizedEntityKey(e));
              if (exact) {
                entityIdRemap.set(e.id, exact.id);
                mergeReport.semanticEntityRemaps++;
                const tombstoneAt = tombstoneTimestamp(e);
                if (tombstoneAt) {
                  await ctx.db.run(
                    `UPDATE entities SET valid_until = COALESCE(valid_until, ?),
                     metadata = json_set(COALESCE(metadata, '{}'), '$.tombstone_imported_at', ?)
                     WHERE id = ?`,
                    [tombstoneAt, new Date().toISOString(), exact.id],
                  );
                  mergeReport.tombstonesApplied++;
                }
                continue;
              }
              const sameName = namedEntityIndex.get(normalizedEntityNameKey(e));
              if (sameName) {
                const importedTime = String(e.valid_from ?? e.updated_at ?? e.created_at ?? '');
                const existingTime = String(sameName.valid_from ?? sameName.updated_at ?? '');
                pendingVersionLinks.push({ importedId: e.id, existingId: sameName.id, importedIsNewer: importedTime >= existingTime });
                mergeReport.preservedVersions++;
              }
            }
            const embeddingBlob = base64ToBuffer(e.embedding);
            await ctx.db.run(
              `INSERT INTO entities (
                 id, name, type, description, source_file, tags, embedding, metadata,
                 created_at, updated_at, last_accessed, access_count,
                 observed_at, recorded_at, event_time, valid_from, valid_until,
                 temporal_confidence, temporal_source, timezone
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                e.observed_at ?? null,
                e.recorded_at ?? e.created_at ?? new Date().toISOString(),
                e.event_time ?? null,
                e.valid_from ?? e.created_at ?? new Date().toISOString(),
                e.valid_until ?? tombstoneTimestamp(e),
                e.temporal_confidence ?? null,
                e.temporal_source ?? null,
                e.timezone ?? null,
              ]
            );
            if (tombstoneTimestamp(e)) mergeReport.tombstonesApplied++;
            entityIdRemap.set(e.id, e.id);
            counts.entities++;
          }

          for (const version of pendingVersionLinks) {
            const sourceId = version.importedIsNewer ? version.importedId : version.existingId;
            const targetId = version.importedIsNewer ? version.existingId : version.importedId;
            await ctx.db.run(
              `INSERT OR IGNORE INTO relationships
               (id, source_id, target_id, type, description, weight, created_at, last_activated, valid_from,
                base_weight, last_decay_at, decay_version)
               VALUES (?, ?, ?, 'historical_version_of', 'Backup merge preserved a same-name content version', 1, ?, ?, ?, 1, ?, 1)`,
              [uuidv4(), sourceId, targetId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
            );
          }

          const existingRelationshipKeys = new Set(
            (mode === 'merge' ? await ctx.db.all<any>('SELECT source_id, target_id, type, valid_from FROM relationships') : [])
              .map((row) => `${row.source_id}|${row.target_id}|${row.type}|${row.valid_from ?? ''}`),
          );

          for (const r of body.relationships || []) {
            if (mode === 'merge' && existing.relationships.has(r.id)) continue;
            const sourceId = entityIdRemap.get(r.source_id) ?? r.source_id;
            const targetId = entityIdRemap.get(r.target_id) ?? r.target_id;
            if (sourceId !== r.source_id || targetId !== r.target_id) mergeReport.relationshipRemaps++;
            const relationshipKey = `${sourceId}|${targetId}|${r.type}|${r.valid_from ?? r.created_at ?? ''}`;
            if (mode === 'merge' && existingRelationshipKeys.has(relationshipKey)) {
              mergeReport.semanticRelationshipDeduplications++;
              continue;
            }
            await ctx.db.run(
              `INSERT INTO relationships (
                 id, source_id, target_id, type, description, weight, created_at,
                 last_activated, valid_from, valid_until, invalidated_at, invalidation_reason,
                 base_weight, last_decay_at, last_reinforced_at, reinforcement_reason, decay_version
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                r.id,
                sourceId,
                targetId,
                r.type,
                r.description ?? null,
                r.weight ?? 1.0,
                r.created_at ?? new Date().toISOString(),
                r.last_activated ?? new Date().toISOString(),
                r.valid_from ?? r.created_at ?? new Date().toISOString(),
                r.valid_until ?? null,
                r.invalidated_at ?? null,
                r.invalidation_reason ?? null,
                r.base_weight ?? r.weight ?? 1.0,
                r.last_decay_at ?? r.last_activated ?? r.created_at ?? new Date().toISOString(),
                r.last_reinforced_at ?? null,
                r.reinforcement_reason ?? null,
                r.decay_version ?? 1,
              ]
            );
            existingRelationshipKeys.add(relationshipKey);
            counts.relationships++;
          }

          const existingAssertionKeys = new Set(
            (mode === 'merge' ? await ctx.db.all<any>('SELECT subject_id, predicate, object_id, literal_value, valid_from FROM assertions') : [])
              .map((row) => `${row.subject_id}|${row.predicate}|${row.object_id ?? ''}|${row.literal_value ?? ''}|${row.valid_from ?? ''}`),
          );

          for (const a of body.assertions || []) {
            if (mode === 'merge' && existing.assertions.has(a.id)) continue;
            const subjectId = entityIdRemap.get(a.subject_id) ?? a.subject_id;
            const objectId = a.object_id ? (entityIdRemap.get(a.object_id) ?? a.object_id) : null;
            const assertionKey = `${subjectId}|${a.predicate}|${objectId ?? ''}|${a.literal_value ?? ''}|${a.valid_from ?? a.created_at ?? ''}`;
            if (mode === 'merge' && existingAssertionKeys.has(assertionKey)) {
              mergeReport.semanticAssertionDeduplications++;
              continue;
            }
            const provenance = a.provenance && typeof a.provenance !== 'string'
              ? JSON.stringify(a.provenance)
              : a.provenance ?? null;
            const createdAt = a.created_at ?? new Date().toISOString();
            await ctx.db.run(
              `INSERT INTO assertions (
                 id, subject_id, predicate, original_predicate, object_id, literal_value, confidence,
                 source_span, provenance, observed_at, recorded_at, event_time,
                 valid_from, valid_until, temporal_confidence, temporal_source,
                 timezone, invalidated_at, invalidation_reason, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                a.id,
                subjectId,
                a.predicate,
                a.original_predicate ?? a.predicate,
                objectId,
                a.literal_value ?? null,
                a.confidence ?? 1,
                a.source_span ?? null,
                provenance,
                a.observed_at ?? null,
                a.recorded_at ?? createdAt,
                a.event_time ?? null,
                a.valid_from ?? createdAt,
                a.valid_until ?? null,
                a.temporal_confidence ?? null,
                a.temporal_source ?? null,
                a.timezone ?? null,
                a.invalidated_at ?? null,
                a.invalidation_reason ?? null,
                createdAt,
                a.updated_at ?? createdAt,
              ]
            );
            existingAssertionKeys.add(assertionKey);
            counts.assertions++;
          }

          // v1 旧备份没有 assertions；为每条关系恢复兼容的 Assertion 视图。
          await ctx.db.run(
            `INSERT OR IGNORE INTO assertions (
               id, subject_id, predicate, object_id, confidence, source_span, provenance,
               recorded_at, valid_from, valid_until, invalidated_at, invalidation_reason,
               created_at, updated_at
             )
             SELECT
               'relationship:' || id, source_id, type, target_id,
               CASE WHEN weight < 0 THEN 0 WHEN weight > 1 THEN 1 ELSE weight END,
               description,
               json_object('backup_restore', 1, 'relationship_id', id),
               created_at, COALESCE(valid_from, created_at), valid_until,
               invalidated_at, invalidation_reason, created_at,
               COALESCE(last_activated, created_at)
             FROM relationships`
          );

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

          counts.supplemental += await insertPortableRows(ctx, 'discussions', body.discussions || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'app_meta', (body.appMeta || []).filter((row) => !SENSITIVE_META_KEY.test(String(row.key || ''))), mode);
          counts.supplemental += await insertPortableRows(ctx, 'ingestion_documents', body.ingestionDocuments || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'ingestion_chunks', body.ingestionChunks || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'entity_merge_candidates', body.entityMergeCandidates || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'entity_merge_audit', body.entityMergeAudit || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'assertion_conflict_audit', body.assertionConflictAudit || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'behavior_events', body.behaviorEvents || [], mode);
          counts.supplemental += await insertPortableRows(ctx, 'proactive_insights', body.proactiveInsights || [], mode);
        });

        await ctx.db.reindexEntities();
        await ctx.db.setMeta('embedding_rebuild_required', JSON.stringify({
          required: true,
          reason: 'portable_import_requires_profile_and_serialization_verification',
          source: body.embeddingMetadata || null,
          marked_at: new Date().toISOString(),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return sendError(res, 500, `Import failed: ${msg}`);
      }

      sendResponse(res, 200, { mode, imported: counts, ...(mode === 'merge' ? { mergeReport } : {}) });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/admin/embedding/reload',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      try {
        await ctx.embeddingService.reload();
        const info = ctx.embeddingService.getInfo();
        sendResponse(res, 200, {
          success: true,
          status: info.status,
          mode: info.mode,
          model: info.model,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Embedding Reload] 重载失败:', msg);
        sendResponse(res, 500, {
          success: false,
          error: msg,
          // 即使失败也返回当前状态（仍是 hash-fallback）
          status: ctx.embeddingService.getStatus(),
        });
      }
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
            const t = pick(REL_TYPES);
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
