// src/lib/curate/llm-client.ts
//
// Thin wrapper over the project's existing LLM gateway for curate-engine use.
// Mirrors the pattern used in src/lib/jkai/planner.ts and
// src/lib/workflows/nodes/llm-helpers.ts — no direct provider SDK calls.

import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type OpenAI from 'openai';

// ── Public types ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; name: string; input: unknown };

export interface StreamChatOptions {
  system: string;
  messages: ChatMessage[];
  /** Optional tool definitions (OpenAI format). */
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /** Override the model. Defaults to the admin-configured builder default. */
  model?: string;
  max_tokens?: number;
}

export interface OneShotOptions {
  system: string;
  prompt: string;
  /** Optional JSON Schema. If provided, structured output is requested via response_format. */
  schema?: Record<string, unknown>;
  model?: string;
  max_tokens?: number;
}

export type OneShotResult = string | Record<string, unknown>;

// ── Internal: resolve the gateway client ────────────────────────────────

async function resolveClient(): Promise<{ client: OpenAI; model: string }> {
  const ctx = await resolveDefaultModel('builder');
  return getLLMClient(ctx);
}

// ── streamChat ───────────────────────────────────────────────────────────
//
// Streams an LLM conversation. Yields text deltas as they arrive and yields
// tool-use events when the model invokes a tool.
//
// Usage:
//   for await (const chunk of streamChat({ system, messages, tools })) {
//     if (chunk.type === 'text') process.stdout.write(chunk.delta);
//   }

export async function* streamChat(opts: StreamChatOptions): AsyncGenerator<StreamChunk> {
  const { client, model } = await resolveClient();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    ...opts.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: opts.model ?? model,
    messages,
    max_tokens: opts.max_tokens ?? 4096,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (opts.tools && opts.tools.length > 0) {
    params.tools = opts.tools;
    params.tool_choice = 'auto';
  }

  const stream = await client.chat.completions.create(params);

  // Accumulate tool-call arguments across chunks before emitting.
  const pendingToolCalls: Map<number, { name: string; argsJson: string }> = new Map();

  for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Text delta
    if (delta.content) {
      yield { type: 'text', delta: delta.content };
    }

    // Tool call accumulation
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!pendingToolCalls.has(idx)) {
          pendingToolCalls.set(idx, { name: tc.function?.name ?? '', argsJson: '' });
        }
        const pending = pendingToolCalls.get(idx)!;
        if (tc.function?.name) pending.name = tc.function.name;
        if (tc.function?.arguments) pending.argsJson += tc.function.arguments;
      }
    }

    // When the model stops, emit accumulated tool calls
    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
      for (const [, tc] of pendingToolCalls) {
        let input: unknown = {};
        try {
          input = tc.argsJson ? JSON.parse(tc.argsJson) : {};
        } catch {
          input = { _raw: tc.argsJson };
        }
        yield { type: 'tool_use', name: tc.name, input };
      }
      pendingToolCalls.clear();
    }
  }
}

// ── oneShot ──────────────────────────────────────────────────────────────
//
// Non-streaming single-turn call. Returns the full response text, or a
// parsed object when `schema` is provided and the model emits valid JSON.

export async function oneShot(opts: OneShotOptions): Promise<OneShotResult> {
  const { client, model } = await resolveClient();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ];

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model ?? model,
    messages,
    max_tokens: opts.max_tokens ?? 2048,
    stream: false,
  };

  if (opts.schema) {
    params.response_format = { type: 'json_object' };
  }

  const response = await client.chat.completions.create(params);
  const text = response.choices[0]?.message?.content ?? '';

  if (opts.schema) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return text;
    }
  }

  return text;
}
