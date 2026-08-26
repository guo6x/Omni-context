import { describe, expect, it } from 'vitest';
import {
  createProductionAuthorizationRuntime,
} from '../src/approval/production-runtime.js';
import {
  createD1b1ControlledFixture,
  createD1b1ControlledFixtureProviders,
} from '../src/approval/d1b1-controlled-fixture.js';

describe('Goal24 D1B-1 production authorization composition', () => {
  it('uses one authorization service/store for real CP6 plan creation and the control facade', async () => {
    const clockNow = new Date('2026-08-26T00:00:00.000Z');
    const clock = () => clockNow;
    const runtime = createProductionAuthorizationRuntime({
      providers: createD1b1ControlledFixtureProviders(clock),
      clock,
    });

    // Structural identity is the guard against a second empty store behind
    // the control route. The runtime never exports an AuthorizationStore.
    expect(runtime.authorizationService).toBe(runtime.controlRuntime);
    expect(Object.keys(runtime)).not.toContain('store');

    // This creates plans with the real CP6 and CP7 APIs: no authorization
    // record, coverage, risk, plan id or required_approval field is forged.
    const fixture = await createD1b1ControlledFixture(runtime);
    const created = runtime.authorizationService.getAuthorizationRecord(fixture.primary.plan_id)!;

    expect(fixture.primary.plan_state).toBe('awaiting_approval');
    expect(fixture.primary.approval_request_status).toBe('pending');
    expect(runtime.controlRuntime.getAuthorizationRecord(fixture.primary.plan_id)).toMatchObject({
      plan: { plan_id: fixture.primary.plan_id, state: 'awaiting_approval' },
      approval_request: { status: 'pending' },
    });
  });
});
