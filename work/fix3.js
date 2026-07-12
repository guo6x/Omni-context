const fs = require("fs");
const base = process.cwd();
let p = base + "/brain-server/tests/entity-resolution-policy.test.ts";
let c = fs.readFileSync(p, "utf8");

// Person types no longer auto-merge
c = c.replace(
  "expect(result.idMap['person-context-new']).toBe('person-context-new');",
  "// Person types no longer auto-merge; expect independent entity\n    expect(result.idMap['person-context-new']).toBe('person-context-new');"
);

// Remove the merged_into assertion
c = c.replace(
  "    expect(result.entitiesToCreate[0].metadata).toMatchObject({\r\n      merged_into: existing.id,\r\n      merge_reason: 'normalized_name_exact',\r\n      merge_operator: 'system',\r\n      similarity: 1,\r\n    });",
  "    expect(result.entitiesToCreate.length).toBeGreaterThanOrEqual(1);"
);

fs.writeFileSync(p, c, "utf8");
console.log("done");
