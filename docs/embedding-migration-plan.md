# Embedding v3 Migration Plan (embedding v3 迁移计划)

> **This round: NO remote model downloads and NO full real re-embed.**
> The migration flow is implemented and verified with **fixtures/mock
> embeddings** only. Running the real migration is a separate, operator-gated
> step (see §6).

## 1. Serialization versions (序列化版本)

The vector passage format is versioned independently for entities and assertions
(`brain-server/src/embedding/serialization.ts`):

| Kind | v1 (legacy) | v2 (interim) | v3 (current) |
|---|---|---|---|
| Entity passage | `entity-passage-v1` (MiniLM-era, no provenance/temporal fields) | `entity-passage-v2` (current: aliases, source chunks, temporal status) | — (v2 is current) |
| Assertion passage | `assertion-passage-v1` (plain triple) | `assertion-passage-v2` (speaker/provenance additions) | `assertion-passage-v3` (current: transition history, raw-event fidelity, exact-value/state key, rejected conflicts) |

Current pins:

```ts
ENTITY_SERIALIZATION_VERSION   = 'entity-passage-v2'
ASSERTION_SERIALIZATION_VERSION = 'assertion-passage-v3'
```

## 2. Embedding generation profiles (生成画像)

An **embedding generation** is the tuple `(model, dimension, serialization
profile, normalized, tokenizer/prefix)`. We define three generations:

| Generation | Model | Dimension | Serialization | Notes |
|---|---|---|---|---|
| v1 (legacy) | `fallback-hash` / MiniLM | 384 | v1-era | pre-profile era; must be migrated, never mixed |
| v2 (interim) | `Xenova/multilingual-e5-small` | 384 | `entity-passage-v2+assertion-passage-v1` | pinned profile `e5-small-prefixed-v2` |
| v3 (target) | `Xenova/multilingual-e5-large` | 1024 | `entity-passage-v2+assertion-passage-v3` | pinned profile `e5-large-v1`; normalized |

Migration target: **v3** (`E5_LARGE_USAGE_PROFILE`).

## 3. No silent mixing (禁止静默混用)

Policy: an index must never silently combine rows from different generations.
Enforcement:

1. **Manifest gating** (existing): `embedding_index_manifests` records per-index
   `model_id`, `dimension`, `serialization_version`, `status`. Search refuses a
   non-active index or a dimension mismatch
   (`EMBEDDING_INDEX_NOT_ACTIVE` / `EMBEDDING_INDEX_DIMENSION_MISMATCH`).
2. **Pre-activation guard (new)**: `rebuildAllEmbeddings` verifies the shadow
   build **before** swap (`verifyBeforeActivate`, default on) — every metadata
   row must match the target profile's model, dimension, serialization version
   and normalized flag, and row counts must match. Failure raises
   `EMBEDDING_SERIALIZATION_MIX` and the **old index stays live**.
3. **Post-activation audit (new)**: `Database.verifyEmbeddingIndexConsistency()`
   audits the active index; the re-embed tool and admin health use it.

Silent mixing is therefore impossible through the supported migration path:
queries keep using the old index until the new one is fully built **and**
verified.

## 4. Per-row metadata recorded in the DB (数据库元数据)

Migration `v28` adds the `normalized` flag; the rest existed since `v24`:

`entity_embedding_metadata` / `assertion_embedding_metadata`:

| Column | Meaning |
|---|---|
| `embedding_model` | model id (e.g. `Xenova/multilingual-e5-large`) |
| `model_revision` | pinned revision |
| `dimension` | vector dimension (1024 for v3) |
| `usage_profile_version` | `e5-large-v1` |
| `serialization_version` | `entity-passage-v2` / `assertion-passage-v3` |
| `normalized` (new, v28) | 1 = L2-normalized |
| `embedded_at` | generation timestamp (generated_at) |
| `content_sha256` | SHA-256 of the serialized passage (content hash) |

`embedding_index_manifests` additionally records `status`
(`building`/`active`/`failed`/`superseded`), `created_at`, `activated_at`,
`content_count`; archived manifests are kept in
`embedding_index_manifest_history`.

## 5. Resumable / interruptible / repeatable re-embed tool

`scripts/re-embed.mjs` wraps the existing resumable shadow-build pipeline
(`Database.rebuildAllEmbeddings`):

- **Resumable**: progress lives in shadow tables
  (`vec_entities_build`, `vec_assertions_build`,
  `entity_embedding_metadata_build`, `assertion_embedding_metadata_build`,
  `entity_embedding_values_build`) + an `app_meta` state key. Rows whose
  `content_sha256` is unchanged are **not** re-embedded.
- **Interruptible**: Ctrl+C after the current row; the partial build survives.
- **Repeatable / idempotent**: re-running a completed migration is a no-op;
  re-running a partial build continues.
- **Safe**: the old index stays queryable until the new build is verified and
  swapped atomically.
- **Fixture mode (this round)**: `--fixture` (default) uses deterministic mock
  embeddings — no model download, no real re-embed.

Usage:

```bash
npm run build   # compile brain-server first (tool imports dist/)
node scripts/re-embed.mjs --db ./data/omni-context.db --profile e5-large --fixture
node scripts/re-embed.mjs --db ./data/omni-context.db --check      # audit active index
```

## 6. Real migration (operator-gated, NOT this round)

When the operator is ready:

1. Install + verify the local model (see `docs/BUILDING.md` / model hash notes).
2. `node scripts/re-embed.mjs --db <db> --profile e5-large --real`.
3. Confirm `verify vec_entities/vec_assertions: OK` before restarting services.

This round **does not** execute step 1-3; `--real` requires an explicitly
installed model and is documented only.

## 7. Verification with fixtures (fixture 验证)

`brain-server/tests/embedding-reembed-migration.test.ts` (3 tests):

1. **metadata recording**: after a fixture v3 rebuild, every
   `entity_embedding_metadata` / `assertion_embedding_metadata` row carries
   model / dimension / serialization / `normalized=1` / content hash /
   `embedded_at`; manifests active; `verifyEmbeddingIndexConsistency` OK.
2. **interrupt & resume**: an interrupted v3 rebuild leaves the old 384-dim
   index active and queryable; a resumed run completes and swaps to 1024-dim.
3. **mix guard**: a tampered shadow row (wrong `serialization_version`) fails
   `EMBEDDING_SERIALIZATION_MIX` **before** activation; the live index is
   unchanged.
