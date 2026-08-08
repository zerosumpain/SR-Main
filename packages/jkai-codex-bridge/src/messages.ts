/**
 * Translation between the OpenAI chat-completions wire format and the single
 * prompt string a Codex turn takes.
 *
 * Codex threads are stateful and take one input per turn; our callers are
 * stateless and send a whole `messages[]` every time. Rather than trying to map
 * conversations onto persisted Codex threads (which would need a session key
 * the callers don't have, and would leak history between unrelated calls), each
 * request starts a fresh thread and the conversation is rendered into the
 * prompt. Stateless in, stateless out.
 */

export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: unknown;
  /** Present on an assistant turn that asked for tools to be run. */
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  /** Present on a tool result, linking it to the call above. */
  tool_call_id?: string;
  /** Some callers name the tool on the result message. */
  name?: string;
}

/**
 * Render an assistant turn that requested tool calls.
 *
 * Codex has no native slot for "you previously asked to run these", because the
 * bridge aborted that turn and started a fresh thread — so the only way the
 * model knows what it asked for is to read it in the transcript. Without this
 * the follow-up turn sees a tool result with no request attached and tends to
 * re-ask for the same call, looping the caller forever.
 */
function renderToolCalls(m: ChatMessage): string {
  const calls = (m.tool_calls ?? [])
    .map((c) => {
      const name = c.function?.name ?? 'unknown';
      const args = c.function?.arguments ?? '{}';
      return `- ${name}(${args})`;
    })
    .join('\n');
  return calls ? `Assistant requested tool calls:\n${calls}` : '';
}

/** OpenAI allows content to be a string or an array of typed parts. Codex takes
 *  text, so parts are flattened and non-text parts are named rather than
 *  dropped silently — a caller sending an image should see why it had no
 *  effect, not wonder why the answer ignored it. */
export function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const p = part as { type?: string; text?: string };
      if (p?.type === 'text' && typeof p.text === 'string') return p.text;
      if (p?.type === 'image_url') return '[image omitted — Codex cannot accept inline images]';
      return p?.type ? `[${p.type} omitted — Codex accepts text only]` : '';
    })
    .filter(Boolean)
    .join('\n');
}

const ROLE_LABEL: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool result',
};

/**
 * Render messages[] into one prompt.
 *
 * System and developer messages are hoisted into an instruction block at the
 * top — Codex has no separate system channel, and leaving them inline in
 * chronological order made the model treat late instructions as conversational
 * asides rather than standing rules.
 *
 * A single user message with no system prompt (much the commonest shape on this
 * site) is passed through verbatim, with no added scaffolding: wrapping a bare
 * prompt in "User:" labels measurably nudged the model toward chatty,
 * transcript-style replies.
 */
export function messagesToPrompt(messages: ChatMessage[]): string {
  const instructions: string[] = [];
  const turns: string[] = [];

  for (const m of messages) {
    const text = flattenContent(m.content).trim();

    if (m.role === 'system' || m.role === 'developer') {
      if (text) instructions.push(text);
      continue;
    }

    // An assistant turn that only requested tools has no content — skipping it
    // for being empty would drop the request the next tool result answers.
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const rendered = renderToolCalls(m);
      turns.push(text ? `Assistant:\n${text}\n\n${rendered}` : rendered);
      continue;
    }

    if (!text) continue;

    if (m.role === 'tool') {
      const named = m.name ? `Tool result (${m.name}):` : 'Tool result:';
      turns.push(`${named}\n${text}`);
      continue;
    }

    turns.push(`${ROLE_LABEL[m.role] ?? m.role}:\n${text}`);
  }

  const onlyOneUserTurn = messages.filter((m) => m.role !== 'system' && m.role !== 'developer').length === 1;

  if (!instructions.length && onlyOneUserTurn) return turns[0]?.replace(/^User:\n/, '') ?? '';
  if (!instructions.length) return turns.join('\n\n');
  if (onlyOneUserTurn) {
    return `${instructions.join('\n\n')}\n\n---\n\n${turns[0]?.replace(/^User:\n/, '') ?? ''}`;
  }
  return `${instructions.join('\n\n')}\n\n---\n\n${turns.join('\n\n')}`;
}

/** Pull a JSON schema out of `response_format` if the caller asked for one.
 *  Supports the `json_schema` form; bare `{type:'json_object'}` has no schema
 *  to hand Codex, so it becomes an instruction instead (see below). */
export function extractOutputSchema(responseFormat: unknown): unknown | undefined {
  if (!responseFormat || typeof responseFormat !== 'object') return undefined;
  const rf = responseFormat as { type?: string; json_schema?: { schema?: unknown } };
  if (rf.type === 'json_schema' && rf.json_schema?.schema) return rf.json_schema.schema;
  return undefined;
}

/** True for `response_format: {type:'json_object'}` — JSON demanded, no schema
 *  given. Codex's outputSchema needs an actual schema, so the bridge falls back
 *  to instructing the model in the prompt. */
export function wantsBareJson(responseFormat: unknown): boolean {
  if (!responseFormat || typeof responseFormat !== 'object') return false;
  return (responseFormat as { type?: string }).type === 'json_object';
}

export const BARE_JSON_INSTRUCTION =
  'Respond with a single valid JSON object and nothing else — no prose, no markdown fences.';
