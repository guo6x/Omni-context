import assert from "node:assert/strict";
import test from "node:test";

import { scanContent, scanPath } from "./scan-secrets.mjs";

test("flags forbidden local secret paths", () => {
  assert.deepEqual(scanPath(".claude/settings.local.json").map((item) => item.rule), [
    "claude-local-settings",
  ]);
  assert.deepEqual(scanPath("config/private.pem").map((item) => item.rule), [
    "private-key-file",
  ]);
  assert.deepEqual(scanPath("brain-server/.env.example"), []);
});

test("reports rule and location without returning the secret value", () => {
  const fakeKey = `sk-${"A".repeat(24)}`;
  const findings = scanContent("fixture.ts", `\nconst value = "${fakeKey}";\n`);

  assert.deepEqual(findings, [{ rule: "openai-key", path: "fixture.ts", line: 2 }]);
  assert.equal(JSON.stringify(findings).includes(fakeKey), false);
});

test("allows explicit placeholders", () => {
  assert.deepEqual(
    scanContent(".env.example", 'API_KEY="your-api-key-placeholder"'),
    [],
  );
});
