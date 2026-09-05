import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Assertion, AssertionInput, Entity, Relationship, SINGLE_VALUED_REL_TYPES } from '../shared-types.js';
import { cosineSimilarity, encodeEmbedding, decodeEmbedding, decodeEmbeddingF32 } from '../utils/math.js';
import * as sqliteVec from 'sqlite-vec';
import { ENTITY_TYPES, NOTIFICATION_TYPES, RELATIONSHIP_TYPES } from '../schema/domain.js';
import type { BehaviorEventInput } from '../behavior/events.js';
import type { EmbeddingService } from '../embedding/service.js';
import type { EmbeddingUsageProfile } from '../embedding/profiles.js';
import {
  ASSERTION_SERIALIZATION_VERSION,
  ENTITY_SERIALIZATION_VERSION,
  serializeAssertionPassage,
  serializeEntityPassage,
} from '../embedding/serialization.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedText(value: unknown, max = 2_000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

sqlite3.verbose();

export interface DatabaseConfig {
  dbPath: string;
  enableWAL?: boolean;
  busyTimeout?: number;
}

export interface VectorSearchResult {
  id: string;
  name: string;
  type: string;
  description: string;
  similarity: number;
}

export interface AssertionVectorSearchResult {
  id: string;
  assertion: Assertion;
  subjectName: string;
  objectName?: string;
  passage: string;
  distance: number;
  similarity: number;
}

export interface EmbeddingIndexSpec {
  indexName: 'vec_entities' | 'vec_assertions';
  modelId: string;
  modelRevision: string;
  dimension: number;
  usageProfileVersion: string;
  serializationVersion: string;
}

export interface EmbeddingIndexManifestRow {
  index_name: string;
  model_id: string;
  model_revision: string;
  dimension: number;
  usage_profile_version: string;
  serialization_version: string;
  status: 'building' | 'active' | 'failed' | 'superseded';
  created_at: string;
  activated_at: string | null;
  content_count: number;
}

