/**
 * approve / verify / reopen are intentionally fail-closed in D1A.
 * They never touch the dev E2E harness, bridge JSON, Rust stores or any
 * Tauri command. They never read or write anything but stderr.
 */

import { EXIT, errorFor } from '../client/errors.js';
import { printError } from '../client/output.js';

export async function cmdApprove({ json, args }) {
  if (args.length === 0) {
    printError('approve', errorFor.usage('approve requires a plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('approve', errorFor.controlSurfaceLocked('approve'), json);
  return EXIT.FEATURE_LOCKED;
}

export async function cmdVerify({ json, args }) {
  if (args.length > 0) {
    // --success/--verified/--expected/--predicate/--regex/--jsonpath are
    // rejected by the parser as unknown flags; any positional is an error.
    printError('verify', errorFor.usage('verify takes no arguments in this Alpha'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('verify', errorFor.controlSurfaceLocked('verify'), json);
  return EXIT.FEATURE_LOCKED;
}

export async function cmdReopen({ json, args }) {
  if (args.length > 0) {
    printError('reopen', errorFor.usage('reopen takes no arguments'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('reopen', errorFor.featureNotAvailable('reopen'), json);
  return EXIT.FEATURE_LOCKED;
}
