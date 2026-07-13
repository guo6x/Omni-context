import { Database } from "../db/sqlite.js";
import type { Entity, Assertion } from "../shared-types.js";

export interface TemporalQueryOpts {
  includeHistorical?: boolean;
  asOf?: string;
  limit?: number;
}

export type TemporalMode = 'current' | 'historical' | 'as_of';

export interface ParsedTemporalQuery {
  mode: TemporalMode;
  asOf?: string;
}

const TEMPORAL_ENTITY_FIELDS = [
  "event_time", "valid_from", "valid_until", "observed_at", "recorded_at", "created_at",
] as const;

type TemporalField = typeof TEMPORAL_ENTITY_FIELDS[number];

function effectiveTimeField(): string {
  return `COALESCE(
    event_time,
    valid_from,
    observed_at,
    recorded_at,
    created_at
  )`;
}

interface TemporalWhereClause {
  /** Full WHERE clause including the "WHERE" keyword, or "" when no filter applies. */
  sql: string;
  /** Parameter values to bind, in the order they appear in the SQL. */
  params: string[];
}

function isCurrentFilter(table: string = "e"): TemporalWhereClause {
  // datetime('now') is a SQLite builtin — no user input, safe to inline.
  return {
    sql: `(${table}.valid_until IS NULL OR ${table}.valid_until > datetime('now'))`,
    params: [],
  };
}

function asOfFilter(asOf: string, table: string = "e"): TemporalWhereClause {
  // Parameter-bound to prevent SQL injection via asOf.
  return {
    sql: `(${table}.valid_from <= ? AND (${table}.valid_until IS NULL OR ${table}.valid_until > ?))`,
    params: [asOf, asOf],
  };
}

export function buildTemporalWhere(opts: TemporalQueryOpts, table: string = "e"): TemporalWhereClause {
  const clauses: string[] = [];
  const params: string[] = [];

  if (opts.asOf) {
    const f = asOfFilter(opts.asOf, table);
    clauses.push(f.sql);
    params.push(...f.params);
  } else if (!opts.includeHistorical) {
    const f = isCurrentFilter(table);
    clauses.push(f.sql);
    params.push(...f.params);
  }

  return clauses.length > 0
    ? { sql: `WHERE ${clauses.join(" AND ")}`, params }
    : { sql: "", params: [] };
}

export async function getEntitiesByEffectiveTime(
  db: Database,
  windowStart: string,
  windowEnd: string,
  limit: number,
  opts: TemporalQueryOpts = {},
): Promise<Entity[]> {
  const where = buildTemporalWhere(opts);
  const whereConjunction = where.sql ? `${where.sql} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM entities e
     ${whereConjunction} ${effectiveTimeField()} >= ? AND ${effectiveTimeField()} < ?
       AND json_extract(e.metadata, '$.merged_into') IS NULL
     ORDER BY ${effectiveTimeField()} DESC
     LIMIT ?`,
    [...where.params, windowStart, windowEnd, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    description: r.description,
    tags: r.tags ? JSON.parse(r.tags) : undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    embedding: r.embedding || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_accessed: r.last_accessed,
    access_count: r.access_count,
    observed_at: r.observed_at || undefined,
    recorded_at: r.recorded_at || undefined,
    event_time: r.event_time || undefined,
    valid_from: r.valid_from || undefined,
    valid_until: r.valid_until || undefined,
    temporal_confidence: r.temporal_confidence ?? undefined,
    temporal_source: r.temporal_source || undefined,
    timezone: r.timezone || undefined,
  }));
}

export async function getAssertionsByEffectiveTime(
  db: Database,
  windowStart: string,
  windowEnd: string,
  limit: number,
  opts: TemporalQueryOpts = {},
): Promise<Assertion[]> {
  const where = buildTemporalWhere(opts, "a");
  const whereConjunction = where.sql ? `${where.sql} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM assertions a
     ${whereConjunction} a.valid_from >= ? AND a.valid_from < ?
       AND a.invalidated_at IS NULL
     ORDER BY a.valid_from DESC
     LIMIT ?`,
    [...where.params, windowStart, windowEnd, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    subject_id: r.subject_id,
    predicate: r.predicate,
    object_id: r.object_id || undefined,
    literal_value: r.literal_value || undefined,
    confidence: r.confidence,
    source_span: r.source_span || undefined,
    provenance: r.provenance ? JSON.parse(r.provenance) : undefined,
    observed_at: r.observed_at || undefined,
    recorded_at: r.recorded_at,
    event_time: r.event_time || undefined,
    valid_from: r.valid_from,
    valid_until: r.valid_until || undefined,
    temporal_confidence: r.temporal_confidence ?? undefined,
    temporal_source: r.temporal_source || undefined,
    timezone: r.timezone || undefined,
    invalidated_at: r.invalidated_at || undefined,
    invalidation_reason: r.invalidation_reason || undefined,
    version: r.version ?? 1,
    previous_version_id: r.previous_version_id || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function searchEntitiesWithTemporal(
  db: Database,
  query: string,
  opts: TemporalQueryOpts = {},
): Promise<Entity[]> {
  const where = buildTemporalWhere(opts);
  const whereConjunction = where.sql ? `${where.sql} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM entities e
     ${whereConjunction} (name LIKE ? OR description LIKE ?)
       AND json_extract(e.metadata, '$.merged_into') IS NULL
     ORDER BY ${effectiveTimeField()} DESC
     LIMIT 50`,
    [...where.params, `%${query}%`, `%${query}%`],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    description: r.description,
    tags: r.tags ? JSON.parse(r.tags) : undefined,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_accessed: r.last_accessed,
    access_count: r.access_count,
    observed_at: r.observed_at || undefined,
    recorded_at: r.recorded_at || undefined,
    event_time: r.event_time || undefined,
    valid_from: r.valid_from || undefined,
    valid_until: r.valid_until || undefined,
    temporal_confidence: r.temporal_confidence ?? undefined,
    temporal_source: r.temporal_source || undefined,
    timezone: r.timezone || undefined,
  }));
}