export interface GraphNeighborhood {
  nodes: Entity[];
  edges: Relationship[];
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

export interface FailedTaskRow {
  task_id: string;
  batch_id: string;
  task_type: 'chat_import' | 'chunk_extract' | 'conflict_resolution' | 'other';
  conversation_title: string | null;
  session_id: string | null;
  turn_id: string | null;
  stage: string | null;
  error: string;
  payload_snapshot: string | null;
  attempts: number;
  status: 'pending' | 'retrying' | 'resolved' | 'permanent_failure';
  created_at: string;
  updated_at: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'unified_graph_schema_v2',
    up: `
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        source_file TEXT,
        tags TEXT,
        embedding BLOB,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_activated TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, type)
      );

      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 2,
    name: 'add_performance_indexes_v2',
    up: `
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at);
      CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);
      CREATE INDEX IF NOT EXISTS idx_relationships_weight ON relationships(weight);
    `,
  },
  {
    version: 3,
    name: 'add_memory_tables',
    up: `
      -- CoreMemory 表：Letta 范式的核心内存（热记忆）
      CREATE TABLE IF NOT EXISTS core_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      -- ArchivalMemory 表：Letta 范式的归档内存（长期存储）
      CREATE TABLE IF NOT EXISTS archival_memory (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        embedding BLOB,
        importance REAL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 核心内存索引
      CREATE INDEX IF NOT EXISTS idx_core_memory_category ON core_memory(category);
      CREATE INDEX IF NOT EXISTS idx_core_memory_access ON core_memory(access_count DESC);

      -- 归档内存索引
      CREATE INDEX IF NOT EXISTS idx_archival_memory_tags ON archival_memory(tags);
      CREATE INDEX IF NOT EXISTS idx_archival_memory_importance ON archival_memory(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_archival_memory_archived ON archival_memory(archived_at);

      -- 实体表补充索引：加速 last_accessed 排序（记忆衰减查询用）
      CREATE INDEX IF NOT EXISTS idx_entities_last_accessed ON entities(last_accessed);
      CREATE INDEX IF NOT EXISTS idx_entities_access_count ON entities(access_count DESC);
    `,
  },
  {
    version: 4,
    name: 'add_vec0_virtual_table',
    requiresVec: true,
    up: `
      -- sqlite-vec 向量搜索虚拟表
      -- 注意：此表通过 sqlite-vec 扩展创建，需要先加载扩展
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(
        entity_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `,
  },
  {
    version: 5,
    name: 'add_fts5_fulltext_search',
    up: `
      -- FTS5 全文检索虚拟表
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_entities USING fts5(
        entity_id UNINDEXED,
        name,
        description,
        tags,
        tokenize = 'unicode61'
      );
    `,
  },
  {
    version: 6,
    name: 'add_notifications_table',
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        related_entities TEXT,
        read_status BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_status);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    `,
  },
  {
    version: 7,
    name: 'add_core_memory_summary',
    up: `
      ALTER TABLE core_memory ADD COLUMN summary TEXT;
    `,
  },
  {
    version: 8,
    name: 'add_temporal_graph_fields',
    up: `
      ALTER TABLE relationships ADD COLUMN valid_from TEXT;
      ALTER TABLE relationships ADD COLUMN valid_until TEXT;
      ALTER TABLE relationships ADD COLUMN invalidated_at TEXT;
      UPDATE relationships SET valid_from = created_at WHERE valid_from IS NULL;
      CREATE INDEX IF NOT EXISTS idx_relationships_valid_until ON relationships(valid_until);
    `,
  },
  {
    version: 9,
    name: 'add_invalidation_reason_to_relationships',
    up: `
      ALTER TABLE relationships ADD COLUMN invalidation_reason TEXT;
    `,
  },
  {
    version: 10,
    name: 'add_app_meta',
    up: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
  {
    version: 11,
    name: 'add_discussions_table',
    up: `
      CREATE TABLE IF NOT EXISTS discussions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        turns TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_discussions_updated ON discussions(updated_at DESC);
    `,
  },
  {
    version: 12,
    name: 'add_mcp_usage_log',
    up: `
      CREATE TABLE IF NOT EXISTS mcp_usage_log (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        client TEXT,
        query TEXT,
        matched_entities TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_created ON mcp_usage_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_tool ON mcp_usage_log(tool_name);
    `,
  },
  {
    version: 13,
    name: 'add_scoped_device_tokens',
    up: `
      CREATE TABLE IF NOT EXISTS device_tokens (
        token_hash TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_type TEXT NOT NULL,
        scopes TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_expires ON device_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_revoked ON device_tokens(revoked_at);
    `,
  },
  {
    version: 14,
    name: 'enforce_domain_type_constraints',
    up: `
      CREATE TRIGGER IF NOT EXISTS validate_entity_type_insert
      BEFORE INSERT ON entities
      WHEN NEW.type NOT IN (${sqlStringList(ENTITY_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid entity type'); END;

      CREATE TRIGGER IF NOT EXISTS validate_entity_type_update
      BEFORE UPDATE OF type ON entities
      WHEN NEW.type NOT IN (${sqlStringList(ENTITY_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid entity type'); END;

      CREATE TRIGGER IF NOT EXISTS validate_relationship_type_insert
      BEFORE INSERT ON relationships
      WHEN NEW.type NOT IN (${sqlStringList(RELATIONSHIP_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid relationship type'); END;

      CREATE TRIGGER IF NOT EXISTS validate_relationship_type_update
      BEFORE UPDATE OF type ON relationships
      WHEN NEW.type NOT IN (${sqlStringList(RELATIONSHIP_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid relationship type'); END;

      CREATE TRIGGER IF NOT EXISTS validate_notification_type_insert
      BEFORE INSERT ON notifications
      WHEN NEW.type NOT IN (${sqlStringList(NOTIFICATION_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid notification type'); END;

      CREATE TRIGGER IF NOT EXISTS validate_notification_type_update
      BEFORE UPDATE OF type ON notifications
      WHEN NEW.type NOT IN (${sqlStringList(NOTIFICATION_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid notification type'); END;
    `,
  },
  {
    version: 15,
    name: 'add_temporal_assertions',
    up: `
      ALTER TABLE entities ADD COLUMN observed_at TEXT;
      ALTER TABLE entities ADD COLUMN recorded_at TEXT;
      ALTER TABLE entities ADD COLUMN event_time TEXT;
      ALTER TABLE entities ADD COLUMN valid_from TEXT;
      ALTER TABLE entities ADD COLUMN valid_until TEXT;
      ALTER TABLE entities ADD COLUMN temporal_confidence REAL;
      ALTER TABLE entities ADD COLUMN temporal_source TEXT;
      ALTER TABLE entities ADD COLUMN timezone TEXT;

      UPDATE entities
      SET recorded_at = COALESCE(recorded_at, created_at),
          valid_from = COALESCE(valid_from, created_at);

      CREATE TABLE IF NOT EXISTS assertions (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_id TEXT,
        literal_value TEXT,
        confidence REAL NOT NULL DEFAULT 1.0 CHECK(confidence >= 0 AND confidence <= 1),
        source_span TEXT,
        provenance TEXT,
        observed_at TEXT,
        recorded_at TEXT NOT NULL,
        event_time TEXT,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        temporal_confidence REAL CHECK(temporal_confidence IS NULL OR (temporal_confidence >= 0 AND temporal_confidence <= 1)),
        temporal_source TEXT,
        timezone TEXT,
        invalidated_at TEXT,
        invalidation_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((object_id IS NOT NULL) != (literal_value IS NOT NULL)),
        FOREIGN KEY(subject_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY(object_id) REFERENCES entities(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_assertions_subject_predicate ON assertions(subject_id, predicate);
      CREATE INDEX IF NOT EXISTS idx_assertions_object ON assertions(object_id);
      CREATE INDEX IF NOT EXISTS idx_assertions_validity ON assertions(valid_from, valid_until);
      CREATE INDEX IF NOT EXISTS idx_assertions_recorded ON assertions(recorded_at);

      INSERT OR IGNORE INTO assertions (
        id, subject_id, predicate, object_id, confidence, source_span, provenance,
        recorded_at, valid_from, valid_until, invalidated_at, invalidation_reason,
        created_at, updated_at
      )
      SELECT
        'relationship:' || id, source_id, type, target_id,
        CASE WHEN weight < 0 THEN 0 WHEN weight > 1 THEN 1 ELSE weight END,
        description,
        '{"migration":"relationships_v15","relationship_id":"' || replace(id, '"', '') || '"}',
        created_at, COALESCE(valid_from, created_at), valid_until, invalidated_at,
        invalidation_reason, created_at, COALESCE(last_activated, created_at)
      FROM relationships;
    `,
  },
  {
    version: 16,
    name: 'add_ingestion_documents_and_chunks',
    up: `
      CREATE TABLE IF NOT EXISTS ingestion_documents (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT,
        content_sha256 TEXT NOT NULL,
        character_count INTEGER NOT NULL CHECK(character_count >= 0),
        total_chunks INTEGER NOT NULL DEFAULT 0 CHECK(total_chunks >= 0),
        processed_chunks INTEGER NOT NULL DEFAULT 0 CHECK(processed_chunks >= 0),
        failed_chunks INTEGER NOT NULL DEFAULT 0 CHECK(failed_chunks >= 0),
        coverage REAL NOT NULL DEFAULT 0 CHECK(coverage >= 0 AND coverage <= 1),
        status TEXT NOT NULL CHECK(status IN ('processing', 'partial', 'success', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_documents_status
        ON ingestion_documents(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ingestion_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        source_span TEXT NOT NULL,
        start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
        end_offset INTEGER NOT NULL CHECK(end_offset > start_offset),
        source_timestamp TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'success', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        error TEXT,
        extracted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES ingestion_documents(id) ON DELETE CASCADE,
        UNIQUE(document_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_chunks_retry
        ON ingestion_chunks(document_id, status, ordinal);
    `,
  },
  {
    version: 17,
    name: 'add_entity_resolution_review_queue',
    up: `
      CREATE INDEX IF NOT EXISTS idx_entities_type_normalized_name
        ON entities(type, lower(trim(name)));

      CREATE TABLE IF NOT EXISTS entity_merge_candidates (
        id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL,
        candidate_entity_id TEXT,
        candidate_name TEXT NOT NULL,
        candidate_type TEXT NOT NULL,
        similarity REAL CHECK(similarity IS NULL OR (similarity >= -1 AND similarity <= 1)),
        reason TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'confirmed', 'rejected', 'reverted')),
        operator TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY(canonical_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY(candidate_entity_id) REFERENCES entities(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entity_merge_candidates_status
        ON entity_merge_candidates(status, candidate_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS entity_merge_audit (
        id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL,
        alias_id TEXT NOT NULL,
        merge_reason TEXT NOT NULL,
        similarity REAL,
        operator TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reverted_at TEXT,
        FOREIGN KEY(canonical_id) REFERENCES entities(id) ON DELETE RESTRICT,
        FOREIGN KEY(alias_id) REFERENCES entities(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_entity_merge_audit_alias
        ON entity_merge_audit(alias_id, created_at DESC);
    `,
  },
  {
    version: 18,
    name: 'add_assertion_conflict_audit',
    up: `
      CREATE TABLE relationships_v18 (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_activated TEXT NOT NULL DEFAULT (datetime('now')),
        valid_from TEXT,
        valid_until TEXT,
        invalidated_at TEXT,
        invalidation_reason TEXT,
        FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
      );
      INSERT INTO relationships_v18
      SELECT id, source_id, target_id, type, description, weight, created_at,
             last_activated, valid_from, valid_until, invalidated_at, invalidation_reason
      FROM relationships;
      DROP TABLE relationships;
      ALTER TABLE relationships_v18 RENAME TO relationships;
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);
      CREATE INDEX IF NOT EXISTS idx_relationships_weight ON relationships(weight);
      CREATE INDEX IF NOT EXISTS idx_relationships_valid_until ON relationships(valid_until);
      CREATE TRIGGER validate_relationship_type_insert
      BEFORE INSERT ON relationships
      WHEN NEW.type NOT IN (${sqlStringList(RELATIONSHIP_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid relationship type'); END;
      CREATE TRIGGER validate_relationship_type_update
      BEFORE UPDATE OF type ON relationships
      WHEN NEW.type NOT IN (${sqlStringList(RELATIONSHIP_TYPES)})
      BEGIN SELECT RAISE(ABORT, 'invalid relationship type'); END;

      CREATE TABLE IF NOT EXISTS assertion_conflict_audit (
        id TEXT PRIMARY KEY,
        new_assertion_id TEXT NOT NULL,
        old_assertion_id TEXT,
        operation TEXT NOT NULL CHECK(operation IN ('supersede', 'conflict', 'independent', 'review')),
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        reason TEXT NOT NULL,
        evidence TEXT NOT NULL,
        model_output TEXT,
        status TEXT NOT NULL CHECK(status IN ('applied', 'pending', 'confirmed', 'rejected', 'reverted')),
        operator TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reverted_at TEXT,
        FOREIGN KEY(new_assertion_id) REFERENCES assertions(id) ON DELETE RESTRICT,
        FOREIGN KEY(old_assertion_id) REFERENCES assertions(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_assertion_conflict_audit_status
        ON assertion_conflict_audit(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assertion_conflict_audit_assertions
        ON assertion_conflict_audit(new_assertion_id, old_assertion_id);
    `,
  },
  {
    version: 19,
    name: 'add_incremental_relationship_decay',
    up: `
      ALTER TABLE relationships ADD COLUMN base_weight REAL;
      ALTER TABLE relationships ADD COLUMN last_decay_at TEXT;
      ALTER TABLE relationships ADD COLUMN last_reinforced_at TEXT;
      ALTER TABLE relationships ADD COLUMN reinforcement_reason TEXT;
      ALTER TABLE relationships ADD COLUMN decay_version INTEGER NOT NULL DEFAULT 1;
      UPDATE relationships
      SET base_weight = COALESCE(base_weight, weight),
          last_decay_at = COALESCE(last_decay_at, last_activated, created_at),
          decay_version = 1;
      CREATE INDEX IF NOT EXISTS idx_relationships_decay_due
        ON relationships(last_decay_at, weight);
    `,
  },
  {
    version: 20,
    name: 'add_behavior_events_and_proactive_insights',
    up: `
      CREATE TABLE IF NOT EXISTS behavior_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'captured','viewed','searched','retrieved','cited','edited','decided',
          'task_created','task_completed','alert_shown','alert_clicked',
          'alert_dismissed','alert_rejected'
        )),
        entity_id TEXT,
        notification_id TEXT,
        topic TEXT,
        intent TEXT CHECK(intent IS NULL OR intent IN ('action','informational','deferred','none','unknown')),
        metadata TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE SET NULL,
        FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_behavior_events_entity_time
        ON behavior_events(entity_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_behavior_events_type_time
        ON behavior_events(event_type, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_behavior_events_topic_time
        ON behavior_events(topic, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS proactive_insights (
        id TEXT PRIMARY KEY,
        notification_id TEXT,
        insight_type TEXT NOT NULL,
        trigger TEXT NOT NULL,
        evidence_ids TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        reason TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        cooldown_until TEXT,
        feedback TEXT CHECK(feedback IS NULL OR feedback IN (
          'useful','not_useful','incorrect','remind_later','stop_this_type'
        )),
        feedback_at TEXT,
        FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proactive_insights_cooldown
        ON proactive_insights(insight_type, cooldown_until);
    `,
  },
  {
    version: 21,
    name: 'add_assertion_literal_type_versioning_fts',
    up: `
      ALTER TABLE assertions ADD COLUMN literal_type TEXT
        CHECK(literal_type IS NULL OR literal_type IN (
          'string','number','date','datetime','boolean','currency',
          'location_text','status','quantity','contact','conclusion'
        ));
      ALTER TABLE assertions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE assertions ADD COLUMN previous_version_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_assertions_version
        ON assertions(subject_id, predicate, version DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS fts_assertions USING fts5(
        assertion_id UNINDEXED,
        subject_id UNINDEXED,
        predicate,
        literal_value,
        source_span,
        tokenize = 'unicode61'
      );

      INSERT INTO fts_assertions (assertion_id, subject_id, predicate, literal_value, source_span)
      SELECT id, subject_id, predicate,
             COALESCE(literal_value, ''),
             COALESCE(source_span, '')
      FROM assertions
      WHERE invalidated_at IS NULL;
    `,
  },
  {
    version: 22,
    name: 'extend_entity_merge_audit_with_redirect_summary',
    up: `
      -- Task 11: Track confirm/revert timestamps separately on the candidate row.
      -- reviewed_at was overloaded for both reject and confirm; reverted_at was missing.
      ALTER TABLE entity_merge_candidates ADD COLUMN confirmed_at TEXT;
      ALTER TABLE entity_merge_candidates ADD COLUMN reverted_at TEXT;

      -- Task 11: Audit row must record what was redirected so revert/review
      -- has a paper trail. Without these, confirmMerge was a metadata flag flip
      -- with no observable effect on the graph.
      ALTER TABLE entity_merge_audit ADD COLUMN redirected_relationships INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE entity_merge_audit ADD COLUMN redirected_assertions INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE entity_merge_audit ADD COLUMN redirected_fts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE entity_merge_audit ADD COLUMN redirected_vec INTEGER NOT NULL DEFAULT 0;

      -- Allow looking up audit history by canonical entity (previously only by alias).
      CREATE INDEX IF NOT EXISTS idx_entity_merge_audit_canonical
        ON entity_merge_audit(canonical_id, created_at DESC);
    `,
  },
  {
    version: 23,
    name: 'add_failed_tasks_and_ingestion_provenance',
    up: `
      -- Task 5: Persist import (and other pipeline) failures so they survive
      -- the 5-minute jobStore TTL and can be retried. Mirrors the shape of
      -- JobState.result.failed_conversations / conflict_failures but persisted.
      CREATE TABLE IF NOT EXISTS failed_tasks (
        task_id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK(task_type IN (
          'chat_import', 'chunk_extract', 'conflict_resolution', 'other'
        )),
        conversation_title TEXT,
        session_id TEXT,
        turn_id TEXT,
        stage TEXT,
        error TEXT NOT NULL,
        payload_snapshot TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending', 'retrying', 'resolved', 'permanent_failure'
        )),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_failed_tasks_batch
        ON failed_tasks(batch_id, status);
      CREATE INDEX IF NOT EXISTS idx_failed_tasks_status
        ON failed_tasks(status, created_at DESC);

      -- Task 5: Forward-compatible provenance columns for ingestion tables.
      -- Chat imports don't currently route through these tables, but adding
      -- the columns now means a future refactor can persist per-turn
      -- provenance without another schema bump. All nullable so existing
      -- file-ingestion rows are unaffected.
      ALTER TABLE ingestion_documents ADD COLUMN session_id TEXT;
      ALTER TABLE ingestion_documents ADD COLUMN idempotency_key TEXT;
      ALTER TABLE ingestion_chunks ADD COLUMN session_id TEXT;
      ALTER TABLE ingestion_chunks ADD COLUMN turn_id TEXT;
      ALTER TABLE ingestion_chunks ADD COLUMN role TEXT;
      ALTER TABLE ingestion_chunks ADD COLUMN idempotency_key TEXT;
    `,
  },
  {
    version: 24,
    name: 'add_embedding_index_manifests',
    up: `
      CREATE TABLE IF NOT EXISTS embedding_index_manifests (
        index_name TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        model_revision TEXT NOT NULL,
        dimension INTEGER NOT NULL CHECK(dimension > 0),
        usage_profile_version TEXT NOT NULL,
        serialization_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('building','active','failed','superseded')),
        created_at TEXT NOT NULL,
        activated_at TEXT,
        content_count INTEGER NOT NULL DEFAULT 0 CHECK(content_count >= 0)
      );
      CREATE TABLE IF NOT EXISTS embedding_index_manifest_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_name TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        archived_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entity_embedding_metadata (
        entity_id TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL,
        model_revision TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        usage_profile_version TEXT NOT NULL,
        serialization_version TEXT NOT NULL,
        embedded_at TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS assertion_embedding_metadata (
        assertion_id TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL,
        model_revision TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        usage_profile_version TEXT NOT NULL,
        serialization_version TEXT NOT NULL,
        embedded_at TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        invalidated_at TEXT,
        FOREIGN KEY(assertion_id) REFERENCES assertions(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 25,
    name: 'add_assertion_original_predicate',
    up: `
      ALTER TABLE assertions ADD COLUMN original_predicate TEXT;
      UPDATE assertions SET original_predicate = predicate WHERE original_predicate IS NULL;
    `,
  },
  {
    version: 26,
    name: 'add_vec_assertions_1024',
    requiresVec: true,
    up: `
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_assertions USING vec0(
        assertion_id TEXT PRIMARY KEY,
        embedding FLOAT[1024]
      );
    `,
  },
  {
    version: 27,
    name: 'invalidate_stale_embedding_rows',
    requiresVec: true,
    up: `
      CREATE TRIGGER IF NOT EXISTS invalidate_assertion_vector_after_update
      AFTER UPDATE OF subject_id, predicate, original_predicate, object_id, literal_value,
        source_span, provenance, observed_at, event_time, valid_from, valid_until,
        invalidated_at, invalidation_reason ON assertions
      BEGIN
        DELETE FROM vec_assertions WHERE assertion_id = NEW.id;
        DELETE FROM assertion_embedding_metadata WHERE assertion_id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS invalidate_assertions_after_entity_text_update
      AFTER UPDATE OF name, description, metadata ON entities
      BEGIN
        DELETE FROM vec_assertions
          WHERE assertion_id IN (
            SELECT id FROM assertions WHERE subject_id = NEW.id OR object_id = NEW.id
          );
        DELETE FROM assertion_embedding_metadata
          WHERE assertion_id IN (
            SELECT id FROM assertions WHERE subject_id = NEW.id OR object_id = NEW.id
          );
      END;
    `,
  },
  {
    version: 28,
    name: 'add_embedding_metadata_normalized_flag',
    up: `
      -- Phase 3 (embedding v3 migration): every embedding row records whether
      -- the vector is L2-normalized. v3 profile normalizes (true); legacy
      -- fallback-hash rows may not. Default keeps existing rows as normalized=1
      -- (the E5 pipeline always normalized); the re-embed tool rewrites rows
      -- with the real flag from the active usage profile.
      ALTER TABLE entity_embedding_metadata ADD COLUMN normalized INTEGER NOT NULL DEFAULT 1
        CHECK(normalized IN (0, 1));
      ALTER TABLE assertion_embedding_metadata ADD COLUMN normalized INTEGER NOT NULL DEFAULT 1
        CHECK(normalized IN (0, 1));
    `,
  },
  {
    version: 29,
    name: 'add_control_approval_audit',
    up: `
      CREATE TABLE IF NOT EXISTS control_approval_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_timestamp TEXT NOT NULL,
        session_reference TEXT NOT NULL,
        actor_id_or_scope TEXT NOT NULL,
        scope TEXT NOT NULL,
        plan_id TEXT,
        decision_id TEXT,
        action TEXT NOT NULL CHECK(action = 'approve'),
        result TEXT NOT NULL CHECK(result IN ('approved', 'rejected', 'failed')),
        failure_reason TEXT,
        transport_context TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_control_approval_audit_plan
        ON control_approval_audit(plan_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_control_approval_audit_timestamp
        ON control_approval_audit(request_timestamp DESC, id DESC);
    `,
  },
  {
    version: 30,
    name: 'add_decision_revision_lifecycle',
    up: `
      -- Goal27: an immutable, forward-only revision chain.  A revision row
      -- stores a complete serialised context and its indexes make cycles,
      -- duplicate indices, forks and duplicate idempotency impossible at the
      -- storage boundary as well as in the service layer.
      CREATE TABLE IF NOT EXISTS decision_revisions (
        revision_id TEXT PRIMARY KEY,
        root_decision_id TEXT NOT NULL,
        parent_decision_id TEXT NOT NULL,
        revision_index INTEGER NOT NULL CHECK(revision_index > 0),
        status TEXT NOT NULL CHECK(status IN ('OPEN', 'DECIDED', 'ABANDONED')),
        idempotency_digest TEXT NOT NULL,
        new_decision_id TEXT,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_revisions_root_index
        ON decision_revisions(root_decision_id, revision_index);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_revisions_parent
        ON decision_revisions(parent_decision_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_revisions_idempotency
        ON decision_revisions(idempotency_digest);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_revisions_new_decision
        ON decision_revisions(new_decision_id) WHERE new_decision_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_revisions_one_open_root
        ON decision_revisions(root_decision_id) WHERE status = 'OPEN';

      CREATE TABLE IF NOT EXISTS decision_revision_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'REOPEN_REQUESTED', 'REOPEN_AUTHORIZED', 'REVISION_CREATED',
          'EVIDENCE_REQUALIFIED', 'REVISION_DECIDED', 'REVISION_ABANDONED'
        )),
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(revision_id) REFERENCES decision_revisions(revision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_decision_revision_events_revision
        ON decision_revision_events(revision_id, id ASC);

      -- Historical judgment records and their audit log are append-only.
      CREATE TRIGGER IF NOT EXISTS prevent_decision_revision_update
      BEFORE UPDATE ON decision_revisions
      BEGIN
        SELECT RAISE(ABORT, 'decision revisions are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS prevent_decision_revision_delete
      BEFORE DELETE ON decision_revisions
      BEGIN
        SELECT RAISE(ABORT, 'decision revisions are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS prevent_decision_revision_event_update
      BEFORE UPDATE ON decision_revision_events
      BEGIN
        SELECT RAISE(ABORT, 'decision revision events are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS prevent_decision_revision_event_delete
      BEFORE DELETE ON decision_revision_events
      BEGIN
        SELECT RAISE(ABORT, 'decision revision events are append-only');
      END;
    `,
  },
];

interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
  // 该迁移依赖 sqlite-vec 扩展（vec0 虚拟表）。扩展未加载时跳过，
  // 且不记入 migrations 表，下次扩展可用时会重试。
  requiresVec?: boolean;
}

export class Database {
  private db: sqlite3.Database;
  private dbPath: string;
  private vecEnabled: boolean = false;
  // sqlite3 serializes individual statements, but it does not keep statement
  // groups from different async callers inside a single transaction. Queue
  // transaction scopes so concurrent ingestion/background work cannot issue a
  // second BEGIN on the same connection or commit another caller's work.
  private transactionTail: Promise<void> = Promise.resolve();
  // vec_entities 当前维度。migration v4 建表时为 384，但实际维度可能因
  // embedding 模型不同而变（如 OpenAI 1536、bge 768/1024）。首次同步时
  // 从 sqlite_master 读取真实维度，写入维度不符则按需重建表。
  private vecDimension: number = 384;
  private vecDimensionResolved: boolean = false;
  private assertionVecDimension: number = 1024;
  private assertionVecDimensionResolved: boolean = false;
  private embeddingService: EmbeddingService | null = null;

  constructor(db: sqlite3.Database, dbPath: string, vecEnabled: boolean = false) {
    this.db = db;
    this.dbPath = dbPath;
    this.vecEnabled = vecEnabled;
  }

  run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getRaw(): sqlite3.Database {
    return this.db;
  }

  isInMemory(): boolean {
    return this.dbPath === ':memory:';
  }

  async runMigrations(): Promise<void> {
    // 确保 migrations 表存在（v1 migration 会创建它，但首次运行时需要先检查）
    await this.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    for (const migration of MIGRATIONS) {
      const applied = await this.get<MigrationRecord>(
        'SELECT * FROM migrations WHERE name = ?',
        [migration.name]
      );

      if (!applied) {
        // 依赖 sqlite-vec 的迁移在扩展缺失时跳过，且不记录——
        // 否则 vec0 建表会抛 "no such module: vec0"，中断后续所有迁移
        // （notifications、temporal 字段等都建不出来）。不记录可在
        // 下次扩展可用时自动重试。
        if (migration.requiresVec && !this.vecEnabled) {
          console.warn(`Migration skipped (sqlite-vec unavailable): ${migration.name}`);
          continue;
        }
        try {
          await this.exec('BEGIN IMMEDIATE;');
          await this.exec(migration.up);
          await this.run(
            'INSERT INTO migrations (name) VALUES (?)',
            [migration.name]
          );
          await this.exec('COMMIT;');
          console.log(`Migration applied: ${migration.name}`);
        } catch (error) {
          try {
            await this.exec('ROLLBACK;');
          } catch (rollbackError) {
            console.error(`Migration rollback failed: ${migration.name}`, rollbackError);
          }
          console.error(`Migration failed: ${migration.name}`, error);
          throw error;
        }
      }
    }
  }

  async addEntity(entity: Omit<Entity, 'id' | 'created_at' | 'updated_at' | 'last_accessed' | 'access_count'> & {
    id?: string;
    access_count?: number;
  }): Promise<Entity> {
    const id = entity.id || uuidv4();
    const now = new Date().toISOString();
    const tagsStr = entity.tags ? JSON.stringify(entity.tags) : null;
    const metadataStr = entity.metadata ? JSON.stringify(entity.metadata) : null;
    const embeddingBlob = entity.embedding ? encodeEmbedding(entity.embedding) : null;
    const isMergedAlias = typeof entity.metadata?.merged_into === 'string'
      && entity.metadata.merged_into.length > 0;

    await this.run(
      `INSERT INTO entities (
        id, name, type, description, source_file, tags, embedding, metadata,
        created_at, updated_at, last_accessed, access_count, observed_at, recorded_at,
        event_time, valid_from, valid_until, temporal_confidence, temporal_source, timezone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entity.name, entity.type, entity.description || null, entity.source_file || null,
       tagsStr, embeddingBlob, metadataStr, now, now, now, entity.access_count || 0,
       entity.observed_at || null, entity.recorded_at || now, entity.event_time || null,
       entity.valid_from || entity.event_time || entity.observed_at || now, entity.valid_until || null,
       entity.temporal_confidence ?? null, entity.temporal_source || null, entity.timezone || null]
    );

    const persisted: Entity = {
      id,
      name: entity.name,
      type: entity.type,
      description: entity.description || '',
      created_at: now,
      updated_at: now,
      source_file: entity.source_file,
      tags: entity.tags,
      embedding: entity.embedding,
      metadata: entity.metadata,
      last_accessed: now,
      access_count: entity.access_count || 0,
      observed_at: entity.observed_at,
      recorded_at: entity.recorded_at || now,
      event_time: entity.event_time,
      valid_from: entity.valid_from || entity.event_time || entity.observed_at || now,
      valid_until: entity.valid_until,
      temporal_confidence: entity.temporal_confidence,
      temporal_source: entity.temporal_source,
      timezone: entity.timezone,
    };

    if (entity.embedding && !isMergedAlias) {
      const passage = serializeEntityPassage(persisted);
      await this._syncVecEmbedding(id, entity.embedding, this.contentSha256(passage));
    }

    // 同步到 FTS5 全文检索
    if (!isMergedAlias) {
      await this._syncFtsEntity(id, entity.name, entity.description || '', entity.tags);
    }

    return persisted;
  }

  async getEntity(id: string): Promise<Entity | null> {
    let currentId = id;
    const seenIds = new Set<string>();
    let row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
    
    while (row) {
      if (seenIds.has(currentId)) break;
      seenIds.add(currentId);
      
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        currentId = meta.merged_into;
        row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
      } else {
        break;
      }
    }
    
    if (!row) return null;
    // 命中后再 +1 访问计数，未命中不浪费一次写入
    await this._updateEntityAccess(row.id);
    return this.rowToEntity(row);
  }

  // 用于不需要计入访问统计 of 内部读取（如图谱上下文聚合、Agent 巡视）
  async peekEntity(id: string): Promise<Entity | null> {
    let currentId = id;
    const seenIds = new Set<string>();
    let row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
    
    while (row) {
      if (seenIds.has(currentId)) break;
      seenIds.add(currentId);
      
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        currentId = meta.merged_into;
        row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
      } else {
        break;
      }
    }
    
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE type = ? AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC`,
      [type]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getRecentEntities(limit: number = 100): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC LIMIT ?`,
      [Math.max(1, Math.min(limit, 20000))]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getEntityCount(): Promise<number> {
    const row = await this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL`
    );
    return row?.count ?? 0;
  }

  async getCorePrinciples(): Promise<Entity[]> {
    const rows = await this.all<any>(`
      SELECT * FROM entities
      WHERE type = 'principle'
      AND json_extract(metadata, '$.isCore') = 1
      AND json_extract(metadata, '$.merged_into') IS NULL
      ORDER BY updated_at DESC
    `);
    return rows.map(row => this.rowToEntity(row));
  }

  async searchEntities(query: string, limit: number = 10, type?: string): Promise<Entity[]> {
    // 优先使用 FTS5 全文检索（用户输入需转义，否则特殊字符会触发语法错或意外布尔逻辑）
    const ftsQuery = this._toFtsQuery(query);
    if (ftsQuery) {
      try {
        const typeClause = type ? ' AND e.type = ?' : '';
        const params: any[] = type ? [ftsQuery, type, limit] : [ftsQuery, limit];
        const rows = await this.all<any>(
          `SELECT e.* FROM fts_entities f
           INNER JOIN entities e ON e.id = f.entity_id
           WHERE fts_entities MATCH ? AND json_extract(e.metadata, '$.merged_into') IS NULL${typeClause}
           ORDER BY rank
           LIMIT ?`,
          params
        );
        if (rows.length > 0) {
          return rows.map(row => this.rowToEntity(row));
        }
      } catch (e) {
        // FTS5 不可用时回退到 LIKE
      }
    }

    // 回退：LIKE 通配符搜索
    const searchTerm = `%${query}%`;
    const typeClause = type ? ' AND type = ?' : '';
    const params: any[] = type
      ? [searchTerm, searchTerm, type, limit]
      : [searchTerm, searchTerm, limit];
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE (name LIKE ? OR description LIKE ?) AND json_extract(metadata, '$.merged_into') IS NULL${typeClause}
       ORDER BY updated_at DESC LIMIT ?`,
      params
    );
    return rows.map(row => this.rowToEntity(row));
  }

  /**
   * List entities of one type, newest first (deterministic). Used by the
   * read-only decision history endpoint (GET /api/decisions). The limit is
   * bounded by the caller; no offset/pagination surface exists.
   */
  async listEntitiesByType(type: string, limit: number): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE type = ? AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC, id ASC LIMIT ?`,
      [type, limit]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  /**
   * 把任意用户输入转成 FTS5 安全查询：按空白拆词，每个词作为带引号的 phrase
   * （内部 " 翻倍转义），词间隐式 AND。这样 - ( ) * 和 AND/OR/NOT 等 FTS5
   * 操作符都被当字面量，不会触发语法错误或意外布尔逻辑。空输入返回空串。
   */
  private _toFtsQuery(query: string): string {
    const tokens = query.split(/\s+/).map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return '';
    return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
  }

  async reindexEntities(): Promise<void> {
    try { await this.run('DELETE FROM vec_entities'); } catch { /* 可选 */ }
    try { await this.run('DELETE FROM fts_entities'); } catch { /* 可选 */ }
    const rows = await this.all<any>('SELECT id, name, description, tags, embedding FROM entities');
    for (const row of rows) {
      if (row.embedding) {
        try { await this._syncVecEmbedding(row.id, decodeEmbedding(row.embedding)); } catch { /* 可选 */ }
      }
      try {
        const tags = row.tags ? JSON.parse(row.tags) : undefined;
        await this._syncFtsEntity(row.id, row.name, row.description || '', tags);
      } catch { /* 可选 */ }
    }
  }

  async getMeta(key: string): Promise<string | null> {
    try {
      const rows = await this.all<any>('SELECT value FROM app_meta WHERE key = ?', [key]);
      return rows[0]?.value ?? null;
    } catch { return null; }
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.run(
      'INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // 时间词召回：按 created_at（或 last_accessed）落在 [start, end) 的实体，新到旧。
  async getEntitiesByTimeWindow(
    startIso: string,
    endIso: string,
    limit: number,
    field: 'created_at' | 'last_accessed' = 'created_at',
  ): Promise<any[]> {
    const effectiveTimeExpr = `COALESCE(event_time, valid_from, observed_at, recorded_at, created_at)`;
    const col = field === 'last_accessed' ? 'last_accessed'
      : field === 'created_at' ? 'created_at'
      : effectiveTimeExpr;
    const rows = await this.all<any>(
      `SELECT id, name, type, description, tags, created_at, last_accessed, access_count
       FROM entities
       WHERE ${col} >= ? AND ${col} < ?
         AND (valid_until IS NULL OR valid_until > datetime('now'))
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY ${col} DESC LIMIT ?`,
      [startIso, endIso, limit],
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, type: r.type, description: r.description,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      created_at: r.created_at, last_accessed: r.last_accessed, access_count: r.access_count,
    }));
  }

  // 用新模型重算所有实体的向量（换 embedding 模型后必跑：旧向量与新模型不可比）。
  // 重算后回灌 vec / fts。逐条容错，单条失败不影响其余。
  async reembedAllEntities(embed: (text: string) => Promise<number[]>): Promise<number> {
    const rows = await this.all<any>('SELECT id, name, description FROM entities');
    let done = 0;
    for (const row of rows) {
      try {
        const vec = await embed(`${row.name}: ${row.description || ''}`);
        await this.run('UPDATE entities SET embedding = ? WHERE id = ?', [encodeEmbedding(vec), row.id]);
        done++;
      } catch { /* 单条失败跳过 */ }
    }
    try { await this.reindexEntities(); } catch { /* 可选 */ }
    return done;
  }

  // 管理/信任面：带 provenance 的实体列表（list_entities 抹了 metadata，这里专门给"看清谁写的"用）
  async listEntitiesForReview(opts: { limit?: number; offset?: number; source?: string; type?: string; q?: string; coreOnly?: boolean; unlinkedOnly?: boolean } = {}): Promise<{ items: any[]; total: number }> {
    const where: string[] = [`json_extract(metadata, '$.merged_into') IS NULL`];
    const params: any[] = [];
    if (opts.type) { where.push('type = ?'); params.push(opts.type); }
    if (opts.coreOnly) {
      where.push(`type = 'principle' AND json_extract(metadata, '$.isCore') IN (1, true)`);
    }
    if (opts.unlinkedOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM relationships r
        WHERE (r.source_id = entities.id OR r.target_id = entities.id)
          AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
      )`);
    }
    if (opts.source === '__user__') {
      where.push(`(json_extract(metadata, '$.provenance.source') IS NULL OR json_extract(metadata, '$.provenance.source') = 'user')`);
    } else if (opts.source) {
      where.push(`json_extract(metadata, '$.provenance.source') = ?`); params.push(opts.source);
    }
    if (opts.q) { where.push('(name LIKE ? OR description LIKE ?)'); const like = `%${opts.q}%`; params.push(like, like); }
    const whereSql = where.join(' AND ');
    const totalRow = await this.get<{ c: number }>(`SELECT COUNT(*) as c FROM entities WHERE ${whereSql}`, params);
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    const rows = await this.all<any>(
      `SELECT id, name, type, description, tags, metadata, created_at, last_accessed, access_count
       FROM entities WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const items = rows.map((r) => {
      let meta: any = {};
      try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* */ }
      const prov = meta.provenance || null;
      return {
        id: r.id, name: r.name, type: r.type,
        description: (r.description || '').slice(0, 180),
        tags: r.tags ? JSON.parse(r.tags) : [],
        created_at: r.created_at, last_accessed: r.last_accessed, access_count: r.access_count,
        isCore: meta.isCore === true || meta.isCore === 1,
        source: prov?.source || 'user',
        provenance: prov,
      };
    });
    return { items, total: totalRow?.c ?? items.length };
  }

  async getReviewTaskSummary(targetCoreCount = 30): Promise<{
    generatedAt: string;
    corePrinciples: {
      total: number;
      target: number;
      overLimit: number;
      lowSignal: number;
      keepSamples: any[];
      demoteSamples: any[];
    };
    unlinkedByType: Array<{ type: string; total: number; samples: any[] }>;
  }> {
    const target = Math.min(Math.max(Math.floor(Number(targetCoreCount) || 30), 5), 100);
    const coreWhere = `type = 'principle'
      AND json_extract(metadata, '$.isCore') IN (1, true)
      AND json_extract(metadata, '$.merged_into') IS NULL`;
    const coreRow = await this.get<{ c: number }>(`SELECT COUNT(*) as c FROM entities WHERE ${coreWhere}`);
    const lowSignalRow = await this.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM entities
       WHERE ${coreWhere}
         AND (COALESCE(access_count, 0) <= 1 OR last_accessed IS NULL)`,
    );
    const keepSamples = await this.listEntitiesForReview({ type: 'principle', coreOnly: true, limit: 5 });
    const demoteRows = await this.all<any>(
      `SELECT id, name, type, description, tags, metadata, created_at, last_accessed, access_count
       FROM entities
       WHERE ${coreWhere}
       ORDER BY COALESCE(access_count, 0) ASC,
         CASE WHEN last_accessed IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(last_accessed, created_at) ASC,
         created_at ASC
       LIMIT 5`,
    );
    const demoteSamples = demoteRows.map((r) => {
      let meta: any = {};
      try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* */ }
      const prov = meta.provenance || null;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        description: (r.description || '').slice(0, 180),
        tags: r.tags ? JSON.parse(r.tags) : [],
        created_at: r.created_at,
        last_accessed: r.last_accessed,
        access_count: r.access_count,
        isCore: meta.isCore === true || meta.isCore === 1,
        source: prov?.source || 'user',
        provenance: prov,
      };
    });

    const unlinkedRows = await this.all<{ type: string; c: number }>(
      `SELECT type, COUNT(*) AS c
       FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE (r.source_id = entities.id OR r.target_id = entities.id)
             AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
         )
       GROUP BY type
       HAVING c > 0
       ORDER BY c DESC
       LIMIT 8`,
    );
    const unlinkedByType = [];
    for (const row of unlinkedRows) {
      const samples = await this.listEntitiesForReview({ type: row.type, unlinkedOnly: true, limit: 5 });
      unlinkedByType.push({ type: row.type, total: row.c, samples: samples.items });
    }

    const totalCore = coreRow?.c ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      corePrinciples: {
        total: totalCore,
        target,
        overLimit: Math.max(totalCore - target, 0),
        lowSignal: lowSignalRow?.c ?? 0,
        keepSamples: keepSamples.items,
        demoteSamples,
      },
      unlinkedByType,
    };
  }

  async demoteExcessCorePrinciples(targetCoreCount = 30): Promise<{
    totalBefore: number;
    target: number;
    kept: number;
    demoted: number;
    items: Array<{ id: string; name: string; access_count: number }>;
  }> {
    const target = Math.min(Math.max(Math.floor(Number(targetCoreCount) || 30), 5), 100);
    const rows = await this.all<{ id: string; name: string; access_count: number }>(
      `SELECT id, name, COALESCE(access_count, 0) AS access_count
       FROM entities
       WHERE type = 'principle'
         AND json_extract(metadata, '$.isCore') IN (1, true)
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY COALESCE(access_count, 0) DESC,
         CASE WHEN last_accessed IS NULL THEN 0 ELSE 1 END DESC,
         COALESCE(last_accessed, created_at) DESC,
         LENGTH(COALESCE(description, '')) DESC,
         created_at ASC`,
    );
    if (rows.length <= target) {
      return { totalBefore: rows.length, target, kept: rows.length, demoted: 0, items: [] };
    }
    const demoteRows = rows.slice(target);
    await this.withTransaction(async () => {
      const now = new Date().toISOString();
      for (const row of demoteRows) {
        await this.run(
          `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.isCore', 0), updated_at = ? WHERE id = ?`,
          [now, row.id],
        );
      }
    });
    return {
      totalBefore: rows.length,
      target,
      kept: target,
      demoted: demoteRows.length,
      items: demoteRows.slice(0, 20),
    };
  }

  // 按 provenance.source 统计（管理面的过滤角标）
  async countEntitiesBySource(): Promise<Record<string, number>> {
    const rows = await this.all<any>(
      `SELECT COALESCE(json_extract(metadata, '$.provenance.source'), 'user') AS src, COUNT(*) AS c
       FROM entities WHERE json_extract(metadata, '$.merged_into') IS NULL GROUP BY src`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.src || 'user'] = r.c;
    return out;
  }

  // ── 整理 / curation 原语 ──

  // 设/撤核心原则（json_set 非破坏，只翻 isCore，保留其余 metadata）
  async setCorePrinciple(id: string, isCore: boolean): Promise<void> {
    await this.run(
      `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.isCore', ?), updated_at = ? WHERE id = ?`,
      [isCore ? 1 : 0, new Date().toISOString(), id],
    );
  }

  // 软合并：dropId 的关系指到 keepId，dropId 标记 merged_into=keepId（可逆，不硬删）
  async softMergeEntities(keepId: string, dropId: string): Promise<void> {
    if (!keepId || !dropId || keepId === dropId) return;
    await this.withTransaction(async () => {
      // 转挂关系：OR IGNORE 跳过会撞 UNIQUE(source_id,target_id,type) 的行（keepId 已有等价关系），
      // 否则唯一约束冲突会让整个合并事务 500 回滚、合并失败。
      await this.run('UPDATE OR IGNORE relationships SET source_id = ? WHERE source_id = ?', [keepId, dropId]);
      await this.run('UPDATE OR IGNORE relationships SET target_id = ? WHERE target_id = ?', [keepId, dropId]);
      // 清掉转挂副作用：keepId 自环（dropId 原本就与 keepId 相连）+ 因冲突被 IGNORE 仍残留在 dropId 上的重复关系
      await this.run('DELETE FROM relationships WHERE source_id = ? AND target_id = ?', [keepId, keepId]);
      await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [dropId, dropId]);
      await this.run(
        `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.merged_into', ?), updated_at = ? WHERE id = ?`,
        [keepId, new Date().toISOString(), dropId],
      );
    });
    try { await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [dropId]); } catch { /* */ }
    try { await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [dropId]); } catch { /* */ }
    this.bumpAccessCounts([keepId]).catch(() => {});
  }

  // 硬删除（含关系/索引清理）。仅供用户主动调用；睡眠巩固不用它。
  async hardDeleteEntity(id: string): Promise<void> {
    await this.withTransaction(async () => {
      await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
      await this.run('DELETE FROM entities WHERE id = ?', [id]);
    });
    try { await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]); } catch { /* */ }
    try { await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]); } catch { /* */ }
  }

  // 找完全同名同类型的重复组（未合并的）。每组按 keeper 优先排序（热度/描述长/最早）。
  async findExactDuplicateGroups(): Promise<Array<{ ids: string[]; name: string; type: string }>> {
    const rows = await this.all<any>(
      `SELECT id, name, type
       FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY type, LOWER(TRIM(name)), access_count DESC, LENGTH(COALESCE(description,'')) DESC, created_at ASC`,
    );
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const key = (r.type || '') + '|' + (r.name || '').trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const dup: Array<{ ids: string[]; name: string; type: string }> = [];
    for (const arr of groups.values()) {
      if (arr.length > 1) dup.push({ ids: arr.map((x) => x.id), name: arr[0].name, type: arr[0].type });
    }
    return dup;
  }

  async updateEntity(id: string, updates: Partial<Omit<Entity, 'id' | 'updated_at' | 'last_accessed'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      values.push(encodeEmbedding(updates.embedding));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.source_file !== undefined) {
      fields.push('source_file = ?');
      values.push(updates.source_file);
    }
    if (updates.created_at !== undefined) {
      fields.push('created_at = ?');
      values.push(updates.created_at);
    }
    if (updates.access_count !== undefined) {
      fields.push('access_count = ?');
      values.push(updates.access_count);
    }
    const temporalFields = [
      'observed_at', 'recorded_at', 'event_time', 'valid_from', 'valid_until',
      'temporal_confidence', 'temporal_source', 'timezone',
    ] as const;
    for (const field of temporalFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.run(
      `UPDATE entities SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    // 如果更新了 embedding，同步到 vec 表
    if (updates.embedding !== undefined) {
      await this._syncVecEmbedding(id, updates.embedding);
    }

    // 如果更新了文本字段，同步 FTS
    if (updates.name !== undefined || updates.description !== undefined || updates.tags !== undefined) {
      const current = await this.get<any>('SELECT name, description, tags FROM entities WHERE id = ?', [id]);
      if (current) {
        const tags = current.tags ? JSON.parse(current.tags) : undefined;
        await this._syncFtsEntity(id, current.name, current.description || '', tags);
      }
    }
    if (updates.name !== undefined || updates.description !== undefined || updates.metadata !== undefined) {
      if (this.embeddingService) {
        const current = await this.get<any>('SELECT * FROM entities WHERE id = ?', [id]);
        if (current) {
          const entity = this.rowToEntity(current);
          const passage = serializeEntityPassage(entity);
          const result = await this.embeddingService.embedPassage(passage);
          await this.run('UPDATE entities SET embedding = ? WHERE id = ?', [encodeEmbedding(result.embedding), id]);
          await this._syncVecEmbedding(id, result.embedding, this.contentSha256(passage));
          const affected = await this.all<{ id: string }>(
            'SELECT id FROM assertions WHERE subject_id = ? OR object_id = ?',
            [id, id],
          );
          for (const assertion of affected) await this.indexAssertion(assertion.id);
        }
      } else {
        await this.run('UPDATE entities SET embedding = NULL WHERE id = ?', [id]);
        await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]);
        await this.run('DELETE FROM entity_embedding_metadata WHERE entity_id = ?', [id]);
      }
    }
  }

  async deleteEntity(id: string): Promise<void> {
    // 先删除 vec 索引
    if (this.vecEnabled) {
      try {
        await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]);
      } catch (e) { /* vec 删除失败不阻塞 */ }
    }
    // 删除 FTS 索引
    try {
      await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]);
    } catch (e) { /* FTS 删除失败不阻塞 */ }
    // 防御性清理：即便 PRAGMA foreign_keys 未生效，也保证关系不孤儿
    await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
    await this.run('DELETE FROM entities WHERE id = ?', [id]);
  }

  /**
   * 合并 sourceId 到 targetId：把 source 的所有关系迁移到 target，
   * 合并 tags（去重），追加 description（如果不同），然后删除 source。
   * 自环（source 与 target 之间的关系）会被丢弃，避免合并后产生自指。
   */
  async mergeEntities(sourceId: string, targetId: string): Promise<{ moved: number; dropped: number }> {
    if (sourceId === targetId) throw new Error('Cannot merge entity into itself');
    const source = await this.get<any>('SELECT * FROM entities WHERE id = ?', [sourceId]);
    const target = await this.get<any>('SELECT * FROM entities WHERE id = ?', [targetId]);
    if (!source || !target) throw new Error('Source or target entity not found');

    // 合并 tags（去重）
    const sourceTags: string[] = source.tags ? JSON.parse(source.tags) : [];
    const targetTags: string[] = target.tags ? JSON.parse(target.tags) : [];
    const mergedTags = Array.from(new Set([...targetTags, ...sourceTags]));

    // 合并 description（target 已有则追加 source，没有则用 source）
    let mergedDesc = target.description || '';
    if (source.description && source.description !== target.description) {
      mergedDesc = mergedDesc
        ? `${mergedDesc}\n\n—— 合并自 ${source.name}：\n${source.description}`
        : source.description;
    }

    await this.updateEntity(targetId, {
      tags: mergedTags,
      description: mergedDesc,
    });

    // 迁移关系：source → X 改为 target → X，X → source 改为 X → target
    // 同时丢弃自环
    const outgoing = await this.all<any>(
      'SELECT id, target_id FROM relationships WHERE source_id = ?',
      [sourceId]
    );
    const incoming = await this.all<any>(
      'SELECT id, source_id FROM relationships WHERE target_id = ?',
      [sourceId]
    );

    let moved = 0;
    let dropped = 0;
    for (const r of outgoing) {
      if (r.target_id === targetId) {
        await this.run('DELETE FROM relationships WHERE id = ?', [r.id]);
        dropped++;
      } else {
        await this.run('UPDATE relationships SET source_id = ? WHERE id = ?', [targetId, r.id]);
        moved++;
      }
    }
    for (const r of incoming) {
      if (r.source_id === targetId) {
        await this.run('DELETE FROM relationships WHERE id = ?', [r.id]);
        dropped++;
      } else {
        await this.run('UPDATE relationships SET target_id = ? WHERE id = ?', [targetId, r.id]);
        moved++;
      }
    }

    // 最后删除 source（这会顺带清掉 vec/fts/关系防御清理）
    await this.deleteEntity(sourceId);
    return { moved, dropped };
  }

  async addRelationship(relationship: Omit<Relationship, 'id' | 'created_at' | 'last_activated' | 'valid_from'> & {
    id?: string;
    valid_from?: string;
    invalidation_reason?: string;
  }): Promise<Relationship> {
    const id = relationship.id || uuidv4();
    const now = new Date().toISOString();
    const validFrom = relationship.valid_from || now;
    const validUntil = relationship.valid_until || null;
    const invalidatedAt = relationship.invalidated_at || null;
    const invalidationReason = relationship.invalidation_reason || null;

    await this.run(
      `INSERT OR REPLACE INTO relationships (
         id, source_id, target_id, type, description, weight, created_at,
         last_activated, valid_from, valid_until, invalidated_at, invalidation_reason,
         base_weight, last_decay_at, decay_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, relationship.source_id, relationship.target_id, relationship.type,
      relationship.description || null, relationship.weight ?? 1.0, now, now, validFrom, validUntil,
      invalidatedAt, invalidationReason, relationship.weight ?? 1.0, now]
    );

    // Relationships remain the graph compatibility view; every new edge also becomes
    // a provenance-aware Assertion so temporal retrieval has a single factual layer.
    await this.run(
      `INSERT OR IGNORE INTO assertions (
        id, subject_id, predicate, original_predicate, object_id, confidence, source_span, provenance,
        observed_at, recorded_at, event_time, valid_from, valid_until,
        temporal_confidence, temporal_source, timezone, invalidated_at,
        invalidation_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `relationship:${id}`, relationship.source_id, relationship.type,
        String(relationship.provenance?.original_predicate || relationship.type), relationship.target_id,
        Math.max(0, Math.min(1, relationship.weight ?? 1)), relationship.description || null,
        JSON.stringify({ relationship_id: id, ...(relationship.provenance || {}) }),
        relationship.observed_at || null, now, relationship.event_time || null, validFrom,
        validUntil, relationship.temporal_confidence ?? null, relationship.temporal_source || null,
        relationship.timezone || null, invalidatedAt, invalidationReason, now, now,
      ],
    );
    if (!invalidatedAt) {
      await this.run(
        `INSERT OR REPLACE INTO fts_assertions(assertion_id, subject_id, predicate, literal_value, source_span)
         VALUES (?, ?, ?, '', ?)`,
        [`relationship:${id}`, relationship.source_id, relationship.type, relationship.description || ''],
      );
      if (this.embeddingService) await this.indexAssertion(`relationship:${id}`);
    }

    return {
      id,
      source_id: relationship.source_id,
      target_id: relationship.target_id,
      type: relationship.type,
      description: relationship.description,
     weight: relationship.weight ?? 1.0,
      created_at: now,
      last_activated: now,
      valid_from: validFrom,
      valid_until: validUntil || undefined,
      invalidated_at: invalidatedAt || undefined,
      invalidation_reason: invalidationReason || undefined,
    };
  }

  async invalidateRelationship(id: string, reason?: string, validUntil?: string): Promise<void> {
    const now = new Date().toISOString();
    const until = validUntil || now;
    await this.run(
      `UPDATE relationships
       SET valid_until = ?, invalidated_at = ?, invalidation_reason = ?
       WHERE id = ?`,
      [until, now, reason || null, id]
    );
    // Sync the mirror assertion and remove from FTS (invalidated facts are not searchable)
    await this.run(
      `UPDATE assertions
       SET valid_until = ?, invalidated_at = ?, invalidation_reason = ?, updated_at = ?
       WHERE id = ?`,
      [until, now, reason || null, now, `relationship:${id}`],
    );
    await this.run(
      `DELETE FROM fts_assertions WHERE assertion_id = ?`,
      [`relationship:${id}`],
    );
    await this.run('DELETE FROM vec_assertions WHERE assertion_id = ?', [`relationship:${id}`]);
    await this.run('DELETE FROM assertion_embedding_metadata WHERE assertion_id = ?', [`relationship:${id}`]);
  }

  async getRelationshipsForEntity(entityId: string, includeHistorical: boolean = false): Promise<Relationship[]> {
    const now = new Date().toISOString();
    let query = `SELECT * FROM relationships WHERE (source_id = ? OR target_id = ?)`;
    const params = [entityId, entityId];

    if (!includeHistorical) {
      query += ` AND invalidated_at IS NULL AND (valid_until IS NULL OR valid_until > ?)`;
      params.push(now);
    }

    query += ` ORDER BY weight DESC`;

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  async getRelationships(limit: number = 200, includeHistorical: boolean = false): Promise<Relationship[]> {
    const now = new Date().toISOString();
    let query = 'SELECT * FROM relationships';
    const params: any[] = [];

    if (!includeHistorical) {
      query += ' WHERE invalidated_at IS NULL AND (valid_until IS NULL OR valid_until > ?)';
      params.push(now);
    }

    query += ' ORDER BY weight DESC, last_activated DESC LIMIT ?';
    params.push(Math.max(1, Math.min(limit, 60000)));

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  async getRelationshipsForEntities(entityIds: string[], includeHistorical: boolean = false): Promise<Relationship[]> {
    if (entityIds.length === 0) return [];
    const now = new Date().toISOString();
    const placeholders = entityIds.map(() => '?').join(',');
    let query = `SELECT * FROM relationships WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`;
    const params = [...entityIds, ...entityIds];

    if (!includeHistorical) {
      query += ` AND invalidated_at IS NULL AND (valid_until IS NULL OR valid_until > ?)`;
      params.push(now);
    }

    query += ` ORDER BY weight DESC`;

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  private async reconcileAssertionTransition(input: AssertionInput): Promise<AssertionInput> {
    const provenance = recordValue(input.provenance);
    if (provenance.fidelity_version !== 'memory-fidelity-v1' || provenance.state !== 'current') return input;
    const stateKey = boundedText(provenance.state_key, 500);
    const transition = recordValue(provenance.transition);
    const kind = boundedText(transition.kind, 40);
    const fromValue = boundedText(transition.from_value);
    const toValue = boundedText(transition.to_value);
    if (!stateKey || !['updated', 'corrected', 'withdrawn', 'superseded'].includes(kind)
      || !fromValue || !toValue) return input;

    const existing = await this.getAssertions({
      subjectId: input.subject_id,
      includeHistorical: true,
      limit: 1_000,
    });
    const prior = existing
      .filter((candidate) => !candidate.invalidated_at && !candidate.valid_until)
      .filter((candidate) => boundedText(recordValue(candidate.provenance).state_key, 500) === stateKey)
      .find((candidate) => {
        const candidateProvenance = recordValue(candidate.provenance);
        const exact = boundedText(candidateProvenance.exact_value) || boundedText(candidate.literal_value);
        return exact === fromValue && exact !== toValue;
      });
    if (!prior) return input;

    const effectiveAt = boundedText(transition.effective_at, 100)
      || input.valid_from || input.event_time || input.observed_at || new Date().toISOString();
    const priorProvenance = recordValue(prior.provenance);
    const invalidatesPrior = kind === 'corrected' || kind === 'withdrawn';
    const priorState = invalidatesPrior ? 'invalidated' : 'historical';
    await this.run(
      `UPDATE assertions
       SET valid_until = COALESCE(valid_until, ?),
           invalidated_at = CASE WHEN ? = 1 THEN COALESCE(invalidated_at, ?) ELSE invalidated_at END,
           invalidation_reason = CASE WHEN ? = 1 THEN COALESCE(invalidation_reason, ?) ELSE invalidation_reason END,
           provenance = ?, updated_at = ?
       WHERE id = ?`,
      [
        effectiveAt,
        invalidatesPrior ? 1 : 0,
        effectiveAt,
        invalidatesPrior ? 1 : 0,
        `state_transition:${kind}`,
        JSON.stringify({ ...priorProvenance, state: priorState, superseded_by_value: toValue }),
        new Date().toISOString(),
        prior.id,
      ],
    );
    if (invalidatesPrior) {
      await this.run('DELETE FROM fts_assertions WHERE assertion_id = ?', [prior.id]);
    }

    const rejectedConflicts = invalidatesPrior
      ? [
          ...(Array.isArray(provenance.rejected_conflicts) ? provenance.rejected_conflicts : []),
          {
            assertion_id: prior.id,
            value: fromValue,
            confidence: prior.confidence,
            state: 'invalidated',
            source_event_ids: Array.isArray(priorProvenance.source_event_ids)
              ? priorProvenance.source_event_ids.slice(0, 5)
              : [],
          },
        ]
      : provenance.rejected_conflicts;
    return {
      ...input,
      previous_version_id: prior.id,
      version: Math.max(input.version || 1, prior.version + 1),
      provenance: {
        ...provenance,
        ...(rejectedConflicts ? { rejected_conflicts: rejectedConflicts } : {}),
      },
    };
  }

  async addAssertion(input: AssertionInput): Promise<Assertion> {
    const prepared = await this.reconcileAssertionTransition(input);
    if (!/^[a-z][a-z0-9_:.\/-]{0,127}$/i.test(prepared.predicate)) {
      throw new Error('invalid assertion predicate');
    }
    if ((prepared.object_id == null) === (prepared.literal_value == null)) {
      throw new Error('assertion requires exactly one of object_id or literal_value');
    }
    const confidence = prepared.confidence ?? 1;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('assertion confidence must be between 0 and 1');
    }
    if (prepared.temporal_confidence != null
      && (!Number.isFinite(prepared.temporal_confidence)
        || prepared.temporal_confidence < 0
        || prepared.temporal_confidence > 1)) {
      throw new Error('temporal confidence must be between 0 and 1');
    }

    const id = prepared.id || uuidv4();
    const now = new Date().toISOString();
    const recordedAt = prepared.recorded_at || now;
    const validFrom = prepared.valid_from || prepared.event_time || prepared.observed_at || recordedAt;
    const version = prepared.version ?? 1;
    await this.run(
      `INSERT INTO assertions (
        id, subject_id, predicate, original_predicate, object_id, literal_value, literal_type, confidence, source_span, provenance,
        observed_at, recorded_at, event_time, valid_from, valid_until, temporal_confidence,
        temporal_source, timezone, invalidated_at, invalidation_reason, version, previous_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, prepared.subject_id, prepared.predicate, prepared.original_predicate || prepared.predicate,
        prepared.object_id || null, prepared.literal_value || null,
        prepared.literal_type || null, confidence, prepared.source_span || null,
        prepared.provenance ? JSON.stringify(prepared.provenance) : null,
        prepared.observed_at || null, recordedAt, prepared.event_time || null, validFrom,
        prepared.valid_until || null, prepared.temporal_confidence ?? null, prepared.temporal_source || null,
        prepared.timezone || null, prepared.invalidated_at || null, prepared.invalidation_reason || null,
        version, prepared.previous_version_id || null,
        now, now,
      ],
    );
    // Maintain FTS index for current (non-invalidated) assertions
    if (!prepared.invalidated_at) {
      await this.run(
        `INSERT INTO fts_assertions (assertion_id, subject_id, predicate, literal_value, source_span)
         VALUES (?, ?, ?, ?, ?)`,
        [id, prepared.subject_id, prepared.predicate, prepared.literal_value || '', prepared.source_span || ''],
      );
    }
    const assertion: Assertion = {
      ...prepared,
      id,
      confidence,
      version,
      recorded_at: recordedAt,
      valid_from: validFrom,
      created_at: now,
      updated_at: now,
    };
    if (this.embeddingService && !assertion.invalidated_at) {
      try {
        await this.indexAssertion(id);
      } catch (error) {
        if (process.env.OMNI_EVALUATION_MODE === '1') throw error;
        console.warn(`[assertion-index] indexing failed (${id}):`, error);
      }
    }
    return assertion;
  }

  async getAssertions(options: {
    subjectId?: string;
    predicate?: string;
    asOf?: string;
    includeHistorical?: boolean;
    limit?: number;
  } = {}): Promise<Assertion[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.subjectId) {
      clauses.push('subject_id = ?');
      params.push(options.subjectId);
    }
    if (options.predicate) {
      clauses.push('predicate = ?');
      params.push(options.predicate);
    }
    if (!options.includeHistorical) {
      const asOf = options.asOf || new Date().toISOString();
      clauses.push('invalidated_at IS NULL');
      clauses.push('valid_from <= ?');
      clauses.push('(valid_until IS NULL OR valid_until > ?)');
      params.push(asOf, asOf);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.max(1, Math.min(options.limit || 200, 1000)));
    const rows = await this.all<any>(
      `SELECT * FROM assertions ${where} ORDER BY valid_from DESC, recorded_at DESC LIMIT ?`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      subject_id: row.subject_id,
      predicate: row.predicate,
      original_predicate: row.original_predicate || row.predicate,
      object_id: row.object_id || undefined,
      literal_value: row.literal_value || undefined,
      literal_type: row.literal_type || undefined,
      confidence: row.confidence,
      source_span: row.source_span || undefined,
      provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
      observed_at: row.observed_at || undefined,
      recorded_at: row.recorded_at,
      event_time: row.event_time || undefined,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      temporal_confidence: row.temporal_confidence ?? undefined,
      temporal_source: row.temporal_source || undefined,
      timezone: row.timezone || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
      version: row.version ?? 1,
      previous_version_id: row.previous_version_id || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async invalidateAssertion(id: string, reason: string, validUntil?: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.run(
      `UPDATE assertions
       SET valid_until = COALESCE(?, valid_until, ?), invalidated_at = ?,
           invalidation_reason = ?, updated_at = ?
       WHERE id = ? AND invalidated_at IS NULL`,
      [validUntil || null, now, now, reason, now, id],
    );
    if (result.changes === 0) throw new Error('assertion not found or already invalidated');
    // Remove from FTS — invalidated facts are not searchable
    await this.run(`DELETE FROM fts_assertions WHERE assertion_id = ?`, [id]);
    await this.run('DELETE FROM vec_assertions WHERE assertion_id = ?', [id]);
    await this.run('DELETE FROM assertion_embedding_metadata WHERE assertion_id = ?', [id]);
    await this.refreshEmbeddingIndexContentCount('vec_assertions');
  }

  /**
   * Full-text search over current (non-invalidated) assertions using fts_assertions.
   * Returns assertion rows matching the query, ranked by FTS relevance.
   */
  async searchAssertions(query: string, limit: number = 10): Promise<Assertion[]> {
    const ftsQuery = query.replace(/"/g, '""');
    const rows = await this.all<any>(
      `SELECT a.* FROM assertions a
       JOIN fts_assertions f ON f.assertion_id = a.id
       WHERE fts_assertions MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [`"${ftsQuery}"`, Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((row) => ({
      id: row.id,
      subject_id: row.subject_id,
      predicate: row.predicate,
      original_predicate: row.original_predicate || row.predicate,
      object_id: row.object_id || undefined,
      literal_value: row.literal_value || undefined,
      literal_type: row.literal_type || undefined,
      confidence: row.confidence,
      source_span: row.source_span || undefined,
      provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
      observed_at: row.observed_at || undefined,
      recorded_at: row.recorded_at,
      event_time: row.event_time || undefined,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      temporal_confidence: row.temporal_confidence ?? undefined,
      temporal_source: row.temporal_source || undefined,
      timezone: row.timezone || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
      version: row.version ?? 1,
      previous_version_id: row.previous_version_id || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async searchResolvedAssertions(query: string, limit: number = 10): Promise<Array<{
    assertion: Assertion;
    subjectName: string;
    objectName?: string;
    passage: string;
  }>> {
    const assertions = await this.searchAssertions(query, limit);
    const resolved = await Promise.all(assertions.map((assertion) => this.getResolvedAssertion(assertion.id)));
    return resolved.filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * Bounded lexical fallback over verified raw-event source spans. It returns
   * assertion candidates, not duplicate event rows, so fusion can group every
   * source path under the stable assertion evidence id.
   */
  async searchRawEventAssertions(query: string, limit: number = 10): Promise<Array<{
    id: string;
    assertion: Assertion;
    subjectName: string;
    objectName?: string;
    passage: string;
  }>> {
    const terms = query
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .slice(0, 8)
      .map((term) => `"${term.replace(/"/g, '""')}"`);
    if (terms.length === 0) return [];
    const now = new Date().toISOString();
    const rows = await this.all<any>(
      `SELECT a.* FROM assertions a
       JOIN fts_assertions f ON f.assertion_id = a.id
       WHERE fts_assertions MATCH ?
         AND a.invalidated_at IS NULL
         AND a.valid_from <= ?
         AND (a.valid_until IS NULL OR a.valid_until > ?)
         AND json_extract(a.provenance, '$.fidelity_version') = 'memory-fidelity-v1'
         AND json_array_length(json_extract(a.provenance, '$.raw_event_references')) > 0
       ORDER BY rank
       LIMIT ?`,
      [`source_span : (${terms.join(' OR ')})`, now, now, Math.max(1, Math.min(limit, 100))],
    );
    const resolved = await Promise.all(rows.map((row) => this.getResolvedAssertion(row.id)));
    return resolved.filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * Database consistency scan: verifies that every non-deleted relationship has
   * a mirror assertion, and that no orphaned FTS rows exist for invalidated assertions.
   * Returns counts of detected inconsistencies. Zero = fully consistent.
   */
  async consistencyScan(): Promise<{
    relationshipsWithoutAssertion: number;
    assertionsWithoutRelationship: number;
    ftsOrphans: number;
    invalidatedInFts: number;
  }> {
    const [withoutAssertion] = await this.all<{ count: number }>(
      `SELECT COUNT(*) as count FROM relationships r
       WHERE NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = 'relationship:' || r.id)`,
    );
    const [withoutRelationship] = await this.all<{ count: number }>(
      `SELECT COUNT(*) as count FROM assertions a
       WHERE a.id LIKE 'relationship:%'
         AND NOT EXISTS (
           SELECT 1 FROM relationships r WHERE a.id = 'relationship:' || r.id
         )`,
    );
    const [ftsOrphans] = await this.all<{ count: number }>(
      `SELECT COUNT(*) as count FROM fts_assertions f
       WHERE NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = f.assertion_id)`,
    );
    const [invalidatedInFts] = await this.all<{ count: number }>(
      `SELECT COUNT(*) as count FROM fts_assertions f
       JOIN assertions a ON a.id = f.assertion_id
       WHERE a.invalidated_at IS NOT NULL`,
    );
    return {
      relationshipsWithoutAssertion: withoutAssertion?.count || 0,
      assertionsWithoutRelationship: withoutRelationship?.count || 0,
      ftsOrphans: ftsOrphans?.count || 0,
      invalidatedInFts: invalidatedInFts?.count || 0,
    };
  }

  async peekEntities(ids: string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.all<any>(`SELECT * FROM entities WHERE id IN (${placeholders})`, ids);
    
    const entities: Entity[] = [];
    for (const row of rows) {
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        // 如果存在 merged_into，单独走 peekEntity 兜底
        const resolved = await this.peekEntity(row.id);
        if (resolved) {
          entities.push(resolved);
        }
      } else {
        entities.push(this.rowToEntity(row));
      }
    }
    return entities;
  }

  async getGraphNeighborhood(entityId: string, depth: number = 1, includeHistorical: boolean = false): Promise<GraphNeighborhood> {
    depth = Math.min(depth, 3);
    const nodes = new Map<string, Entity>();
    const edgesMap = new Map<string, Relationship>();
    const visited = new Set<string>([entityId]);

    const startEntity = await this.peekEntity(entityId);
    if (!startEntity) return { nodes: [], edges: [] };
    nodes.set(entityId, startEntity);

    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;

      const rels = await this.getRelationshipsForEntities(frontier, includeHistorical);
      const nextFrontierCandidates = new Set<string>();

      for (const rel of rels) {
        if (!edgesMap.has(rel.id)) {
          edgesMap.set(rel.id, rel);
        }

        const sourceInFrontier = frontier.includes(rel.source_id);
        const targetInFrontier = frontier.includes(rel.target_id);

        if (sourceInFrontier) {
          const neighborId = rel.target_id;
          if (!visited.has(neighborId)) {
            nextFrontierCandidates.add(neighborId);
          }
        }
        if (targetInFrontier) {
          const neighborId = rel.source_id;
          if (!visited.has(neighborId)) {
            nextFrontierCandidates.add(neighborId);
          }
        }
      }

      if (nextFrontierCandidates.size === 0) {
        break;
      }

      const newNeighborsList = Array.from(nextFrontierCandidates);
      const newEntities = await this.peekEntities(newNeighborsList);

      const nextFrontier: string[] = [];
      for (const entity of newEntities) {
        if (!nodes.has(entity.id)) {
          nodes.set(entity.id, entity);
          visited.add(entity.id);
          nextFrontier.push(entity.id);
        }
      }
      frontier = nextFrontier;
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edgesMap.values())
    };
  }

  async updateRelationshipWeight(relId: string, weightChange: number = 0.1): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      `UPDATE relationships
       SET weight = weight + ?, last_activated = ?
       WHERE id = ?`,
      [weightChange, now, relId]
    );
    // Sync mirror assertion confidence (clamped to [0,1])
    await this.run(
      `UPDATE assertions
       SET confidence = MIN(1, MAX(0, (
         SELECT weight FROM relationships WHERE id = ?
       ))), updated_at = ?
       WHERE id = ?`,
      [relId, now, `relationship:${relId}`],
    );
  }

  async deleteRelationship(id: string): Promise<void> {
    await this.run('DELETE FROM relationships WHERE id = ?', [id]);
    // Invalidate the mirror assertion (don't delete — preserve audit trail)
    const now = new Date().toISOString();
    await this.run(
      `UPDATE assertions
       SET valid_until = ?, invalidated_at = ?, invalidation_reason = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, 'relationship_deleted', now, `relationship:${id}`],
    );
    await this.run(
      `DELETE FROM fts_assertions WHERE assertion_id = ?`,
      [`relationship:${id}`],
    );
  }

  /**
   * 向量搜索 — 优先使用 sqlite-vec 原生 KNN，回退到 JS 内存计算
   * @param queryEmbedding 搜索向量
   * @param limit 结果限制
   * @returns 搜索结果（带相似度/距离）
   */
  async vectorSearch(queryEmbedding: number[], limit: number = 10): Promise<VectorSearchResult[]> {
    if (this.vecEnabled) {
      await this._resolveVecDimension();
      if (queryEmbedding.length !== this.vecDimension) {
        throw new Error(`ENTITY_VECTOR_DIMENSION_MISMATCH: index=${this.vecDimension} query=${queryEmbedding.length}`);
      }
      await this.assertEmbeddingIndexReady('vec_entities', queryEmbedding.length);
      return this._vectorSearchNative(queryEmbedding, limit);
    }
    // 回退到 JS 内存计算（兼容 sqlite-vec 不可用的环境）
    return this._vectorSearchFallback(queryEmbedding, limit);
  }

  /**
   * [核心壁垒] sqlite-vec 原生 KNN 向量搜索
   * 数据在 SQLite 层完成计算，不加载到 Node.js 内存
   */
  private async _vectorSearchNative(queryEmbedding: number[], limit: number): Promise<VectorSearchResult[]> {
    // sqlite-vec 要求 Float32Array 格式
    const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);

    // sqlite-vec KNN 需要在 vec0 的 WHERE 中显式提供 k 才能下推；
    // 经 JOIN 后跟随的 LIMIT 不会被 vec0 视为 k 约束（会报
    // "A LIMIT or 'k = ?' constraint is required on vec0 knn queries"），
    // 因此这里强制用 `AND k = ?` 取 KNN，再回 JOIN 取实体明细。
    const rows = await this.all<any>(
      `SELECT
         v.entity_id AS id,
         v.distance,
         e.name,
         e.type,
         e.description
       FROM vec_entities v
       INNER JOIN entities e ON e.id = v.entity_id
       WHERE v.embedding MATCH ? AND k = ? AND json_extract(e.metadata, '$.merged_into') IS NULL
       ORDER BY v.distance`,
      [queryBlob, limit]
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      // sqlite-vec 返回 L2 距离，转换为相似度 (0~1)
      similarity: 1 / (1 + row.distance),
    }));
  }

  /**
   * 回退：JS 内存余弦相似度（当 sqlite-vec 不可用时）
   */
  private async _vectorSearchFallback(queryEmbedding: number[], limit: number): Promise<VectorSearchResult[]> {
    // 仅在 sqlite-vec 不可用时走这里。一次性把所有带向量的实体读进内存做余弦相似度，
    // 实体过万时内存可达数百 MB，故按热度（access_count / last_accessed）取前 N 作候选，
    // 用召回率换取内存安全。
    const CANDIDATE_CAP = 5000;
    const rows = await this.all<any>(
      `SELECT id, name, type, description, embedding FROM entities
       WHERE embedding IS NOT NULL AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY access_count DESC, last_accessed DESC
       LIMIT ?`,
      [CANDIDATE_CAP]
    );

    const results: VectorSearchResult[] = rows
      .map(row => {
        if (!row.embedding) return null;
        const storedEmbedding = decodeEmbedding(row.embedding);
        const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          description: row.description,
          similarity,
        };
      })
      .filter((r): r is VectorSearchResult => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * 将实体的 embedding 同步到 vec_entities 虚拟表
   */
  private async _syncVecEmbedding(entityId: string, embedding: number[], contentSha256?: string): Promise<void> {
    if (!this.vecEnabled) return;
    try {
      await this._resolveVecDimension();
      if (embedding.length !== this.vecDimension) {
        throw new Error(`ENTITY_VECTOR_DIMENSION_MISMATCH: index=${this.vecDimension} value=${embedding.length}`);
      }
      const vecBlob = Buffer.from(new Float32Array(embedding).buffer);
      // 先尝试删除旧记录（vec0 不支持 UPSERT）
      await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [entityId]);
      await this.run(
        'INSERT INTO vec_entities (entity_id, embedding) VALUES (?, ?)',
        [entityId, vecBlob]
      );
      const manifest = await this.getEmbeddingIndexManifest('vec_entities');
      if (manifest && contentSha256) {
        await this.run(
          `INSERT INTO entity_embedding_metadata(
             entity_id, embedding_model, model_revision, dimension, usage_profile_version,
             serialization_version, embedded_at, content_sha256
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(entity_id) DO UPDATE SET
             embedding_model=excluded.embedding_model, model_revision=excluded.model_revision,
             dimension=excluded.dimension, usage_profile_version=excluded.usage_profile_version,
             serialization_version=excluded.serialization_version, embedded_at=excluded.embedded_at,
             content_sha256=excluded.content_sha256`,
          [entityId, manifest.model_id, manifest.model_revision, manifest.dimension,
            manifest.usage_profile_version, manifest.serialization_version,
            new Date().toISOString(), contentSha256],
        );
      }
      await this.refreshEmbeddingIndexContentCount('vec_entities');
    } catch (e) {
      if (process.env.OMNI_EVALUATION_MODE === '1') throw e;
      console.warn(`[sqlite-vec] 向量同步失败 (${entityId}):`, e);
    }
  }

  /** 从 sqlite_master 读取 vec_entities 的真实声明维度（只做一次） */
  private async _resolveVecDimension(): Promise<void> {
    if (this.vecDimensionResolved) return;
    this.vecDimensionResolved = true;
    try {
      const row = await this.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vec_entities'"
      );
      const m = row?.sql?.match(/\[\s*(\d+)\s*\]/);
      if (m) this.vecDimension = parseInt(m[1], 10);
    } catch {
      /* 读不到则保留默认 384 */
    }
  }

  // ===================== Notifications (Agent Insights) =====================

  async recordBehaviorEvent(input: BehaviorEventInput): Promise<string> {
    const id = uuidv4();
    const occurredAt = input.occurredAt || new Date().toISOString();
    await this.run(
      `INSERT INTO behavior_events (
         id, event_type, entity_id, notification_id, topic, intent, metadata,
         occurred_at, idempotency_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
      [
        id,
        input.eventType,
        input.entityId || null,
        input.notificationId || null,
        input.topic?.trim().slice(0, 500) || null,
        input.intent || null,
        JSON.stringify(input.metadata || {}),
        occurredAt,
        input.idempotencyKey || null,
      ],
    );
    return id;
  }

  async recordBehaviorEvents(inputs: BehaviorEventInput[]): Promise<void> {
    if (!inputs.length) return;
    await this.withTransaction(async () => {
      for (const input of inputs) await this.recordBehaviorEvent(input);
    });
  }

  async recordProactiveInsight(input: {
    notificationId?: string;
    insightType: string;
    trigger: string;
    evidenceIds: string[];
    confidence: number;
    reason: string;
    cooldownUntil?: string;
  }): Promise<string> {
    const id = uuidv4();
    await this.run(
      `INSERT INTO proactive_insights (
         id, notification_id, insight_type, trigger, evidence_ids, confidence,
         reason, generated_at, cooldown_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.notificationId || null, input.insightType, input.trigger,
        JSON.stringify(input.evidenceIds), Math.max(0, Math.min(1, input.confidence)),
        input.reason, new Date().toISOString(), input.cooldownUntil || null,
      ],
    );
    return id;
  }

  async addNotification(notification: Omit<import('../shared-types.js').Notification, 'id' | 'created_at' | 'read_status'> & { id?: string }): Promise<import('../shared-types.js').Notification> {
    const id = notification.id || uuidv4();
    const now = new Date().toISOString();
    const relatedStr = notification.related_entities ? JSON.stringify(notification.related_entities) : null;

    await this.run(
      `INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [id, notification.title, notification.content, notification.type, relatedStr, now]
    );

    return {
      id,
      title: notification.title,
      content: notification.content,
      type: notification.type,
      related_entities: notification.related_entities,
      read_status: false,
      created_at: now,
    };
  }

  async hasRecentNotification(titlePrefix: string, days: number, contentIncludes?: string): Promise<boolean> {
    const safeDays = Math.max(1, Math.min(Math.floor(days), 365));
    const contentClause = contentIncludes ? ' AND content LIKE ?' : '';
    const params: Array<string | number> = [`${titlePrefix}%`, safeDays];
    if (contentIncludes) params.push(`%${contentIncludes}%`);
    const row = await this.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM notifications
       WHERE title LIKE ?
         AND created_at > datetime('now', '-' || ? || ' days')
         ${contentClause}`,
      params,
    );
    return (row?.c ?? 0) > 0;
  }

  // ── failed_tasks (Task 5): persisted import/pipeline failures ──

  async recordFailedTask(input: {
    task_id: string;
    batch_id: string;
    task_type: 'chat_import' | 'chunk_extract' | 'conflict_resolution' | 'other';
    conversation_title?: string;
    session_id?: string;
    turn_id?: string;
    stage?: string;
    error: string;
    payload_snapshot?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      `INSERT OR REPLACE INTO failed_tasks (
        task_id, batch_id, task_type, conversation_title, session_id, turn_id,
        stage, error, payload_snapshot, attempts, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
      [
        input.task_id,
        input.batch_id,
        input.task_type,
        input.conversation_title ?? null,
        input.session_id ?? null,
        input.turn_id ?? null,
        input.stage ?? null,
        input.error,
        input.payload_snapshot ?? null,
        now,
        now,
      ],
    );
  }

  async getFailedTasks(batchId: string, status?: string): Promise<FailedTaskRow[]> {
    const sql = status
      ? 'SELECT * FROM failed_tasks WHERE batch_id = ? AND status = ? ORDER BY created_at ASC'
      : 'SELECT * FROM failed_tasks WHERE batch_id = ? ORDER BY created_at ASC';
    const params = status ? [batchId, status] : [batchId];
    return this.all<FailedTaskRow>(sql, params);
  }

  async getFailedTask(taskId: string): Promise<FailedTaskRow | null> {
    const row = await this.get<FailedTaskRow>(
      'SELECT * FROM failed_tasks WHERE task_id = ?',
      [taskId],
    );
    return row ?? null;
  }

  async updateFailedTaskStatus(
    taskId: string,
    status: 'pending' | 'retrying' | 'resolved' | 'permanent_failure',
    extraError?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    if (status === 'retrying') {
      await this.run(
        `UPDATE failed_tasks SET status = ?, attempts = attempts + 1, updated_at = ? WHERE task_id = ?`,
        [status, now, taskId],
      );
    } else if (status === 'resolved') {
      await this.run(
        `UPDATE failed_tasks SET status = ?, updated_at = ? WHERE task_id = ?`,
        [status, now, taskId],
      );
    } else {
      await this.run(
        `UPDATE failed_tasks SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE task_id = ?`,
        [status, extraError ?? null, now, taskId],
      );
    }
  }

  async getUnreadNotifications(): Promise<import('../shared-types.js').Notification[]> {
    const rows = await this.all<any>(
      'SELECT * FROM notifications WHERE read_status = 0 ORDER BY created_at DESC'
    );
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      related_entities: row.related_entities ? JSON.parse(row.related_entities) : undefined,
      read_status: Boolean(row.read_status),
      created_at: row.created_at,
    }));
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.run('UPDATE notifications SET read_status = 1 WHERE id = ?', [id]);
  }

  async getNotification(id: string): Promise<import('../shared-types.js').Notification | null> {
    const rows = await this.all<any>('SELECT * FROM notifications WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      related_entities: row.related_entities ? JSON.parse(row.related_entities) : undefined,
      read_status: Boolean(row.read_status),
      created_at: row.created_at,
    };
  }

  async promoteInsightToGraph(notificationId: string): Promise<{ entity: Entity; linked: number } | null> {
    const n = await this.getNotification(notificationId);
    if (!n || n.type !== 'insight' || n.read_status === true) {
      return null;
    }

    const entityName = n.title.slice(0, 120);
    const entityDescription = n.content;
    const insightEntity = await this.addEntity({
      name: entityName,
      type: 'concept',
      description: entityDescription,
      tags: ['insight', 'agent-loop'],
      metadata: {
        provenance: {
          source: 'agent-loop',
          generated_at: n.created_at
        },
        insight: true
      }
    });

    let linkedCount = 0;
    const relatedEntities = n.related_entities || [];
    for (const targetId of relatedEntities) {
      const targetEntity = await this.peekEntity(targetId);
      if (targetEntity) {
        await this.addRelationship({
          source_id: insightEntity.id,
          target_id: targetId,
          type: 'derived_from',
          description: '由 Agent 洞见关联',
          weight: 0.6
        });
        linkedCount++;
      }
    }

    await this.markNotificationRead(notificationId);

    return {
      entity: insightEntity,
      linked: linkedCount
    };
  }

  async getEntitiesForConsolidation(limit = 5): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
         AND ( json_extract(metadata, '$.consolidated_at') IS NULL
               OR datetime(json_extract(metadata, '$.consolidated_at')) < datetime(updated_at) )
       ORDER BY COALESCE(cast(json_extract(metadata, '$.importance') as real), 0.5) DESC, updated_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async markEntitiesConsolidated(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    await this.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.consolidated_at', ?)
       WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  // ── 问大脑会话（可续聊的思考记录，独立于记忆，不进召回）──
  async listDiscussions(limit = 50): Promise<Array<{ id: string; title: string; updated_at: string; turns: number }>> {
    const rows = await this.all<any>(
      'SELECT id, title, turns, updated_at FROM discussions ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((r) => {
      let n = 0;
      try { const a = JSON.parse(r.turns); n = Array.isArray(a) ? a.length : 0; } catch { /* */ }
      return { id: r.id, title: r.title, updated_at: r.updated_at, turns: n };
    });
  }

  async getDiscussion(id: string): Promise<{ id: string; title: string; turns: any[]; created_at: string; updated_at: string } | null> {
    const rows = await this.all<any>('SELECT * FROM discussions WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return null;
    let turns: any[] = [];
    try { const a = JSON.parse(row.turns); if (Array.isArray(a)) turns = a; } catch { /* */ }
    return { id: row.id, title: row.title, turns, created_at: row.created_at, updated_at: row.updated_at };
  }

  async upsertDiscussion(input: { id?: string | null; title: string; turns: any[] }): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const turnsStr = JSON.stringify(input.turns || []);
    if (input.id) {
      const rows = await this.all<any>('SELECT id FROM discussions WHERE id = ?', [input.id]);
      if (rows[0]) {
        await this.run('UPDATE discussions SET title = ?, turns = ?, updated_at = ? WHERE id = ?', [input.title, turnsStr, now, input.id]);
        return { id: input.id };
      }
    }
    const id = input.id || uuidv4();
    await this.run(
      'INSERT INTO discussions (id, title, turns, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, input.title, turnsStr, now, now]
    );
    return { id };
  }

  async deleteDiscussion(id: string): Promise<void> {
    await this.run('DELETE FROM discussions WHERE id = ?', [id]);
  }

  /**
   * 将实体同步到 FTS5 全文检索虚拟表
   */
  private async _syncFtsEntity(entityId: string, name: string, description: string, tags?: string[]): Promise<void> {
    try {
      // FTS5 不支持 UPSERT，先删后插
      await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [entityId]);
      await this.run(
        'INSERT INTO fts_entities (entity_id, name, description, tags) VALUES (?, ?, ?, ?)',
        [entityId, name, description, tags ? tags.join(' ') : '']
      );
    } catch (e) {
      // FTS5 虚拟表可能不可用（某些 SQLite 编译版本），不阻塞主流程
      console.warn(`[FTS5] 全文索引同步失败 (${entityId}):`, e);
    }
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_file: row.source_file,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      embedding: row.embedding ? decodeEmbedding(row.embedding) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      last_accessed: row.last_accessed,
      access_count: row.access_count,
      observed_at: row.observed_at || undefined,
      recorded_at: row.recorded_at || undefined,
      event_time: row.event_time || undefined,
      valid_from: row.valid_from || undefined,
      valid_until: row.valid_until || undefined,
      temporal_confidence: row.temporal_confidence ?? undefined,
      temporal_source: row.temporal_source || undefined,
      timezone: row.timezone || undefined,
    };
  }

  private async _updateEntityAccess(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      `UPDATE entities
       SET last_accessed = ?, access_count = access_count + 1
       WHERE id = ?`,
      [now, id]
    );
  }

  /**
   * 批量更新实体的 access_count 和 last_accessed（隐式 access tracking）
   */
  async bumpAccessCounts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    await this.run(
      `UPDATE entities SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    let began = false;
    try {
      await this.beginTransaction();
      began = true;
      const result = await fn();
      await this.commit();
      return result;
    } catch (error) {
      if (began) {
        try {
          await this.rollback();
        } catch (rollbackError) {
          console.error('[Database] transaction rollback failed:', rollbackError);
        }
      }
      throw error;
    } finally {
      release();
    }
  }

  async updateAssertion(
    id: string,
    updates: Partial<Pick<Assertion,
      'subject_id' | 'predicate' | 'original_predicate' | 'object_id' | 'literal_value' |
      'source_span' | 'provenance' | 'observed_at' | 'event_time' | 'valid_from' |
      'valid_until' | 'invalidated_at' | 'invalidation_reason'>>,
  ): Promise<Assertion> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const scalarFields = [
      'subject_id', 'predicate', 'original_predicate', 'object_id', 'literal_value',
      'source_span', 'observed_at', 'event_time', 'valid_from', 'valid_until',
      'invalidated_at', 'invalidation_reason',
    ] as const;
    for (const field of scalarFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        fields.push(`${field} = ?`);
        values.push(updates[field] ?? null);
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'provenance')) {
      fields.push('provenance = ?');
      values.push(updates.provenance ? JSON.stringify(updates.provenance) : null);
    }
    if (!fields.length) {
      const existing = await this.getResolvedAssertion(id);
      if (!existing) throw new Error('assertion not found');
      return existing.assertion;
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    const result = await this.run(`UPDATE assertions SET ${fields.join(', ')} WHERE id = ?`, values);
    if (result.changes !== 1) throw new Error('assertion not found');
    const resolved = await this.getResolvedAssertion(id);
    if (!resolved) throw new Error('assertion not found after update');
    if (resolved.assertion.invalidated_at) {
      await this.run('DELETE FROM vec_assertions WHERE assertion_id = ?', [id]);
      await this.run('DELETE FROM assertion_embedding_metadata WHERE assertion_id = ?', [id]);
      await this.refreshEmbeddingIndexContentCount('vec_assertions');
    } else if (this.embeddingService) {
      await this.indexAssertion(id);
    }
    return resolved.assertion;
  }

  attachEmbeddingService(service: EmbeddingService): void {
    this.embeddingService = service;
  }

  async getEmbeddingIndexManifest(indexName: EmbeddingIndexSpec['indexName']): Promise<EmbeddingIndexManifestRow | undefined> {
    return this.get<EmbeddingIndexManifestRow>(
      'SELECT * FROM embedding_index_manifests WHERE index_name = ?',
      [indexName],
    );
  }

  async getEmbeddingIndexManifests(): Promise<EmbeddingIndexManifestRow[]> {
    return this.all<EmbeddingIndexManifestRow>(
      'SELECT * FROM embedding_index_manifests ORDER BY index_name',
    );
  }

  /**
   * Phase 3 guard: verify the ACTIVE index contains no mixed embedding
   * generations. Every metadata row must match the manifest's model, dimension
   * and serialization version, and must carry a normalized flag. Throws
   * `EMBEDDING_SERIALIZATION_MIX` otherwise — callers (re-embed tool, admin
   * health) must surface this instead of silently searching a mixed index.
   */
  async verifyEmbeddingIndexConsistency(indexName: EmbeddingIndexSpec['indexName']): Promise<{
    ok: boolean;
    rows: number;
    serializationVersion: string;
    modelId: string;
    dimension: number;
    mismatches: string[];
  }> {
    const manifest = await this.getEmbeddingIndexManifest(indexName);
    const mismatches: string[] = [];
    if (!manifest) {
      return { ok: false, rows: 0, serializationVersion: '', modelId: '', dimension: 0, mismatches: ['manifest missing'] };
    }
    if (manifest.status !== 'active') {
      return { ok: false, rows: 0, serializationVersion: manifest.serialization_version, modelId: manifest.model_id, dimension: manifest.dimension, mismatches: [`index not active: ${manifest.status}`] };
    }
    const table = indexName === 'vec_entities' ? 'entity_embedding_metadata' : 'assertion_embedding_metadata';
    const idColumn = indexName === 'vec_entities' ? 'entity_id' : 'assertion_id';
    const rows = await this.all<any>(
      `SELECT ${idColumn} AS id, embedding_model, dimension, serialization_version, normalized
       FROM ${table}`,
    );
    for (const row of rows) {
      if (row.embedding_model !== manifest.model_id) mismatches.push(`model:${row.id}=${row.embedding_model}`);
      if (Number(row.dimension) !== Number(manifest.dimension)) mismatches.push(`dimension:${row.id}=${row.dimension}`);
      if (row.serialization_version !== manifest.serialization_version) mismatches.push(`serialization:${row.id}=${row.serialization_version}`);
      if (row.normalized === null || row.normalized === undefined) mismatches.push(`normalized:${row.id}=null`);
    }
    if (rows.length !== Number(manifest.content_count)) {
      mismatches.push(`count:metadata=${rows.length} manifest=${manifest.content_count}`);
    }
    return {
      ok: mismatches.length === 0,
      rows: rows.length,
      serializationVersion: manifest.serialization_version,
      modelId: manifest.model_id,
      dimension: manifest.dimension,
      mismatches,
    };
  }

  /**
   * Phase 3 guard: verify the resumable shadow build is internally consistent
   * BEFORE it is swapped in. Called by rebuildAllEmbeddings unless explicitly
   * disabled. Prevents silent mixing of old/new embedding generations.
   */
  private async verifyEmbeddingShadowBuildConsistency(
    profile: EmbeddingUsageProfile,
    entityDone: number,
    assertionDone: number,
  ): Promise<void> {
    const entityRows = await this.all<any>(
      'SELECT entity_id AS id, embedding_model, dimension, serialization_version, normalized FROM entity_embedding_metadata_build',
    );
    const assertionRows = await this.all<any>(
      'SELECT assertion_id AS id, embedding_model, dimension, serialization_version, normalized FROM assertion_embedding_metadata_build',
    );
    const problems: string[] = [];
    for (const row of entityRows) {
      if (row.embedding_model !== profile.modelId) problems.push(`entity:${row.id} model=${row.embedding_model}`);
      if (Number(row.dimension) !== Number(profile.dimension)) problems.push(`entity:${row.id} dim=${row.dimension}`);
      if (row.serialization_version !== ENTITY_SERIALIZATION_VERSION) problems.push(`entity:${row.id} serial=${row.serialization_version}`);
      if (row.normalized !== (profile.normalize ? 1 : 0)) problems.push(`entity:${row.id} normalized=${row.normalized}`);
    }
    for (const row of assertionRows) {
      if (row.embedding_model !== profile.modelId) problems.push(`assertion:${row.id} model=${row.embedding_model}`);
      if (Number(row.dimension) !== Number(profile.dimension)) problems.push(`assertion:${row.id} dim=${row.dimension}`);
      if (row.serialization_version !== ASSERTION_SERIALIZATION_VERSION) problems.push(`assertion:${row.id} serial=${row.serialization_version}`);
      if (row.normalized !== (profile.normalize ? 1 : 0)) problems.push(`assertion:${row.id} normalized=${row.normalized}`);
    }
    if (entityRows.length !== entityDone) problems.push(`entity count: build=${entityRows.length} done=${entityDone}`);
    if (assertionRows.length !== assertionDone) problems.push(`assertion count: build=${assertionRows.length} done=${assertionDone}`);
    if (problems.length > 0) {
      throw new Error(`EMBEDDING_SERIALIZATION_MIX: ${problems.slice(0, 20).join('; ')}`);
    }
  }

  /** Explicit management operation. Query/write paths never call this method. */
  async prepareEmbeddingIndexes(specs: EmbeddingIndexSpec[], options: { force?: boolean } = {}): Promise<void> {
    if (!this.vecEnabled) throw new Error('EMBEDDING_INDEX_REBUILD_REQUIRES_SQLITE_VEC');
    const expected = new Map(specs.map((spec) => [spec.indexName, spec]));
    for (const name of ['vec_entities', 'vec_assertions'] as const) {
      if (!expected.has(name)) throw new Error(`Missing embedding index spec: ${name}`);
    }
    const [{ count: entityCount }] = await this.all<{ count: number }>('SELECT COUNT(*) AS count FROM entities');
    const [{ count: assertionCount }] = await this.all<{ count: number }>('SELECT COUNT(*) AS count FROM assertions');
    if (!options.force && entityCount + assertionCount > 0) {
      throw new Error('EMBEDDING_INDEX_REBUILD_REQUIRES_FORCE_FOR_NONEMPTY_DATABASE');
    }

    const now = new Date().toISOString();
    for (const spec of specs) {
      const previous = await this.getEmbeddingIndexManifest(spec.indexName);
      if (previous) {
        await this.run(
          'INSERT INTO embedding_index_manifest_history(index_name, manifest_json, archived_at) VALUES (?, ?, ?)',
          [spec.indexName, JSON.stringify(previous), now],
        );
      }
      await this.run(
        `INSERT INTO embedding_index_manifests(
           index_name, model_id, model_revision, dimension, usage_profile_version,
           serialization_version, status, created_at, activated_at, content_count
         ) VALUES (?, ?, ?, ?, ?, ?, 'building', ?, NULL, 0)
         ON CONFLICT(index_name) DO UPDATE SET
           model_id=excluded.model_id, model_revision=excluded.model_revision,
           dimension=excluded.dimension, usage_profile_version=excluded.usage_profile_version,
           serialization_version=excluded.serialization_version, status='building',
           created_at=excluded.created_at, activated_at=NULL, content_count=0`,
        [spec.indexName, spec.modelId, spec.modelRevision, spec.dimension,
          spec.usageProfileVersion, spec.serializationVersion, now],
      );
    }

    await this.run('DELETE FROM entity_embedding_metadata');
    await this.run('DELETE FROM assertion_embedding_metadata');
    await this.run('UPDATE entities SET embedding = NULL');
    await this.run('DROP TABLE IF EXISTS vec_entities');
    await this.run('DROP TABLE IF EXISTS vec_assertions');
    await this.run(`CREATE VIRTUAL TABLE vec_entities USING vec0(
      entity_id TEXT PRIMARY KEY, embedding FLOAT[${expected.get('vec_entities')!.dimension}]
    )`);
    await this.run(`CREATE VIRTUAL TABLE vec_assertions USING vec0(
      assertion_id TEXT PRIMARY KEY, embedding FLOAT[${expected.get('vec_assertions')!.dimension}]
    )`);
    this.vecDimension = expected.get('vec_entities')!.dimension;
    this.assertionVecDimension = expected.get('vec_assertions')!.dimension;
    this.vecDimensionResolved = true;
    this.assertionVecDimensionResolved = true;
  }

  async activateEmbeddingIndex(indexName: EmbeddingIndexSpec['indexName'], contentCount: number): Promise<void> {
    const result = await this.run(
      `UPDATE embedding_index_manifests
       SET status='active', activated_at=?, content_count=?
       WHERE index_name=? AND status='building'`,
      [new Date().toISOString(), contentCount, indexName],
    );
    if (result.changes !== 1) throw new Error(`Embedding index is not building: ${indexName}`);
  }

  private async assertEmbeddingIndexReady(indexName: EmbeddingIndexSpec['indexName'], dimension: number): Promise<void> {
    const manifest = await this.getEmbeddingIndexManifest(indexName);
    if (!manifest) {
      if (process.env.OMNI_EVALUATION_MODE === '1') {
        throw new Error(`EMBEDDING_INDEX_MANIFEST_MISSING: ${indexName}`);
      }
      return;
    }
    if (manifest.status !== 'active') throw new Error(`EMBEDDING_INDEX_NOT_ACTIVE: ${indexName}:${manifest.status}`);
    if (manifest.dimension !== dimension) {
      throw new Error(`EMBEDDING_INDEX_DIMENSION_MISMATCH: ${indexName} expected=${manifest.dimension} actual=${dimension}`);
    }
  }

  private async getWritableEmbeddingManifest(
    indexName: EmbeddingIndexSpec['indexName'],
    dimension: number,
  ): Promise<EmbeddingIndexManifestRow> {
    const manifest = await this.getEmbeddingIndexManifest(indexName);
    if (!manifest) throw new Error(`EMBEDDING_INDEX_MANIFEST_MISSING: ${indexName}`);
    if (manifest.status !== 'building' && manifest.status !== 'active') {
      throw new Error(`EMBEDDING_INDEX_NOT_WRITABLE: ${indexName}:${manifest.status}`);
    }
    if (manifest.dimension !== dimension) {
      throw new Error(`EMBEDDING_INDEX_DIMENSION_MISMATCH: ${indexName} expected=${manifest.dimension} actual=${dimension}`);
    }
    return manifest;
  }

  private contentSha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private async refreshEmbeddingIndexContentCount(indexName: EmbeddingIndexSpec['indexName']): Promise<void> {
    const table = indexName === 'vec_entities' ? 'vec_entities' : 'vec_assertions';
    await this.run(
      `UPDATE embedding_index_manifests
       SET content_count=(SELECT COUNT(*) FROM ${table})
       WHERE index_name=?`,
      [indexName],
    );
  }

  private assertionFromRow(row: any): Assertion {
    return {
      id: row.id,
      subject_id: row.subject_id,
      predicate: row.predicate,
      original_predicate: row.original_predicate || row.predicate,
      object_id: row.object_id || undefined,
      literal_value: row.literal_value || undefined,
      literal_type: row.literal_type || undefined,
      confidence: row.confidence,
      source_span: row.source_span || undefined,
      provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
      observed_at: row.observed_at || undefined,
      recorded_at: row.recorded_at,
      event_time: row.event_time || undefined,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      temporal_confidence: row.temporal_confidence ?? undefined,
      temporal_source: row.temporal_source || undefined,
      timezone: row.timezone || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
      version: row.version ?? 1,
      previous_version_id: row.previous_version_id || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async getResolvedAssertion(assertionId: string): Promise<{
    id: string;
    assertion: Assertion;
    subjectName: string;
    objectName?: string;
    passage: string;
  } | null> {
    const row = await this.get<any>(
      `SELECT a.*, s.name AS subject_name, o.name AS object_name
       FROM assertions a
       JOIN entities s ON s.id = a.subject_id
       LEFT JOIN entities o ON o.id = a.object_id
       WHERE a.id = ?`,
      [assertionId],
    );
    if (!row) return null;
    const assertion = this.assertionFromRow(row);
    const passage = serializeAssertionPassage({
      assertion,
      subjectName: row.subject_name,
      objectName: row.object_name || undefined,
    });
    return { id: assertion.id, assertion, subjectName: row.subject_name, objectName: row.object_name || undefined, passage };
  }

  async indexAssertion(assertionId: string): Promise<void> {
    if (!this.embeddingService) {
      if (process.env.OMNI_EVALUATION_MODE === '1') throw new Error('ASSERTION_EMBEDDING_SERVICE_NOT_ATTACHED');
      return;
    }
    const resolved = await this.getResolvedAssertion(assertionId);
    if (!resolved) throw new Error(`Assertion not found for embedding: ${assertionId}`);
    const result = await this.embeddingService.embedPassage(resolved.passage);
    const manifest = await this.getWritableEmbeddingManifest('vec_assertions', result.dimensions);
    const blob = Buffer.from(new Float32Array(result.embedding).buffer);
    await this.run('DELETE FROM vec_assertions WHERE assertion_id = ?', [assertionId]);
    await this.run('INSERT INTO vec_assertions(assertion_id, embedding) VALUES (?, ?)', [assertionId, blob]);
    await this.run(
      `INSERT INTO assertion_embedding_metadata(
         assertion_id, embedding_model, model_revision, dimension, usage_profile_version,
         serialization_version, embedded_at, content_sha256, valid_from, valid_until, invalidated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(assertion_id) DO UPDATE SET
         embedding_model=excluded.embedding_model, model_revision=excluded.model_revision,
         dimension=excluded.dimension, usage_profile_version=excluded.usage_profile_version,
         serialization_version=excluded.serialization_version, embedded_at=excluded.embedded_at,
         content_sha256=excluded.content_sha256, valid_from=excluded.valid_from,
         valid_until=excluded.valid_until, invalidated_at=excluded.invalidated_at`,
      [assertionId, manifest.model_id, manifest.model_revision, manifest.dimension,
        manifest.usage_profile_version, manifest.serialization_version, new Date().toISOString(),
        this.contentSha256(resolved.passage), resolved.assertion.valid_from,
        resolved.assertion.valid_until || null, resolved.assertion.invalidated_at || null],
    );
    await this.refreshEmbeddingIndexContentCount('vec_assertions');
  }

  async assertionVectorSearch(
    queryEmbedding: number[],
    limit = 10,
    options: { asOf?: string; includeHistorical?: boolean } = {},
  ): Promise<AssertionVectorSearchResult[]> {
    if (!this.vecEnabled) throw new Error('ASSERTION_VECTOR_SEARCH_REQUIRES_SQLITE_VEC');
    await this._resolveAssertionVecDimension();
    if (queryEmbedding.length !== this.assertionVecDimension) {
      throw new Error(`ASSERTION_VECTOR_DIMENSION_MISMATCH: index=${this.assertionVecDimension} query=${queryEmbedding.length}`);
    }
    await this.assertEmbeddingIndexReady('vec_assertions', queryEmbedding.length);
    const asOf = options.asOf || new Date().toISOString();
    const validity = options.includeHistorical
      ? 'a.valid_from <= ? AND (a.valid_until IS NULL OR a.valid_until > ?)'
      : 'a.invalidated_at IS NULL AND a.valid_from <= ? AND (a.valid_until IS NULL OR a.valid_until > ?)';
    const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
    const rows = await this.all<any>(
      `SELECT a.*, s.name AS subject_name, o.name AS object_name, v.distance
       FROM vec_assertions v
       JOIN assertions a ON a.id = v.assertion_id
       JOIN entities s ON s.id = a.subject_id
       LEFT JOIN entities o ON o.id = a.object_id
       WHERE v.embedding MATCH ? AND k = ? AND ${validity}
       ORDER BY v.distance`,
      [queryBlob, Math.max(1, Math.min(limit, 500)), asOf, asOf],
    );
    return rows.map((row) => {
      const assertion = this.assertionFromRow(row);
      return {
        id: assertion.id,
        assertion,
        subjectName: row.subject_name,
        objectName: row.object_name || undefined,
        passage: serializeAssertionPassage({ assertion, subjectName: row.subject_name, objectName: row.object_name || undefined }),
        distance: row.distance,
        similarity: 1 / (1 + row.distance),
      };
    });
  }

  async rebuildAllEmbeddings(
    service: EmbeddingService,
    onProgress?: (progress: { phase: 'entities' | 'assertions'; done: number; total: number }) => void,
    options: { verifyBeforeActivate?: boolean } = {},
  ): Promise<{ entities: number; assertions: number }> {
    this.attachEmbeddingService(service);
    const profile = service.getUsageProfile();
    const verifyBeforeActivate = options.verifyBeforeActivate !== false;
    const specs: EmbeddingIndexSpec[] = [
      {
        indexName: 'vec_entities', modelId: profile.modelId, modelRevision: profile.modelRevision,
        dimension: profile.dimension, usageProfileVersion: profile.usageProfileVersion,
        serializationVersion: ENTITY_SERIALIZATION_VERSION,
      },
      {
        indexName: 'vec_assertions', modelId: profile.modelId, modelRevision: profile.modelRevision,
        dimension: profile.dimension, usageProfileVersion: profile.usageProfileVersion,
        serializationVersion: ASSERTION_SERIALIZATION_VERSION,
      },
    ];
    const stateKey = 'embedding_rebuild_state';
    const expectedState = {
      fingerprint: profile.fingerprint,
      dimension: profile.dimension,
      entitySerialization: ENTITY_SERIALIZATION_VERSION,
      assertionSerialization: ASSERTION_SERIALIZATION_VERSION,
    };
    const previousStateRaw = await this.getMeta(stateKey);
    let resumable = false;
    if (previousStateRaw) {
      try {
        const previous = JSON.parse(previousStateRaw);
        const shadowTables = await this.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE name IN ('vec_entities_build','vec_assertions_build','entity_embedding_metadata_build','assertion_embedding_metadata_build','entity_embedding_values_build')",
        );
        resumable = shadowTables.length === 5
          && previous.fingerprint === expectedState.fingerprint
          && Number(previous.dimension) === expectedState.dimension
          && previous.entitySerialization === expectedState.entitySerialization
          && previous.assertionSerialization === expectedState.assertionSerialization;
      } catch { resumable = false; }
    }

    if (!resumable) {
      await this.run('DROP TABLE IF EXISTS vec_entities_build');
      await this.run('DROP TABLE IF EXISTS vec_assertions_build');
      await this.run('DROP TABLE IF EXISTS entity_embedding_metadata_build');
      await this.run('DROP TABLE IF EXISTS assertion_embedding_metadata_build');
      await this.run('DROP TABLE IF EXISTS entity_embedding_values_build');
      await this.run(`CREATE VIRTUAL TABLE vec_entities_build USING vec0(
        entity_id TEXT PRIMARY KEY, embedding FLOAT[${profile.dimension}]
      )`);
      await this.run(`CREATE VIRTUAL TABLE vec_assertions_build USING vec0(
        assertion_id TEXT PRIMARY KEY, embedding FLOAT[${profile.dimension}]
      )`);
      await this.run('CREATE TABLE entity_embedding_metadata_build AS SELECT * FROM entity_embedding_metadata WHERE 0');
      await this.run('CREATE TABLE assertion_embedding_metadata_build AS SELECT * FROM assertion_embedding_metadata WHERE 0');
      await this.run('CREATE TABLE entity_embedding_values_build(entity_id TEXT PRIMARY KEY, embedding BLOB NOT NULL)');
      await this.setMeta(stateKey, JSON.stringify({ ...expectedState, status: 'building', startedAt: new Date().toISOString() }));
    }

    const entityRows = await this.all<any>(
      `SELECT * FROM entities
       WHERE COALESCE(json_extract(metadata, '$.merged_into'), '') = ''
       ORDER BY created_at, id`,
    );
    const assertionRows = await this.all<{ id: string }>(
      'SELECT id FROM assertions WHERE invalidated_at IS NULL ORDER BY created_at, id',
    );
    let entityDone = 0;
    let assertionDone = 0;
    try {
      for (const row of entityRows) {
        const entity = this.rowToEntity(row);
        const passage = serializeEntityPassage(entity);
        const contentHash = this.contentSha256(passage);
        const existing = await this.get<{ content_sha256: string }>(
          'SELECT content_sha256 FROM entity_embedding_metadata_build WHERE entity_id = ?', [entity.id],
        );
        if (!existing || existing.content_sha256 !== contentHash) {
          if (existing) {
            await this.run('DELETE FROM vec_entities_build WHERE entity_id = ?', [entity.id]);
            await this.run('DELETE FROM entity_embedding_metadata_build WHERE entity_id = ?', [entity.id]);
            await this.run('DELETE FROM entity_embedding_values_build WHERE entity_id = ?', [entity.id]);
          }
          const result = await service.embedPassage(passage);
          if (result.dimensions !== profile.dimension || result.embedding.length !== profile.dimension) {
            throw new Error(`EMBEDDING_PREFLIGHT_DIMENSION_MISMATCH: expected=${profile.dimension} actual=${result.embedding.length}`);
          }
          await this.run('INSERT INTO vec_entities_build(entity_id, embedding) VALUES (?, ?)', [
            entity.id, Buffer.from(new Float32Array(result.embedding).buffer),
          ]);
          await this.run('INSERT INTO entity_embedding_values_build(entity_id, embedding) VALUES (?, ?)', [
            entity.id, encodeEmbedding(result.embedding),
          ]);
          await this.run(
            `INSERT INTO entity_embedding_metadata_build(
               entity_id, embedding_model, model_revision, dimension, usage_profile_version,
               serialization_version, embedded_at, content_sha256, normalized
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entity.id, profile.modelId, profile.modelRevision, profile.dimension,
              profile.usageProfileVersion, ENTITY_SERIALIZATION_VERSION, new Date().toISOString(), contentHash,
              profile.normalize ? 1 : 0],
          );
        }
        entityDone++;
        onProgress?.({ phase: 'entities', done: entityDone, total: entityRows.length });
      }

      for (const row of assertionRows) {
        const resolved = await this.getResolvedAssertion(row.id);
        if (!resolved) throw new Error(`Assertion not found during rebuild: ${row.id}`);
        const contentHash = this.contentSha256(resolved.passage);
        const existing = await this.get<{ content_sha256: string }>(
          'SELECT content_sha256 FROM assertion_embedding_metadata_build WHERE assertion_id = ?', [row.id],
        );
        if (!existing || existing.content_sha256 !== contentHash) {
          if (existing) {
            await this.run('DELETE FROM vec_assertions_build WHERE assertion_id = ?', [row.id]);
            await this.run('DELETE FROM assertion_embedding_metadata_build WHERE assertion_id = ?', [row.id]);
          }
          const result = await service.embedPassage(resolved.passage);
          if (result.dimensions !== profile.dimension || result.embedding.length !== profile.dimension) {
            throw new Error(`EMBEDDING_PREFLIGHT_DIMENSION_MISMATCH: expected=${profile.dimension} actual=${result.embedding.length}`);
          }
          await this.run('INSERT INTO vec_assertions_build(assertion_id, embedding) VALUES (?, ?)', [
            row.id, Buffer.from(new Float32Array(result.embedding).buffer),
          ]);
          await this.run(
            `INSERT INTO assertion_embedding_metadata_build(
               assertion_id, embedding_model, model_revision, dimension, usage_profile_version,
               serialization_version, embedded_at, content_sha256, valid_from, valid_until, invalidated_at, normalized
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, profile.modelId, profile.modelRevision, profile.dimension,
              profile.usageProfileVersion, ASSERTION_SERIALIZATION_VERSION, new Date().toISOString(), contentHash,
              resolved.assertion.valid_from, resolved.assertion.valid_until || null, null,
              profile.normalize ? 1 : 0],
          );
        }
        assertionDone++;
        onProgress?.({ phase: 'assertions', done: assertionDone, total: assertionRows.length });
      }

      // Phase 3 guard: never swap in a mixed-generation index. Verify the
      // shadow build matches the requested profile before activation.
      if (verifyBeforeActivate) {
        await this.verifyEmbeddingShadowBuildConsistency(profile, entityDone, assertionDone);
      }

      const switchedAt = new Date().toISOString();
      const previousManifests = await this.getEmbeddingIndexManifests();
      await this.withTransaction(async () => {
        for (const manifest of previousManifests) {
          await this.run(
            'INSERT INTO embedding_index_manifest_history(index_name, manifest_json, archived_at) VALUES (?, ?, ?)',
            [manifest.index_name, JSON.stringify(manifest), switchedAt],
          );
        }
        await this.run('DROP TRIGGER IF EXISTS invalidate_assertion_vector_after_update');
        await this.run('DROP TRIGGER IF EXISTS invalidate_assertions_after_entity_text_update');
        await this.run('DROP TABLE IF EXISTS vec_entities');
        await this.run('DROP TABLE IF EXISTS vec_assertions');
        await this.run(`CREATE VIRTUAL TABLE vec_entities USING vec0(
          entity_id TEXT PRIMARY KEY, embedding FLOAT[${profile.dimension}]
        )`);
        await this.run(`CREATE VIRTUAL TABLE vec_assertions USING vec0(
          assertion_id TEXT PRIMARY KEY, embedding FLOAT[${profile.dimension}]
        )`);
        await this.run('INSERT INTO vec_entities(entity_id, embedding) SELECT entity_id, embedding FROM vec_entities_build');
        await this.run('INSERT INTO vec_assertions(assertion_id, embedding) SELECT assertion_id, embedding FROM vec_assertions_build');
        await this.run('DELETE FROM entity_embedding_metadata');
        await this.run('INSERT INTO entity_embedding_metadata SELECT * FROM entity_embedding_metadata_build');
        await this.run('DELETE FROM assertion_embedding_metadata');
        await this.run('INSERT INTO assertion_embedding_metadata SELECT * FROM assertion_embedding_metadata_build');
        await this.run('UPDATE entities SET embedding = (SELECT embedding FROM entity_embedding_values_build b WHERE b.entity_id=entities.id)');
        await this.run('DELETE FROM embedding_index_manifests');
        for (const spec of specs) {
          await this.run(
            `INSERT INTO embedding_index_manifests(
              index_name, model_id, model_revision, dimension, usage_profile_version,
              serialization_version, status, created_at, activated_at, content_count
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
            [spec.indexName, spec.modelId, spec.modelRevision, spec.dimension,
              spec.usageProfileVersion, spec.serializationVersion, switchedAt, switchedAt,
              spec.indexName === 'vec_entities' ? entityDone : assertionDone],
          );
        }
        await this.run('DROP TABLE entity_embedding_metadata_build');
        await this.run('DROP TABLE assertion_embedding_metadata_build');
        await this.run('DROP TABLE entity_embedding_values_build');
        await this.run('DROP TABLE vec_entities_build');
        await this.run('DROP TABLE vec_assertions_build');
        await this.run('DELETE FROM app_meta WHERE key = ?', [stateKey]);
        await this.exec(`
          CREATE TRIGGER invalidate_assertion_vector_after_update
          AFTER UPDATE OF subject_id, predicate, original_predicate, object_id, literal_value,
            literal_type, confidence, source_span, provenance, observed_at, event_time,
            valid_from, valid_until, invalidated_at ON assertions
          BEGIN
            DELETE FROM vec_assertions WHERE assertion_id = NEW.id;
            DELETE FROM assertion_embedding_metadata WHERE assertion_id = NEW.id;
          END;
          CREATE TRIGGER invalidate_assertions_after_entity_text_update
          AFTER UPDATE OF name, description, metadata ON entities
          BEGIN
            DELETE FROM vec_assertions
              WHERE assertion_id IN (
                SELECT id FROM assertions WHERE subject_id = NEW.id OR object_id = NEW.id
              );
            DELETE FROM assertion_embedding_metadata
              WHERE assertion_id IN (
                SELECT id FROM assertions WHERE subject_id = NEW.id OR object_id = NEW.id
              );
          END;
        `);
      });
      this.vecDimension = profile.dimension;
      this.assertionVecDimension = profile.dimension;
      this.vecDimensionResolved = true;
      this.assertionVecDimensionResolved = true;
      await this.setMeta('embedding_model', profile.modelId);
      await this.setMeta('embedding_usage_profile', profile.fingerprint);
      await this.run("DELETE FROM app_meta WHERE key='embedding_rebuild_required'");
      return { entities: entityDone, assertions: assertionDone };
    } catch (error) {
      await this.setMeta(stateKey, JSON.stringify({
        ...expectedState, status: 'interrupted', entityDone, assertionDone,
        updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  }

  async scanEmbeddingIntegrity(): Promise<{
    entity: { active: number; vectors: number; metadata: number; coverage: number };
    assertion: { active: number; vectors: number; metadata: number; coverage: number };
    zeroVectors: number;
    nanVectors: number;
    wrongDimensions: number;
    orphanVectors: number;
    staleVectors: number;
  }> {
    const entityActive = (await this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM entities WHERE json_extract(metadata, '$.merged_into') IS NULL",
    ))?.count || 0;
    const assertionActive = (await this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM assertions WHERE invalidated_at IS NULL',
    ))?.count || 0;
    const entityVectors = (await this.get<{ count: number }>('SELECT COUNT(*) AS count FROM vec_entities'))?.count || 0;
    const assertionVectors = (await this.get<{ count: number }>('SELECT COUNT(*) AS count FROM vec_assertions'))?.count || 0;
    const entityMetadata = (await this.get<{ count: number }>('SELECT COUNT(*) AS count FROM entity_embedding_metadata'))?.count || 0;
    const assertionMetadata = (await this.get<{ count: number }>('SELECT COUNT(*) AS count FROM assertion_embedding_metadata'))?.count || 0;
    const manifests = await this.getEmbeddingIndexManifests();
    // SQLite can surface INTEGER columns as numeric strings depending on the
    // driver/build. Normalize here so the integrity scan reports the vector
    // payload shape, rather than a JS representation mismatch.
    const dimensions = new Map(manifests.map((item) => [item.index_name, Number(item.dimension)]));
    let zeroVectors = 0;
    let nanVectors = 0;
    let wrongDimensions = 0;
    for (const [table, idColumn] of [['vec_entities', 'entity_id'], ['vec_assertions', 'assertion_id']] as const) {
      const rows = await this.all<any>(`SELECT ${idColumn} AS id, embedding FROM ${table}`);
      for (const row of rows) {
        const vector = decodeEmbeddingF32(row.embedding);
        if (vector.length !== dimensions.get(table)) wrongDimensions++;
        if (vector.some((value) => !Number.isFinite(value))) nanVectors++;
        if (vector.every((value) => value === 0)) zeroVectors++;
      }
    }
    const entityOrphans = (await this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM vec_entities v LEFT JOIN entities e ON e.id=v.entity_id WHERE e.id IS NULL',
    ))?.count || 0;
    const assertionOrphans = (await this.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM vec_assertions v LEFT JOIN assertions a ON a.id=v.assertion_id WHERE a.id IS NULL',
    ))?.count || 0;
    let staleVectors = 0;
    const indexedAssertions = await this.all<{ id: string; content_sha256: string }>(
      'SELECT assertion_id AS id, content_sha256 FROM assertion_embedding_metadata',
    );
    for (const row of indexedAssertions) {
      const resolved = await this.getResolvedAssertion(row.id);
      if (!resolved || this.contentSha256(resolved.passage) !== row.content_sha256) staleVectors++;
    }
    return {
      entity: { active: entityActive, vectors: entityVectors, metadata: entityMetadata, coverage: entityActive ? entityVectors / entityActive : 1 },
      assertion: { active: assertionActive, vectors: assertionVectors, metadata: assertionMetadata, coverage: assertionActive ? assertionVectors / assertionActive : 1 },
      zeroVectors, nanVectors, wrongDimensions,
      orphanVectors: entityOrphans + assertionOrphans,
      staleVectors,
    };
  }

  private async _resolveAssertionVecDimension(): Promise<void> {
    if (this.assertionVecDimensionResolved) return;
    this.assertionVecDimensionResolved = true;
    const row = await this.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_assertions'",
    );
    const match = row?.sql?.match(/\[\s*(\d+)\s*\]/);
    if (match) this.assertionVecDimension = Number(match[1]);
  }

  // ── 图分析洞见查询 ──

  /**
   * 按实体 type 分组统计近 N 天的访问量，用于注意力分布异常检测。
   */
  async getAccessCountByType(days: number): Promise<Array<{type: string, total_access: number, entity_count: number}>> {
    return this.all<{type: string, total_access: number, entity_count: number}>(
      `SELECT type, SUM(access_count) as total_access, COUNT(*) as entity_count
       FROM entities
       WHERE created_at > datetime('now', '-' || ? || ' days')
         AND json_extract(metadata, '$.merged_into') IS NULL
       GROUP BY type
       ORDER BY total_access DESC`,
      [days],
    );
  }

  async addMcpUsageLog(entry: {
    toolName: string;
    client?: string;
    query?: string;
    matchedEntities?: Array<{ id: string; name?: string; type?: string }>;
    success: boolean;
    error?: string;
    durationMs: number;
  }): Promise<void> {
    const id = uuidv4();
    const matched = (entry.matchedEntities || [])
      .filter((e) => e && e.id)
      .slice(0, 12)
      .map((e) => ({ id: e.id, name: e.name || '', type: e.type || '' }));

    await this.run(
      `INSERT INTO mcp_usage_log
        (id, tool_name, client, query, matched_entities, success, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id,
        entry.toolName,
        entry.client || null,
        entry.query ? entry.query.slice(0, 500) : null,
        matched.length > 0 ? JSON.stringify(matched) : null,
        entry.success ? 1 : 0,
        entry.error ? entry.error.slice(0, 500) : null,
        Math.max(0, Math.round(entry.durationMs || 0)),
      ],
    );
  }

  async getRecentMcpUsage(limit: number = 20): Promise<Array<{
    id: string;
    toolName: string;
    client: string | null;
    query: string | null;
    matchedEntities: Array<{ id: string; name?: string; type?: string }>;
    success: boolean;
    error: string | null;
    durationMs: number;
    createdAt: string;
  }>> {
    const rows = await this.all<any>(
      `SELECT id, tool_name, client, query, matched_entities, success, error, duration_ms, created_at
       FROM mcp_usage_log
       ORDER BY created_at DESC
       LIMIT ?`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((row) => {
      let matchedEntities: Array<{ id: string; name?: string; type?: string }> = [];
      try {
        matchedEntities = row.matched_entities ? JSON.parse(row.matched_entities) : [];
      } catch {
        matchedEntities = [];
      }
      return {
        id: row.id,
        toolName: row.tool_name,
        client: row.client || null,
        query: row.query || null,
        matchedEntities,
        success: row.success === 1 || row.success === true,
        error: row.error || null,
        durationMs: row.duration_ms || 0,
        createdAt: row.created_at,
      };
    });
  }

  /**
   * 在实体 name/description 中搜索关键词（LIKE 模糊匹配），用于反共识洞见检测。
   */
  async searchEntityByKeyword(keyword: string, limit: number = 10): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE (name LIKE ? OR description LIKE ?)
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
      [`%${keyword}%`, `%${keyword}%`, limit],
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getStats(): Promise<{
    entities: number;
    relationships: number;
    principles: number;
    corePrinciples: number;
    evidence: number;
  }> {
    const entities = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities');
    const relationships = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM relationships');
    const principles = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['principle']);
    const corePrinciples = await this.get<{ count: number }>(`SELECT COUNT(*) as count FROM entities WHERE type = ? AND json_extract(metadata, '$.isCore') = 1`, ['principle']);
    const evidence = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['evidence']);

    return {
      entities: entities?.count || 0,
      relationships: relationships?.count || 0,
      principles: principles?.count || 0,
      corePrinciples: corePrinciples?.count || 0,
      evidence: evidence?.count || 0,
    };
  }
}

export function initDatabase(config: string | DatabaseConfig = './data/omni-context.db'): Database {
  const dbPath = typeof config === 'string' ? config : config.dbPath;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new sqlite3.Database(dbPath);

  // 始终开启外键约束 — 关系表的 ON DELETE CASCADE 才会真正生效，
  // 避免删除实体后留下大量孤儿 relationship 行。
  db.run('PRAGMA foreign_keys = ON');

  if (typeof config === 'object') {
    if (config.enableWAL) {
      db.run('PRAGMA journal_mode = WAL');
    }
    if (config.busyTimeout) {
      db.run(`PRAGMA busy_timeout = ${config.busyTimeout}`);
    }
  }

  // [核心壁垒] 加载 sqlite-vec 扩展（原生向量搜索）
  let vecEnabled = false;
  try {
    sqliteVec.load(db);
    vecEnabled = true;
    console.log('[Database] sqlite-vec 扩展加载成功 ✓');
  } catch (e) {
    console.warn('[Database] sqlite-vec 扩展加载失败，将回退到 JS 内存向量搜索:', e);
  }

  return new Database(db, dbPath, vecEnabled);
}

export default initDatabase;
