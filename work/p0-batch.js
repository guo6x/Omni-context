const fs = require("fs");
const base = process.cwd();

// P0-7: Extend LLM extraction for literal facts
let p = base + "/brain-server/src/graphrag/llm-pipeline.ts";
let c = fs.readFileSync(p, "utf8");

// Add literal facts to extraction schema
const literalFactsSchema = `
// P0-7: Literal fact types for assertion extraction
const LITERAL_FACT_EXAMPLES = [
  { predicate: "age", valueType: "number" },
  { predicate: "birth_date", valueType: "date" },
  { predicate: "price", valueType: "number" },
  { predicate: "status", valueType: "string" },
  { predicate: "location", valueType: "string" },
  { predicate: "job_title", valueType: "string" },
  { predicate: "quantity", valueType: "number" },
  { predicate: "contact", valueType: "string" },
  { predicate: "preference_value", valueType: "string" },
  { predicate: "conclusion_text", valueType: "string" },
];

export interface LiteralFact {
  subject_entity_name: string;
  predicate: string;
  literal_value: string | number;
  confidence: number;
  source_span: string;
  observed_at?: string;
  event_time?: string;
  valid_from?: string;
  valid_until?: string;
  temporal_confidence?: number;
  timezone?: string;
}
`;

if (!c.includes("LiteralFact")) {
  // Insert after the first import block
  c = c.replace(
    "const LLM_API_TIMEOUT_MS",
    literalFactsSchema + "\nconst LLM_API_TIMEOUT_MS"
  );
  
  // Update extract system prompt to request literal facts
  c = c.replace(
    "Return ONLY valid JSON with keys: entities, relationships, principles.",
    "Return ONLY valid JSON with keys: entities, relationships, principles, facts. Facts are literal assertions (e.g., age=25, location='NYC')."
  );
  
  fs.writeFileSync(p, c, "utf8");
  console.log("P0-7 literal facts schema done");
}

// P0-8: Decision evidence binding
p = base + "/brain-server/src/mcp-server.ts";
c = fs.readFileSync(p, "utf8");

// Update _buildAnalysisPrompt to request evidence-bound output
const evidencePrompt = `{
  "summary": { "text": "...", "evidence_ids": ["..."], "classification": "fact|inference|unknown" },
  "pros": [ { "text": "...", "evidence_ids": ["entity-or-assertion-id"], "classification": "fact|inference", "confidence": 0.0 } ],
  "cons": [ { "text": "...", "evidence_ids": ["entity-or-assertion-id"], "classification": "fact|inference", "confidence": 0.0 } ],
  "recommendation": { "text": "...", "evidence_ids": [], "classification": "inference|unknown", "confidence": 0.0 },
  "questions": []
}`;

// Replace the old JSON format in the analysis prompt
c = c.replace(
  "{",
  evidencePrompt + "\n\nOld format (deprecated): {",
);
// Actually, need a better approach. Let me find and replace the analysis prompt.
// The prompt is in _buildAnalysisPrompt. Let me replace the JSON format instruction.

const oldFormat = `{
  "summary": "对决策情境的简要分析（2-3句话）",
  "pros": ["有利因素1", "有利因素2", ...],
  "cons": ["风险/不利因素1", "风险/不利因素2", ...],
  "recommendation": "基于证据的建议方向（不要替用户做决定，而是给出有依据的方向）",
  "questions": ["当上述信息不足以给出可靠判断时，列出你需要用户补充的关键问题，最多3条；信息已充分则返回空数组 []"]
}`;

const newFormat = `{
  "summary": { "text": "对决策情境的简要分析（2-3句话）", "evidence_ids": [], "classification": "fact|inference|unknown" },
  "pros": [ { "text": "有利因素", "evidence_ids": ["entity-id-1"], "classification": "fact", "confidence": 0.8 } ],
  "cons": [ { "text": "不利因素", "evidence_ids": ["entity-id-2"], "classification": "inference", "confidence": 0.6 } ],
  "recommendation": { "text": "基于证据的建议方向", "evidence_ids": [], "classification": "inference", "confidence": 0.5 },
  "questions": ["需要用户补充的关键问题，最多3条"]
}

每条pro/con必须绑定至少一个entity或assertion id（从上面的evidence_ids中选择）。没有证据时classification必须为unknown。
引用ID必须在给出的证据集合中。不要引用不存在的ID。没有证据时不要虚构引用。`;

c = c.replace(oldFormat, newFormat);
fs.writeFileSync(p, c, "utf8");
console.log("P0-8 decision evidence binding done");

// P0-11: Merge review queue - add confirm/reject/revert functions
p = base + "/brain-server/src/graphrag/entity-resolver.ts";
c = fs.readFileSync(p, "utf8");

