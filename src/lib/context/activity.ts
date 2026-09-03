/**
 * Which ACTIVITY is spending the money.
 *
 * The durable ledger (`agent_actions`) has always recorded provider, model,
 * tokens and cost. What it could not record is the role that made the call: 877
 * of 1,047 local `llm_call` rows carry `source = 'gateway'`, which is every LLM
 * task on the site that is not a workflow node or a research run — entity
 * extraction, vision/OCR, embeddings, the deck art director, the nightly
 * self-improve pass, the workflow doctor. $4.43 of $5.99 in one undifferentiated
 * bucket. You could see that the site spent the money; you could not see what
 * spent it, and so you could not decide what to move to a cheaper model.
 *
 * The id written here is a WORKLOAD id from `$lib/models/workloads` — the same
 * registry the model picker writes to. That is deliberate: it makes the spend
 * table and the model-routing table joinable on one key, so a row that says
 * "vision cost $2.10 this month" is the same row that changes what vision runs
 * on.
 *
 * The id travels on an AsyncLocalStorage rather than through the call
 * signatures, for the same reason `$lib/context/research-meter.ts` does it: the LLM call
 * is several frames below the code that knows which role it is serving, and
 * those frames are shared with callers that have no role at all. Outside a
 * wrapped call every function here is a no-op.
 *
 * Deliberately NOT done with `AsyncLocalStorage.enterWith()` inside
 * `resolveWorkloadModel`, which would have been one line and covered every call
 * site automatically. `enterWith` sets the store for the REST of the current
 * async context, so the tag would leak onto every later LLM call in the same
 * request — an OCR pass tagged onto the chat turn that followed it. That
 * mis-attributes rather than under-attributes, and a confident wrong number is
 * worse in a cost ledger than an honest blank.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const activity = new AsyncLocalStorage<{ id: string }>();

/**
 * Run `fn` with `id` as the ambient activity, so every LLM call it makes lands
 * in the ledger attributed to that role.
 *
 * Wrap the LLM call, not the model resolution — resolving is free and the tag
 * only means anything while a request is in flight.
 */
export function withActivity<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return activity.run({ id }, fn);
}

/** The activity this code is executing inside, or null when there is none. */
export function currentActivityId(): string | null {
  return activity.getStore()?.id ?? null;
}

/**
 * A compact "who spent this" hint for a call that carried NO activity tag.
 *
 * The `source:gateway` row on /admin/ops/costs is, by construction, spend that
 * nothing has claimed — and for months it was the largest line on the bill with
 * no way to find out what was in it. Every diagnosis meant auditing every LLM
 * call site by hand and reasoning from model ids and cron times. This makes the
 * bucket say what is in it.
 *
 * Only called when there is no ambient activity, so the cost falls to nothing
 * as the leaks are closed — and even then it sits next to a network round trip
 * measured in hundreds of milliseconds.
 *
 * The server bundle is NOT minified and keeps its function names, and chunks are
 * named after the module they came from, so a frame reads as something like
 * `groundClaim@ground.server-BqK1z.js:274` — enough to open the right file. It
 * deliberately does not try to resolve sourcemaps: reading 1,476 `.map` files at
 * runtime to prettify a diagnostic would cost more than the thing it diagnoses.
 */
export function untaggedOrigin(): string | null {
  if (activity.getStore()) return null;
  const prev = Error.stackTraceLimit;
  Error.stackTraceLimit = 24;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = prev;

  for (const raw of stack.split('\n').slice(2)) {
    const line = raw.trim();
    if (/node:internal|node_modules|[/\\]openai[/\\]/.test(line)) continue;

    // "at fnName (/path/to/chunk.js:12:34)" or "at /path/to/chunk.js:12:34"
    const m = /^at\s+(?:(.+?)\s+\()?(.*?):(\d+):\d+\)?$/.exec(line);
    if (!m) continue;
    const [, fn, file, lineNo] = m;
    const base = file.split(/[/\\]/).pop() ?? file;
    if (!base || base === 'index.js') continue;
    // The plumbing every LLM call passes through. Matched on the BASENAME, not
    // the path: an earlier version tested the whole frame, which also excluded
    // any legitimate caller whose directory happened to contain one of these
    // words — it would have blanked exactly the frames worth reporting.
    // This module's own frames need no rule; `slice(2)` has already dropped
    // them, and `withActivity` cannot be on the stack when there is no tag.
    if (/^(usage-capture|usage-log|client|keys)[.-]/.test(base)) continue;

    const name = (fn ?? '').replace(/^(async|new)\s+/, '').split('.').pop();
    const hint = `${name && name !== '<anonymous>' ? `${name}@` : ''}${base}:${lineNo}`;
    return hint.slice(0, 120);
  }
  return null;
}
