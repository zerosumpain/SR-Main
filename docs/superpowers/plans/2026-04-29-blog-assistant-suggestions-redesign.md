# Blog Assistant Suggestions Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline blog assistant panel with a floating bottom-right chat widget whose edits are surfaced as inline-or-margin proposals (user-selectable) with Accept/Reject/Modify/Regenerate, and metadata changes as Accept/Reject chips in the chat.

**Architecture:** A single client-side `proposalStore` (Svelte 5 `$state` Map) holds every pending proposal. The runner is rewritten so its tool calls *return* `Proposal` objects instead of mutating the post; the SSE stream forwards them as `proposal` events. The RichEditor consumes prose proposals via a new TipTap `suggestion` mark; a sibling `BlogAssistantMarginCallouts` overlay handles margin mode. The chat widget renders metadata proposals as `SuggestionChip`s. Acceptance routes through the existing post-save endpoint (prose) or a new `apply-proposal` endpoint (metadata).

**Tech Stack:** SvelteKit 2 + Svelte 5, TipTap (`@tiptap/core`), Drizzle, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-29-blog-assistant-suggestions-redesign-design.md`

**Convention notes:**
- Tests run via `DATABASE_URL='postgresql://app:test@localhost:5433/strange_rambling' npx vitest run <file>`. Full suite: `npm test` with the same env var.
- TipTap marks: see `@tiptap/core` `Mark.create` API — short example near Task 5.
- Don't run `npm run check` whole-project — it OOMs. Trust per-file syntactic correctness; verify integration with the dev server.
- Commit after each green step. Each task ends with one commit.

---

## File Structure

### New
- `src/lib/blog/assistant/proposal.ts` — `Proposal` type + serialisation helpers shared by client + server.
- `src/lib/blog/assistant/proposal-store.ts` — Svelte 5 `$state` proposal store factory + helpers (client only).
- `src/lib/blog/assistant/suggestion-mark.ts` — TipTap `Mark` extension, registered with two HTML renderings (`add` / `remove`).
- `src/lib/components/BlogAssistantWidget.svelte` — floating bottom-right chat card.
- `src/lib/components/BlogAssistantSuggestionChip.svelte` — metadata proposal chip used in the transcript.
- `src/lib/components/BlogAssistantMarginCallouts.svelte` — absolutely-positioned right-margin callouts for prose proposals.
- `src/routes/api/admin/blog/[id]/apply-proposal/+server.ts` — POST endpoint that applies a metadata proposal.

### Modified
- `src/lib/blog/assistant/tools.ts` — `runTool` returns a `Proposal` instead of mutating; signatures change.
- `src/lib/blog/assistant/runner.ts` — emits `proposal` events; drops `tool_call` / `tool_result` / `post_state`.
- `src/lib/blog/assistant/prompt.ts` — instruct the LLM to *propose* (no longer "apply").
- `src/routes/api/admin/blog/[id]/assistant/+server.ts` — pipe through new event types and persist `role: 'proposal'` rows.
- `src/lib/components/RichEditor.svelte` — register the suggestion mark; expose `proposalStore` + `displayMode` props + an API for accept / reject / modify / regenerate-request.
- `src/routes/admin/blog/[id]/+page.svelte` — replace `<BlogAssistantPanel>` with `<BlogAssistantWidget>` + `<BlogAssistantMarginCallouts>`; pass display mode + store to RichEditor.

### Deleted
- `src/lib/components/BlogAssistantPanel.svelte` — replaced by widget.
- `src/lib/blog/assistant/undo-store.ts` and `src/routes/api/admin/blog/[id]/assistant/undo/+server.ts` — no direct mutations any more.
- `tests/lib/blog/assistant/undo-store.test.ts` — undo store gone.

---

## Task 1: Proposal types + store

**Files:**
- Create: `src/lib/blog/assistant/proposal.ts`
- Create: `src/lib/blog/assistant/proposal-store.ts`
- Test: `tests/lib/blog/assistant/proposal-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/blog/assistant/proposal-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createProposalStore } from '$lib/blog/assistant/proposal-store';
import type { Proposal } from '$lib/blog/assistant/proposal';

const proseP: Proposal = {
  id: 'p1', kind: 'prose', original: 'old', suggested: 'new',
  anchor: { from: 0, to: 3 }, status: 'pending',
};
const metaP: Proposal = {
  id: 'm1', kind: 'meta', field: 'title',
  currentValue: 'A', suggestedValue: 'B', status: 'pending',
};

