// src/lib/llm/tool-loop.ts
//
// The one tool loop: call the model, run the tools it asks for, feed the
// results back, repeat until it answers or the rounds run out.
//
// Daydream's think cycle and the heartbeat turn each carried their own copy of
// this, and they had already drifted (one normalised non-object arguments, one
// did not). The loop is mechanics only — what a tool call DOES, and how its
// result is worded, is the caller's `execute`.
//
// The client comes in already resolved through the gateway (`getLLMClient`), so
// every call still goes via `$lib/llm/client` and is recorded by
// `installUsageCapture`. The usage summed here is for the CALLER's own
// bookkeeping; it is never written to the ledger a second time.

import type OpenAI from 'openai';
import { withActivity } from '$lib/context/activity';
import { combineSignals, isAbortError } from './resilience';

export interface ToolLoopCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ToolLoopStop = 'reply' | 'final' | 'max_rounds' | 'empty' | 'aborted';

export interface ToolLoopOptions {
  client: OpenAI;
  model: string;
  /** Mutated in place: assistant turns, tool results and the forced-final
   *  prompt are appended, so the caller holds the whole transcript after. */
  messages: Array<Record<string, unknown>>;
  /** Omitted from the request when empty. A tool call is only honoured when
   *  tools were offered. */
  tools?: unknown[];
  /** Runs one call; returns the tool message's content. */
  execute: (call: ToolLoopCall, round: number) => Promise<string>;
  /** Model calls that may carry tools. A forced final is one call more. */
  maxRounds: number;
  /** When the rounds run out while the model is still calling tools: one more
   *  call, without tools, with `prompt` appended as a user message. `false`
   *  (the default) ends with an empty reply instead. */
  forceFinal?: { prompt: string; temperature?: number } | false;
  temperature?: number;
  maxTokens?: number;
  /** One `withActivity` around the whole loop, so a turn's spend is one row. */
  activity?: string;
  signal?: AbortSignal;
  /** A ceiling on the WHOLE loop, not per call. */
  timeoutMs?: number;
  onRound?: (r: { round: number; content: string | null; calls: ToolLoopCall[] }) => void | Promise<void>;
}

export interface ToolLoopResult {
  reply: string;
  /** Model calls made, the forced final included. */
  rounds: number;
  calls: ToolLoopCall[];
  usage: { prompt: number; completion: number };
  stop: ToolLoopStop;
}

type RawToolCall = { id: string; function?: { name?: string; arguments?: string } };

/** Malformed or non-object arguments become `{}` — the tool's own defaults apply. */
export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  return {};
}

export function runToolLoop(o: ToolLoopOptions): Promise<ToolLoopResult> {
  return o.activity ? withActivity(o.activity, () => loop(o)) : loop(o);
}

async function loop(o: ToolLoopOptions): Promise<ToolLoopResult> {
  const signal =
    o.timeoutMs != null ? combineSignals(o.signal, o.timeoutMs) : o.signal;
  const tools = o.tools && o.tools.length ? o.tools : null;
  const out: ToolLoopResult = { reply: '', rounds: 0, calls: [], usage: { prompt: 0, completion: 0 }, stop: 'max_rounds' };

  const create = async (withTools: boolean, temperature: number | undefined) => {
    out.rounds++;
    const params = {
      model: o.model,
      ...(temperature != null ? { temperature } : {}),
      ...(o.maxTokens != null ? { max_tokens: o.maxTokens } : {}),
      // The gateway's types are the OpenAI SDK's; these messages carry
      // tool_calls and tool results, which that union spells differently.
      messages: o.messages as never,
      ...(withTools && tools ? { tools: tools as never } : {}),
    };
    // The options argument only when there is a signal, so a scripted client
    // sees exactly the one argument the callers always sent.
    const res = signal
      ? await o.client.chat.completions.create(params, { signal })
      : await o.client.chat.completions.create(params);
    out.usage.prompt += res.usage?.prompt_tokens ?? 0;
    out.usage.completion += res.usage?.completion_tokens ?? 0;
    return res.choices?.[0]?.message;
  };

  try {
    let exhausted = true;
    for (let round = 0; round < o.maxRounds; round++) {
      if (signal?.aborted) return aborted(out);
      const msg = await create(true, o.temperature);
      if (!msg) {
        exhausted = false;
        break;
      }
      const raw = tools ? ((msg as { tool_calls?: RawToolCall[] }).tool_calls ?? []) : [];
      const calls: ToolLoopCall[] = raw.map((tc) => ({
        id: tc.id,
        name: tc.function?.name ?? '',
        args: parseToolArgs(tc.function?.arguments),
      }));
      await o.onRound?.({ round, content: msg.content ?? null, calls });
      if (calls.length === 0) {
        out.reply = (msg.content ?? '').trim();
        out.stop = 'reply';
        return out;
      }
      o.messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: raw });
      for (const call of calls) {
        if (signal?.aborted) return aborted(out);
        out.calls.push(call);
        const content = await o.execute(call, round);
        o.messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }

    if (!o.forceFinal) {
      out.stop = exhausted ? 'max_rounds' : 'empty';
      return out;
    }
    // Out of rounds (or the model sent nothing) while still looking: one last
    // call, without tools, for the answer.
    if (signal?.aborted) return aborted(out);
    o.messages.push({ role: 'user', content: o.forceFinal.prompt });
    const msg = await create(false, o.forceFinal.temperature ?? o.temperature);
    out.reply = (msg?.content ?? '').trim();
    out.stop = 'final';
    return out;
  } catch (err) {
    if (signal?.aborted && isAbortError(err)) return aborted(out);
    throw err;
  }
}

function aborted(out: ToolLoopResult): ToolLoopResult {
  out.reply = '';
  out.stop = 'aborted';
  return out;
}
