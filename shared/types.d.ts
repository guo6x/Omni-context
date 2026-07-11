export type PrincipleType =
    | 'code_principle'
    | 'design_pattern'
    | 'workflow_rule'
    | 'personal_preference'
    | 'security_rule'
    | 'performance_optimization';
import type { EntityType, RelationshipType } from './generated-domain-types';
export type { EntityType, NotificationType, RelationshipType } from './generated-domain-types';
export interface Entity {
    id: string;
    name: string;
    type: EntityType;
    description: string;
    created_at: string;
    updated_at: string;
    source_file?: string;
    tags?: string[];
    embedding?: number[];
    metadata?: Record<string, any>;
    access_count?: number;
    last_accessed?: string;
}
export interface Relationship {
    id: string;
    source_id: string;
    target_id: string;
    type: RelationshipType;
    description?: string;
    weight: number;
    created_at: string;
    last_activated?: string;
}
export interface Principle {
    id: string;
    title: string;
    content: string;
    type: PrincipleType;
    evidence: Evidence[];
    critic_review?: CriticReview;
    created_at: string;
    updated_at: string;
    is_core: boolean;
    version: number;
}
export interface Evidence {
    id: string;
    content: string;
    source_type: 'screenshot' | 'clipboard' | 'log' | 'manual';
    source_file?: string;
    timestamp: string;
    ocr_text?: string;
}
export interface CriticReview {
    score: number;
    vulnerabilities: string[];
    suggestions: string[];
    reviewed_at: string;
    reviewer_model: string;
}
export interface CaptureSnapshot {
    id: string;
    timestamp: string;
    screenshot?: string;
    clipboard?: string;
    active_window?: string;
    system_logs?: string[];
    source: 'physical_button' | 'manual' | 'schedule';
    button_type?: 'precipitate' | 'decision' | 'reset';
}
export interface GraphRAGOutput {
    entities: Entity[];
    relationships: Relationship[];
    principles: Principle[];
}
