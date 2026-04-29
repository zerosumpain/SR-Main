# Blog Assistant — Suggestions Redesign — Design

Date: 2026-04-29

## Summary

Redesign the blog editor assistant from a small inline chat panel + direct mutate-and-undo tools into a **floating bottom-right chat widget** whose edits surface as **inline proposals** the user accepts/rejects/modifies. Two presentation modes for prose proposals — **inline diff** and **margin annotation** — selectable per-user. Non-prose operations (title, excerpt, slug, tags, status, cover alt) appear as **suggestion chips** in the chat transcript with Accept/Reject. The intent: keep the assistant always reachable while writing without it ever silently changing the post.

## Out of scope

- Real-time multi-user co-editing.
- Server-side persistence of pending suggestions across sessions (suggestions are session-scoped client state).
- Suggestions on the cover image binary itself (only the alt text).
- Migrating the existing inline `BlogAssistantPanel.svelte` for users on `/jkai` or anywhere else — only `/admin/blog/[id]` gets the new widget.

## Design choices (already settled in brainstorm)

1. **Display modes**: inline-diff and margin-annotation, both supported, user picks.
2. **Granularity**: hybrid — LLM defaults to region-level proposals, splits to sentence-level when changes are independent.
3. **Modify-a-suggestion**: click the proposed insertion → edit it in place → press Enter/click ✓ to accept the modified version. Plus a `↻ regenerate` affordance to ask the LLM for an alternative.
4. **Widget shape**: floating bottom-right card (~360 × 500 px), collapses to a circular button, draggable within the viewport.
5. **Non-prose operations**: suggestion chips in the chat transcript with Accept/Reject buttons. Nothing applies until the user clicks Accept.

## Architecture

### Data model

A single TypeScript type captures every kind of proposal the assistant can make:

```ts
type Proposal =
  | {
      id: string;             // uuid
      kind: 'prose';
      original: string;       // exact text from current document; "" for pure insertions
      suggested: string;      // proposed replacement; "" for pure deletions
      reason?: string;        // short LLM explanation, shown on hover
      anchor: { from: number; to: number }; // ProseMirror positions at proposal time
      status: 'pending' | 'accepted' | 'rejected';
    }
  | {
      id: string;
      kind: 'meta';
      field: 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';
      currentValue: unknown;
      suggestedValue: unknown;
      reason?: string;
      status: 'pending' | 'accepted' | 'rejected';
    };
```

### Source of truth

A client-side **proposal store** (Svelte 5 `$state` Map keyed by id) holds every pending proposal for the current editing session. Two consumers read from it:

1. The **RichEditor** → renders prose proposals as TipTap marks.
2. The **BlogAssistantWidget** → renders metadata proposals as chips, and the assistant transcript as text.

Acceptance / rejection mutates the store and triggers a single side effect (post save for prose, server tool call for metadata).

### Component tree (new + changed)

```
src/routes/admin/blog/[id]/+page.svelte
  ├── …existing sections…
  └── <BlogAssistantWidget> (NEW — replaces inline panel)
        ├── Composer (input + send/cancel buttons)
        ├── Transcript
        │     ├── User messages
        │     ├── Assistant text (streamed)
        │     ├── <SuggestionChip> for kind=meta proposals
        │     └── Tool-trace lines (collapsible)
        └── Drag handle / collapse-to-circle button

src/lib/components/RichEditor.svelte (CHANGED)
  + suggestion-mark TipTap extension
  + accepts a proposalStore prop and a displayMode prop ('inline' | 'margin')
  + emits accept/reject/modify events on its API

<BlogAssistantMarginCallouts> (NEW, sibling of editor when displayMode === 'margin')
  - absolutely positioned <aside> on the right
  - reads proposalStore + measures mark DOM rects
  - renders one callout card per pending prose proposal
```

### Suggestion mark — TipTap extension

A new TipTap mark `suggestion` with attributes `{ id: string, type: 'add' | 'remove' }`. Two CSS classes drive the visual modes:

- **Inline mode**: `<span class="sg-add">…</span>` is rendered green; `<span class="sg-remove">…</span>` rendered red strikethrough. Both modes share these classes; only the surrounding chrome differs.
- **Margin mode**: same marks, same CSS classes, but with a body class `data-suggestion-display="margin"` we restyle them to a *subtle* underline/highlight instead of bold colour, then `BlogAssistantMarginCallouts` renders the proposed text in a card on the right margin. The text in the document remains the original until accepted.

Accepting a prose proposal → the editor removes the `<del>` text, unwraps the `<ins>` mark (keeping its content), and triggers the existing `onSave` callback. Rejecting → unwrap `<del>` (keep original) and remove the `<ins>` text. Modifying → make the `<ins>` content `contenteditable`, listen for Enter/click-out, treat the new text as the suggested value on accept.

### Server-side: from "apply" to "propose"

The existing tools split into two camps:

- **Prose tools** (`replace_content`, `patch_content`) — rewritten to *propose* rather than apply. They return a `Proposal` object instead of mutating the post. The runner forwards them as SSE `proposal` events.
- **Metadata tools** (`update_title`, `update_excerpt`, `update_slug`, `update_tags`, `set_status`, `set_cover_alt`) — same: propose instead of apply. They become "show this as a chip in the chat".

