export interface RelationshipStyle {
  color: string;
  dash?: number[];
  width: number;
}

export const RELATIONSHIP_STYLES: Record<string, RelationshipStyle> = {
  supports: { color: '#10b981', width: 1.5 },
  depends_on: { color: '#3b82f6', width: 1.5 },
  contradicts: { color: '#ef4444', width: 2 },
  conflicts_with: { color: '#f97316', width: 2 },
  superseded: { color: '#6b7280', dash: [4, 4], width: 1 },
  related_to: { color: '#9ca3af', width: 1 },
  relates_to: { color: '#9ca3af', width: 1 },
};

export const DEFAULT_RELATIONSHIP_STYLE: RelationshipStyle = {
  color: '#64748b',
  width: 1,
};

export function getRelationshipStyle(type: string): RelationshipStyle {
  return RELATIONSHIP_STYLES[type] || DEFAULT_RELATIONSHIP_STYLE;
}
