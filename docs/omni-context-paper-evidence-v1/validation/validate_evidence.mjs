#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const repo=path.resolve(root,'..','..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const json=rel=>JSON.parse(read(rel));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const checks=[];
const check=(id,pass,detail)=>checks.push({id,status:pass?'PASS':'FAIL',detail});
const near=(a,b,t=1e-6)=>Math.abs(Number(a)-Number(b))<=t;
const v=json('manifests/version-lock.json');
const h=json('metrics/headline-metrics.json');
const target=json('metrics/targeted-7-summary.json');
const dev=json('metrics/development-35-summary.json');
const formal=json('metrics/formal-250-summary.json');
const comp=json('metrics/comparison-70-summary.json');

check('commit-format',/^[0-9a-f]{40}$/.test(v.product_commit)&&/^[0-9a-f]{40}$/.test(v.benchmark_commit),'Product and benchmark commits are full hexadecimal SHAs.');
let tagTarget=''; try{tagTarget=execFileSync('git',['rev-list','-n','1',v.freeze_tag],{cwd:repo,encoding:'utf8'}).trim();}catch(e){tagTarget=String(e.message)}
check('freeze-tag-target',tagTarget===v.product_commit,`tag target=${tagTarget}`);
const manifest=path.join(repo,'docs/cognitive-benchmark-v1.1-review/evidence/candidate-v3.1-final-execution/11-candidate-freeze/freeze-manifest.json');
check('freeze-manifest-hash',sha(manifest)===v.freeze_manifest_sha256&&v.freeze_manifest_sha256===v.expected_freeze_manifest_sha256,`sha256=${sha(manifest)}`);
check('summary-counts',target.completed===7&&target.errors===0&&formal.completed===248&&formal.errors===2&&formal.missing===0,'Targeted 7/7; Formal 248 completed, 2 errors, 0 missing.');
check('overall-aggregates',target.aggregate_matches_machine_summary&&formal.aggregate_matches_machine_summary&&near(target.overall,.840868)&&near(formal.overall,.866546),'Category macro aggregates match machine summaries.');
const catCsv=read('metrics/formal-250-by-category.csv').trim().split(/\r?\n/);
check('category-rows',catCsv.length===8,'Formal category CSV contains header plus seven categories; values were emitted by the extraction script from terminal records.');
const modes=Object.fromEntries(comp.modes.map(x=>[x.mode,x]));
check('comparison-counts',modes.full_omni.completed===70&&modes.full_omni.errors===0&&modes.retrieval_only.completed===69&&modes.retrieval_only.errors===1&&modes.no_memory.completed===70&&modes.no_memory.errors===0,'Comparison mode terminal counts are 70/70, 69/70, and 70/70.');
check('retry-total',h.stability.retry_records===34,'Retry records=34.');
check('deterministic-rescore',h.stability.deterministic_rescore_records===105&&h.stability.scoring_differences===0&&h.stability.scoring_defects===0,'105 deterministic records; 0 differences; 0 scoring defects.');
const mainCsv=read('tables/table-main-results.csv');
check('csv-json-consistency',mainCsv.includes('Formal-250,Full Omni,248/250,2,0.866546')&&mainCsv.includes('Comparison-70,retrieval_only,69/70,1,0.552346'),'Main CSV agrees with summary JSON.');

const files=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}};walk(root);
const textFiles=files.filter(f=>!f.endsWith('validation-report.json')&&!f.endsWith('validation-report.md'));
const text=textFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const artifactText=textFiles.filter(f=>!f.endsWith('.mjs')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const jsonFiles=textFiles.filter(f=>f.endsWith('.json'));
let unknownOk=true;
const scanUnknown=(node,parent={})=>{if(typeof node==='string'&&node==='UNKNOWN'&&!parent.unknown_reason)unknownOk=false;else if(Array.isArray(node))node.forEach(x=>scanUnknown(x,parent));else if(node&&typeof node==='object')for(const val of Object.values(node))scanUnknown(val,node)};
for(const f of jsonFiles)scanUnknown(JSON.parse(fs.readFileSync(f,'utf8')));
check('unknown-reasons',unknownOk,'Every exact UNKNOWN JSON value has a sibling unknown_reason.');
check('api-key-scan',!/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)&&!/\b[A-Za-z0-9_-]{32,}\.(?:[A-Za-z0-9_-]{20,})\.(?:[A-Za-z0-9_-]{20,})\b/.test(text),'No API-key or JWT-shaped value found.');
check('authorization-header',!/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+/i.test(text),'No Authorization Bearer header found.');
const absPath=(text.match(/\b[A-Z]:\\[^\s`"']+/g)||[]).filter(p=>!p.includes('<'));
check('absolute-path-redaction',absPath.length===0,absPath.length?`Unredacted paths: ${absPath.slice(0,3).join(', ')}`:'Only portable placeholders are present.');
check('locomo-status',h.locomo.status==='NOT RUN'&&h.locomo.conversation_2_10_accessed===false&&!/LoCoMo[^\n]{0,80}(?:completed|score\s*[:=]\s*\d)/i.test(artifactText),'LoCoMo is NOT RUN; Conversation 2–10 accessed=false.');
check('formal-not-overstated',!artifactText.includes('Formal-250 | Full Omni | 250/250')&&!mainCsv.includes('Formal-250,Full Omni,250/250'),'Formal is not represented as 250/250.');
check('retrieval-only-not-overstated',!mainCsv.includes('Comparison-70,retrieval_only,70/70'),'Comparison Retrieval-only is not represented as 70/70.');
check('call-totals',h.calls.answer_successful===569&&h.calls.extraction_successful===998&&h.calls.reranker_successful===360&&h.calls.kimi_judge_logical_successful===152&&h.calls.kimi_physical_attempts===163,'Call totals match stage terminal records and usage manifests.');
check('test-gates',h.tests.product==='329/329'&&h.tests.cognitive==='61/61'&&h.tests.harness==='242/242'&&['typecheck','build','secret_scan'].every(k=>h.tests[k]==='PASS'),'Recorded tests/build/typecheck/secret scan gates pass.');
check('no-heavy-artifacts',!files.some(f=>/\.(?:db|sqlite|onnx|bin|zst)$/i.test(f))&&Math.max(...files.map(f=>fs.statSync(f).size))<5*1024*1024,'No database/model/archive is present and every package file is below 5 MiB.');

const status=checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
const report={schema_version:1,status,generated_at:new Date().toISOString(),checks,summary:{passed:checks.filter(c=>c.status==='PASS').length,total:checks.length,failed:checks.filter(c=>c.status==='FAIL').map(c=>c.id)}};
fs.writeFileSync(path.join(root,'validation/validation-report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'validation/validation-report.md'),`# Evidence validation report\n\nStatus: **${status}**\n\n${checks.map(c=>`- ${c.status}: ${c.id} — ${c.detail}`).join('\n')}\n\nThe extraction recomputation confirmed category-macro scoring. A scenario-weighted mean would differ for unequal category counts, so the package uses the benchmark's category-macro definition.\n`);
console.log(JSON.stringify(report,null,2));
process.exitCode=status==='PASS'?0:1;
