# Database Migration Plan

Status: PARTIALLY_FIXED

## Applied migration sequence

- v13: scoped device tokens.
- v14: canonical entity, relationship, and notification type constraints.
- v15: first-class Entity time fields and the Assertion table.

Migrations are append-only and recorded in the `migrations` table. Existing tables are not rebuilt or destructively replaced.

## v15 upgrade behavior

1. Add nullable temporal columns to `entities`.
2. Backfill `recorded_at` and `valid_from` from `created_at`.
3. Create `assertions` with confidence, validity, provenance, and referential constraints.
4. Create subject/predicate, object, validity, and recorded-time indexes.
5. Copy each existing Relationship to an Assertion with ID `relationship:<relationship_id>`.
6. Preserve the original Relationship for compatibility and graph traversal.

The backfill uses `INSERT OR IGNORE`, making relationship conversion idempotent. Automated tests open a persisted database shaped as v14, apply v15, and verify both the legacy relationship and its new Assertion survive.

## Forward migrations still required

- Assertion conflict/audit transaction tables.
- Behavior events and corrected decay baseline fields.
- Decision outcomes and review reminders.
- Complete portable export/import coverage for every new table and index.

Each future migration must include an old-database upgrade test, a round-trip backup test, and a downgrade statement in release notes. Database rollback is restore-from-backup rather than destructive reverse migration.
