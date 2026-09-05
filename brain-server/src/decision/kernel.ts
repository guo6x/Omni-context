/**
 * Canonical decision disposition kernel.
 *
 * Goal27 deliberately reuses this kernel for both an original Agent Pilot
 * judgment and a reopened judgment.  It accepts only the trusted evidence
 * surface result; a revision trigger or an outcome can add context, but can
 * never replace this disposition mapping.
 */

export const DECISION_KERNEL_ID = 'omni-context-evidence-decision-kernel-v1' as const;

export const DECISION_DISPOSITIONS = ['DECIDE', 'CLARIFY', 'DEFER', 'BLOCK'] as const;
export type DecisionDisposition = (typeof DECISION_DISPOSITIONS)[number];

export interface DecisionKernelInput {
  evidence_action: 'proceed' | 'retrieve_more' | 'clarify' | 'defer' | 'block';
  mandatory_satisfied: boolean;
  reason_codes: readonly string[];
}

export interface DecisionKernelResult {
  kernel_id: typeof DECISION_KERNEL_ID;
  disposition: DecisionDisposition;
  reason: string;
}

/**
 * The one canonical disposition mapping.  Keep this deliberately small and
 * deterministic: evidence eligibility decides whether a judgment can proceed;
 * a revision never gets a special "mismatch => block" shortcut.
 */
export function runDecisionKernel(input: DecisionKernelInput): DecisionKernelResult {
  const disposition: DecisionDisposition = input.evidence_action === 'proceed'
    ? 'DECIDE'
    : input.evidence_action === 'clarify'
      ? 'CLARIFY'
      : input.evidence_action === 'defer'
        ? 'DEFER'
        : 'BLOCK';
  const reason = input.reason_codes[0]
    ?? (input.mandatory_satisfied ? 'EVIDENCE_SATISFIED' : 'EVIDENCE_MISSING');
  return { kernel_id: DECISION_KERNEL_ID, disposition, reason };
}
