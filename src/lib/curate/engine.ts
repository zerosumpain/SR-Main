// src/lib/curate/engine.ts
//
// Phase state machine + phase orchestrator functions for the curate flow.
//
// ── Tool-use convention (important — read before modifying) ──────────────
//
// The LLM in the discovery phase calls discovery tools by emitting native
// OpenAI tool_use events (not text markers). The llm-client.ts wrapper
// already handles tool_use accumulation and yields { type: 'tool_use',
// name, input } chunks at finish_reason === 'tool_calls'.
//
// The runDiscovery loop:
//   1. Calls streamChat() with tools wired as OpenAI function definitions.
//   2. As text chunks arrive → emit 'discovery' SSE events.
//   3. When a tool_use chunk arrives → run the corresponding discovery tool,
//      append the result as a 'user' message (acting as a tool-result turn),
//      and call streamChat() again to continue the conversation.
//   4. When finish_reason === 'stop' with no pending tool calls → look for
//      a <proposal>…</proposal> block in the accumulated text.
//   5. On success: save proposal, transition to awaiting-approval.
//   6. On parse failure: continue looping (the LLM may emit the proposal
//      on the next turn). Bail out after MAX_DISCOVERY_TURNS.
//
// This design works because the OpenAI-compatible gateway the project uses
// (see $lib/jkai/llm-client) supports the standard `tools` + `tool_choice`
// parameters.

import { getSession, updateSession } from './session-store';
import { pushEvent } from './event-bus';
import { streamChat } from './llm-client';
import type { ChatMessage } from './llm-client';
import { SCOPE_SYSTEM_PROMPT } from './prompts/scope';
import { DISCOVERY_SYSTEM_PROMPT } from './prompts/discovery';
import { defaultToolkit } from './discovery/index';
import { runGenerate } from './generate';
import { runTestCases } from './live-test';
import { runPromote } from './promote';
import { materializeNodeSpec } from './materialize';
import type OpenAI from 'openai';

// ── Allowed transition graph ────────────────────────────────────────────

const TRANSITIONS: Record<string, string[]> = {
  scoping:             ['discovering', 'aborted'],
  discovering:         ['awaiting-approval', 'error', 'aborted'],
  'awaiting-approval': ['generating', 'discovering', 'aborted'],
  generating:          ['live-testing', 'error'],
  'live-testing':      ['awaiting-promotion', 'generating', 'aborted'],
  'awaiting-promotion': ['promoting', 'aborted'],
  promoting:           ['promoted', 'error'],
  // Terminal statuses — no further transitions allowed.
  promoted:            [],
  aborted:             [],
  error:               [],
  ended:               [],
};

/**
 * Returns the list of statuses this session can legally transition to from
 * `currentStatus`. Returns [] for unknown statuses.
 */
export function getAllowedTransitions(currentStatus: string): string[] {
  return TRANSITIONS[currentStatus] ?? [];
}

// ── Log entry type ──────────────────────────────────────────────────────

interface TransitionLogEntry {
  from: string;
  to: string;
  at: string; // ISO timestamp
}

// ── transitionStatus ────────────────────────────────────────────────────

/**
 * Validates that `to` is an allowed target from `from`, then persists the
 * new status and appends a transition entry to `iterationLog`.
 *
 * Throws if:
 * - the session is not found
 * - the transition is not in the allowed graph
 */
export async function transitionStatus(
  sessionId: string,
  from: string,
  to: string,
): Promise<void> {
  const allowed = getAllowedTransitions(from);
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid curate-session transition: ${from} → ${to}. Allowed: [${allowed.join(', ')}]`,
    );
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Curate session not found: ${sessionId}`);
  }

  const existing = (session.iterationLog ?? []) as unknown[];
  const entry: TransitionLogEntry = {
    from,
    to,
    at: new Date().toISOString(),
  };

  await updateSession(sessionId, {
    status: to,
    iterationLog: [...existing, entry],
  });
}

// ── Internal helpers ────────────────────────────────────────────────────

interface ChatLogEntry {
  kind: 'chat';
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface RedirectLogEntry {
  kind: 'redirect';
  text: string;
  at: string;
}

/**
 * Append a chat message to iterationLog AND emit an SSE 'msg' event.
 */
async function persistAndEmitMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  const entry: ChatLogEntry = { kind: 'chat', role, content, at: new Date().toISOString() };
  const existing = (session.iterationLog ?? []) as unknown[];
  await updateSession(sessionId, { iterationLog: [...existing, entry] });

