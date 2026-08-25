import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const d1b0 = path.join(root, 'docs', 'goal24', 'distribution', 'd1b0');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(d1b0, name), 'utf8'));
const required = [
  'cargo-audit.json', 'cargo-tree-windows.txt', 'brain-npm-audit.json', 'desktop-npm-audit.json',
  'dependency-audit-classification.json', 'trust-boundaries.json', 'public-control-attack-surface.json',
  'd1b0-architecture-decisions.json', 'd1b0-readiness-gate.json', 'public-control-threat-model.md'
];
for (const file of required) assert.ok(fs.existsSync(path.join(d1b0, file)), `missing ${file}`);

const classification = readJson('dependency-audit-classification.json');
assert.equal(classification.unknown_count, 0);
assert.equal(classification.fix_before_d1b, 0);
assert.equal(classification.blocks_d1b, 0);
assert.equal(classification.cargo_audit.completed, true);
assert.equal(classification.npm_audits.brain.completed, true);
assert.equal(classification.npm_audits.desktop.completed, true);
assert.equal(classification.entries.length, 42);
for (const entry of classification.entries) {
  assert.notEqual(entry.classification, 'UNKNOWN', `${entry.source}:${entry.package || entry.crate}`);
  assert.ok(Array.isArray(entry.dependency_path || entry.dependency_path_evidence));
}

const gate = readJson('d1b0-readiness-gate.json');
for (const field of [
  'authoritative_base_exact', 'rustsec_db_fresh', 'cargo_audit_completed',
  'brain_npm_audit_completed', 'desktop_npm_audit_completed', 'threat_model_complete',
  'attack_surface_inventory_complete', 'control_transport_selected', 'approval_auth_model_selected',
  'verify_auth_model_selected', 'browser_origin_policy_selected', 'approval_schema_frozen',
  'verify_schema_frozen', 'replay_policy_frozen', 'retry_policy_frozen', 'audit_policy_frozen',
  'rate_limit_policy_frozen', 'same_user_limit_documented', 'd1b1_prerequisites_complete',
  'd1b2_prerequisites_defined'
]) assert.equal(gate[field], true, `gate field ${field}`);
assert.equal(gate.gate_status, 'PASS');

const omctx = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'omctx', 'package.json'), 'utf8'));
assert.equal(omctx.private, true);
assert.equal(Object.keys(omctx.dependencies || {}).length, 0);
assert.equal(omctx.version, '0.1.0-alpha.0');

const locked = fs.readFileSync(path.join(root, 'packages', 'omctx', 'src', 'commands', 'locked.js'), 'utf8');
assert.match(locked, /controlSurfaceLocked/);
assert.doesNotMatch(locked, /fetch\(|readFile|writeFile|spawn|execFile|sqlite|http/);
const routes = fs.readFileSync(path.join(root, 'brain-server', 'src', 'api', 'routes.ts'), 'utf8');
assert.doesNotMatch(routes, /\/api\/control\/(approve|verify)/);
const client = fs.readFileSync(path.join(root, 'packages', 'omctx', 'src', 'client', 'omni-local-client.js'), 'utf8');
assert.match(client, /redirect:\s*'error'/);
const inventory = readJson('public-control-attack-surface.json');
assert.equal(inventory.generic_escape_surfaces_found, 0);
assert.equal(inventory.blocking_escape_surfaces, 0);
assert.ok(inventory.items.length >= 10);

console.log('D1B0_ARTIFACT_VALIDATION=PASS');
console.log(`D1B0_DEPENDENCY_ENTRIES=${classification.entries.length}`);
console.log(`D1B0_GATE=${gate.gate_status}`);
