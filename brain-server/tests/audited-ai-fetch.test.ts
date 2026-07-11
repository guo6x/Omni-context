import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditedAiFetch } from '../src/security/audited-ai-fetch.js';

describe('audited AI fetch', () => {
  const auditFile = path.join(os.tmpdir(), `omni-ai-audit-${process.pid}.jsonl`);

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OMNI_REMOTE_AI_ENABLED;
    delete process.env.OMNI_AI_AUDIT_PATH;
    fs.rmSync(auditFile, { force: true });
  });

  it('blocks remote calls when disabled and records metadata without payloads', async () => {
    process.env.OMNI_REMOTE_AI_ENABLED = 'false';
    process.env.OMNI_AI_AUDIT_PATH = auditFile;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const secretPrompt = 'private prompt content';

    await expect(auditedAiFetch('https://provider.example/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-key' },
      body: JSON.stringify({ model: 'model-a', messages: [{ role: 'user', content: secretPrompt }] }),
    }, { purpose: 'test.remote', kind: 'llm' })).rejects.toThrow('REMOTE_AI_DISABLED');

    expect(fetchMock).not.toHaveBeenCalled();
    const audit = fs.readFileSync(auditFile, 'utf8');
    expect(audit).toContain('RemoteAiDisabled');
    expect(audit).not.toContain(secretPrompt);
    expect(audit).not.toContain('secret-key');
  });

  it('allows loopback calls even when remote AI is disabled', async () => {
    process.env.OMNI_REMOTE_AI_ENABLED = 'false';
    process.env.OMNI_AI_AUDIT_PATH = auditFile;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    const response = await auditedAiFetch('http://127.0.0.1:11434/v1/models', {
      method: 'GET',
    }, { purpose: 'test.local', kind: 'llm' });

    expect(response.ok).toBe(true);
    expect(fs.readFileSync(auditFile, 'utf8')).toContain('"remote":false');
  });
});
