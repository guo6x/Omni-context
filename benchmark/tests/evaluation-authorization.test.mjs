import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTHETIC_HELDOUT_GATE_CASES,
  executeSyntheticHeldOutGateCase,
} from './helpers/heldout-gate-fixture.mjs';

describe('Final Freeze v1 held-out authorization gate', () => {
  for (const testCase of SYNTHETIC_HELDOUT_GATE_CASES) {
    it(testCase.name, async () => {
      const result = await executeSyntheticHeldOutGateCase(testCase.id);
      assert.equal(result.status, testCase.expected_status);
      assert.equal(result.heldout_dataset_created, false);
      if (testCase.expected_status === 'rejected') {
        assert.match(result.reason, testCase.expected_reason);
      } else {
        assert.equal(result.authorization, 'Omni-Context Evaluation Freeze v1');
      }
    });
  }
});
