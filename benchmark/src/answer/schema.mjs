import { z } from 'zod';

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['assertion', 'entity']),
  source_span: z.string().nullable(),
  temporal_status: z.enum(['current', 'historical']),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  invalidated_at: z.string().nullable(),
  provenance: z.record(z.unknown()).nullable(),
}).passthrough();

export const ClaimSchema = z.object({
  text: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)),
}).strict();

export const StructuredAnswerSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(ClaimSchema),
  abstained: z.boolean(),
  abstention_reason: z.string().min(1).nullable(),
}).strict().superRefine((answer, ctx) => {
  if (answer.abstained && !answer.abstention_reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['abstention_reason'], message: 'is required when abstained=true' });
  }
  if (!answer.abstained && answer.abstention_reason !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['abstention_reason'], message: 'must be null when abstained=false' });
  }
  if (!answer.abstained && answer.claims.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims'], message: 'must contain at least one grounded claim' });
  }
});

export function normalizeEvidence(retrieval) {
  const raw = Array.isArray(retrieval?.evidence) ? retrieval.evidence : [];
  const parsed = z.array(EvidenceSchema).safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Retrieval evidence schema validation failed: ${details}`);
  }
  return parsed.data;
}

export function validateStructuredAnswer(raw, evidence) {
  const parsed = StructuredAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Structured answer schema validation failed: ${details}`);
  }
  const validIds = new Set(evidence.map((item) => item.id));
  for (const [claimIndex, claim] of parsed.data.claims.entries()) {
    for (const evidenceId of claim.evidence_ids) {
      if (!validIds.has(evidenceId)) {
        throw new Error(`Structured answer cites unknown evidence id at claims.${claimIndex}: ${evidenceId}`);
      }
    }
    if (!parsed.data.abstained && claim.evidence_ids.length === 0) {
      throw new Error(`Structured answer contains an ungrounded factual claim at claims.${claimIndex}`);
    }
  }
  return parsed.data;
}
