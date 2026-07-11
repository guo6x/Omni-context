export type PrincipleType =
  | 'code_principle'
  | 'design_pattern'
  | 'workflow_rule'
  | 'personal_preference'
  | 'security_rule'
  | 'performance_optimization';

import {
  SINGLE_VALUED_RELATIONSHIP_TYPES,
  type EntityType,
  type NotificationType,
  type RelationshipType,
} from './schema/domain.js';

export type { EntityType, NotificationType, RelationshipType } from './schema/domain.js';

export const SINGLE_VALUED_REL_TYPES: RelationshipType[] = [...SINGLE_VALUED_RELATIONSHIP_TYPES];

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  access_count: number;
  source_file?: string;
  tags?: string[];
  embedding?: number[];
  metadata?: Record<string, any>;
}

export interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  type: RelationshipType;
  description?: string;
  weight: number;
  created_at: string;
  last_activated: string;
  valid_from: string;
  valid_until?: string;
  invalidated_at?: string;
  invalidation_reason?: string;
}

export interface GraphRAGOutput {
  entities: Entity[];
  relationships: Relationship[];
  principles: Entity[];
}

export interface Notification {
  id: string;
  title: string;
  content: string;
  type: NotificationType;
  related_entities?: string[];
  read_status: boolean;
  created_at: string;
}
