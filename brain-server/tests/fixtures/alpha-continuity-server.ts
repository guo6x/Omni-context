/** Synthetic-only runtime for the targeted Alpha journey. Never uses the app DB. */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { startDesktopImportFixture } from './desktop-import-server.js';

const root = process.env.OMNI_ALPHA_FIXTURE_ROOT;
if (!root || !path.isAbsolute(root) || !existsSync(path.join(root, '.synthetic-alpha-fixture'))) {
  throw new Error('An explicitly owned synthetic fixture directory is required');
}
const output = process.stdout.write.bind(process.stdout);
console.log = () => {};
console.warn = () => {};
console.error = () => {};
const fixture = await startDesktopImportFixture({ dbPath: path.join(root, 'alpha-fixture.sqlite'), decisionAnswers: true });
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  process.stdin.destroy();
  void fixture.close().then(() => output('CLOSED\n'), () => { process.exitCode = 1; });
};
process.stdin.setEncoding('utf8');
process.stdin.once('data', (command) => { if (String(command).trim() === 'SHUTDOWN') close(); });
process.stdin.once('end', close);
process.once('SIGINT', close);
process.once('SIGTERM', close);
output(`READY ${fixture.baseUrl} ${fixture.llmUrl}\n`);
