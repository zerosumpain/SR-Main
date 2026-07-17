/**
 * Fixed prompt suite for NL→workflow generation evals.
 *
 * Each case is a natural-language prompt plus the structural expectations the
 * generated graph must satisfy (see `ExpectationSpec` in ./assertions). The
 * cases cover the same archetypes as the golden exemplars the orchestrator is
 * grounded on:
 *
 *   1. scrape → summarise → email
 *   2. cron → fetch → notify
 *   3. gmail-trigger → LLM → reply
 *   4. gmail-trigger → LLM → label  (classification)
 *   5. conditional branch
 *   6. loop / map over a list
 *   7. cron → fetch → store (schedule + persistence)
 *
 * These are scored by ./assertions and run live by ./run-eval (which calls the
 * REAL generateWorkflow). They are NOT executed by the normal vitest suite.
 *
 * Node type names are checked against the real registry (registry-client.ts).
 * `edges`/`hasSchedule` are intentionally lenient on the EXACT type chosen
 * (e.g. scrape can be `web-scrape` OR `stealth-scrape`) — where a case allows
 * alternatives, we assert only the must-have anchor types so legitimate model
 * choices don't false-fail. Tighten per-case as quality improves.
 */

import type { ExpectationSpec, IdempotencySpec } from './assertions';

export interface EvalCase {
  name: string;
  prompt: string;
  expect: ExpectationSpec;
  /**
   * Opt-in two-run idempotency check (B6). When set, run-eval proves the
   * accepted graph's dedupe node filters a re-run to zero new items against the
   * given source-output fixture. See `checkIdempotency` in ./assertions.
   */
  idempotency?: IdempotencySpec;
}

/**
 * Outside-world list-producing source node types. We never pin which one the
 * model chooses (web-scrape vs stealth-scrape vs tavily-search vs http-request),
 * so the memory-on-path assertion accepts any of them as the "source" endpoint.
 * Mirrors the LIST_SOURCE_TYPES set in orchestrator/verify.ts.
 */
const SOURCE_TYPES = [
  'tavily-search',
  'web-scrape',
  'stealth-scrape',
  'stealth-scrape-llm',
  'rss',
  'http-request',
  'gmail-search',
  'gmail-fetch',
  'site-mapper',
];

/** Memory node types that break the "re-send the same item" chain. */
const MEMORY_TYPES = ['dedupe', 'data-store'];

export const evalCases: EvalCase[] = [
  {
    name: 'scrape → summarise → email (recurring digest, must dedupe)',
    prompt:
      'Every morning, scrape the top headlines from a news website, have an LLM summarise them into three bullet points, and email the summary to me at john@example.com.',
    expect: {
      // We don't pin the scrape variant (web-scrape vs stealth-scrape) — assert
      // the LLM-summarise + email anchors that every valid graph must have.
      nodeTypes: ['llm-call', 'email'],
      // A recurring digest MUST remember what it already sent: at least one
      // memory node present…
      nodeTypesAnyOf: [MEMORY_TYPES],
      edges: [{ from: 'llm-call', to: 'email' }],
      // …AND positioned between the fetch and the email, so run 2 re-summarises
      // only genuinely new headlines. This is the exact shape the live pipeline
      // got WRONG (flat source → llm → send, no memory).
      memoryOnPath: {
        from: SOURCE_TYPES,
        through: MEMORY_TYPES,
        to: ['email'],
        preferThrough: ['dedupe'],
      },
      hasSchedule: true,
    },
  },
  {
    // Deliberately NO word "new"/"already seen" in the prompt — the generator
    // must infer that a recurring briefing needs dedup memory anyway (B5/B3).
    name: 'daily news briefing → WhatsApp (no "new" keyword, must dedupe)',
    prompt:
      'Every day at 7am, find news about UK civil service digital transformation and send me a WhatsApp briefing.',
    expect: {
      nodeTypes: ['whatsapp'],
      // A search/scrape source (either is a legitimate model choice) AND a
      // memory node must both be present.
      nodeTypesAnyOf: [['tavily-search', 'web-scrape'], MEMORY_TYPES],
      memoryOnPath: {
        from: ['tavily-search', 'web-scrape'],
        through: MEMORY_TYPES,
        to: ['whatsapp'],
        preferThrough: ['dedupe'], // dedupe preferred; data-store = partial credit (warn)
      },
      hasSchedule: true,
    },
    // Two-run idempotency: a tavily-shaped source output. The generated dedupe
    // node's itemsPath/idPath must address this shape; run 2 must filter to 0.
    idempotency: {
      sourceOutput: {
        results: [
          { url: 'https://gov.uk/news/gds-cloud-first', title: 'GDS goes cloud-first' },
          { url: 'https://gov.uk/news/one-login-rollout', title: 'One Login rollout' },
          { url: 'https://gov.uk/news/data-marketplace', title: 'Data marketplace launches' },
        ],
      },
    },
  },
  {
    name: 'cron → fetch → notify (WhatsApp)',
    prompt:
      'On a schedule every 30 minutes, fetch JSON from https://api.example.com/status and send me a WhatsApp message with the result.',
    expect: {
      nodeTypes: ['http-request', 'whatsapp'],
      edges: [{ from: 'http-request', to: 'whatsapp' }],
      hasSchedule: true,
    },
  },
  {
    name: 'gmail-trigger → LLM → reply',
    prompt:
      'When a new email arrives in my Gmail inbox matching "from:support", use an LLM to draft a polite reply and send it as a reply to that email.',
    expect: {
      nodeTypes: ['gmail-trigger', 'llm-call', 'gmail-reply'],
      edges: [{ from: 'llm-call', to: 'gmail-reply' }],
      hasSchedule: false,
    },
  },
  {
    name: 'gmail-trigger → LLM → label (classify)',
    prompt:
      'Whenever I get a new Gmail message, classify it with an LLM as either "urgent" or "later" and apply a matching Gmail label.',
    expect: {
      nodeTypes: ['gmail-trigger', 'llm-call', 'gmail-label'],
      edges: [{ from: 'llm-call', to: 'gmail-label' }],
      hasSchedule: false,
    },
  },
  {
    name: 'conditional branch',
    prompt:
      'Fetch the current weather JSON from https://api.weather.example.com. If the temperature is below 5 degrees, send me a WhatsApp warning; otherwise do nothing.',
    expect: {
      nodeTypes: ['http-request', 'conditional', 'whatsapp'],
      edges: [{ from: 'conditional', to: 'whatsapp' }],
    },
  },
  {
    name: 'loop / map over a list',
    prompt:
      'Take a list of city names, and for each city fetch its weather from https://api.weather.example.com/{city} and collect the results into one report.',
    expect: {
      nodeTypes: ['loop', 'http-request'],
    },
  },
  {
    name: 'cron → fetch → store',
    prompt:
      'Every hour, fetch the latest exchange rate from https://api.rates.example.com/gbp and store the value under the key "gbpRate" for later use.',
    expect: {
      nodeTypes: ['http-request', 'data-store'],
      edges: [{ from: 'http-request', to: 'data-store' }],
      hasSchedule: true,
    },
  },
];
