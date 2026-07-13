const assert = require('node:assert/strict');
const test = require('node:test');

const privacy = require('./privacy.js');

test('automatic capture is off and requires an explicitly enabled supported domain', () => {
  assert.equal(privacy.mergeSettings({}).autoCapture, false);
  assert.deepEqual(
    privacy.evaluateCapturePolicy({}, 'https://chatgpt.com/c/1', { automatic: true }),
    { allowed: false, reason: 'auto-disabled', domain: 'chatgpt.com' },
  );
  assert.deepEqual(
    privacy.evaluateCapturePolicy(
      { autoCapture: true, allowedDomains: ['chatgpt.com'] },
      'https://chatgpt.com/c/1',
      { automatic: true },
    ),
    { allowed: true, reason: 'allowed', domain: 'chatgpt.com' },
  );
});

test('migrates legacy default-on users back to explicit consent', () => {
  const migrated = privacy.migrateSettings({
    autoCapture: true,
    allowedDomains: ['chatgpt.com'],
  });
  assert.equal(migrated.autoCapture, false);
  assert.deepEqual(migrated.allowedDomains, []);
  assert.equal(migrated.privacyConsentVersion, 1);
});

test('blocklist and pause override capture while allowlist can opt into a sensitive domain', () => {
  assert.equal(
    privacy.evaluateCapturePolicy(
      { allowedDomains: ['mail.google.com'] },
      'https://mail.google.com/mail/u/0',
      { automatic: false },
    ).allowed,
    true,
  );
  assert.equal(
    privacy.evaluateCapturePolicy(
      { allowedDomains: ['mail.google.com'], blockedDomains: ['google.com'] },
      'https://mail.google.com/mail/u/0',
      { automatic: false },
    ).reason,
    'blocked-domain',
  );
  assert.equal(
    privacy.evaluateCapturePolicy(
      { capturePaused: true, allowedDomains: ['chatgpt.com'] },
      'https://chatgpt.com',
      { automatic: false },
    ).reason,
    'paused',
  );
});

test('redacts common secrets without returning the original values in metadata', () => {
  const fakeKey = `sk-${'A'.repeat(24)}`;
  const result = privacy.redactSensitiveText(`API key ${fakeKey}\npassword=hunter-two`);
  assert.equal(result.text.includes(fakeKey), false);
  assert.equal(result.text.includes('hunter-two'), false);
  assert.equal(result.redactedCount, 2);
  assert.deepEqual(privacy.captureStats(result.text, result.redactedCount), {
    sentCharacters: result.text.length,
    payloadChunks: 1,
    redactedCount: 2,
  });
});

test('reports the real number of 12k transport chunks for long captures', () => {
  assert.deepEqual(privacy.captureStats('x'.repeat(24001), 0), {
    sentCharacters: 24001,
    payloadChunks: 3,
    redactedCount: 0,
  });
});
