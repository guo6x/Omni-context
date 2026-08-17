import { EXIT } from '../client/errors.js';
import { printResult } from '../client/output.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HELP_TEXT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'help-text.js'), 'utf8');

export async function cmdHelp({ json }) {
  printResult({
    command: 'help',
    status: 'ok',
    data: null,
    human: HELP_TEXT,
    json,
  });
  return EXIT.SUCCESS;
}
