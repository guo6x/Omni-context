import { Database } from "../db/sqlite.js";
import type { Entity, Assertion } from "../shared-types.js";

export interface TemporalQueryOpts {
  includeHistorical?: boolean;
  asOf?: string;
  limit?: number;
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

function isCurrentFilter(table: string = "e"): string {
  const now = `datetime('now')`;
  return `(
    ${table}.valid_until IS NULL OR ${table}.valid_until > ${now}
  )`;
}

function asOfFilter(asOf: string, table: string = "e"): string {
  return `(
    ${table}.valid_from <= '${asOf}' AND (${table}.valid_until IS NULL OR ${table}.valid_until > '${asOf}')
  )`;
}

export function buildTemporalWhere(opts: TemporalQueryOpts, table: string = "e"): string {
  const clauses: string[] = [];

  if (opts.asOf) {
    clauses.push(asOfFilter(opts.asOf, table));
  } else if (!opts.includeHistorical) {
    clauses.push(isCurrentFilter(table));
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

export async function getEntitiesByEffectiveTime(
  db: Database,
  windowStart: string,
  windowEnd: string,
  limit: number,
  opts: TemporalQueryOpts = {},
): Promise<Entity[]> {
  const where = buildTemporalWhere(opts);
  const whereConjunction = where ? `${where} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM entities e
     ${whereConjunction} ${effectiveTimeField()} >= ? AND ${effectiveTimeField()} < ?
       AND json_extract(e.metadata, '$.merged_into') IS NULL
     ORDER BY ${effectiveTimeField()} DESC
     LIMIT ?`,
    [windowStart, windowEnd, limit],
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
  const whereConjunction = where ? `${where} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM assertions a
     ${whereConjunction} a.valid_from >= ? AND a.valid_from < ?
       AND a.invalidated_at IS NULL
     ORDER BY a.valid_from DESC
     LIMIT ?`,
    [windowStart, windowEnd, limit],
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
  const whereConjunction = where ? `${where} AND` : "WHERE";

  const rows = await db.all<any>(
    `SELECT * FROM entities e
     ${whereConjunction} (name LIKE ? OR description LIKE ?)
       AND json_extract(e.metadata, '$.merged_into') IS NULL
     ORDER BY ${effectiveTimeField()} DESC
     LIMIT 50`,
    [`%${query}%`, `%${query}%`],
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
