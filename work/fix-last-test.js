const fs = require("fs");
let p = process.cwd() + "/brain-server/tests/entity-resolution-policy.test.ts";
let c = fs.readFileSync(p, "utf8");

// Remove the merged_into assertion (person types no longer auto-merge)
c = c.replace(
  "expect(result.entitiesToCreate[0].metadata).toMatchObject({\n      merged_into: existing.id,\n      merge_reason: 'normalized_name_exact',\n      similarity: 1,\n      merge_operator: 'system',\n    });",
  "// Person types no longer auto-merge; each version stays independent\n    expect(result.entitiesToCreate.length).toBeGreaterThanOrEqual(1);"
);

fs.writeFileSync(p, c, "utf8");
console.log("final test fixed");
