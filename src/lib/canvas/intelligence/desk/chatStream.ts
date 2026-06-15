// Pure, DOM-free helpers for the research-chat node's SSE-over-POST stream.
// Frames arrive as `data: {json}\n\n`; see POST /api/deepdive/[id]/chat which
// emits {type:'sources'}, then {type:'token'} per delta, then {type:'done'}.

export interface ChatSource {
  n: number;
  title: string;
  domain: string;
  url: string | null;
}

export type ChatFrame =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'token'; token: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

/**
 * Split an accumulated decode buffer on the SSE record separator ("\n\n").
 * Returns the parsed `data:` frames and the trailing partial record (`rest`)
 * to carry into the next read. Non-`data:` lines and malformed JSON are dropped.
 */
export function parseSseFrames(buffer: string): { frames: ChatFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: ChatFrame[] = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data:')) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (evt && typeof evt === 'object' && typeof (evt as { type?: unknown }).type === 'string') {
      frames.push(evt as ChatFrame);
    }
  }
  return { frames, rest };
}

/**
 * Mutate a single (assistant) message in place from one frame. The component
 * is responsible for reassigning `messages = [...messages]` afterwards so
 * Svelte 5 reactivity fires.
 */
export function applyFrame(msg: ChatMessage, frame: ChatFrame): void {
  switch (frame.type) {
    case 'token':
      msg.content += frame.token;
      break;
    case 'sources':
      msg.sources = frame.sources;
      break;
    case 'error':
      msg.content += `\n\n_(${frame.message})_`;
      break;
    case 'done':
    default:
      break;
  }
}