  pushEvent(sessionId, { type: 'msg', role, text: content });
}

/**
 * Build the chat history from iterationLog, filtering to only 'chat' entries.
 * Returned as ChatMessage[] ready for streamChat().
 */
function buildChatHistory(iterationLog: unknown[]): ChatMessage[] {
  return (iterationLog as Array<{ kind?: string; role?: string; content?: string }>)
    .filter((e) => e.kind === 'chat' && e.role && e.content)
    .map((e) => ({ role: e.role as 'user' | 'assistant', content: e.content as string }));
}

// ── GOAL: line extraction ───────────────────────────────────────────────

/**
 * Extract the GOAL: statement from an assistant message, if present.
 * Returns the goal string (without the "GOAL:" prefix) or null.
 *
 * Exported for unit testing.
 */
export function extractGoal(text: string): string | null {
  // Tolerates markdown bold (**GOAL:**), italics (*GOAL:*), bullet/list
  // prefixes (-, *, >), and surrounding backticks. The model sometimes
  // wraps the marker for emphasis even when the system prompt asks for
  // plain text — match permissively, then strip the prefix.
  const re = /^[\s>*\-`]*\**\s*GOAL\s*:\s*\**\s*(.+?)\s*\**\s*$/i;
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// ── Proposal extraction ─────────────────────────────────────────────────

/**
 * Extract and parse the JSON inside a <proposal>…</proposal> block from
 * `text`. Tolerates prose before/after the block.
 *
 * Returns the parsed object or null if no valid block is found.
 *
 * Exported for unit testing.
 */
export function extractProposal(text: string): Record<string, unknown> | null {
  // Preferred: <proposal>…</proposal> tags as the system prompt requests.
  const tagMatch = text.match(/<proposal>([\s\S]*?)<\/proposal>/i);
  if (tagMatch) {
    try {
      return JSON.parse(tagMatch[1].trim()) as Record<string, unknown>;
    } catch { /* fall through to other strategies */ }
  }

  // Fallback 1: ```json … ``` fenced block whose JSON has the proposal shape.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text))) {
    const candidate = tryProposalJson(m[1]);
    if (candidate) return candidate;
  }

  // Fallback 2: bare JSON object whose shape looks like a proposal.
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const candidate = tryProposalJson(objMatch[0]);
    if (candidate) return candidate;
  }

  return null;
}

function tryProposalJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    // A proposal at minimum has type + label + description — the model
    // sometimes drops the <proposal> tags but keeps the shape.
    if (
      typeof parsed.type === 'string' &&
      typeof parsed.label === 'string' &&
      typeof parsed.description === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Discovery tool definitions (OpenAI format) ──────────────────────────

const DISCOVERY_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web__search',
      description: 'Search the web for API docs, libraries, and community approaches.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web__fetch',
      description: 'Fetch a specific URL (API docs, GitHub READMEs, npm pages).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'context7__queryDocs',
      description: 'Fetch up-to-date documentation for an npm library.',
      parameters: {
        type: 'object',
        properties: {
          libraryName: { type: 'string', description: 'Library name (e.g. "node-caldav-adapter")' },
          query: { type: 'string', description: 'What to look for in the docs' },
        },
        required: ['libraryName', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo__readNode',
      description: 'Read an existing workflow node definition + executor source.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Node type identifier (e.g. "gmail-fetch")' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo__readPanel',
      description: 'Read a panel Svelte component by name.',
      parameters: {
        type: 'object',
        properties: {
          componentName: { type: 'string', description: 'Component name (e.g. "GmailFetchPanel")' },
        },
        required: ['componentName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo__readPackageJson',
      description: 'Read the project package.json to check available dependencies.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repo__listAvailableNodes',
      description: 'List all existing node types to avoid duplication.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'srDocs__read',
      description: 'Read internal sr-docs for project-specific workflow engine context.',
      parameters: {
        type: 'object',
        properties: {
          globOrPath: { type: 'string', description: 'Filename, glob, or "*" for all files' },
        },
        required: ['globOrPath'],
      },
    },
  },
  // ── Terminal tool: structured proposal submission ────────────────────────
  // Calling this tool is the LLM's way of saying "I'm done researching, here
  // is the proposal". The args are received as a parsed object — no regex,
  // no JSON.parse from free-form text. After this tool fires the engine
  // persists the args as session.proposal and transitions to awaiting-approval.
  {
    type: 'function',
    function: {
      name: 'submit_proposal',
      description:
        'Submit the final structured proposal once research is complete. ' +
        'Calling this ENDS the discovery phase. Do not call any other tool after this.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'kebab-case node type identifier (e.g. "apple-calendar")',
          },
          label: { type: 'string', description: 'Human-readable label for the canvas node menu' },
          category: {
            type: 'string',
            description: 'One of: data, ai, communication, calendar, utility, integrations',
          },
          description: { type: 'string', description: 'One-line canvas description' },
          llmDescription: {
            type: 'string',
            description:
              'Richer description for the orchestrator LLM, explaining when to choose this node',
          },
          approach: {
            type: 'string',
            description: '2-3 sentence explanation of the chosen implementation approach',
          },
          rejectedAlternatives: {
            type: 'array',
            description: 'Implementation approaches that were considered and rejected',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['name', 'reason'],
            },
          },
          suggestedDeps: {
            type: 'array',
            description: 'npm packages the executor will need',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
              },
              required: ['name', 'version'],
            },
          },
          authMethod: {
            type: 'string',
            enum: ['oauth2', 'api-key', 'none', 'other'],
            description: 'Authentication mechanism this integration requires',
          },
          configFields: {
            type: 'array',
            description: 'High-level config fields the node panel will expose',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'snake_case or camelCase identifier' },
                label: { type: 'string' },
                widget: {
                  type: 'string',
                  enum: [
                    'string',
                    'textarea',
                    'dropdown',
                    'toggle',
                    'datetime',
                    'credential-picker',
                    'resource-picker',
                    'template-string',
                  ],
                },
                required: { type: 'boolean' },
                description: { type: 'string' },
              },
              required: ['key', 'label', 'widget'],
            },
          },
          outputShape: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              example: { type: 'object', additionalProperties: true },
            },
            required: ['description', 'example'],
          },
          testCases: {
            type: 'array',
            description: '1-3 worked test cases for the live-testing phase',
            items: {
              type: 'object',
              properties: {
                scenario: { type: 'string' },
                config: { type: 'object', additionalProperties: true },
                notes: { type: 'string' },
              },
              required: ['scenario', 'config'],
            },
          },
        },
        required: [
          'type',
          'label',
          'category',
          'description',
          'llmDescription',
          'approach',
          'authMethod',
          'configFields',
          'outputShape',
          'testCases',
        ],
      },
    },
  },
];

const MAX_DISCOVERY_TURNS = 20;
/** After this many turns, nudge the LLM to stop researching and emit. */
const NUDGE_AFTER_TURN = 10;

// ── runScopeChat ─────────────────────────────────────────────────────────

/**
 * Scope chat turn: appends the user message, streams the LLM's response,
 * persists the assistant reply, and emits SSE 'msg' events.
 *
 * If the assistant emits a line starting with "GOAL:", the goal is saved to
 * the session and the status is transitioned scoping → discovering, then
 * runDiscovery() is triggered in the same async context.
 */
export async function runScopeChat(sessionId: string, userMessage: string): Promise<void> {
  // Persist + emit the user message.
  await persistAndEmitMessage(sessionId, 'user', userMessage);

  // Load fresh history.
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);

  const history = buildChatHistory((session.iterationLog ?? []) as unknown[]);

  // Stream the LLM response. We accumulate deltas locally and only emit
  // the full message at the end via persistAndEmitMessage — the UI doesn't
  // do per-token streaming yet, so emitting partial deltas just produces
  // empty chat rows. (A future delta-friendly UI can opt into msg-delta
  // events.)
  let assistantText = '';
  for await (const chunk of streamChat({
    system: SCOPE_SYSTEM_PROMPT,
    messages: history,
    max_tokens: 1024,
  })) {
    if (chunk.type === 'text') {
      assistantText += chunk.delta;
    }
  }

  // Persist the full assistant message.
  await persistAndEmitMessage(sessionId, 'assistant', assistantText);

  // Check for GOAL: line → transition to discovering.
  const goal = extractGoal(assistantText);
  if (goal) {
    await updateSession(sessionId, { goal });
    await transitionStatus(sessionId, 'scoping', 'discovering');
    pushEvent(sessionId, { type: 'phase', status: 'discovering', goal });

    // Kick off discovery — intentionally not awaited so this function returns
    // promptly. The caller fire-and-forgets runScopeChat from the API layer.
    // The .catch is critical: runDiscovery can throw ("Discovery ended without
    // a valid proposal after N turns"), and an unhandled rejection here crashes
    // the entire SvelteKit process — the discovery already updates session
    // state to 'error' inside its own catch before re-throwing, so swallowing
    // is safe.
    void runDiscovery(sessionId).catch(() => undefined);
  }
}

// ── runDiscovery ─────────────────────────────────────────────────────────

export interface RunDiscoveryOpts {
  redirectText?: string;
}

/**
 * Autonomous discovery loop. Calls the LLM with discovery tools wired up,
 * streams narration as 'discovery' SSE events, handles tool calls, and
 * parses the final <proposal> block.
 *
 * Tool-use flow (see module header for full explanation):
 *   - The LLM emits native OpenAI tool_use events (not text markers).
 *   - When a tool_use chunk arrives, the corresponding discovery tool runs.
 *   - The tool result is fed back as a 'user' message and the loop continues.
 *   - When the LLM calls the terminal `submit_proposal` tool, its arguments
 *     are persisted as session.proposal and the loop ends. (No regex on text;
 *     no JSON.parse from free-form output. Tool calls are atomic + parsed.)
 */
export async function runDiscovery(sessionId: string, opts: RunDiscoveryOpts = {}): Promise<void> {
  const toolkit = defaultToolkit();

  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);

  // Build initial conversation: goal context + (optionally) redirect text.
  const goalContext = session.goal
    ? `The goal for this session is:\n${session.goal}`
    : 'No goal has been set yet — use your best judgment.';

  const messages: ChatMessage[] = [{ role: 'user', content: goalContext }];

  if (opts.redirectText) {
    messages.push({
      role: 'user',
      content: `REDIRECT: The user wants to change direction. New instructions:\n${opts.redirectText}`,
    });
  }

  let accumulatedText = '';
  let turns = 0;
  let proposalFound = false;

  try {
    while (turns < MAX_DISCOVERY_TURNS && !proposalFound) {
      turns++;

      // Soft nudge if the LLM is taking a long time. Tool-call submission
      // means we don't NEED this — but if the model wanders, this nudges
      // it toward calling submit_proposal.
      if (turns === NUDGE_AFTER_TURN) {
        messages.push({
          role: 'user',
          content:
            'You have enough research. Stop calling research tools and call ' +
            'submit_proposal with your final structured proposal now.',
        });
      }

      let turnText = '';
      const pendingToolCalls: Array<{ name: string; input: unknown }> = [];

      for await (const chunk of streamChat({
        system: DISCOVERY_SYSTEM_PROMPT,
        messages,
        tools: DISCOVERY_TOOLS,
        max_tokens: 4096,
      })) {
        if (chunk.type === 'text') {
          turnText += chunk.delta;
        } else if (chunk.type === 'tool_use') {
          pendingToolCalls.push({ name: chunk.name, input: chunk.input });
        }
      }

      // Stream a discovery feed line summarising the turn.
      if (turnText.trim()) {
        pushEvent(sessionId, { type: 'discovery', text: turnText.trim() });
      }

      // Persist the assistant turn to iterationLog so future failures are
      // debuggable without re-running. Tool calls are also recorded.
      const turnEntry: Record<string, unknown> = {
        kind: 'discovery-turn',
        at: new Date().toISOString(),
        turn: turns,
        text: turnText,
        toolCalls: pendingToolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
      };
      const sessionForLog = await getSession(sessionId);
      const existingLog = ((sessionForLog?.iterationLog ?? []) as unknown[]);
      await updateSession(sessionId, { iterationLog: [...existingLog, turnEntry] });

      // Append assistant turn to conversation context.
      if (turnText) {
        accumulatedText += turnText;
        messages.push({ role: 'assistant', content: turnText });
      }

      // ── Detect terminal tool: submit_proposal ──────────────────────────
      // This is now the ONLY way the LLM can finalise — no regex on text.
      const submitCall = pendingToolCalls.find((tc) => tc.name === 'submit_proposal');
      if (submitCall) {
        const proposal = submitCall.input as Record<string, unknown>;
        // Minimum viability check.
        if (
          typeof proposal.type === 'string' &&
          typeof proposal.label === 'string' &&
          typeof proposal.description === 'string'
        ) {
          proposalFound = true;
          await updateSession(sessionId, { proposal });
          await transitionStatus(sessionId, 'discovering', 'awaiting-approval');
          pushEvent(sessionId, { type: 'phase', status: 'awaiting-approval', proposal });
          pushEvent(sessionId, {
            type: 'discovery',
            text: `[submit_proposal] received: ${proposal.type} / ${proposal.label}`,
          });
          return;
        }
        // Malformed submission — feed an error result back so the LLM retries.
        messages.push({
          role: 'user',
          content:
            `submit_proposal received but missing required fields ` +
            `(type/label/description must all be non-empty strings). ` +
            `Please call submit_proposal again with the correct shape.`,
        });
        pushEvent(sessionId, {
          type: 'discovery',
          text: '[submit_proposal] rejected — missing required fields. Asking model to retry.',
        });
        continue;
      }

      // Execute any non-terminal tool calls. Per-tool try/catch so a single
      // failing tool doesn't kill the whole discovery flow — the LLM gets a
      // structured error and can decide how to recover.
      for (const tc of pendingToolCalls) {
        let result: unknown;
        try {
          result = await executeDiscoveryTool(toolkit, tc.name, tc.input);
        } catch (toolErr) {
          const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          result = { error: msg };
        }
        const resultText = JSON.stringify(result, null, 2);

        messages.push({
          role: 'user',
          content: `Tool result for ${tc.name}:\n${resultText}`,
        });

        pushEvent(sessionId, {
          type: 'discovery',
          text: `[tool] ${tc.name} → ${resultText.slice(0, 200).replace(/\s+/g, ' ').trim()}${resultText.length > 200 ? '…' : ''}`,
        });
      }

      // Defensive: if the model emitted plain text but no tool call AND no
      // submit_proposal, it's likely confused (thinks it submitted but
      // didn't). Push a stronger nudge before next turn.
      if (pendingToolCalls.length === 0 && turnText.trim()) {
        messages.push({
          role: 'user',
          content:
            'You replied with text but did not call submit_proposal. ' +
            'To finalise, you MUST call the submit_proposal tool with the ' +
            'structured arguments. Do that now.',
        });
      }
    }

    if (!proposalFound) {
      throw new Error(
        `Discovery ended without a submit_proposal call after ${turns} turns. ` +
        `Check iterationLog entries (kind='discovery-turn') for what the model did.`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await getSession(sessionId);
    if (current && current.status === 'discovering') {
      await updateSession(sessionId, { errorTrace: message });
      await transitionStatus(sessionId, 'discovering', 'error');
      pushEvent(sessionId, { type: 'phase', status: 'error', error: message });
    }
    throw err;
  }
}

/**
 * Route a tool call name (as emitted by the LLM) to the correct discovery
 * toolkit method. Tool names use double-underscore as namespace separator
 * (e.g. "web__search", "repo__readNode") matching the DISCOVERY_TOOLS list.
 */
async function executeDiscoveryTool(
  toolkit: ReturnType<typeof defaultToolkit>,
  name: string,
  input: unknown,
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'web__search':
      return toolkit.webSearch(String(args.query ?? ''));

    case 'web__fetch':
      return toolkit.webFetch(String(args.url ?? ''));

    case 'context7__queryDocs':
      return toolkit.queryLibraryDocs(String(args.libraryName ?? ''), String(args.query ?? ''));

    case 'repo__readNode':
      return toolkit.readNode(String(args.type ?? ''));

    case 'repo__readPanel':
      return toolkit.readPanel(String(args.componentName ?? ''));

    case 'repo__readPackageJson':
      return toolkit.readPackageJson();

    case 'repo__listAvailableNodes':
      return toolkit.listAvailableNodes();

    case 'srDocs__read':
      return toolkit.srDocsRead(String(args.globOrPath ?? '*'));

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── runIteration ─────────────────────────────────────────────────────────

/**
 * Handle a user interjection during the discovery phase.
 * Logs the redirect and re-runs discovery with the redirect text appended.
 */
export async function runIteration(sessionId: string, userText: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);

  const entry: RedirectLogEntry = { kind: 'redirect', text: userText, at: new Date().toISOString() };
  const existing = (session.iterationLog ?? []) as unknown[];
  await updateSession(sessionId, { iterationLog: [...existing, entry] });

  pushEvent(sessionId, { type: 'msg', role: 'user', text: userText });

  await runDiscovery(sessionId, { redirectText: userText });
}

// ── runGenerate (orchestrator wrapper) ───────────────────────────────────

/**
 * Orchestrator wrapper for the generate phase.
 * Calls the Phase 4.1 generate function, emits SSE events, and on success
 * transitions to live-testing and triggers runLiveTest().
 *
 * Note: runGenerate() in generate.ts handles its own status transitions
 * (generating → live-testing or error). This wrapper just emits SSE events
 * around it and chains runLiveTest on success.
 */
export async function runGeneratePhase(sessionId: string): Promise<void> {
  try {
    pushEvent(sessionId, { type: 'phase', status: 'generating' });

    // Materialize a full NodeSpec from the approved proposal if we don't
    // already have one. The proposal is high-level; runGenerate needs a
    // complete spec including executor body + full uiSchema.
    const session = await getSession(sessionId);
    if (session && !session.nodeSpec) {
      pushEvent(sessionId, { type: 'discovery', text: '[engine] materializing NodeSpec from proposal…' });
      await materializeNodeSpec(sessionId);
      pushEvent(sessionId, { type: 'discovery', text: '[engine] NodeSpec ready, generating files…' });
    }

    await runGenerate(sessionId);
    pushEvent(sessionId, { type: 'phase', status: 'live-testing' });
    await runLiveTest(sessionId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    pushEvent(sessionId, { type: 'phase', status: 'error', error: message });
    // Best-effort: persist the error and transition to 'error' so the user
    // can see what went wrong. runGenerate handles its own error state on
    // tsc/dep failures; this catch handles materialization + early throws.
    try {
      const current = await getSession(sessionId);
      if (current && current.status === 'generating') {
        await updateSession(sessionId, { errorTrace: message });
        await transitionStatus(sessionId, 'generating', 'error');
      }
    } catch { /* swallow — best-effort */ }
  }
}

// ── runLiveTest ──────────────────────────────────────────────────────────

/**
 * Phase 4.2: runs the live-test cases and records results to iterationLog.
 * Transitions live-testing → awaiting-promotion.
 */
export async function runLiveTest(sessionId: string): Promise<void> {
  try {
    const results = await runTestCases(sessionId);
    // Emit individual test results over SSE.
    for (const r of results) {
      pushEvent(sessionId, { type: 'test-result', result: r });
    }
    await transitionStatus(sessionId, 'live-testing', 'awaiting-promotion');
    pushEvent(sessionId, { type: 'phase', status: 'awaiting-promotion' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await getSession(sessionId);
    if (current && current.status === 'live-testing') {
      await updateSession(sessionId, { errorTrace: message });
      // live-testing → generating is allowed (re-generate on failure).
      // For now, surface as aborted rather than silently swallowing.
      await transitionStatus(sessionId, 'live-testing', 'aborted');
      pushEvent(sessionId, { type: 'phase', status: 'aborted', error: message });
    }
    throw err;
  }
}

// ── runPromote (orchestrator wrapper) ────────────────────────────────────

/**
 * Orchestrator wrapper for the promote pipeline.
 * Drains the async-iterable from promote.ts and pushes each step as a
 * 'promote-step' SSE event. Transitions to promoted on success, error on failure.
 */
export async function runPromotePhase(sessionId: string): Promise<void> {
  try {
    pushEvent(sessionId, { type: 'phase', status: 'promoting' });

    for await (const step of runPromote(sessionId)) {
      pushEvent(sessionId, { type: 'promote-step', step });
    }

    // runPromote() calls updateSession({ status: 'promoted' }) directly in cleanup.
    // Emit the final phase event so the UI can react.
    const current = await getSession(sessionId);
    const finalStatus = current?.status ?? 'promoted';
    pushEvent(sessionId, { type: 'phase', status: finalStatus });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await getSession(sessionId);
    if (current && current.status === 'promoting') {
      await updateSession(sessionId, { errorTrace: message });
      await transitionStatus(sessionId, 'promoting', 'error');
      pushEvent(sessionId, { type: 'phase', status: 'error', error: message });
    }
    throw err;
  }
}
