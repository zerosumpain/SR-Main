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
 * signatures, for the same reason `$lib/deepdive/meter.ts` does it: the LLM call
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
