import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudit } from './audit-v1-p2.mjs';
const a=buildAudit();

test('frozen shape',()=>{assert.equal(a.source.samples,180);assert.equal(a.source.rows,1080);});
test('C1 is 30 UDR / 30 WAVR / 30 FEDD',()=>{const m=a.by_condition.C1_HIDDEN;assert.deepEqual([m.unsupported_count,m.wavr_count,m.fedd_count],[30,30,30]);});
test('retrieval UDR differs from WAVR',()=>{assert.deepEqual([
 [a.by_condition.C2_LEXICAL.unsupported_count,a.by_condition.C2_LEXICAL.wavr_count],
 [a.by_condition.C3_HASH_DENSE.unsupported_count,a.by_condition.C3_HASH_DENSE.wavr_count],
 [a.by_condition.C4_HYBRID.unsupported_count,a.by_condition.C4_HYBRID.wavr_count]
],[[56,18],[61,23],[53,24]]);});
test('all F6 C1 surfaces retain superseded cue',()=>{assert.equal(a.f6_cue_audit.visible_superseded_count,30);assert.equal(a.f6_cue_audit.all_have_visible_superseded,true);});
test('C1 recall structure',()=>{assert.equal(a.c1_recall.by_family.F1.recall_mean,0.5);assert.equal(a.c1_recall.by_family.F2.recall_mean,0.5);for(const f of ['F3','F4','F5','F6'])assert.equal(a.c1_recall.by_family[f].recall_mean,0);assert.equal(a.c1_recall.aggregate_mean,0.166667);});
test('C5 oracle identity',()=>{assert.deepEqual(a.c5_oracle_audit,{incomplete_count:87,incomplete_decisive_count:0,complete_count:93,complete_unsupported_count:0});});
test('no covered decisive world violation',()=>{for(const m of Object.values(a.by_condition))assert.equal(m.covered_decisive_world_violation_count,0);});
