import type { LiveEvent } from './log-emitter';
export interface PiAssistantUpdate {
  type: string; contentIndex?: number; delta?: string; content?: string;
  toolCall?: { name?: string; arguments?: Record<string, unknown> };
  partial?: { content?: Array<{ name?: string }> };
}
/** Keep generated source readable, rather than displaying only a file path. */
export function piToolCode(args: Record<string, unknown> = {}): string {
  const path = typeof args.path === 'string' ? args.path : '';
  if (typeof args.command === 'string') return args.command.slice(0, 32000);
  if (typeof args.content === 'string') return `${path}\n${args.content}`.slice(0, 32000);
  if (typeof args.newText === 'string') return `${path}\n${args.newText}`.slice(0, 32000);
  return JSON.stringify(args, null, 2).slice(0, 32000);
}
/** Pi 0.84 emits toolcall_*; keep older transport fixtures compatible. */
export function piLiveUpdate(sub: PiAssistantUpdate, iterationId: string, message: number): LiveEvent | null {
  const base = { iterationId, streamId: `${iterationId}:${message}:${sub.contentIndex ?? 0}` };
  const toolName = sub.toolCall?.name ?? sub.partial?.content?.[sub.contentIndex ?? 0]?.name;
  switch (sub.type) {
    case 'text_delta': return { ...base, type: 'stream_text', delta: sub.delta };
    case 'thinking_delta': return { ...base, type: 'stream_thinking', delta: sub.delta };
    case 'toolcall_start': case 'tool_input_start': return { ...base, type: 'stream_tool_start', toolName };
    case 'toolcall_delta': case 'tool_input_delta': return { ...base, type: 'stream_tool_delta', delta: sub.delta, toolName };
    case 'toolcall_end': case 'tool_input_end': return { ...base, type: 'stream_tool_end', toolName,
      full: sub.toolCall ? piToolCode(sub.toolCall.arguments) : sub.content };
    case 'text_end': case 'thinking_end': return { ...base, type: 'stream_turn_end', full: sub.content };
    default: return null;
  }
}
