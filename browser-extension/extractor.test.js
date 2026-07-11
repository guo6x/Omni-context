const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const extractorSource = readFileSync(path.join(__dirname, 'extractor.js'), 'utf8');

function runFixture(url, html, title) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.document, 'title', { value: title, configurable: true });
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto, configurable: true });
  dom.window.TextEncoder = TextEncoder;
  dom.window.eval(extractorSource);
  return dom.window;
}

const fixtures = [
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/c/test',
    html: `
      <article data-message-author-role="user"><div class="whitespace-pre-wrap">Plan a release</div></article>
      <article data-message-author-role="assistant"><div class="markdown">Start with tests</div></article>`,
  },
  {
    name: 'Claude',
    url: 'https://claude.ai/chat/test',
    html: `
      <div data-testid="user-message">Review this design</div>
      <div class="font-claude-message">The main risk is migration safety</div>`,
  },
  {
    name: 'Gemini',
    url: 'https://gemini.google.com/app/test',
    html: `
      <user-query><div class="query-text">Summarize the decision</div></user-query>
      <model-response><message-content>Keep evidence with the result</message-content></model-response>`,
  },
];

for (const fixture of fixtures) {
  test(`extracts ordered user and assistant turns from ${fixture.name} fixture`, () => {
    const window = runFixture(fixture.url, fixture.html, `${fixture.name} fixture`);
    const result = window.__omniExtractConversation();
    assert.equal(result.source, fixture.name);
    assert.equal(result.turns, 2);
    assert.equal(result.lastRole, 'assistant');
    assert.match(result.content, /【我】/);
    assert.match(result.content, new RegExp(`【${fixture.name}】`));
  });
}

test('uses a stable SHA-256 conversation signature', async () => {
  const window = runFixture(fixtures[0].url, fixtures[0].html, 'Signature fixture');
  const conversation = window.__omniExtractConversation();
  const first = await window.__omniConversationSignature(conversation);
  const second = await window.__omniConversationSignature(conversation);
  assert.equal(first, second);
  assert.match(first, /^2:[a-f0-9]{64}$/);
});