describe('proposal-store', () => {
  it('add() appends a proposal', () => {
    const s = createProposalStore();
    s.add(proseP);
    expect(s.list()).toHaveLength(1);
    expect(s.get('p1')).toEqual(proseP);
  });

  it('replace() swaps a proposal in place', () => {
    const s = createProposalStore();
    s.add(proseP);
    s.replace('p1', { ...proseP, id: 'p2', suggested: 'newer' });
    expect(s.get('p1')).toBeUndefined();
    expect(s.get('p2')?.suggested).toBe('newer');
  });

  it('resolve() updates status and keeps the row', () => {
    const s = createProposalStore();
    s.add(metaP);
    s.resolve('m1', 'accepted');
    expect(s.get('m1')?.status).toBe('accepted');
  });

  it('pending() returns only pending entries', () => {
    const s = createProposalStore();
    s.add(proseP);
    s.add(metaP);
    s.resolve('m1', 'rejected');
    expect(s.pending().map((p) => p.id)).toEqual(['p1']);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

`DATABASE_URL='postgresql://app:test@localhost:5433/strange_rambling' npx vitest run tests/lib/blog/assistant/proposal-store.test.ts`

- [ ] **Step 3: Implement types**

Create `src/lib/blog/assistant/proposal.ts`:

```typescript
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export type ProseProposal = {
  id: string;
  kind: 'prose';
  original: string;
  suggested: string;
  reason?: string;
  anchor: { from: number; to: number };
  status: ProposalStatus;
  /** When set, this proposal supersedes the named one (regenerate flow). */
  replaces?: string;
};

export type MetaField = 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';

export type MetaProposal = {
  id: string;
  kind: 'meta';
  field: MetaField;
  currentValue: unknown;
  suggestedValue: unknown;
  reason?: string;
  status: ProposalStatus;
  replaces?: string;
};

export type Proposal = ProseProposal | MetaProposal;

export function isProseProposal(p: Proposal): p is ProseProposal {
  return p.kind === 'prose';
}

export function isMetaProposal(p: Proposal): p is MetaProposal {
  return p.kind === 'meta';
}
```

- [ ] **Step 4: Implement the store**

Create `src/lib/blog/assistant/proposal-store.ts`:

```typescript
import type { Proposal, ProposalStatus } from './proposal';

export type ProposalStore = {
  list(): Proposal[];
  pending(): Proposal[];
  get(id: string): Proposal | undefined;
  add(p: Proposal): void;
  replace(oldId: string, next: Proposal): void;
  resolve(id: string, status: Exclude<ProposalStatus, 'pending'>): void;
  clear(): void;
};

export function createProposalStore(): ProposalStore {
  // Plain Map; the Svelte 5 binding ($state) wraps the store at the call site
  // to keep this module testable in plain Node.
  const map = new Map<string, Proposal>();
  return {
    list() { return Array.from(map.values()); },
    pending() { return Array.from(map.values()).filter((p) => p.status === 'pending'); },
    get(id) { return map.get(id); },
    add(p) { map.set(p.id, p); },
    replace(oldId, next) {
      map.delete(oldId);
      map.set(next.id, next);
    },
    resolve(id, status) {
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, status } as Proposal);
    },
    clear() { map.clear(); },
  };
}
```

- [ ] **Step 5: Run, confirm PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/blog/assistant/proposal.ts src/lib/blog/assistant/proposal-store.ts \
  tests/lib/blog/assistant/proposal-store.test.ts
git commit -m "feat(blog-assistant): proposal types + client-side proposal store"
```

---

## Task 2: Refactor tools to propose, not apply

**Files:**
- Modify: `src/lib/blog/assistant/tools.ts`
- Modify: `tests/lib/blog/assistant/tools.test.ts`

- [ ] **Step 1: Replace the tests file**

Overwrite `tests/lib/blog/assistant/tools.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { runTool } from '$lib/blog/assistant/tools';
import type { Proposal } from '$lib/blog/assistant/proposal';

const snapshot = {
  id: 1, title: 'old title', excerpt: 'e', slug: 's',
  content: 'first sentence. second sentence. third sentence.',
  contentFormat: 'html' as const, status: 'draft' as const,
  coverImageUrl: null, coverImageAlt: null, publishedAt: null,
  previewToken: 't', tags: ['x'],
};

const ctx = () => ({ postId: 1, snapshot: { ...snapshot } });

describe('runTool — proposal mode', () => {
  it('update_title returns a meta proposal', async () => {
    const r = await runTool('update_title', { title: 'new' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('title');
    expect(p.suggestedValue).toBe('new');
    expect(p.currentValue).toBe('old title');
    expect(p.status).toBe('pending');
  });

  it('update_tags returns a meta proposal with array values', async () => {
    const r = await runTool('update_tags', { tags: ['a', 'b'] }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('tags');
    expect(p.suggestedValue).toEqual(['a', 'b']);
    expect(p.currentValue).toEqual(['x']);
  });

  it('set_status returns a meta proposal', async () => {
    const r = await runTool('set_status', { status: 'published' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('meta');
    if (p.kind !== 'meta') return;
    expect(p.field).toBe('status');
    expect(p.suggestedValue).toBe('published');
  });

  it('replace_content returns a prose proposal covering the whole body', async () => {
    const r = await runTool('replace_content', { content: 'totally new body' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('prose');
    if (p.kind !== 'prose') return;
    expect(p.original).toBe(snapshot.content);
    expect(p.suggested).toBe('totally new body');
    expect(p.anchor.from).toBe(0);
    expect(p.anchor.to).toBe(snapshot.content.length);
  });

  it('patch_content errors when find string is missing', async () => {
    const r = await runTool('patch_content', { find: 'not present', replace: 'x' }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not found/i);
  });

  it('patch_content returns a prose proposal at correct anchor', async () => {
    const r = await runTool('patch_content', { find: 'second sentence.', replace: 'SECOND.' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.proposal as Proposal;
    expect(p.kind).toBe('prose');
    if (p.kind !== 'prose') return;
    expect(p.original).toBe('second sentence.');
    expect(p.suggested).toBe('SECOND.');
    expect(snapshot.content.slice(p.anchor.from, p.anchor.to)).toBe('second sentence.');
  });

  it('read_post returns the snapshot directly', async () => {
    const r = await runTool('read_post', {}, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.snapshot as { title: string }).title).toBe('old title');
  });

  it('returns error for unknown tool', async () => {
    const r = await runTool('nope', {}, ctx());
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

- [ ] **Step 3: Rewrite `tools.ts`**

Overwrite `src/lib/blog/assistant/tools.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { Proposal, MetaField } from './proposal';

export type PostSnapshot = {
  id: number;
  title: string;
  excerpt: string;
  slug: string;
  content: string;
  contentFormat: 'html' | 'markdown';
  status: 'draft' | 'published';
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: Date | null;
  previewToken: string | null;
  tags: string[];
};

export type ToolContext = {
  postId: number;
  snapshot: PostSnapshot;
};

export type ToolResult =
  | { ok: true; proposal: Proposal }
  | { ok: true; snapshot: PostSnapshot }
  | { ok: false; error: string };

export const toolDefinitions = [
  toolDef('update_title', 'Propose a new post title.', { title: { type: 'string' } }, ['title']),
  toolDef('update_excerpt', 'Propose a new excerpt.', { excerpt: { type: 'string' } }, ['excerpt']),
  toolDef('update_slug', 'Propose a new URL slug (kebab-case).', { slug: { type: 'string' } }, ['slug']),
  toolDef('update_tags', 'Propose a new full tag list.', {
    tags: { type: 'array', items: { type: 'string' } },
  }, ['tags']),
  toolDef('set_status', 'Propose publish/unpublish.', {
    status: { type: 'string', enum: ['draft', 'published'] },
  }, ['status']),
  toolDef('set_cover_alt', 'Propose alt text for the cover image.', {
    alt: { type: 'string' },
  }, ['alt']),
  toolDef('replace_content', 'Propose replacing the entire post body.', {
    content: { type: 'string' },
  }, ['content']),
  toolDef('patch_content', 'Propose a substring replacement in the post body. Errors if find is missing or non-unique.', {
    find: { type: 'string' },
    replace: { type: 'string' },
    reason: { type: 'string', description: 'one short sentence; shown as a tooltip on the suggestion' },
  }, ['find', 'replace']),
  toolDef('read_post', 'Return the current post snapshot. Use when you need to inspect more than what is in the system prompt.', {}, []),
];

function toolDef(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'function' as const,
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

function metaProposal(field: MetaField, currentValue: unknown, suggestedValue: unknown, reason?: string): Proposal {
  return {
    id: randomUUID(), kind: 'meta', field,
    currentValue, suggestedValue, reason, status: 'pending',
  };
}

function proseProposal(original: string, suggested: string, from: number, to: number, reason?: string): Proposal {
  return {
    id: randomUUID(), kind: 'prose',
    original, suggested, anchor: { from, to }, reason, status: 'pending',
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { snapshot } = ctx;
  const reason = typeof args.reason === 'string' ? args.reason : undefined;

  switch (name) {
    case 'update_title':
      return { ok: true, proposal: metaProposal('title', snapshot.title, String(args.title ?? ''), reason) };

    case 'update_excerpt':
      return { ok: true, proposal: metaProposal('excerpt', snapshot.excerpt, String(args.excerpt ?? ''), reason) };

    case 'update_slug':
      return { ok: true, proposal: metaProposal('slug', snapshot.slug, String(args.slug ?? ''), reason) };

    case 'update_tags': {
      const tags = (args.tags as unknown[] | undefined ?? []).map((t) => String(t));
      return { ok: true, proposal: metaProposal('tags', snapshot.tags, tags, reason) };
    }

    case 'set_status':
      return { ok: true, proposal: metaProposal('status', snapshot.status, args.status === 'published' ? 'published' : 'draft', reason) };

    case 'set_cover_alt':
      return { ok: true, proposal: metaProposal('cover_alt', snapshot.coverImageAlt, String(args.alt ?? ''), reason) };

    case 'replace_content':
      return {
        ok: true,
        proposal: proseProposal(snapshot.content, String(args.content ?? ''), 0, snapshot.content.length, reason),
      };

    case 'patch_content': {
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      if (!find) return { ok: false, error: 'find string is empty.' };
      const occurrences = snapshot.content.split(find).length - 1;
      if (occurrences === 0) return { ok: false, error: `find string not found in content.` };
      if (occurrences > 1) return { ok: false, error: `find string not unique (${occurrences} matches).` };
      const from = snapshot.content.indexOf(find);
      const to = from + find.length;
      return { ok: true, proposal: proseProposal(find, replace, from, to, reason) };
    }

    case 'read_post':
      return { ok: true, snapshot };

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

export function isProposalResult(r: ToolResult): r is { ok: true; proposal: Proposal } {
  return r.ok && 'proposal' in r;
}
```

- [ ] **Step 4: Run, confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/assistant/tools.ts tests/lib/blog/assistant/tools.test.ts
git commit -m "refactor(blog-assistant): tools propose instead of mutate"
```

---

## Task 3: Update prompt for propose-don't-apply

**Files:**
- Modify: `src/lib/blog/assistant/prompt.ts`

- [ ] **Step 1: Overwrite the prompt builder**

Replace the entire content of `src/lib/blog/assistant/prompt.ts` with:

```typescript
import type { PostSnapshot } from './tools';

const MAX_CONTENT_CHARS = 40_000;

export function buildSystemPrompt(post: PostSnapshot): string {
  const truncated = post.content.length > MAX_CONTENT_CHARS
    ? post.content.slice(0, MAX_CONTENT_CHARS) + '\n…[truncated]'
    : post.content;

  return `You are an editorial assistant for the strangeramblings.com blog.

Voice: warm, slightly brutalist, British English (-ise, not -ize). Short sentences are fine. Avoid corporate-speak.

You are working on ONE specific draft. The current state of that draft is below. When the user asks a question or gives an instruction, default to acting on this post unless they clearly mean something else.

How to make changes: NEVER edit the post directly. Instead, *propose* changes via tools — every tool call creates a Proposal that the user reviews in the editor and either accepts, rejects, or modifies. Do not call the same tool twice for the same change.

Granularity guidance for prose changes:
- Default to ONE proposal per logical unit of change (paragraph rewrite, single typo fix, single tone adjustment).
- If you're making genuinely independent edits across different parts of the post, emit MULTIPLE patch_content calls — one per independent change. Don't batch unrelated edits into a single replace_content.
- Use replace_content only when rewriting the whole body or large contiguous regions.
- Always include a one-sentence \`reason\` argument so the user knows why the change was suggested.

If the user only wants ideas / alternatives without changes (e.g. "what would a punchier title be?"), reply in text without calling tools. If the user explicitly says "apply X", they still need to accept the proposal in the UI — that's by design; don't apologise for it.

Current draft:
- id: ${post.id}
- title: ${JSON.stringify(post.title)}
- slug: ${JSON.stringify(post.slug)}
- status: ${post.status}
- tags: ${JSON.stringify(post.tags)}
- excerpt: ${JSON.stringify(post.excerpt)}
- format: ${post.contentFormat}
- cover image url: ${post.coverImageUrl ?? '(none)'}
- cover image alt: ${post.coverImageAlt ?? '(none)'}

Body:
\`\`\`${post.contentFormat}
${truncated}
\`\`\`
`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/blog/assistant/prompt.ts
git commit -m "feat(blog-assistant): prompt — propose, never apply directly"
```

---

## Task 4: Runner emits proposal events

**Files:**
- Modify: `src/lib/blog/assistant/runner.ts`
- Modify: `tests/lib/blog/assistant/runner.test.ts`

- [ ] **Step 1: Replace runner tests**

Overwrite `tests/lib/blog/assistant/runner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAssistant } from '$lib/blog/assistant/runner';
import * as blog from '$lib/blog';

vi.mock('$lib/blog');

function fakeClient(scripted: Array<{ tool?: { name: string; args: Record<string, unknown> }; text?: string }>) {
  let i = 0;
  return {
    chat: {
      completions: {
        async create(_opts: unknown) {
          const step = scripted[i++];
          if (!step) throw new Error('out of scripted steps');
          if (step.tool) {
            return {
              choices: [{
                message: {
                  role: 'assistant', content: null,
                  tool_calls: [{
                    id: `call_${i}`, type: 'function',
                    function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
            };
          }
          return {
            choices: [{ message: { role: 'assistant', content: step.text ?? '' }, finish_reason: 'stop' }],
          };
        },
      },
    },
  };
}

const snapshot = {
  id: 1, title: 'old', excerpt: 'e', slug: 's',
  content: 'one. two. three.',
  contentFormat: 'html' as const, status: 'draft' as const,
  coverImageUrl: null, coverImageAlt: null, publishedAt: null,
  previewToken: 't', tags: [],
};

describe('runAssistant', () => {
  it('emits text + done for plain replies', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const client = fakeClient([{ text: 'hello' }]);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'hi', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('emits proposal events for tool calls', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const client = fakeClient([
      { tool: { name: 'update_title', args: { title: 'new' } } },
      { text: 'proposed' },
    ]);
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'rename', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['proposal', 'text', 'done']);
    const proposal = events[0] as unknown as { proposal: { kind: string } };
    expect(proposal.proposal.kind).toBe('meta');
  });

  it('caps tool calls at 6', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const scripted = Array.from({ length: 8 }, () => ({ tool: { name: 'update_title', args: { title: 'x' } } }));
    const client = fakeClient(scripted);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'spam', history: [], client: client as never, model: 'm',
    })) events.push(e);
    const proposalCount = events.filter((e) => e.type === 'proposal').length;
    expect(proposalCount).toBeLessThanOrEqual(6);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

- [ ] **Step 3: Rewrite `runner.ts`**

Overwrite `src/lib/blog/assistant/runner.ts`:

```typescript
import type OpenAI from 'openai';
import { getPostById } from '$lib/blog';
import { buildSystemPrompt } from './prompt';
import { runTool, toolDefinitions, type PostSnapshot } from './tools';
import type { Proposal } from './proposal';
import type { ChatMessage } from './messages';

const MAX_TOOL_CALLS = 6;

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done'; reason: 'stop' | 'cap' }
  | { type: 'error'; message: string };

export type RunOptions = {
  postId: number;
  userMessage: string;
  history: ChatMessage[];
  client: OpenAI;
  model: string;
};

function toRowSnapshot(row: Awaited<ReturnType<typeof getPostById>>): PostSnapshot {
  if (!row) throw new Error('Post not found');
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    slug: row.slug,
    content: row.content,
    contentFormat: (row.contentFormat as 'html' | 'markdown') ?? 'html',
    status: (row.status as 'draft' | 'published') ?? 'draft',
    coverImageUrl: row.coverImageUrl ?? null,
    coverImageAlt: (row as { coverImageAlt?: string | null }).coverImageAlt ?? null,
    publishedAt: row.publishedAt ?? null,
    previewToken: row.previewToken ?? null,
    tags: row.tags ?? [],
  };
}

export async function* runAssistant(opts: RunOptions): AsyncGenerator<AssistantEvent> {
  const { postId, userMessage, history, client, model } = opts;
  const row = await getPostById(postId);
  if (!row) {
    yield { type: 'error', message: `Post ${postId} not found.` };
    return;
  }
  const snapshot = toRowSnapshot(row);

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(snapshot) },
    ...history.map((h) => ({ role: h.role === 'tool' || h.role === 'proposal' ? 'assistant' : h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];

  let toolCalls = 0;

  while (true) {
    let resp;
    try {
      resp = await client.chat.completions.create({
        model,
        messages: messages as never,
        tools: toolDefinitions as never,
        tool_choice: 'auto' as never,
      });
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : 'LLM call failed' };
      return;
    }

    const choice = resp.choices[0];
    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        if (toolCalls >= MAX_TOOL_CALLS) {
          yield { type: 'done', reason: 'cap' };
          return;
        }
        toolCalls++;
        const name = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore parse error */ }

        const result = await runTool(name, args, { postId, snapshot });

        if (result.ok && 'proposal' in result) {
          yield { type: 'proposal', proposal: result.proposal };
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: true, proposalId: result.proposal.id, summary: summarise(result.proposal) }),
          });
        } else if (result.ok && 'snapshot' in result) {
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ ok: true, snapshot: result.snapshot }),
          });
        } else if (!result.ok) {
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, error: result.error }),
          });
        }
      }
      continue;
    }

    const text = msg.content ?? '';
    if (text) yield { type: 'text', delta: text };
    yield { type: 'done', reason: 'stop' };
    return;
  }
}

function summarise(p: Proposal): string {
  if (p.kind === 'meta') return `proposed ${p.field} → ${JSON.stringify(p.suggestedValue).slice(0, 60)}`;
  return `proposed prose change at ${p.anchor.from}–${p.anchor.to}`;
}
```

- [ ] **Step 4: Run, confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/assistant/runner.ts tests/lib/blog/assistant/runner.test.ts
git commit -m "feat(blog-assistant): runner emits proposal events instead of tool_call/result"
```

---

## Task 5: SSE endpoint forwards proposals; persist `role: 'proposal'`

**Files:**
- Modify: `src/routes/api/admin/blog/[id]/assistant/+server.ts`
- Modify: `src/lib/blog/assistant/messages.ts`

- [ ] **Step 1: Update `messages.ts` to allow `'proposal'` role**

Replace `src/lib/blog/assistant/messages.ts`:

```typescript
import { db } from '$lib/db';
import { blogAssistantMessages } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';

export type ChatRole = 'user' | 'assistant' | 'tool' | 'proposal' | 'proposal_resolved';

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  createdAt: Date;
};

export async function appendMessage(postId: number, role: ChatRole, content: string): Promise<void> {
  await db.insert(blogAssistantMessages).values({ postId, role, content });
}

export async function loadHistory(postId: number, limit = 30): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(blogAssistantMessages)
    .where(eq(blogAssistantMessages.postId, postId))
    .orderBy(asc(blogAssistantMessages.createdAt));
  return rows.slice(-limit).map((r) => ({
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function clearHistory(postId: number): Promise<void> {
  await db.delete(blogAssistantMessages).where(eq(blogAssistantMessages.postId, postId));
}
```

- [ ] **Step 2: Update the SSE endpoint**

Overwrite `src/routes/api/admin/blog/[id]/assistant/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';
import { runAssistant } from '$lib/blog/assistant/runner';
import { appendMessage, loadHistory } from '$lib/blog/assistant/messages';

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');

  const body = await request.json().catch(() => ({}));
  const userMessage = String(body.message ?? '').trim();
  if (!userMessage) throw error(400, 'empty message');

  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const history = await loadHistory(postId);

  await appendMessage(postId, 'user', userMessage);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let assistantText = '';
      try {
        for await (const ev of runAssistant({ postId, userMessage, history, client, model })) {
          send(ev);
          if (ev.type === 'text') assistantText += ev.delta;
          if (ev.type === 'proposal') {
            await appendMessage(postId, 'proposal', JSON.stringify(ev.proposal));
          }
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'unknown error' });
      } finally {
        if (assistantText) {
          await appendMessage(postId, 'assistant', assistantText).catch(() => undefined);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/blog/assistant/messages.ts \
  'src/routes/api/admin/blog/[id]/assistant/+server.ts'
git commit -m "feat(blog-assistant): SSE forwards proposal events; persist proposal rows"
```

---

## Task 6: Apply-proposal endpoint (metadata)

**Files:**
- Create: `src/routes/api/admin/blog/[id]/apply-proposal/+server.ts`

- [ ] **Step 1: Implement**

Create `src/routes/api/admin/blog/[id]/apply-proposal/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';
import { appendMessage } from '$lib/blog/assistant/messages';

type Body = {
  proposalId: string;
  field: 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';
  value: unknown;
};

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  const field = body.field;
  if (!field) throw error(400, 'field required');
  const value = body.value;

  switch (field) {
    case 'title':
      await updatePostFields(postId, { title: String(value ?? '') });
      break;
    case 'excerpt':
      await updatePostFields(postId, { excerpt: String(value ?? '') });
      break;
    case 'slug':
      await updatePostFields(postId, { slug: String(value ?? '') });
      break;
    case 'tags':
      await replaceTags(postId, Array.isArray(value) ? value.map((t) => String(t)) : []);
      break;
    case 'status': {
      const status: 'draft' | 'published' = value === 'published' ? 'published' : 'draft';
      const fields: Parameters<typeof updatePostFields>[1] = { status };
      const cur = await getPostById(postId);
      if (status === 'published' && cur && !cur.publishedAt) {
        fields.publishedAt = new Date();
      }
      await updatePostFields(postId, fields);
      break;
    }
    case 'cover_alt':
      await updatePostFields(postId, { coverImageAlt: value === null ? null : String(value ?? '') });
      break;
    default:
      throw error(400, `unsupported field: ${field}`);
  }

  if (body.proposalId) {
    await appendMessage(
      postId, 'proposal_resolved',
      JSON.stringify({ id: body.proposalId, status: 'accepted' }),
    ).catch(() => undefined);
  }

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
```

- [ ] **Step 2: Type-check**

`npx svelte-kit sync` — confirm no errors at this path.

- [ ] **Step 3: Commit**

```bash
git add 'src/routes/api/admin/blog/[id]/apply-proposal/+server.ts'
git commit -m "feat(blog-assistant): endpoint to apply a metadata proposal"
```

---

## Task 7: Suggestion mark TipTap extension

**Files:**
- Create: `src/lib/blog/assistant/suggestion-mark.ts`

- [ ] **Step 1: Implement**

Create `src/lib/blog/assistant/suggestion-mark.ts`:

```typescript
import { Mark, mergeAttributes } from '@tiptap/core';

export const SuggestionMark = Mark.create({
  name: 'suggestion',

  addAttributes() {
    return {
      id: { default: null },
      // 'add' wraps the proposed insertion; 'remove' wraps the original (about to be removed).
      type: { default: 'add' },
    };
  },

  parseHTML() {
    return [
      { tag: 'ins[data-suggestion-id]', attrs: { type: 'add' } },
      { tag: 'del[data-suggestion-id]', attrs: { type: 'remove' } },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const tag = HTMLAttributes.type === 'remove' ? 'del' : 'ins';
    const attrs = mergeAttributes(
      {
        'data-suggestion-id': HTMLAttributes.id,
        class: HTMLAttributes.type === 'remove' ? 'sg-remove' : 'sg-add',
      },
    );
    return [tag, attrs, 0];
  },

  // Suggestions are inclusive — marks expand as the user types inside them
  // (relevant for the "modify" interaction).
  inclusive: true,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/blog/assistant/suggestion-mark.ts
git commit -m "feat(blog-assistant): TipTap suggestion mark for inline-diff rendering"
```

---

## Task 8: RichEditor wires suggestion mark + exposes proposal API

**Files:**
- Modify: `src/lib/components/RichEditor.svelte`

- [ ] **Step 1: Read the file**

`cat src/lib/components/RichEditor.svelte` — locate the existing `new Editor({ extensions: [...] })` call (around line 269) and the `RichEditorApi` interface (around line 10–18).

- [ ] **Step 2: Extend `RichEditorApi`**

Inside `RichEditor.svelte`, replace the `RichEditorApi` interface with:

```typescript
import type { Proposal, ProseProposal } from '$lib/blog/assistant/proposal';

interface RichEditorApi {
  getHTML: () => string;
  getText: () => string;
  linkSnippet: (snippet: string, url: string, title?: string) => boolean;
  addFootnote: (snippet: string, url: string, title?: string) => number;
  applyProposal: (p: ProseProposal) => boolean;
  acceptProposal: (id: string, modifiedText?: string) => boolean;
  rejectProposal: (id: string) => boolean;
}
```

- [ ] **Step 3: Add new props**

Above the existing `let host: HTMLDivElement | undefined = $state();` add:

```typescript
import { SuggestionMark } from '$lib/blog/assistant/suggestion-mark';

type DisplayMode = 'inline' | 'margin';

let {
  content = '',
  onSave,
  onAutoSave,
  uploadImage,
  api = $bindable<RichEditorApi | undefined>(),
  displayMode = 'inline' as DisplayMode,
  onProposalAccepted,
  onProposalRejected,
}: {
  content?: string;
  onSave?: (html: string) => Promise<void>;
  onAutoSave?: (html: string) => Promise<void>;
  uploadImage?: (file: File) => Promise<string>;
  api?: RichEditorApi;
  displayMode?: DisplayMode;
  onProposalAccepted?: (id: string, finalText: string) => void;
  onProposalRejected?: (id: string) => void;
} = $props();
```

(The original prop block runs from `let { ... } = $props()`. Replace that whole block with the above.)

- [ ] **Step 4: Register the suggestion mark**

In the existing `new Editor({ ... extensions: [...] ... })` call, append `SuggestionMark` to the `extensions` array. Example:

```typescript
extensions: [
  StarterKit,
  Image.configure({ inline: false, allowBase64: true }),
  Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank' } }),
  Placeholder.configure({ placeholder: 'Write…' }),
  SuggestionMark,
],
```

- [ ] **Step 5: Implement the new API methods**

Wherever the existing `api = { getHTML, getText, linkSnippet, addFootnote }` assignment lives (search for it), replace it with:

```typescript
api = {
  getHTML, getText, linkSnippet, addFootnote,
  applyProposal: (p) => {
    if (!editor) return false;
    const found = locateOriginal(editor, p);
    if (!found) return false;
    const { from, to } = found;
    const tr = editor.state.tr;
    if (p.original.length > 0) {
      tr.addMark(from, to, editor.schema.marks.suggestion.create({ id: p.id, type: 'remove' }));
    }
    if (p.suggested.length > 0) {
      const insertAt = p.original.length > 0 ? to : from;
      tr.insertText(p.suggested, insertAt);
      tr.addMark(insertAt, insertAt + p.suggested.length, editor.schema.marks.suggestion.create({ id: p.id, type: 'add' }));
    }
    editor.view.dispatch(tr);
    return true;
  },
  acceptProposal: (id, modifiedText) => {
    if (!editor) return false;
    let removeFrom = -1, removeTo = -1, addFrom = -1, addTo = -1;
    editor.state.doc.descendants((node, pos) => {
      const mark = node.marks.find((m) => m.type.name === 'suggestion' && m.attrs.id === id);
      if (!mark) return;
      const end = pos + node.nodeSize;
      if (mark.attrs.type === 'remove') { removeFrom = pos; removeTo = end; }
      else { addFrom = pos; addTo = end; }
    });
    if (removeFrom < 0 && addFrom < 0) return false;
    let tr = editor.state.tr;
    // 1) Drop the deletion span entirely.
    if (removeFrom >= 0) {
      tr = tr.delete(removeFrom, removeTo);
      // shift add positions if they were after the removed range
      if (addFrom > removeTo) { addFrom -= (removeTo - removeFrom); addTo -= (removeTo - removeFrom); }
    }
    // 2) Replace insertion text if user modified it, then strip the suggestion mark.
    if (addFrom >= 0) {
      if (modifiedText !== undefined) {
        tr = tr.insertText(modifiedText, addFrom, addTo);
        addTo = addFrom + modifiedText.length;
      }
      tr = tr.removeMark(addFrom, addTo, editor.schema.marks.suggestion);
    }
    editor.view.dispatch(tr);
    onProposalAccepted?.(id, editor.getText().slice(addFrom, addTo));
    void runAutoSave();
    return true;
  },
  rejectProposal: (id) => {
    if (!editor) return false;
    let removeFrom = -1, removeTo = -1, addFrom = -1, addTo = -1;
    editor.state.doc.descendants((node, pos) => {
      const mark = node.marks.find((m) => m.type.name === 'suggestion' && m.attrs.id === id);
      if (!mark) return;
      const end = pos + node.nodeSize;
      if (mark.attrs.type === 'remove') { removeFrom = pos; removeTo = end; }
      else { addFrom = pos; addTo = end; }
    });
    if (removeFrom < 0 && addFrom < 0) return false;
    let tr = editor.state.tr;
    // 1) Drop insertion text entirely.
    if (addFrom >= 0) {
      tr = tr.delete(addFrom, addTo);
      if (removeFrom > addTo) { removeFrom -= (addTo - addFrom); removeTo -= (addTo - addFrom); }
    }
    // 2) Strip suggestion mark from the removed-span text (keeping the original text).
    if (removeFrom >= 0) {
      tr = tr.removeMark(removeFrom, removeTo, editor.schema.marks.suggestion);
    }
    editor.view.dispatch(tr);
    onProposalRejected?.(id);
    return true;
  },
};

function locateOriginal(ed: import('@tiptap/core').Editor, p: ProseProposal): { from: number; to: number } | null {
  if (p.original.length === 0) {
    return { from: p.anchor.from + 1, to: p.anchor.from + 1 };
  }
  const docText = ed.state.doc.textContent;
  const window = 200;
  const start = Math.max(0, p.anchor.from - window);
  const end = Math.min(docText.length, p.anchor.to + window);
  const idx = docText.indexOf(p.original, start);
  if (idx < 0 || idx > end) {
    const fallback = docText.indexOf(p.original);
    if (fallback < 0) return null;
    return { from: fallback + 1, to: fallback + 1 + p.original.length };
  }
  return { from: idx + 1, to: idx + 1 + p.original.length };
}
```

(`runAutoSave` is the existing function; if it's named differently in the file — likely just `autoSave` or wired into `onAutoSave` — adapt the call accordingly. Find with `grep -n "autoSave\|onAutoSave" src/lib/components/RichEditor.svelte`.)

- [ ] **Step 6: Add data attribute for display mode + suggestion CSS**

In the markup, where the editor host element is rendered (search for `<div bind:this={host}` or similar), add a `data-suggestion-display={displayMode}` attribute. In the `<style>` block, append:

```css
:global(.sg-add) {
  background: rgba(34, 139, 34, 0.18);
  text-decoration: none;
}
:global(.sg-remove) {
  background: rgba(220, 38, 38, 0.14);
  text-decoration: line-through;
  text-decoration-color: rgba(220, 38, 38, 0.7);
}
:global([data-suggestion-display="margin"] .sg-add),
:global([data-suggestion-display="margin"] .sg-remove) {
  background: transparent;
  text-decoration: none;
  border-bottom: 2px dotted var(--accent, #888);
}
```

- [ ] **Step 7: Type-check + commit**

`npx svelte-kit sync` to refresh `./$types`. Visually scan the file — it should still compile. Commit:

```bash
git add src/lib/components/RichEditor.svelte
git commit -m "feat(blog-assistant): RichEditor accepts/rejects/modifies prose proposals"
```

---

## Task 9: SuggestionChip component (metadata proposals)

**Files:**
- Create: `src/lib/components/BlogAssistantSuggestionChip.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/components/BlogAssistantSuggestionChip.svelte`:

```svelte
<script lang="ts">
  import type { MetaProposal } from '$lib/blog/assistant/proposal';

  type Props = {
    proposal: MetaProposal;
    onAccept: (p: MetaProposal) => void;
    onReject: (p: MetaProposal) => void;
    onRegenerate: (p: MetaProposal, note: string) => void;
  };
  let { proposal, onAccept, onReject, onRegenerate }: Props = $props();

  let regenerating = $state(false);
  let regenNote = $state('');

  function fmt(v: unknown): string {
    if (Array.isArray(v)) return v.join(', ');
    if (v == null) return '(none)';
    return String(v);
  }

  function submitRegen() {
    if (!regenNote.trim()) return;
    onRegenerate(proposal, regenNote.trim());
    regenerating = false;
    regenNote = '';
  }
</script>

<div class="chip" class:resolved={proposal.status !== 'pending'}>
  <div class="row">
    <span class="field">{proposal.field}</span>
    <span class="arrow">→</span>
    <span class="value" title={fmt(proposal.suggestedValue)}>{fmt(proposal.suggestedValue)}</span>
  </div>
  {#if proposal.reason}
    <p class="reason">{proposal.reason}</p>
  {/if}
  {#if proposal.status === 'pending'}
    <div class="actions">
      <button class="nm-save-btn" onclick={() => onAccept(proposal)}>Accept</button>
      <button class="nm-btn-ghost" onclick={() => onReject(proposal)}>Reject</button>
      <button class="nm-link-btn" onclick={() => (regenerating = !regenerating)}>↻</button>
    </div>
    {#if regenerating}
      <div class="regen-row">
        <input
          class="nm-text-input"
          placeholder="ask for another version…"
          bind:value={regenNote}
          onkeydown={(e) => e.key === 'Enter' && submitRegen()}
        />
        <button class="nm-btn-ghost" onclick={submitRegen} disabled={!regenNote.trim()}>Send</button>
      </div>
    {/if}
  {:else}
    <span class="status">{proposal.status}</span>
  {/if}
</div>

<style>
  .chip {
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    padding: 0.45rem 0.6rem;
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .chip.resolved { opacity: 0.6; }
  .row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .field { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .arrow { color: var(--text-ghost); }
  .value { font-weight: 500; word-break: break-word; max-width: 100%; }
  .reason { font-size: 0.78rem; color: var(--text-muted); margin: 0; }
  .actions { display: flex; gap: 0.4rem; align-items: center; }
  .regen-row { display: flex; gap: 0.4rem; }
  .regen-row .nm-text-input { flex: 1; }
  .status { font-size: 0.75rem; color: var(--text-ghost); text-transform: uppercase; letter-spacing: 0.05em; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/BlogAssistantSuggestionChip.svelte
git commit -m "feat(blog-assistant): metadata-proposal chip with accept/reject/regenerate"
```

---

## Task 10: Margin callouts overlay

**Files:**
- Create: `src/lib/components/BlogAssistantMarginCallouts.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/components/BlogAssistantMarginCallouts.svelte`:

```svelte
<script lang="ts">
  import type { ProseProposal } from '$lib/blog/assistant/proposal';

  type Props = {
    proposals: ProseProposal[];
    editorEl?: HTMLElement;
    onAccept: (p: ProseProposal, modifiedText?: string) => void;
    onReject: (p: ProseProposal) => void;
    onRegenerate: (p: ProseProposal, note: string) => void;
  };
  let { proposals, editorEl, onAccept, onReject, onRegenerate }: Props = $props();

  type Anchor = { id: string; top: number; height: number };
  let anchors = $state<Anchor[]>([]);
  let regenFor = $state<string | null>(null);
  let regenNote = $state('');
  let editFor = $state<string | null>(null);
  let editText = $state('');

  function recompute() {
    if (!editorEl) { anchors = []; return; }
    const containerRect = editorEl.getBoundingClientRect();
    const next: Anchor[] = [];
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const el = editorEl.querySelector(`[data-suggestion-id="${p.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({ id: p.id, top: r.top - containerRect.top, height: r.height });
    }
    anchors = next;
  }

  $effect(() => {
    // re-run whenever proposals change OR window resizes
    recompute();
    const handler = () => recompute();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  });

  function submitEdit(p: ProseProposal) {
    onAccept(p, editText);
    editFor = null;
    editText = '';
  }

  function submitRegen(p: ProseProposal) {
    if (!regenNote.trim()) return;
    onRegenerate(p, regenNote.trim());
    regenFor = null;
    regenNote = '';
  }
</script>

<aside class="margin-layer" aria-label="Pending suggestions">
  {#each proposals.filter((p) => p.status === 'pending') as p (p.id)}
    {@const anchor = anchors.find((a) => a.id === p.id)}
    {#if anchor}
      <div class="callout" style="top: {anchor.top}px;">
        {#if editFor === p.id}
          <textarea class="nm-textarea" rows="3" bind:value={editText}></textarea>
          <div class="acts">
            <button class="nm-save-btn" onclick={() => submitEdit(p)}>Save</button>
            <button class="nm-btn-ghost" onclick={() => { editFor = null; editText = ''; }}>Cancel</button>
          </div>
        {:else}
          <p class="suggested">{p.suggested || '(delete)'}</p>
          {#if p.reason}<p class="reason">{p.reason}</p>{/if}
          <div class="acts">
            <button class="nm-save-btn" onclick={() => onAccept(p)}>Accept</button>
            <button class="nm-btn-ghost" onclick={() => onReject(p)}>Reject</button>
            <button class="nm-link-btn" onclick={() => { editFor = p.id; editText = p.suggested; }}>Edit</button>
            <button class="nm-link-btn" onclick={() => (regenFor = regenFor === p.id ? null : p.id)}>↻</button>
          </div>
          {#if regenFor === p.id}
            <div class="regen-row">
              <input class="nm-text-input" placeholder="ask for another version…"
                bind:value={regenNote}
                onkeydown={(e) => e.key === 'Enter' && submitRegen(p)} />
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/each}
</aside>

<style>
  .margin-layer {
    position: absolute;
    top: 0;
    right: -340px;
    width: 320px;
    pointer-events: none;
  }
  .callout {
    position: absolute;
    width: 100%;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 0.5rem 0.6rem;
    pointer-events: auto;
    box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .suggested { margin: 0; font-weight: 500; }
  .reason { margin: 0; font-size: 0.78rem; color: var(--text-muted); }
  .acts { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .regen-row { display: flex; }
  .regen-row .nm-text-input { width: 100%; }
  @media (max-width: 1100px) {
    .margin-layer { display: none; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/BlogAssistantMarginCallouts.svelte
git commit -m "feat(blog-assistant): margin callouts overlay for prose proposals"
```

---

## Task 11: BlogAssistantWidget — floating chat card

**Files:**
- Create: `src/lib/components/BlogAssistantWidget.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/components/BlogAssistantWidget.svelte`:

```svelte
<script lang="ts">
  import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';
  import BlogAssistantSuggestionChip from './BlogAssistantSuggestionChip.svelte';

  type ChatRow = { role: 'user' | 'assistant'; content: string };

  type Props = {
    postId: number;
    adminToken: string;
    history: { role: string; content: string }[];
    proposalStore: import('$lib/blog/assistant/proposal-store').ProposalStore;
    displayMode: 'inline' | 'margin';
    onSetDisplayMode: (m: 'inline' | 'margin') => void;
    onProposalArrived: (p: Proposal) => void;
    onAcceptMeta: (p: MetaProposal) => Promise<void>;
    onRejectMeta: (p: MetaProposal) => void;
    onRegenerate: (p: Proposal, note: string) => void;
    sendMessage?: (text: string) => Promise<void>;
  };

  let {
    postId, adminToken, history, proposalStore,
    displayMode, onSetDisplayMode,
    onProposalArrived, onAcceptMeta, onRejectMeta, onRegenerate,
    sendMessage = $bindable(),
  }: Props = $props();

  let open = $state(true);
  let busy = $state(false);
  let input = $state('');
  let abortCtl: AbortController | null = null;

  let chatRows = $state<ChatRow[]>(
    history
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
  );
  let metaProposals = $derived(proposalStore.list().filter((p): p is MetaProposal => p.kind === 'meta'));

  type Pos = { x: number; y: number };
  const POS_KEY = 'blog-assistant-widget-pos';
  let pos = $state<Pos>(loadPos());
  function loadPos(): Pos {
    if (typeof localStorage === 'undefined') return { x: 16, y: 16 };
    try { return JSON.parse(localStorage.getItem(POS_KEY) ?? '{"x":16,"y":16}'); } catch { return { x: 16, y: 16 }; }
  }
  function savePos() { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } }

  let dragging = false;
  let dragStart: { x: number; y: number; px: number; py: number } | null = null;
  function startDrag(e: PointerEvent) {
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: PointerEvent) {
    if (!dragging || !dragStart) return;
    pos = {
      x: Math.max(8, dragStart.px - (e.clientX - dragStart.x)),
      y: Math.max(8, dragStart.py - (e.clientY - dragStart.y)),
    };
  }
  function endDrag(e: PointerEvent) {
    dragging = false; dragStart = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    savePos();
  }

  // Expose sendMessage for parent (page) to invoke programmatically (e.g. regenerate).
  sendMessage = async (text: string) => {
    input = text;
    await send();
  };

  async function send() {
    if (!input.trim() || busy) return;
    const message = input.trim();
    input = '';
    busy = true;
    chatRows = [...chatRows, { role: 'user', content: message }];
    let assistantBuf = '';
    let assistantIdx = -1;

    abortCtl = new AbortController();
    try {
      const res = await fetch(`/api/admin/blog/${postId}/assistant?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortCtl.signal,
      });
      if (!res.ok || !res.body) {
        chatRows = [...chatRows, { role: 'assistant', content: `Error: ${res.status}` }];
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') {
            assistantBuf += ev.delta;
            if (assistantIdx === -1) {
              chatRows = [...chatRows, { role: 'assistant', content: assistantBuf }];
              assistantIdx = chatRows.length - 1;
            } else {
              chatRows[assistantIdx] = { role: 'assistant', content: assistantBuf };
              chatRows = chatRows;
            }
          } else if (ev.type === 'proposal') {
            const p = ev.proposal as Proposal;
            if (p.replaces) proposalStore.replace(p.replaces, p);
            else proposalStore.add(p);
            onProposalArrived(p);
          } else if (ev.type === 'error') {
            chatRows = [...chatRows, { role: 'assistant', content: `Error: ${ev.message}` }];
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        chatRows = [...chatRows, { role: 'assistant', content: `Error: ${(e as Error).message}` }];
      }
    } finally {
      busy = false;
      abortCtl = null;
    }
  }

  function cancel() {
    abortCtl?.abort();
    busy = false;
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  }

  function handleAcceptMeta(p: MetaProposal) {
    onAcceptMeta(p);
  }
</script>

{#if !open}
  <button
    class="fab"
    style="right: {pos.x}px; bottom: {pos.y}px;"
    onclick={() => (open = true)}
    aria-label="Open assistant"
  >🪶</button>
{:else}
  <section class="widget" style="right: {pos.x}px; bottom: {pos.y}px;" role="region" aria-label="Blog assistant">
    <header
      class="bar"
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      <span class="title">Assistant</span>
      <span class="mode">
        <button class:active={displayMode === 'inline'} onclick={() => onSetDisplayMode('inline')}>inline</button>
        <button class:active={displayMode === 'margin'} onclick={() => onSetDisplayMode('margin')}>margin</button>
      </span>
      <button class="close" onclick={() => (open = false)} aria-label="Minimise">–</button>
    </header>

    <div class="body">
      {#each chatRows as row, i (i)}
        <div class="row {row.role}"><span class="bubble">{row.content}</span></div>
      {/each}
      {#each metaProposals as p (p.id)}
        <BlogAssistantSuggestionChip
          proposal={p}
          onAccept={handleAcceptMeta}
          onReject={onRejectMeta}
          onRegenerate={(prop, note) => onRegenerate(prop, note)}
        />
      {/each}
      {#if chatRows.length === 0 && metaProposals.length === 0}
        <p class="empty">Ask the assistant to rewrite, retitle, retag, publish, etc.</p>
      {/if}
    </div>

    <footer class="composer">
      <textarea class="nm-textarea" rows="2" bind:value={input} onkeydown={onKeydown} disabled={busy}
        placeholder="Ask the assistant…"></textarea>
      {#if busy}
        <button class="nm-btn-ghost" onclick={cancel}>Stop</button>
      {:else}
        <button class="nm-save-btn" onclick={send} disabled={!input.trim()}>Send</button>
      {/if}
    </footer>
  </section>
{/if}

<style>
  .fab {
    position: fixed; z-index: 80; width: 44px; height: 44px;
    border-radius: 50%; border: 1px solid var(--card-border);
    background: var(--bg-section); cursor: pointer; font-size: 1.2rem;
    box-shadow: 0 4px 10px rgba(0,0,0,0.08);
  }
  .widget {
    position: fixed; z-index: 80;
    width: 360px; height: 500px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    box-shadow: 0 6px 24px rgba(0,0,0,0.12);
    display: flex; flex-direction: column;
  }
  .bar {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--card-border);
    cursor: grab; user-select: none;
  }
  .bar:active { cursor: grabbing; }
  .title { font-family: var(--font-mono); font-size: 0.85rem; }
  .mode { display: flex; gap: 0.25rem; margin-left: auto; }
  .mode button {
    border: 1px solid var(--card-border); background: transparent;
    padding: 0.1rem 0.4rem; font-size: 0.7rem; cursor: pointer;
  }
  .mode button.active { background: var(--accent-tint-08); }
  .close { border: 0; background: transparent; font-size: 1.2rem; cursor: pointer; padding: 0 0.3rem; }
  .body {
    flex: 1; overflow-y: auto; padding: 0.6rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .row { display: flex; }
  .row.user { justify-content: flex-end; }
  .bubble {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    font-size: 0.86rem; max-width: 85%;
    white-space: pre-wrap;
  }
  .row.user .bubble { background: var(--accent-tint-08); }
  .empty { font-size: 0.85rem; color: var(--text-muted); margin: 0; }
  .composer { display: flex; gap: 0.4rem; padding: 0.4rem; border-top: 1px solid var(--card-border); }
  .composer .nm-textarea { flex: 1; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/BlogAssistantWidget.svelte
git commit -m "feat(blog-assistant): floating bottom-right chat widget"
```

---

## Task 12: Wire it all together in the editor page

**Files:**
- Modify: `src/routes/admin/blog/[id]/+page.svelte`

- [ ] **Step 1: Replace imports + state**

In the `<script>` block, REMOVE:

```typescript
import BlogAssistantPanel from '$lib/components/BlogAssistantPanel.svelte';
```

ADD:

```typescript
import BlogAssistantWidget from '$lib/components/BlogAssistantWidget.svelte';
import BlogAssistantMarginCallouts from '$lib/components/BlogAssistantMarginCallouts.svelte';
import { createProposalStore } from '$lib/blog/assistant/proposal-store';
import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';

const proposalStore = createProposalStore();
let proposalTick = $state(0); // bump to force re-render of derived lists
let displayMode = $state<'inline' | 'margin'>(
  (typeof localStorage !== 'undefined' && (localStorage.getItem('blog-assistant-display-mode') as 'inline' | 'margin')) || 'inline',
);
let editorContainer = $state<HTMLDivElement | undefined>();

function setDisplayMode(m: 'inline' | 'margin') {
  displayMode = m;
  try { localStorage.setItem('blog-assistant-display-mode', m); } catch { /* ignore */ }
}

async function acceptMetaProposal(p: MetaProposal) {
  proposalStore.resolve(p.id, 'accepted');
  proposalTick++;
  const res = await fetch(`/api/admin/blog/${data.post.id}/apply-proposal?token=${adminToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposalId: p.id, field: p.field, value: p.suggestedValue }),
  });
  if (!res.ok) return;
  const body = await res.json();
  if (!body.post) return;
  if (p.field === 'title') title = body.post.title;
  if (p.field === 'excerpt') excerpt = body.post.excerpt;
  if (p.field === 'slug') slug = body.post.slug;
  if (p.field === 'tags') tags = (body.post.tags as string[]).join(', ');
  if (p.field === 'status') status = body.post.status;
  data.post = body.post;
}

function rejectMetaProposal(p: MetaProposal) {
  proposalStore.resolve(p.id, 'rejected');
  proposalTick++;
}

let widgetSendMessage = $state<((text: string) => Promise<void>) | undefined>();

async function regenerate(p: Proposal, note: string) {
  // Mark the old proposal as superseded; widget will call SSE to fetch a new one.
  proposalStore.resolve(p.id, 'rejected');
  proposalTick++;
  const summary = p.kind === 'prose'
    ? `the prose change at "${p.original.slice(0, 40)}…"`
    : `the ${p.field} change to ${JSON.stringify(p.suggestedValue).slice(0, 40)}`;
  await widgetSendMessage?.(`I rejected ${summary}. Try a different version: ${note}`);
}

function onProposalArrived(p: Proposal) {
  proposalTick++;
  if (p.kind === 'prose' && richApi) {
    richApi.applyProposal(p);
  }
}

let proseProposals = $derived(
  proposalTick >= 0 ? proposalStore.list().filter((p): p is ProseProposal => p.kind === 'prose') : []
);

function acceptProse(p: ProseProposal, modifiedText?: string) {
  if (!richApi) return;
  richApi.acceptProposal(p.id, modifiedText);
  proposalStore.resolve(p.id, 'accepted');
  proposalTick++;
}

function rejectProse(p: ProseProposal) {
  if (!richApi) return;
  richApi.rejectProposal(p.id);
  proposalStore.resolve(p.id, 'rejected');
  proposalTick++;
}
```

- [ ] **Step 2: Pass props to RichEditor**

Find the existing `<RichEditor ... bind:api={richApi} />` line. Replace it with:

```svelte
<div bind:this={editorContainer} class="editor-host" data-suggestion-display={displayMode}>
  <RichEditor
    {content}
    onSave={saveContent}
    onAutoSave={saveContent}
    {uploadImage}
    bind:api={richApi}
    {displayMode}
    onProposalAccepted={(id) => { proposalStore.resolve(id, 'accepted'); proposalTick++; }}
    onProposalRejected={(id) => { proposalStore.resolve(id, 'rejected'); proposalTick++; }}
  />
  {#if displayMode === 'margin'}
    <BlogAssistantMarginCallouts
      proposals={proseProposals}
      editorEl={editorContainer}
      onAccept={(p, modifiedText) => acceptProse(p, modifiedText)}
      onReject={(p) => rejectProse(p)}
      onRegenerate={(p, note) => regenerate(p, note)}
    />
  {/if}
</div>
```

Add to the `<style>` block:

```css
.editor-host { position: relative; }
```

- [ ] **Step 3: Replace the panel mount with the widget mount**

Find the existing `<BlogAssistantPanel ... />` block (around the bottom of the markup). REPLACE it with:

```svelte
<BlogAssistantWidget
  postId={data.post.id}
  {adminToken}
  history={data.history ?? []}
  {proposalStore}
  {displayMode}
  onSetDisplayMode={setDisplayMode}
  onProposalArrived={onProposalArrived}
  onAcceptMeta={acceptMetaProposal}
  onRejectMeta={rejectMetaProposal}
  onRegenerate={regenerate}
  bind:sendMessage={widgetSendMessage}
/>
```

- [ ] **Step 4: Type-check**

`npx svelte-kit sync` — should report no errors.

- [ ] **Step 5: Commit**

```bash
git add 'src/routes/admin/blog/[id]/+page.svelte'
git commit -m "feat(blog-assistant): mount widget + margin callouts; wire proposal flow"
```

---

## Task 13: Remove dead code

**Files:**
- Delete: `src/lib/components/BlogAssistantPanel.svelte`
- Delete: `src/lib/blog/assistant/undo-store.ts`
- Delete: `src/routes/api/admin/blog/[id]/assistant/undo/+server.ts`
- Delete: `tests/lib/blog/assistant/undo-store.test.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm src/lib/components/BlogAssistantPanel.svelte
git rm src/lib/blog/assistant/undo-store.ts
git rm 'src/routes/api/admin/blog/[id]/assistant/undo/+server.ts'
git rm tests/lib/blog/assistant/undo-store.test.ts
```

- [ ] **Step 2: Confirm no remaining references**

```bash
grep -rn "BlogAssistantPanel\|undo-store\|undoStore\|/assistant/undo" src tests 2>/dev/null
```

Expected: no output.

- [ ] **Step 3: Run the full test suite**

`DATABASE_URL='postgresql://app:test@localhost:5433/strange_rambling' npm test`
Expected: all tests pass (proposal-store, tools, runner, plus everything else).

- [ ] **Step 4: Build**

`DATABASE_URL='postgresql://app:test@localhost:5433/strange_rambling' npm run build`
Expected: `✓ built`. (Circular-dependency warnings are pre-existing and fine.)

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(blog-assistant): remove obsolete panel/undo code"
```

---

## Task 14: Manual UAT checklist (no commit; use as smoke test)

- [ ] Open `/admin/blog/<some draft>?token=…` in dev. Widget appears bottom-right.
- [ ] Type "rewrite the first paragraph more punchy" — proposal arrives, original wraps `<del>` and replacement wraps `<ins>` (inline mode).
- [ ] Click Accept on a meta chip ("set title to X") — title input updates without reload; chip greys out.
- [ ] Toggle to margin mode — diff highlights become subtle underline + callout cards on right.
- [ ] On a wide screen click Edit on a callout — textarea appears; Save accepts the modified text.
- [ ] Click ↻ on a meta chip — composer prefilled with regenerate request; Send fires; new proposal replaces old.
- [ ] Drag widget header — widget moves; refresh page; widget re-opens at last position.
- [ ] Click minimise (`–`) — collapses to floating circle; click circle — restores.
- [ ] Reject a prose proposal — original text intact, no `<ins>`/`<del>` left.
- [ ] Reload — earlier accepted/rejected proposals show as resolved chips/marks (proposals from `blog_assistant_messages` history).

If anything regresses, capture the failing case before deploying.
