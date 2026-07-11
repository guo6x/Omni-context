import { z } from 'zod';

export const DOMAIN_SCHEMA_VERSION = 1;

export const ENTITY_TYPES = [
  'principle', 'evidence', 'concept', 'tool', 'person', 'project', 'code_snippet',
  'architecture_pattern', 'bug_vulnerability', 'business_logic', 'critical_review',
  'capture_snapshot', 'memory', 'decision', 'goal', 'question', 'preference', 'event', 'task',
] as const;

export const RELATIONSHIP_TYPES = [
  'derived_from', 'relates_to', 'depends_on', 'conflicts_with', 'extends', 'cites',
  'belongs_to', 'supported_by', 'extracted_from', 'reviewed_by', 'references',
  'decision_referenced', 'works_at', 'lives_in', 'studies_at', 'married_to',
  'leads_to_conclusion', 'supersedes', 'superseded_by', 'revises', 'invalidates',
  'historical_version_of', 'continues', 'reverses', 'opposed_by', 'outcome_of', 'learned_from',
  'knows', 'uses', 'created_by',
] as const;

export type EntityType = typeof ENTITY_TYPES[number];
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

export const SINGLE_VALUED_RELATIONSHIP_TYPES = [
  'works_at', 'lives_in', 'studies_at', 'married_to', 'leads_to_conclusion',
] as const satisfies readonly RelationshipType[];

export const NOTIFICATION_TYPES = [
  'insight', 'reminder', 'system', 'decay_warning', 'blindspot', 'proactive',
  'proactive_question', 'conflict', 'consolidation',
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);

const MetadataSchema = z.record(z.unknown());
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const EntityCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  type: EntityTypeSchema,
  description: z.string().max(200_000).optional(),
  tags: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  metadata: MetadataSchema.optional(),
  observed_at: IsoTimestampSchema.optional(),
  recorded_at: IsoTimestampSchema.optional(),
  event_time: IsoTimestampSchema.optional(),
  valid_from: IsoTimestampSchema.optional(),
  valid_until: IsoTimestampSchema.optional(),
  temporal_confidence: z.number().min(0).max(1).optional(),
  temporal_source: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
}).strict();

export const EntityUpdateSchema = EntityCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one entity field is required' },
);

export const RelationshipCreateSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  type: RelationshipTypeSchema,
  description: z.string().max(200_000).optional(),
  weight: z.number().min(0).max(1_000).optional(),
  valid_from: IsoTimestampSchema.optional(),
  valid_until: IsoTimestampSchema.optional(),
}).strict();
