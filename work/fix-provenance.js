const fs = require("fs");
const base = process.cwd();
let p = base + "/brain-server/src/importers/chat-export.ts";
let c = fs.readFileSync(p, "utf8");

// Add withImportProvenance before importWithResolution
const helperFn = `
function withImportProvenance(
  convId: string,
  batchId: string,
  source: string,
  platform: string,
  title: string,
  originalTimestamp: string,
): Record<string, unknown> {
  return {
    import_source: source,
    import_platform: platform,
    import_title: title,
    import_original_timestamp: originalTimestamp,
    import_batch_id: batchId,
    import_conversation_id: convId,
  };
}
`;
c = c.replace("export async function importWithResolution", helperFn + "\nexport async function importWithResolution");
fs.writeFileSync(p, c, "utf8");
console.log("withImportProvenance added");
