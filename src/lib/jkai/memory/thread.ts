// The thread inspector's Memory mode — payload shape.
//
// PURE: the schema the client parses and the types both halves share. The
// composer that fills it lives in `thread.server.ts`; anything reaching
// `$lib/db` from a component fails the BUILD, not the type-check (the same
// split as `memories.ts` / `memories.server.ts` in daydream).
//
// What the mode answers, in the owner's words:
//
//   SERVED    what jkai was GIVEN on the last turn      — read from the stamp
//   RELEVANT  what the next turn would most likely get  — retrieval, now
//   THREAD    what this thread wrote, recalled, forgot  — traces + provenance
//   CHANGED   what moved in the store lately, and how   — the state vocabulary
//
// "Used" is a recorded fact (the assistant row's `metadata.memory`), never an
// inference: a thread from before the stamp existed says so.

import { z } from 'zod';

export const memoryStateSchema = z.enum(['forgotten', 'replaced', 'expired', 'expiring', 'pinned', 'current']);

export const threadMemoryRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  content: z.string(),
  confidence: z.string(),
  state: memoryStateSchema,
  origin: z.string(),
  assertion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  pinned: z.boolean(),
  /** Why retrieval surfaced it, when it came from retrieval. */
  recalledBecause: z.string().nullable(),
  entities: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The newer row, when this one was replaced. */
  replacedBy: z.object({ id: z.string(), content: z.string() }).nullable(),
  /** Written from THIS thread. */
  fromThisThread: z.boolean(),
  use: z.object({
    /** Assistant turns in this thread whose stamp names it. */
    servedTurns: z.number(),
    lastServedAt: z.string().nullable(),
    /** Tool events in this thread that touched it. */
    events: z.number(),
  }),
});
export type ThreadMemoryRow = z.infer<typeof threadMemoryRowSchema>;

export const threadMemoryEventSchema = z.object({
  id: z.string(),
  verb: z.enum(['written', 'recalled', 'forgotten']),
  tool: z.string(),
  at: z.string(),
  /** Memories the step named. May be empty when the trace capped the result. */
  memoryIds: z.array(z.string()),
  summary: z.string().nullable(),
  traceId: z.string(),
});
export type ThreadMemoryEvent = z.infer<typeof threadMemoryEventSchema>;

export const threadMemoryPayloadSchema = z.object({
  conversationId: z.string(),
  /** At least one assistant turn in this thread carries a stamp. */
  recorded: z.boolean(),
  lastTurn: z
    .object({
      at: z.string(),
      served: z.number(),
      retrieved: z.number(),
      chars: z.number(),
      budget: z.number(),
      unavailable: z.boolean(),
    })
    .nullable(),
  figures: z.object({
    live: z.number(),
    pinned: z.number(),
    writtenHere: z.number(),
    /** Replaced, forgotten or expired within the last 30 days. */
    stale30d: z.number(),
  }),
  served: z.array(threadMemoryRowSchema),
  /** Retrieved on the last turn but not written — usually the budget. */
  omittedLastTurn: z.number(),
  relevant: z.array(threadMemoryRowSchema),
  /** The query retrieval ran, so the reading is reproducible. */
  relevantQuery: z.string(),
  thread: z.object({
    rows: z.array(threadMemoryRowSchema),
    events: z.array(threadMemoryEventSchema),
  }),
  changed: z.array(threadMemoryRowSchema),
  lastReviewAt: z.string().nullable(),
});
export type ThreadMemoryPayload = z.infer<typeof threadMemoryPayloadSchema>;

export { MEMORY_PROMPT_BUDGET } from './contracts';
