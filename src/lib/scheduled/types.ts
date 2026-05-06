export type CallbackKind = 'reply' | 'tool' | 'orchestrator-turn';
export type CallbackStatus = 'pending' | 'fired' | 'failed' | 'cancelled';

export interface ReplyPayload {
  text: string;
  /** Optional: also push via WhatsApp using the conversation's phone number. */
  notifyWhatsApp?: boolean;
}

export interface ToolPayload {
  toolName: string;
  args: Record<string, unknown>;
}

export interface OrchestratorTurnPayload {
  /** The synthetic user message that re-engages the orchestrator. */
  message: string;
}

export type CallbackPayload = ReplyPayload | ToolPayload | OrchestratorTurnPayload;

export interface FireResult {
  ok: boolean;
  summary: string;
  costUsd?: number;
  error?: string;
}
