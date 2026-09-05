/**
 * Goal27's fixed, human-only reopen control boundary.  It deliberately has
 * no generic update, patch, mutation, execution or retry operation.
 */

import type { ControlSession } from './session.js';
import { CONTROL_REOPEN_SCOPE } from './session.js';
import {
  DecisionRevisionService,
  type ReopenDecisionResult,
} from '../revision/service.js';
import { RevisionError } from '../revision/errors.js';

export interface ControlReopenRuntime {
  reopen(rawRequest: unknown, actor: {
    actor_id: 'local-owner';
    actor_kind: 'owner';
    scope: typeof CONTROL_REOPEN_SCOPE;
  }): Promise<ReopenDecisionResult>;
}

export class ControlReopenFacade {
  constructor(private readonly runtime: ControlReopenRuntime | undefined) {}

  async reopen(rawBody: unknown, session: ControlSession): Promise<ReopenDecisionResult> {
    if (session.scope !== CONTROL_REOPEN_SCOPE) {
      throw new RevisionError('REVISION_SCOPE_INSUFFICIENT', 'session is not scoped for reopening');
    }
    if (!this.runtime) {
      throw new RevisionError('REVISION_RUNTIME_UNAVAILABLE', 'revision runtime is unavailable');
    }
    return this.runtime.reopen(rawBody, {
      actor_id: session.actor_id,
      actor_kind: session.actor_kind,
      scope: CONTROL_REOPEN_SCOPE,
    });
  }
}
