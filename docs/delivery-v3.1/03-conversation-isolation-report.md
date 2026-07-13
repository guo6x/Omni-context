# Per-conversation runtime isolation report

Status: `FIXED`

## Production entry change

The benchmark CLI no longer accepts `--brain-server-url` or `BRAIN_SERVER_URL`. A formal run cannot silently connect to a desktop/shared Brain Server. The production runner creates and owns one `ConversationRuntime` per authorized conversation.

Each runtime has its own:

- process and PID file
- dynamically allocated loopback port
- `brain.db`
- `server.log`
- `runtime.json`
- `database-hash.txt`
- conversation directory and result stream

The run layout is now:

```text
Run/
├── conversation-1/
│   ├── brain.db
│   ├── server.log
│   ├── server.pid
│   ├── runtime.json
│   ├── database-hash.txt
│   ├── ingestion.json
│   └── results.jsonl
└── manifest.json
```

Future authorized conversations use the same `conversation-N/` structure. Result-store and metric recomputation read per-conversation JSONL files, with read-only compatibility for legacy runs.

## Empty start, migration, and safe shutdown

- A new runtime refuses to start if its database path already exists.
- Resume refuses to start if the original conversation database is missing.
- The real Brain Server was built and started from an absent DB; migrations completed and initial entity, relationship, principle, core-principle, and evidence counts were all exactly 0.
- Windows shutdown uses an evaluation-only parent/child IPC message. The child closes HTTP and SQLite before exit.
- The real-process smoke exited with code 0. No `brain.db-wal` or `brain.db-shm` remained after shutdown.
- The closed database SHA-256 was `587223a82f5e041c3c2abe4ca4d7ae387f16e0c19c61cc1a3458b47a7a078f91`.

## Port, token, and crash behavior

- Ports are selected dynamically and startup retries up to five times if a race occupies a chosen port.
- Each runtime receives a private token shared only through parent memory and child environment. The token is not persisted to logs, runtime metadata, or reports.
- A runtime marked `starting` or `running` is checked on restart; a still-live orphan is terminated before resume reconnects the original DB.
- `runtime.json` preserves PID/lifecycle state for audit without preserving credentials.

## Resume and ingestion behavior

`ingestion.json` is the durable source of truth. Resume reconnects the original conversation DB and skips ingestion only when that file says `completed`; it does not infer ingestion completion from the presence of one completed question. The production-runner integration test confirms a completed conversation retains one extracted entity after resume rather than creating a duplicate.

## Split boundary

Development mode checks the split before loading data. It then streams exactly Conversation 1 from the official top-level array and stops when the first JSON object closes. A regression test appends deliberately invalid content after Conversation 1 and proves Conversation 1 still loads, demonstrating later content is not parsed.

Conversation 2-10 were not executed, viewed, analyzed, or counted in this task.

## Verification

- A/B process isolation: separate ports, DB paths, logs, and PIDs.
- A-only entity write: visible in A, absent in B; B database entity count remains 0.
- Clean close: DB hash written and no sidecar WAL/SHM remains for the real Brain Server.
- Resume: original A entity remains and ingestion is not repeated.
- Failure paths: new-over-existing DB rejected; missing resume DB rejected; recorded orphan cleaned.
- Production runner integration: required directory layout, real runtime ownership, per-conversation JSONL, manifest DB hash, and stopped lifecycle.
- Full benchmark suite: 154 passed, 0 failed.
- Brain Server TypeScript build: passed.
- Full Brain Server suite: 27 test files passed, 231 tests passed, 0 failed.

## Evidence

- `docs/delivery-v3.1/evidence/conversation-isolation/benchmark-tests.log`
- `docs/delivery-v3.1/evidence/conversation-isolation/brain-server-tests.log`
- `docs/delivery-v3.1/evidence/conversation-isolation/real-runtime/real-runtime-summary.json`
- `docs/delivery-v3.1/evidence/conversation-isolation/real-runtime/conversation-1/server.log`
- `docs/delivery-v3.1/evidence/conversation-isolation/real-runtime/conversation-1/runtime.json`
- `docs/delivery-v3.1/evidence/conversation-isolation/real-runtime/conversation-1/database-hash.txt`
- `docs/delivery-v3.1/evidence/conversation-isolation/real-runtime/conversation-1/brain.db`

## Remaining risk

This closes the isolation P0. Conversation 1 has not yet been fully ingested or answered on the production models in this report; extraction-quality diagnostics and the complete 199-question run are separate blocking tasks.
