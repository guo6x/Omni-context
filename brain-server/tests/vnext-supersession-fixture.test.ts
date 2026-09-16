import { afterEach, describe, expect, it } from 'vitest';
import initDatabase, { type Database } from '../src/db/sqlite.js';
import { createProductionAuthorizationRuntime } from '../src/approval/production-runtime.js';
import { createD1b1ControlledFixtureProviders } from '../src/approval/d1b1-controlled-fixture.js';
import { createProductionRevisionRuntime } from '../src/revision/production-runtime.js';
import { createVnextSupersessionControlledFixture } from '../src/revision/vnext-supersession-fixture.js';

const openDatabases: Database[] = [];
afterEach(async () => {
  while (openDatabases.length) await openDatabases.pop()!.close();
});

describe('vNext controlled supersession fixture', () => {
  it('creates a real linear revision with fresh approval and no historical authority reuse', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    openDatabases.push(db);
    await db.runMigrations();

    const clock = () => new Date();
    const authorizationRuntime = createProductionAuthorizationRuntime({
      providers: createD1b1ControlledFixtureProviders(clock),
      clock,
    });
    const revisions = createProductionRevisionRuntime(db, authorizationRuntime);

    const fixture = await createVnextSupersessionControlledFixture(authorizationRuntime, revisions);

    expect(fixture).toMatchObject({
      fixture: 'VNEXT_SUPERSESSION_CONTROLLED_LOCAL_ONLY',
      original_outcome_status: 'MISMATCH',
      current_plan_state: 'awaiting_approval',
      requires_new_approval: true,
      native_execution_started: false,
      external_github_writes: 0,
      synthetic_receipt_registered: true,
      synthetic_readback_registered: true,
      reopen_execution_count: 0,
      old_approval_reused: false,
      old_grant_reused: false,
      old_plan_reused: false,
    });
    expect(fixture.current_decision_id).not.toBe(fixture.original_decision_id);
    expect(fixture.current_plan_id).not.toBe(fixture.original_plan_id);

    const originalProjection = await revisions.projectionForDecision(fixture.original_decision_id);
    const currentProjection = await revisions.projectionForDecision(fixture.current_decision_id);
    expect(originalProjection).toMatchObject({
      root_decision_id: fixture.original_decision_id,
      current_decision_id: fixture.current_decision_id,
      revision_count: 1,
      revision_index: 1,
      revision_status: 'DECIDED',
      trigger_type: 'OUTCOME_MISMATCH',
      current_disposition: 'DECIDE',
      new_plan_pending_approval: true,
    });
    expect(currentProjection).toEqual(originalProjection);

    const currentAuthorization = authorizationRuntime.authorizationService.getAuthorizationRecord(fixture.current_plan_id);
    expect(currentAuthorization?.plan.state).toBe('awaiting_approval');
    expect(currentAuthorization?.plan.approval).toBeNull();
  });
});
