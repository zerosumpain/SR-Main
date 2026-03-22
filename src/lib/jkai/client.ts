import OpenAI from 'openai';
import { loadKeys } from '../deepdive/keys';
import type { ChatMessage } from './types';

const SYSTEM_PROMPT = `You are JKAI 2.0, an autonomous assistant with a live Docker sandbox (Python 3.12, Node 22, bash, internet access).

STYLE: Be pithy. Plain language, no filler. Short sentences. Lead with the answer.

HOW EXECUTION WORKS:
- You have a Docker sandbox. When you write a fenced code block, it is executed automatically and the real output is returned to you in the next message.
- Write EXACTLY ONE code block per response. After the closing \`\`\` fence, STOP IMMEDIATELY. Do not write anything else. Do not predict, summarise, or fabricate what the output might be. You will see the real output and can respond to it in your next turn.
- Each code block should do ONE thing. Do not chain multiple commands with && or ;. Do not write long multi-step scripts. One simple action per block. If you need to install something, that's one block. If you need to run a script, that's the next block. Keep it atomic.
- If you need multiple steps, do them one at a time across multiple turns. You will get the output each time.
- NEVER invent or guess command output. Ever. If you haven't received output yet, you don't know what it says.

PLANNING:
- Before non-trivial work, state your plan in a few plain sentences. No formatted lists. Wait for the user to approve before executing.
- Once approved, execute step by step — one code block per turn, respond to the real result, then move to the next step.

WHEN NOT EXECUTING CODE:
- Just talk normally. No code blocks needed for conversation, explanations, or simple answers.`;

export function getJkaiClient(): OpenAI {
  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
  return new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || 'https://api.z.ai/api/coding/paas/v4/',
  });
}

export function getJkaiModel(): string {
  const keys = loadKeys();
  return keys.zaiModel || 'glm-5-turbo';
}

const FENCE_OPEN = /```(bash|python|sh|javascript|typescript|node)\n/;

/**
 * Stream LLM response. Only emits onTextToken for content OUTSIDE code blocks.
 * Code block content is buffered silently. Stops the stream once a complete
 * code block is detected.
 */
export async function collectResponse(
  messages: ChatMessage[],
  onTextToken?: (token: string) => void,
): Promise<string> {
  const client = getJkaiClient();
  const model = getJkaiModel();

  const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  const stream = await client.chat.completions.create({
    model,
    messages: apiMessages,
    stream: true,
    temperature: 0.7,
    max_tokens: 4096,
  });

  let full = '';
  let fenceDetected = false;
  // How much of `full` we've already emitted as text tokens
  let emittedUpTo = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta?.content) continue;

    full += delta.content;

    if (!fenceDetected) {
      // Check if we've hit a code fence opening
      const fenceMatch = full.match(FENCE_OPEN);
      if (fenceMatch) {
        fenceDetected = true;
        const fenceStart = fenceMatch.index!;

        // Emit any text tokens up to (but not including) the fence
        if (fenceStart > emittedUpTo) {
          onTextToken?.(full.slice(emittedUpTo, fenceStart));
          emittedUpTo = fenceStart;
        }
        // From here on, we buffer silently
      } else {
        // No fence yet — check if we might be mid-backtick at the end
        // Hold back the last 4 chars in case they're the start of ```x
        const safeEnd = Math.max(emittedUpTo, full.length - 4);
        if (safeEnd > emittedUpTo) {
          onTextToken?.(full.slice(emittedUpTo, safeEnd));
          emittedUpTo = safeEnd;
        }
      }
    }

    // If we're inside a code block, check for closing fence
    if (fenceDetected) {
      const fenceMatch = full.match(FENCE_OPEN)!;
      const openEnd = fenceMatch.index! + fenceMatch[0].length;
      const afterOpen = full.slice(openEnd);
      const closeIdx = afterOpen.indexOf('```');
      if (closeIdx !== -1) {
        // Complete code block found — truncate and stop
        full = full.slice(0, openEnd + closeIdx + 3);
        try { stream.controller?.abort(); } catch {}
        break;
      }
    }
  }

  // If no fence was detected, flush remaining text
  if (!fenceDetected && emittedUpTo < full.length) {
    onTextToken?.(full.slice(emittedUpTo));
  }

  return full;
}

/**
 * Extract the first fenced code block from text.
 */
export function extractCodeBlock(text: string): {
  lang: string;
  code: string;
  before: string;
  after: string;
} | null {
  const match = text.match(FENCE_OPEN);
  if (!match) return null;

  const fullMatch = text.match(/```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/);
  if (!fullMatch) return null;

  const start = fullMatch.index!;
  const end = start + fullMatch[0].length;
  return {
    lang: fullMatch[1],
    code: fullMatch[2].trimEnd(),
    before: text.slice(0, start),
    after: text.slice(end),
  };
}

export { SYSTEM_PROMPT };