A new server endpoint `POST /api/admin/blog/[id]/apply-proposal` handles user-accept actions for metadata proposals. Body: `{ field, value }`. It performs the mutation server-side using existing repo helpers and returns the new post payload.

For prose proposals, *no extra round trip is needed on accept*. The editor just calls `onSave(html)` with the post-acceptance HTML — that already hits `PUT /api/admin/blog/[id]` per the existing save flow.

### Removal of direct-mutation tools

The existing `runTool()` function in `src/lib/blog/assistant/tools.ts` is rewritten to return a `Proposal` instead of performing DB writes. The undo-store and `/api/admin/blog/[id]/assistant/undo` endpoint become unused for new sessions and are kept only for backwards compatibility with existing `blog_assistant_messages` rows that referenced undo tokens. (The undo endpoint can be removed in a follow-up once those rows are gone.)

### Regenerate flow

Each pending proposal has a `↻` icon. Clicking it opens a small inline input under the suggestion in the chat transcript: *"Ask for another version…"*. Submitting sends `regenerate <proposal id> <user note>` as a special user message. The server prompt instructs the LLM to replace that proposal's `id` with a new one of the same `kind` and same `anchor` (for prose) or `field` (for meta), based on the user's note. The runner emits a `proposal` event with `replaces: <previous id>` set; the client's store removes the previous proposal and adds the new one.

### Display-mode persistence

User's choice (inline vs. margin) is stored in `localStorage` under `blog-assistant-display-mode`. No DB migration. Default: inline.

### Widget docking + drag

Widget is `position: fixed; bottom: 16px; right: 16px;` with `width: 360px; height: 500px;`. Collapsed = a 44×44 circular button at the same anchor. Dragging is implemented via a small `pointerdown → pointermove → pointerup` handler bound to the widget's title bar; positions persist in `localStorage` per-user. Hidden behind a feature toggle in code (no UI to disable, just `WIDGET_DRAGGABLE = true` constant — easy to change).

### Streaming compatibility

The existing SSE event shapes are extended, not replaced:

- New `proposal` event: `{ id, kind, original?, suggested?, anchor?, field?, currentValue?, suggestedValue?, reason?, replaces? }`
- New `proposal_resolved` event: emitted by the *server* in response to the client's accept/reject HTTP call (so the chat transcript can persist the resolution into `blog_assistant_messages`).
- Existing `text`, `done`, `error` events unchanged.
- Removed: `tool_call`, `tool_result`, `post_state` (no more direct mutations from the runner; no need for post-state resync).

The pre-existing client (the panel we're replacing) won't be reachable post-change, so we don't need a compatibility layer.

### Schema

No new tables. The existing `blog_assistant_messages` table grows new `role`/`content` shapes:

- `role: 'tool'` rows (existing) become `role: 'proposal'` for new sessions; `content` is `JSON.stringify({ id, kind, ...payload, status })`. Keep `'tool'` working for old rows on rehydrate.
- New `role: 'proposal_resolved'` rows for accept/reject, recording the final resolution.

Both shapes are still just `text NOT NULL` so no migration needed.

## Architecture quality notes

- **Editor doesn't know about the LLM**. The RichEditor receives a `proposalStore` and a `displayMode`; the chat widget owns LLM/SSE concerns. They communicate only through the proposal store. This keeps the editor reusable in future preview-only contexts.
- **One source of truth, two views**. Proposals are written exactly once (by the SSE listener); the editor + chat widget both read from the store. Means accepting a meta-suggestion-chip in chat or accepting it via a hypothetical hotkey both go through the same store.
- **Server-tools shape doesn't leak into client**. The runner returns `Proposal`s — concrete, typed payloads with no reference to OpenAI tool names. Client doesn't care which tool was called.

## Failure modes

- **LLM proposes prose with stale anchors** — by the time the proposal arrives, the user has already typed somewhere upstream and the offsets shifted. Solution: each prose proposal includes the `original` substring; before applying anchors we run a fuzzy locate (search for `original` near `anchor.from`); if not found within ±200 chars, we mark the proposal as `stale` and the chat shows it greyed-out with a "no longer applies" badge.
- **Network drops mid-stream** — the SSE handler closes with an error event; pending proposals stay in the store; the user can resume by sending another message.
- **User edits the post while a proposal is pending** — TipTap's marks travel with the text, so the proposal's anchor remains correct as long as the original text isn't deleted. If the user does delete the marked region, the proposal is silently dropped from the store on the next mark-removed event.
- **Conflicting overlapping proposals** — the LLM is instructed to never propose overlapping prose changes. If it does anyway, the second one is rejected client-side with a chat note.

## Testing

Server-side unit tests:
- `runTool` / `proposeTool`: each operation returns a correctly-shaped `Proposal`, no DB writes happen.
- Runner emits the new event types in the right order.
- Apply-proposal endpoint applies metadata correctly.

Manual UAT:
- Create proposals across both modes; accept, reject, modify each.
- Regenerate; ensure old proposal is replaced cleanly.
- Drag widget; collapse/expand; refresh; widget re-opens at last position.
- Switch between inline and margin modes mid-session.

## Open questions

None remaining at design time.
