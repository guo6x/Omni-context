const fs = require("fs");
const base = process.cwd();
let p = base + "/brain-server/src/mcp-server.ts";
let c = fs.readFileSync(p, "utf8");

// Fix return type - use exact match with CRLF
c = c.replace(
  "    ranked: RetrievalCandidate[];\r\n    graphContext: { nodes: Entity[]; edges: any[] };\r\n    counts: { text: number; vector: number; temporal: number; graph: number };\r\n  }> {",
  "    ranked: RetrievalCandidate[];\r\n    graphContext: { nodes: Entity[]; edges: any[] };\r\n    assertions: RetrievalCandidate[];\r\n    counts: { text: number; vector: number; temporal: number; graph: number; assertion: number };\r\n  }> {"
);
fs.writeFileSync(p, c, "utf8");
console.log("mcp-server return type fixed (CRLF)");
