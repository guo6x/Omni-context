/**
 * Goal24 Checkpoint 8 (Lane A) - Internal trusted evaluator registry.
 *
 * Evaluators are trusted application code registered by the server runtime.
 * There is deliberately no REST / MCP / Skill / LLM / WebView registration
 * path: dynamic provider loading is a separate future security checkpoint.
 * Registration is fail-closed: duplicate capability_id or evaluator_id is
 * rejected, metadata is strictly validated.
 */

import {
  OutcomeEvaluatorV1MetadataSchema,
  type OutcomeEvaluatorV1,
} from './evaluator.js';
import { OutcomeError } from './errors.js';

export class OutcomeEvaluatorRegistry {
  private readonly byCapabilityId = new Map<string, OutcomeEvaluatorV1>();
  private readonly byEvaluatorId = new Map<string, OutcomeEvaluatorV1>();

  register(evaluator: OutcomeEvaluatorV1): void {
    if (!evaluator || typeof evaluator !== 'object') {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'evaluator must be an object');
    }
    const parsed = OutcomeEvaluatorV1MetadataSchema.safeParse(evaluator.metadata);
    if (!parsed.success) {
      throw new OutcomeError(
        'OUTCOME_INPUT_INVALID',
        `evaluator metadata is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    if (this.byCapabilityId.has(parsed.data.capability_id)) {
      throw new OutcomeError('OUTCOME_DUPLICATE_RECORD', `an evaluator is already registered for capability '${parsed.data.capability_id}'`);
    }
    if (this.byEvaluatorId.has(parsed.data.evaluator_id)) {
      throw new OutcomeError('OUTCOME_DUPLICATE_RECORD', `an evaluator with id '${parsed.data.evaluator_id}' is already registered`);
    }
    if (typeof evaluator.deriveExpectation !== 'function' || typeof evaluator.evaluate !== 'function') {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'evaluator must implement deriveExpectation(plan) and evaluate(expectation, observation)');
    }
    this.byCapabilityId.set(parsed.data.capability_id, evaluator);
    this.byEvaluatorId.set(parsed.data.evaluator_id, evaluator);
  }

  getForCapability(capabilityId: string): OutcomeEvaluatorV1 | undefined {
    return this.byCapabilityId.get(capabilityId);
  }

  get(evaluatorId: string): OutcomeEvaluatorV1 | undefined {
    return this.byEvaluatorId.get(evaluatorId);
  }

  list(): readonly OutcomeEvaluatorV1[] {
    return [...this.byCapabilityId.values()].sort((left, right) =>
      left.metadata.capability_id.localeCompare(right.metadata.capability_id),
    );
  }
}
