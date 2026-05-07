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

  pushEvent(sessionId, { type: 'msg', role, content });
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
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('GOAL:')) {
      return trimmed.slice('GOAL:'.length).trim();
    }
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
  const match = text.match(/<proposal>([\s\S]*?)<\/proposal>/);
  if (!match) return null;

  try {
    return JSON.parse(match[1].trim()) as Record<string, unknown>;
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
];

const MAX_DISCOVERY_TURNS = 12;

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

  // Stream the LLM response.
  let assistantText = '';
  for await (const chunk of streamChat({
    system: SCOPE_SYSTEM_PROMPT,
    messages: history,
    max_tokens: 1024,
  })) {
    if (chunk.type === 'text') {
      assistantText += chunk.delta;
      pushEvent(sessionId, { type: 'msg', role: 'assistant', delta: chunk.delta });
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
    void runDiscovery(sessionId);
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
 *   - When finish_reason === 'stop', the accumulated text is scanned for
 *     a <proposal> block. Loop continues until one is found or MAX_DISCOVERY_TURNS.
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
          pushEvent(sessionId, { type: 'discovery', delta: chunk.delta });
        } else if (chunk.type === 'tool_use') {
          pendingToolCalls.push({ name: chunk.name, input: chunk.input });
        }
      }

      // Append assistant turn to conversation.
      if (turnText) {
        accumulatedText += turnText;
        messages.push({ role: 'assistant', content: turnText });
      }

      // Execute any tool calls the LLM requested. Per-tool try/catch so
      // a single failing tool doesn't kill the whole discovery flow — the
      // LLM gets a structured error and can decide how to recover.
      for (const tc of pendingToolCalls) {
        let result: unknown;
        try {
          result = await executeDiscoveryTool(toolkit, tc.name, tc.input);
        } catch (toolErr) {
          const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          result = { error: msg };
        }
        const resultText = JSON.stringify(result, null, 2);

        // Feed tool result back as a user message (tool-result turn).
        messages.push({
          role: 'user',
          content: `Tool result for ${tc.name}:\n${resultText}`,
        });

        pushEvent(sessionId, {
          type: 'discovery',
          toolCall: { name: tc.name, result: resultText.slice(0, 500) },
        });
      }

      // Check for proposal in accumulated text after each non-tool turn.
      if (pendingToolCalls.length === 0) {
        const proposal = extractProposal(accumulatedText);
        if (proposal) {
          proposalFound = true;
          await updateSession(sessionId, { proposal });
          await transitionStatus(sessionId, 'discovering', 'awaiting-approval');
          pushEvent(sessionId, { type: 'phase', status: 'awaiting-approval', proposal });
          return;
        }
      }
    }

    // Ran out of turns without a valid proposal.
    if (!proposalFound) {
      throw new Error(`Discovery ended without a valid proposal after ${turns} turns`);
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

  pushEvent(sessionId, { type: 'msg', role: 'user', content: userText });

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
    await runGenerate(sessionId);
    pushEvent(sessionId, { type: 'phase', status: 'live-testing' });
    await runLiveTest(sessionId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    pushEvent(sessionId, { type: 'phase', status: 'error', error: message });
    // runGenerate already transitions to error status on failure.
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
