import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function rel(p){return path.relative(ROOT,p).replaceAll('\\','/');}

const args=process.argv.slice(2);
const corpus=path.resolve(args[0]??'');
const audit=path.resolve(args[1]??'');
const out=path.resolve(args[2]??'');
if(!args[0]||!args[1]||!args[2]){
  console.error('usage: node make-confirmatory-structure-manifest.mjs <corpus.jsonl> <audit.json> <out.json>');
  process.exit(2);
}
const auditJson=JSON.parse(fs.readFileSync(audit,'utf8'));
const sources={
  generator:path.join(HERE,'generate-confirmatory-candidate.mjs'),
  design:path.join(HERE,'CONFIRMATORY_DESIGN.md'),
  preregistration_draft:path.join(HERE,'PREREGISTRATION_DRAFT.md'),
  schema:path.join(HERE,'paired-world.schema.json'),
  validator_a:path.join(HERE,'validate-paired-world.mjs'),
  validator_b:path.join(HERE,'validate-paired-world-b.mjs'),
  structural_audit:path.join(HERE,'audit-confirmatory-structure.mjs')
};
const sourceHashes=Object.fromEntries(Object.entries(sources).map(([k,p])=>[k,{path:rel(p),sha256:sha(p)}]));
const manifest={
  schema_version:1,
  status:'STRUCTURAL_CANDIDATE_ONLY__CONFIRMATORY_OUTCOMES_FORBIDDEN',
  git_head:process.env.GITHUB_SHA??null,
  node_version:process.version,
  corpus:{path:rel(corpus),sha256:sha(corpus),pairs:auditJson.pairs,worlds:auditJson.worlds},
  audit:{path:rel(audit),sha256:sha(audit),gates:auditJson.gates},
  source_hashes:sourceHashes,
  declarations:{
    decision_policy_outcomes_executed:false,
    monitor_condition_action_outcomes_executed:false,
    llm_outputs_executed:false,
    retriever_downstream_outcomes_executed:false,
    full_preregistration_frozen:false,
    confirmatory_execution_authorized:false
  }
};
fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
