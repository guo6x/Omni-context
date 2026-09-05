/** Trusted production composition for the persistent Goal27 lifecycle. */

import type { Database } from '../db/sqlite.js';
import type { ProductionAuthorizationRuntime } from '../approval/production-runtime.js';
import { DecisionRevisionService } from './service.js';
import { SqliteDecisionRevisionStore } from './store.js';

export function createProductionRevisionRuntime(
  db: Database,
  authorizationRuntime: ProductionAuthorizationRuntime,
): DecisionRevisionService {
  return new DecisionRevisionService({
    store: new SqliteDecisionRevisionStore(db),
    authorizationService: authorizationRuntime.authorizationService,
    evidenceRuntime: authorizationRuntime.evidenceRuntime,
    verificationRuntime: authorizationRuntime.verificationRuntime,
  });
}
