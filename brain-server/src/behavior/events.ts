export const BEHAVIOR_EVENT_TYPES = [
  'captured',
  'viewed',
  'searched',
  'retrieved',
  'cited',
  'edited',
  'decided',
  'task_created',
  'task_completed',
  'alert_shown',
  'alert_clicked',
  'alert_dismissed',
  'alert_rejected',
] as const;

export type BehaviorEventType = typeof BEHAVIOR_EVENT_TYPES[number];

export interface BehaviorEventInput {
  eventType: BehaviorEventType;
  entityId?: string;
  notificationId?: string;
  topic?: string;
  intent?: 'action' | 'informational' | 'deferred' | 'none' | 'unknown';
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  idempotencyKey?: string;
}
