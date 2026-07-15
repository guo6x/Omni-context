import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeRetrievalTrace } from '../src/retrieval/trace.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('evaluation retrieval trace', () => {
  it('writes stage ranks and hashes the query without storing prompt text or secrets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-trace-'));
    directories.push(directory);
    const result = await writeRetrievalTrace({
      traceDirectory: directory,
      query: 'Which setting is active? secret-token-must-not-appear',
      temporalMode: 'current',
      stages: {
        assertion_vector: [{ id: 'a1', rank: 1, distance: 0.2, score: 0.83 }],
        raw_event_fallback: [{ id: 'a1', rank: 1, score: 0.75 }],
        raw_event_channel_eligibility: [{
          id: 'a1', rank: 1, evidence_kind: 'raw_event', selected: true, final_rank: 1,
          eligible_channels: ['raw_event_fallback'],
          excluded_channels: ['assertion_vector', 'assertion_fts', 'subject_attachment'],
        }],
      },
      candidatePool: [{
        id: 'a1', group_id: 'group-1', type: 'evidence_group', fused_rank: 1, reranker_rank: 1,
        final_rank: 1, reranker_summary: 'STATE: current\nSOURCE_AGENTS: Agent-A',
      }],
      finalContext: [{ evidence_id: 'a1', group_id: 'group-1', fused_rank: 1, final_rank: 1, selection_reason: 'core' }],
    });

    expect(result.status).toBe('written');
    const raw = await readFile(path.join(directory, 'retrieval-trace.jsonl'), 'utf8');
    const trace = JSON.parse(raw.trim());
    expect(trace.query_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.stages.raw_event_fallback[0]).toEqual({ id: 'a1', rank: 1, score: 0.75 });
    expect(trace.stages.raw_event_channel_eligibility[0]).toMatchObject({
      evidence_kind: 'raw_event',
      eligible_channels: ['raw_event_fallback'],
      excluded_channels: ['assertion_vector', 'assertion_fts', 'subject_attachment'],
    });
    expect(trace.candidate_pool[0]).toMatchObject({
      group_id: 'group-1', reranker_rank: 1, reranker_summary: 'STATE: current\nSOURCE_AGENTS: Agent-A',
    });
    expect(raw).not.toContain('Which setting');
    expect(raw).not.toContain('secret-token-must-not-appear');
    expect(raw.toLocaleLowerCase()).not.toContain('api_key');
    expect(raw.toLocaleLowerCase()).not.toContain('authorization');
  });

  it('is disabled when no explicit local trace directory is supplied', async () => {
    const result = await writeRetrievalTrace({
      query: 'query', temporalMode: 'current', stages: {}, candidatePool: [], finalContext: [],
    });
    expect(result).toEqual({ status: 'disabled' });
  });
});
