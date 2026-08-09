/**
 * Hermes addresses a chat as `chat_<uuid>`. Postgres stores the bare uuid as
 * `jkai_conversations.id`, and `orchestrator_chats.conversation_id` carries an
 * FK to it. Anything crossing that boundary has to strip the prefix, or the
 * read misses and the write is rejected by the constraint.
 *
 * Getting this wrong is not hypothetical: every `targeted` heartbeat action
 * registered since the Hermes cutover stored the prefixed form, so
 * `runTargetedAction` never resolved its conversation and errored on every
 * single tick — 1,905 pulses of "conversation not found", nothing delivered,
 * and no pause because the engine had no failure budget. Three call sites each
 * had to remember the strip; now they don't.
 */
export function normaliseConversationId(id: string): string {
  return id.startsWith('chat_') ? id.slice('chat_'.length) : id;
}

/** Nullable convenience for tool contexts, where `conversationId` is optional. */
export function normaliseOptionalConversationId(
  id: string | null | undefined,
): string | undefined {
  return id ? normaliseConversationId(id) : undefined;
}