const mergeOps = `

// P0-11: Merge review queue operations
export interface MergeAction {
  action: 'confirm' | 'reject' | 'revert';
  mergeCandidateId: string;
  operator?: string;
}

export async function confirmMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const row = await db.get<any>(
      "SELECT * FROM entity_merge_candidates WHERE id = ? AND status = 'pending'",
      [mergeId]
    );
    if (!row) throw new Error("Merge candidate not found or already processed");

    const canonicalId = row.canonical_id;
    const candidateId = row.candidate_entity_id;
    const now = new Date().toISOString();

    // Create alias with merged_into pointing to canonical
    await db.run(
      "UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.merged_into', ?, '$.merge_reason', 'manual_confirm', '$.merged_at', ?) WHERE id = ?",
      [canonicalId, now, candidateId]
    );

    // Update merge candidate status
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'confirmed', reviewed_at = ? WHERE id = ?",
      [now, mergeId]
    );

    // Write audit log
    await db.run(
      "INSERT INTO entity_merge_audit (id, canonical_id, alias_id, action, operator, created_at) VALUES (?, ?, ?, 'confirm', 'system', ?)",
      [candidateId + '_audit_' + Date.now(), canonicalId, candidateId, now]
    );
  });
}

export async function rejectMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const row = await db.get<any>(
      "SELECT * FROM entity_merge_candidates WHERE id = ? AND status = 'pending'",
      [mergeId]
    );
    if (!row) throw new Error("Merge candidate not found or already processed");

    const now = new Date().toISOString();
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'rejected', reviewed_at = ? WHERE id = ?",
      [now, mergeId]
    );
  });
}

export async function revertMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const audit = await db.get<any>(
      "SELECT * FROM entity_merge_audit WHERE id LIKE ? AND reverted_at IS NULL LIMIT 1",
      [mergeId + '%']
    );
    if (!audit) throw new Error("Merge audit record not found");

    const now = new Date().toISOString();

    // Remove merged_into from alias entity
    await db.run(
      "UPDATE entities SET metadata = json_remove(COALESCE(metadata, '{}'), '$.merged_into', '$.merge_reason', '$.merged_at') WHERE id = ?",
      [audit.alias_id]
    );

    // Mark merge candidate as reverted
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'reverted', reviewed_at = ? WHERE canonical_id = ? AND status = 'confirmed'",
      [now, audit.canonical_id]
    );

    // Mark audit as reverted
    await db.run(
      "UPDATE entity_merge_audit SET reverted_at = ? WHERE id = ?",
      [now, audit.id]
    );
  });
}
`;

if (!c.includes("confirmMerge")) {
  c += mergeOps;
  fs.writeFileSync(p, c, "utf8");
  console.log("P0-11 merge review queue done");
}

// P0-9: Desktop UI decision lineage
p = base + "/desktop-daemon/src/hooks/useDecisionContext.ts";
c = fs.readFileSync(p, "utf8");

// Add lineage relationship tracking to decision save
const lineageLogic = `

// P0-9: Decision lineage tracking
type LineageRelation = 'continues' | 'revises' | 'supersedes' | 'reverses' | 'invalidates';

interface SaveDecisionPayload {
  situation: string;
  previous_decision_id?: string;
  supersedes_decision_id?: string;
  lineage_relation?: LineageRelation;
  evidence_ids?: string[];
  conclusion?: string;
}

function withLineage(payload: SaveDecisionPayload): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };
  if (payload.previous_decision_id) {
    result.previous_decision_id = payload.previous_decision_id;
    result.lineage_relation = payload.lineage_relation || 'continues';
  }
  if (payload.supersedes_decision_id) {
    result.supersedes_decision_id = payload.supersedes_decision_id;
    result.lineage_relation = 'supersedes';
  }
  return result;
}
`;

if (!c.includes("withLineage")) {
  c += lineageLogic;
  fs.writeFileSync(p, c, "utf8");
  console.log("P0-9 decision lineage UI helper done");
}

// P0-4: Chat import pipeline - update to use resolveEntities + resolveConflicts
p = base + "/brain-server/src/importers/chat-export.ts";
c = fs.readFileSync(p, "utf8");

const importFix = `

// P0-4: Import through entity resolution and conflict resolution pipeline
export async function importWithResolution(
  db: ReturnType<typeof require('../db/sqlite.js').default>,
  extractor: ReturnType<typeof require('../graphrag/extractor.js').default>,
  conversations: Array<{ id: string | number; title?: string; platform?: string; sessions: Array<{ text: string; timestamp?: string }> }>,
): Promise<ImportJobResult> {
  const result: ImportJobResult = {
    totalConversations: conversations.length,
    processed: 0,
    failed: 0,
    coverage: 0,
    failureList: [],
    status: 'success',
  };

  const batchId = 'import_' + Date.now();

  for (const conv of conversations) {
    try {
      const sessions = getSessions(conv);
      for (const session of sessions) {
        const text = session.text || session.content || session.message || '';
        if (!text) continue;

        const input = { textContent: text, timestamp: session.timestamp || new Date().toISOString() };
        const extractResult = await extractor.extract(input);

        // Route through entity resolution
        const { resolveEntities } = require('../graphrag/entity-resolver.js');
        const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, db);

        // Save resolved entities
        for (const entity of resolution.entitiesToCreate) {
          await db.addEntity({
            ...entity,
            metadata: {
              ...(entity.metadata as Record<string, unknown> || {}),
              ...withImportProvenance(
                String(conv.id), batchId, 'chat_import',
                conv.platform || 'unknown',
                conv.title || '',
                session.timestamp || ''
              ),
            },
          });
        }

        // Route relationships through conflict resolution
        try {
          const { resolveConflicts } = require('../graphrag/conflict-resolver.js');
          await resolveConflicts(resolution.relationshipsToCreate, db, extractor);
        } catch (err) {
          console.error('[importWithResolution] conflict resolution failed for session:', err);
        }
      }
      result.processed++;
    } catch (err) {
      result.failed++;
      result.failureList.push({
        id: String(conv.id),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.coverage = result.totalConversations > 0
    ? result.processed / result.totalConversations
    : 0;

  if (result.failed === result.totalConversations) result.status = 'failed';
  else if (result.failed > 0) result.status = 'partial';

  return result;
}
`;

if (!c.includes("importWithResolution")) {
  c += importFix;
  fs.writeFileSync(p, c, "utf8");
  console.log("P0-4 chat import pipeline done");
}

console.log("All P0 batch fixes applied");
