import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const FROZEN=path.join(HERE,'confirmatory/frozen');

const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const record=JSON.parse(fs.readFileSync(path.join(FROZEN,'FREEZE_RECORD.json'),'utf8'));

const checks={
  corpus: {
    expected:record.frozen_corpus_sha256,
    actual:sha(path.join(FROZEN,'paired-worlds.jsonl'))
  },
  structural_audit: {
    expected:record.frozen_structural_audit_sha256,
    actual:sha(path.join(FROZEN,'structural-audit.json'))
  },
  generator: {
    expected:record.generator_sha256,
    actual:sha(path.join(HERE,'generate-confirmatory-candidate.mjs'))
  },
  schema: {
    expected:record.schema_sha256,
    actual:sha(path.join(HERE,'paired-world.schema.json'))
  },
  validator_a: {
    expected:record.validator_a_sha256,
    actual:sha(path.join(HERE,'validate-paired-world.mjs'))
  },
  validator_b: {
    expected:record.validator_b_sha256,
    actual:sha(path.join(HERE,'validate-paired-world-b.mjs'))
  },
  structural_audit_source: {
    expected:record.structural_audit_source_sha256,
    actual:sha(path.join(HERE,'audit-confirmatory-structure.mjs'))
  },
  preregistration_draft: {
    expected:record.preregistration_draft_sha256,
    actual:sha(path.join(HERE,'PREREGISTRATION_DRAFT.md'))
  },
  design: {
    expected:record.design_sha256,
    actual:sha(path.join(HERE,'CONFIRMATORY_DESIGN.md'))
  }
};

const mismatches=Object.entries(checks)
  .filter(([,x])=>x.expected!==x.actual)
  .map(([name,x])=>({name,...x}));

const gates=record.gates??{};
const declarations=record.declarations??{};
const errors=[];
if(record.status!=='CORPUS_FROZEN__EXECUTION_NOT_AUTHORIZED') errors.push('bad freeze status');
if(record.pairs!==160||record.worlds!==320) errors.push('frozen size mismatch');
for(const [k,v] of Object.entries(gates)) if(v!==true) errors.push('frozen structural gate false: '+k);
for(const k of [
  'confirmatory_policy_outcomes_executed_before_freeze',
  'confirmatory_monitor_action_outcomes_executed_before_freeze',
  'confirmatory_llm_outputs_executed_before_freeze',
  'confirmatory_retriever_downstream_outcomes_executed_before_freeze'
]) if(declarations[k]!==false) errors.push('pre-freeze outcome declaration is not false: '+k);
if(declarations.confirmatory_execution_authorized!==false) errors.push('freeze record must not authorize execution');

const report={
  schema_version:1,
  status:mismatches.length===0&&errors.length===0?'PASS':'FAIL',
  frozen_commit_expected_parent:record.freeze_source_git_head,
  checks,
  mismatches,
  errors,
  declarations
};

if(process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS') process.exit(1);
