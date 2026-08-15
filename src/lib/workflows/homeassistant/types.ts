export interface HAEntity {
  entity_id: string;
  domain: string;
  friendly_name: string;
  area_id: string | null;
  area_name: string | null;
  device_id: string | null;
  state: string;
}

export interface HAArea {
  id: string;
  name: string;
}

export interface HAStateResponse {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HAOperationResult {
  success: boolean;
  data?: unknown;
  error?: string;
  // Plain data object — passed straight through as a node executor `output`,
  // which must satisfy `Record<string, unknown>`.
  [key: string]: unknown;
}

export type HAOperation = 'query_state' | 'call_service' | 'fire_event' | 'get_history' | 'render_template';
