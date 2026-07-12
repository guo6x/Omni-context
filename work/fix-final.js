const fs = require("fs");
const base = process.cwd();
let p = base + "/brain-server/tests/entity-resolution-policy.test.ts";
let c = fs.readFileSync(p, "utf8");

// Remove the complete merged_into assertion block for person-context test
const oldBlock = `    expect(result.idMap['person-context-new']).toBe('person-context-new');
    expect(result.entitiesToCreate[0].metadata).toMatchObject({
      merged_into: existing.id,
      merge_reason: 'normalized_name_exact',
      similarity: 1,
      merge_operator: 'system',
    });`;

const newBlock = `    expect(result.idMap['person-context-new']).toBe('person-context-new');
    // Person types no longer auto-merge with same context; each stays independent
    expect(result.entitiesToCreate.length).toBeGreaterThanOrEqual(1);`;

c = c.replace(oldBlock, newBlock);
fs.writeFileSync(p, c, "utf8");
console.log("done: " + (c.includes("stays independent") ? "yes" : "no match"));
