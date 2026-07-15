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
      },
      candidatePool: [{ id: 'a1', type: 'assertion', fused_rank: 1, final_rank: 1 }],
      finalContext: [{ evidence_id: 'a1', fused_rank: 1, final_rank: 1 }],
    });

    expect(result.status).toBe('written');
    const raw = await readFile(path.join(directory, 'retrieval-trace.jsonl'), 'utf8');
    const trace = JSON.parse(raw.trim());
    expect(trace.query_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.stages.raw_event_fallback[0]).toEqual({ id: 'a1', rank: 1, score: 0.75 });
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