export function resolveTemporalField(entity: Entity): {
  field: TemporalField;
  value: string;
} {
  if (entity.event_time) return { field: "event_time", value: entity.event_time };
  if (entity.valid_from) return { field: "valid_from", value: entity.valid_from };
  if (entity.observed_at) return { field: "observed_at", value: entity.observed_at };
  if (entity.recorded_at) return { field: "recorded_at", value: entity.recorded_at };
  return { field: "created_at", value: entity.created_at };
}

// ── 时间感知查询解析 ──
// 从自然语言查询中检测时间词，映射为 temporal_mode：
// - "现在"/"目前"/"当前" → current（默认，仅保留当前有效事实）
// - "当时"/"之前"/"以前"/"曾经" → historical（包含已失效历史事实）
// - "昨天"/"上周"/"去年" → as_of（按具体日期过滤有效事实）
/**
 * 格式化日期为 SQLite datetime 字符串（当天 23:59:59）。
 */
function formatEndDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 23:59:59`;
}

export function parseTemporalQuery(query: string): ParsedTemporalQuery {
  if (!query || typeof query !== 'string') {
    console.warn('[temporal] parseTemporalQuery: empty or non-string query, defaulting to current mode');
    return { mode: 'current' };
  }
  const q = query.toLowerCase();
  const now = new Date();

  // 相对时间词 → 具体日期，按 as_of 过滤
  if (q.includes('昨天')) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { mode: 'as_of', asOf: formatEndDate(d) };
  }
  if (q.includes('上周')) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { mode: 'as_of', asOf: formatEndDate(d) };
  }
  if (q.includes('去年')) {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return { mode: 'as_of', asOf: formatEndDate(d) };
  }

  // "现在"/"目前"/"当前" → 仅保留当前有效事实
  if (q.includes('现在') || q.includes('目前') || q.includes('当前') || q.includes('现在还')) {
    return { mode: 'current' };
  }

  // "当时"/"之前"/"以前"/"曾经" → 包含历史事实
  if (q.includes('当时') || q.includes('之前') || q.includes('以前') || q.includes('曾经')) {
    return { mode: 'historical' };
  }

  // No temporal keyword found — log so silent defaults are visible.
  console.warn(`[temporal] parseTemporalQuery: no temporal keyword in query "${query.slice(0, 80)}", defaulting to current mode`);
  return { mode: 'current' };
}

/**
 * 将自然语言查询转换为 TemporalQueryOpts，供 filter/buildTemporalWhere 使用。
 */
export function temporalOptsFromQuery(query: string): TemporalQueryOpts {
  const parsed = parseTemporalQuery(query);
  if (parsed.mode === 'as_of' && parsed.asOf) {
    return { asOf: parsed.asOf };
  }
  if (parsed.mode === 'historical') {
    return { includeHistorical: true };
  }
  // current 模式：默认剔除已失效事实
  return {};
}

/**
 * JS 侧时间过滤：在已加载实体集合上按 temporal 有效性过滤。
 * 用于检索结果已返回后、重排前的时间感知过滤。
 */
export function filterEntitiesByTemporal<T extends { valid_from?: string; valid_until?: string }>(
  entities: T[],
  opts: TemporalQueryOpts,
): T[] {
  if (!entities || entities.length === 0) return entities;

  if (opts.asOf) {
    const asOf = opts.asOf;
    return entities.filter(
      (e) => (!e.valid_from || e.valid_from <= asOf) && (!e.valid_until || e.valid_until > asOf),
    );
  }
  if (opts.includeHistorical) {
    return entities;
  }
  // current 模式：剔除已失效（valid_until 早于现在）的实体
  const now = new Date().toISOString();
  return entities.filter((e) => !e.valid_until || e.valid_until > now);
}

/**
 * JS 侧时间过滤：在已加载断言集合上按 temporal 有效性过滤。
 * 断言额外考虑 invalidated_at（被显式作废的时间戳）。
 */
export function filterAssertionsByTemporal<T extends { valid_from?: string; valid_until?: string; invalidated_at?: string }>(
  assertions: T[],
  opts: TemporalQueryOpts,
): T[] {
  if (!assertions || assertions.length === 0) return assertions;

  if (opts.asOf) {
    const asOf = opts.asOf;
    return assertions.filter(
      (a) =>
        (!a.valid_from || a.valid_from <= asOf) &&
        (!a.valid_until || a.valid_until > asOf) &&
        !a.invalidated_at,
    );
  }
  if (opts.includeHistorical) {
    return assertions;
  }
  // current 模式：剔除已失效/已作废的断言
  const now = new Date().toISOString();
  return assertions.filter(
    (a) => (!a.valid_until || a.valid_until > now) && !a.invalidated_at,
  );
}
