const fs = require("fs");
const base = process.cwd();

// Fix mcp-server.ts _buildAnalysisPrompt
let p = base + "/brain-server/src/mcp-server.ts";
let c = fs.readFileSync(p, "utf8");

// Find the old JSON format in the analysis prompt
const oldPrompt = `{
  "summary": "对决策情境的简要分析（2-3句话）",
  "pros": ["有利因素1", "有利因素2", ...],
  "cons": ["风险/不利因素1", "风险/不利因素2", ...],
  "recommendation": "基于证据的建议方向（不要替用户做决定，而是给出有依据的方向）",
  "questions": ["当上述信息不足以给出可靠判断时，列出你需要用户补充的关键问题，最多3条；信息已充分则返回空数组 []"]
}`;

const newPrompt = `{
  "summary": { "text": "对决策情境的简要分析（2-3句话）", "evidence_ids": [], "classification": "fact|inference|unknown" },
  "pros": [ { "text": "有利因素", "evidence_ids": ["entity-id-1"], "classification": "fact", "confidence": 0.8 } ],
  "cons": [ { "text": "不利因素", "evidence_ids": ["entity-id-2"], "classification": "inference", "confidence": 0.6 } ],
  "recommendation": { "text": "基于证据的建议方向", "evidence_ids": [], "classification": "inference", "confidence": 0.5 },
  "questions": ["需要用户补充的关键问题，最多3条"]
}

每条pro/con必须绑定至少一个entity或assertion id。没有证据时classification必须为unknown。引用ID必须在给出的证据集合中。`;

c = c.replace(oldPrompt, newPrompt);
fs.writeFileSync(p, c, "utf8");
console.log("mcp-server analysis prompt updated with evidence binding");

// Fix chat-export.ts import pipeline
p = base + "/brain-server/src/importers/chat-export.ts";
c = fs.readFileSync(p, "utf8");

// Add the importWithResolution function with proper ES module imports
const fix = `

// P0-4: Import through entity resolution + conflict resolution pipeline.
// Uses dynamic imports to avoid circular dependency issues at module load time.
export async function importWithResolution(
  db: any,
  extractor: any,
  conversations: Array<{ id: string | number; title?: string; platform?: string; sessions: Array<{ text: string; timestamp?: string }> }>,
): Promise<ImportJobResult> {
  const { resolveEntities } = await import("../graphrag/entity-resolver.js");
  const { resolveConflicts } = await import("../graphrag/conflict-resolver.js");

  const result: ImportJobResult = {
    totalConversations: conversations.length,
    processed: 0,
    failed: 0,
    coverage: 0,
    failureList: [],
    status: "success",
  };

  const batchId = "import_" + Date.now();

  for (const conv of conversations) {
    try {
      const sessions = conv.sessions || [];
      for (const session of sessions) {
        const text = session.text || session.content || session.message || "";
        if (!text) continue;

        const input = {
          textContent: text,
          timestamp: session.timestamp || new Date().toISOString(),
        };
        const extractResult = await extractor.extract(input);

        const resolution = await resolveEntities(
          extractResult.entities,
          extractResult.relationships,
          db,
        );

        for (const entity of resolution.entitiesToCreate) {
          await db.addEntity({
            ...entity,
            metadata: {
              ...(entity.metadata || {}),
              ...withImportProvenance(
                String(conv.id), batchId, "chat_import",
                conv.platform || "unknown",
                conv.title || "",
                session.timestamp || "",
              ),
            },
          });
        }

        try {
          await resolveConflicts(
            resolution.relationshipsToCreate,
            db,
            extractor,
          );
        } catch (err: any) {
          console.error("[importWithResolution] conflict resolution failed:", err.message || err);
        }
      }
      result.processed++;
    } catch (err: any) {
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

  if (result.failed === result.totalConversations) result.status = "failed";
  else if (result.failed > 0) result.status = "partial";

  return result;
}
`;

if (!c.includes("importWithResolution")) {
  c += fix;
  fs.writeFileSync(p, c, "utf8");
  console.log("chat-export importWithResolution added");
}
