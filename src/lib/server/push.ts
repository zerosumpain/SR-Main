export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
  actionEndpoint?: string;
  actionPayload?: Record<string, unknown>;
}

/** Compatibility shim while callers move to an active delivery channel. */
export async function notifyUser(_userId: string, _payload: PushPayload): Promise<void> {}

/** Web push has been retired; background work continues without a browser alert. */
export async function notifyAllSubscribers(_payload: PushPayload): Promise<void> {}
