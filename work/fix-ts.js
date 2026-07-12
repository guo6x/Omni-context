const fs = require("fs");
const base = process.cwd();

// Fix chat-export.ts: ImportJobResult and withImportProvenance not exported
let p = base + "/brain-server/src/importers/chat-export.ts";
let c = fs.readFileSync(p, "utf8");

// The ImportJobResult interface was defined in round 1 but needs to be exported
// Check if it exists
if (!c.includes("export interface ImportJobResult")) {
  // Add it before the importWithResolution function
  c = c.replace(
    "export async function importWithResolution",
    "export interface ImportJobResult {\n  totalConversations: number;\n  processed: number;\n  failed: number;\n  coverage: number;\n  failureList: Array<{ id: string; error: string }>;\n  status: \"success\" | \"partial\" | \"failed\";\n}\n\nexport async function importWithResolution"
  );
}

// Fix the content/message property access on session type
c = c.replace(
  "const text = session.text || session.content || session.message || \"\";",
  "const text = (session as any).text || (session as any).content || (session as any).message || \"\";"
);

fs.writeFileSync(p, c, "utf8");
console.log("chat-export.ts fixed");

// Fix mcp-server.ts: return type for _retrieveMemoryCandidates
p = base + "/brain-server/src/mcp-server.ts";
c = fs.readFileSync(p, "utf8");

// Fix return type to include assertions and assertion count
c = c.replace(
  "  ): Promise<{\n    ranked: RetrievalCandidate[];\n    graphContext: { nodes: Entity[]; edges: any[] };\n    counts: { text: number; vector: number; temporal: number; graph: number };\n  }> {",
  "  ): Promise<{\n    ranked: RetrievalCandidate[];\n    graphContext: { nodes: Entity[]; edges: any[] };\n    assertions: RetrievalCandidate[];\n    counts: { text: number; vector: number; temporal: number; graph: number; assertion: number };\n  }> {"
);

fs.writeFileSync(p, c, "utf8");
console.log("mcp-server.ts return type fixed");
