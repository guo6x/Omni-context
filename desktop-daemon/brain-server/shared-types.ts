export type PrincipleType =
  | 'code_principle'
  | 'design_pattern'
  | 'workflow_rule'
  | 'personal_preference'
  | 'security_rule'
  | 'performance_optimization';

export type EntityType =
  | 'principle'
  | 'evidence'
  | 'concept'
  | 'tool'
  | 'person'
  | 'project'
  | 'code_snippet'
  | 'architecture_pattern'
  | 'bug_vulnerability'
  | 'business_logic'
  | 'critical_review'
  | 'capture_snapshot'
  | 'memory';

export type RelationshipType =
  | 'derived_from'
  | 'relates_to'
  | 'depends_on'
  | 'conflicts_with'
  | 'extends'
  | 'cites'
  | 'belongs_to'
  | 'supported_by'
  | 'extracted_from'
  | 'reviewed_by'
  | 'references';

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
}

export interface GraphRAGOutput {
  entities: Entity[];
  relationships: Relationship[];
  principles: Entity[];
}
