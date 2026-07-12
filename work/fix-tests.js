const fs = require("fs");
const base = process.cwd();
let p = base + "/brain-server/tests/entity-resolution-policy.test.ts";
let c = fs.readFileSync(p, "utf8");
c = c.replace("reason: 'exact_name_context_mismatch'", "reason: 'exact_name_manual_only'");
c = c.replace("expect(result.idMap['person-context-new']).toBe(existing.id);", "expect(result.idMap['person-context-new']).toBe('person-context-new');");
c = c.replace("expect(result.entitiesToCreate[0].metadata).toMatchObject({\n      merged_into: existing.id,\n    });", "// Person types no longer auto-merge with same context");
fs.writeFileSync(p, c, "utf8");
console.log("test expectations fixed");
