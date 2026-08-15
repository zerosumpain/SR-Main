<script lang="ts">
  import { Marked } from 'marked';
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import SlashCommandButtonBar from './SlashCommandButtonBar.svelte';
  import FileReferenceChips from './FileReferenceChips.svelte';
  import ResearchReferenceChips from './ResearchReferenceChips.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import { rewriteHermesToolLog } from '$lib/workflows/chat/hermes-tool-log';
  import { linkifyCitations, fileAnchors, researchAnchors, type CiteTarget } from '$lib/jkai/citation-linkify';
  import { linkifyEntities } from '$lib/jkai/intel/entity-linkify';
  import type { MentionTarget } from '$lib/jkai/intel/entity-card-store';
  import { entityMentionHandlers } from '$lib/components/intel/entity-hover.svelte';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import type { ApprovalUiSettings } from '$lib/server/models/settings';
  import { readTurnStamp, type TurnStamp } from '$lib/jkai/turn-stamp';
  import { shortModelLabel } from '$lib/jkai/model-label';
  import { formatGbp } from '$lib/canvas/stats/costFormat';

  // @files / @research references cited by this reply. Their in-prose mentions
  // are linkified into clickable citations (see citation-linkify); any source the
  // model didn't name is shown in a compact fallback chip row below the reply.
  type FileRef = {
    fileId: string; source: string; modality: string; score: number;
    chunkOrd?: number; charStart?: number; charEnd?: number; passage: string;
  };
  type ResearchRef = {
    factId: string; sourceId: string | null; sessionId: string; sessionTopic: string;
    sourceTitle: string | null; sourceUrl: string | null; domain: string | null;
    score: number; passage: string;
  };

  let {
    role,
    content,
    metadata,
    thinking,
    conversationId = null,
    onSilentSend,
    approvalUi,
    isLatest = false,
    createdAt,
    queued = false,
    fileRefs = [],
    researchRefs = [],
    onOpenFileRef,
    onOpenResearchRef,
    entityMentions = [],
    erProcessing = false,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: {
      workflowGenerated?: boolean;
      usage?: TurnStamp;
      heartbeat?: {
        activity: string;
        kind: 'note' | 'reply' | 'user-trigger';
        replyToHeartbeatMessageId?: string;
        tokens?: { prompt: number; completion: number };
      };
    };
    thinking?: OrchestratorThinking;
    conversationId?: string | null;
    onSilentSend?: (command: string) => void | Promise<void>;
    approvalUi?: ApprovalUiSettings;
    isLatest?: boolean;
    /** @files hits cited by this reply — mentions are linkified inline; the rest
     *  fall back to a chip row. */
    fileRefs?: FileRef[];
    /** @research hits cited by this reply. Same lifecycle as fileRefs. */
    researchRefs?: ResearchRef[];
    /** Open the file viewer at a cited @files passage (from an inline link or chip). */
    onOpenFileRef?: (ref: FileRef) => void;
    /** Open the research source reader for a cited @research passage. */
    onOpenResearchRef?: (ref: ResearchRef) => void;
    /** Intel entities whose first mention in this reply becomes a hoverable
     *  reference. Supplied once by the page from the cached mention index. */
    entityMentions?: MentionTarget[];
    /** ISO timestamp the bubble was created. Drives the "10:42:13" wall-clock
     *  mark that fades in under each bubble on hover. */
    createdAt?: string;
    /** True when the bubble represents a message that was queued offline by
     *  the outbox (`$lib/jkai/pwa/outbox`) rather than POSTed live. Drives
     *  the inline "queued" badge so John can see at a glance that the
     *  message hasn't actually been sent to the server yet. */
    queued?: boolean;
    /** Entity resolution is running over the thread this reply just joined.
     *  Marks the bubble itself — a pulsing border plus an "ER processing"
     *  legend on the top edge — rather than dropping a separate pill into the
     *  thread, so the signal sits on the message it is about. */
    erProcessing?: boolean;
  } = $props();

  function formatClockTime(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  let clockTime = $derived(formatClockTime(createdAt));

  const marked = new Marked({ gfm: true, breaks: true });

  /**
   * Append `?conv=<conversationId>` to any /jkai/canvas/<slug> link in the
   * rendered HTML so the conversation thread can follow the user when
   * they click through. Skips links that already carry a conv param,
   * preserves any existing query string and fragment, and is a no-op when
   * we don't have an active conversation id.
   */
  function injectConvParam(html: string, convId: string | null): string {
    if (!convId) return html;
    return html.replace(
      /href="([^"]*\/jkai\/canvas\/[^"#?]+)((?:\?[^"#]*)?)((?:#[^"]*)?)"/g,
      (_match, base: string, query: string, hash: string) => {
        if (query && /[?&]conv=/.test(query)) return `href="${base}${query}${hash}"`;
        const sep = query ? '&' : '?';
        return `href="${base}${query}${sep}conv=${encodeURIComponent(convId)}${hash}"`;
      },
    );
  }

  // Wrap GFM tables in a horizontal-scroll container so a wide comparison
  // table doesn't overflow the chat column. Runs post-sanitise so the wrapper
  // survives (marked emits a bare `<table>` — confirmed).
  function wrapTables(html: string): string {
    return html
      .replace(/<table>/g, '<div class="md-table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
  }

  // Hermes writes its own tool-call log into the text stream (`⚙️
  // mcp_jkai_recall_memories: "…"`), which is machinery, not answer. Rewrite it
  // into plain English BEFORE the markdown parse so both the live stream and
  // stored history read the same — see $lib/workflows/chat/hermes-tool-log.
  let renderedContent = $derived(
    role === 'assistant'
      ? wrapTables(
          injectConvParam(
            sanitizeChatHtml(marked.parse(rewriteHermesToolLog(content)) as string),
            conversationId,
          ),
        )
      : ''
  );

  // Turn each cited source into anchor candidates, then linkify its first in-prose
  // mention into a clickable citation. `matched` tells us which refs got linked so
  // the rest can fall back to chips. Pure string transform over already-sanitised
  // HTML → SSR-safe, and it can only inject the fixed cite-link markup.
  let citeTargets: CiteTarget[] = $derived([
    ...fileRefs.map((r, idx) => ({ kind: 'file' as const, idx, anchors: fileAnchors(r.source) })),
    ...researchRefs.map((r, idx) => ({ kind: 'research' as const, idx, anchors: researchAnchors(r) })),
  ]);
  let linkified = $derived(
    role === 'assistant'
      ? linkifyCitations(renderedContent, citeTargets)
      : { html: renderedContent, matched: new Set<string>() },
  );
  // Sources the model didn't name in prose still get a chip so nothing is lost.
  let unmatchedFileRefs = $derived(fileRefs.filter((_, idx) => !linkified.matched.has(`file:${idx}`)));
  let unmatchedResearchRefs = $derived(researchRefs.filter((_, idx) => !linkified.matched.has(`research:${idx}`)));

  // Intel entities named in the reply become hoverable references. Runs AFTER
  // citation linkification and skips anything already inside an <a>, so a real
  // source citation always wins over an entity mention at the same words.
  let displayHtml = $derived(
    role === 'assistant' && entityMentions.length
      ? linkifyEntities(linkified.html, entityMentions).html
      : linkified.html,
  );

  const mentionEvents = entityMentionHandlers();

  function citeFromEvent(target: EventTarget | null): HTMLElement | null {
    const el = target as HTMLElement | null;
    return el?.closest?.('a.cite-link') ?? null;
  }
  function openCite(a: HTMLElement) {
    const kind = a.getAttribute('data-cite-kind');
    const idx = Number(a.getAttribute('data-cite-idx'));
    if (kind === 'file' && fileRefs[idx]) onOpenFileRef?.(fileRefs[idx]);
    else if (kind === 'research' && researchRefs[idx]) onOpenResearchRef?.(researchRefs[idx]);
  }
  function onCiteClick(e: MouseEvent) {
    const a = citeFromEvent(e.target);
    if (a) {
      e.preventDefault();
      openCite(a);
      return;
    }
    mentionEvents.handleClick(e);
  }
  function onCiteKey(e: KeyboardEvent) {
    const a = citeFromEvent(e.target);
    if (a && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openCite(a);
      return;
    }
    mentionEvents.handleKey(e);
  }

  let isUser = $derived(role === 'user');
  let thinkingOpen = $state(true);
  let hasThinking = $derived(thinking && thinking.steps && thinking.steps.length > 0);
  let heartbeat = $derived(metadata?.heartbeat ?? null);
  let isHeartbeatTrigger = $derived(heartbeat?.kind === 'user-trigger');

  // Per-turn ledger: MODEL / N TOK / LATENCY / £PRICE, stamped under every
  // assistant reply. This is the point of the redesign — every turn is priced
  // where it sits, rather than only rolling up into a conversation total.
  const stamp = $derived<TurnStamp | null>(metadata?.usage ?? readTurnStamp(metadata));

  function compactTokens(v: number): string {
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(1)}K`;
    return `${(v / 1_000_000).toFixed(1)}M`;
  }
  function formatLatency(ms: number): string {
    if (ms <= 0) return '';
    if (ms < 1000) return `${Math.round(ms)}MS`;
    return `${(ms / 1000).toFixed(1)}S`;
  }
  const stampChunks = $derived.by(() => {
    if (!stamp) return [];
    const chunks: Array<{ text: string; accent?: boolean }> = [];
    const model = shortModelLabel(stamp.model);
    if (model) chunks.push({ text: model });
    const total = stamp.inputTokens + stamp.outputTokens;
    if (total > 0) chunks.push({ text: `${compactTokens(total)} tok` });
    const latency = formatLatency(stamp.latencyMs);
    if (latency) chunks.push({ text: latency });
    chunks.push({ text: formatGbp(stamp.costUsd), accent: true });
    return chunks;
  });

  const roleLabel = $derived(isUser ? 'you' : role === 'system' ? 'system' : 'jkai');

  // An attachment-only turn (the model returned a file and no prose) would
  // otherwise draw an empty bubble above the attachment block. Skip the bubble
  // and let the attachment be the message.
  const hasBody = $derived(
    content.trim().length > 0 || !!heartbeat || hasThinking || !!metadata?.workflowGenerated,
  );
  let heartbeatLabel = $derived.by(() => {
    if (!heartbeat) return '';
    if (heartbeat.kind === 'note') return 'heartbeat note';
    if (heartbeat.kind === 'reply') return `heartbeat reply (${heartbeat.activity})`;
    if (heartbeat.kind === 'user-trigger') return `heartbeat trigger (${heartbeat.activity})`;
    return 'heartbeat';
  });
</script>

<!-- One ledger row per turn: an 84px mono gutter carrying who and when, the body
     in the column beside it, and a hairline rule underneath. Assistant turns take
     a faint accent wash so the two registers separate without a bubble. -->
<div class="msg-row" class:user={isUser} class:assistant={!isUser} class:bodyless={!hasBody}>
  <!-- ROLE / TIMESTAMP — the uniform every turn wears, now in the gutter. -->
  <div class="msg-meta">
    <span class="meta-role">{roleLabel}</span>
    {#if clockTime}
      <span class="meta-time">{clockTime}</span>
    {/if}
  </div>

  <div class="msg-body">
  {#if hasBody}
  <div
    class="msg-bubble"
    class:hb-msg={!!heartbeat}
    class:hb-msg-trigger={isHeartbeatTrigger}
    class:er-processing={erProcessing}
  >
    {#if erProcessing}
      <!-- Legend on the top border, fieldset-style: it belongs to the frame,
           not to the reply's prose. -->
      <span class="er-legend" role="status" aria-live="polite">ER processing</span>
    {/if}
    {#if heartbeat}
      <div class="hb-badge">
        <span class="hb-pulse" aria-hidden="true">●</span>
        <span class="hb-label">{heartbeatLabel}</span>
      </div>
    {/if}
    {#if hasThinking}
      <!-- One mono row above the body: what the model did before it answered is
           machinery, and machinery reads above the answer, not under it. -->
      <button class="thinking-toggle" onclick={() => { thinkingOpen = !thinkingOpen; }}>
        <span class="tt-glyph" aria-hidden="true">{thinkingOpen ? '\u25BE' : '\u25B8'}</span>
        <span class="tt-word">thinking</span>
        <span class="tt-sep" aria-hidden="true">/</span>
        <span>{thinking!.steps.length} steps</span>
      </button>

      {#if thinkingOpen}
        <ThinkingTimeline thinking={thinking!} />
      {/if}
    {/if}

    {#if isUser}
      <p class="user-text">{content}</p>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="chat-markdown"
        onclick={onCiteClick}
        onkeydown={onCiteKey}
        onmouseover={mentionEvents.onmouseover}
        onmouseout={mentionEvents.onmouseout}
        onfocusin={mentionEvents.onfocusin}
      >{@html displayHtml}</div>
      {#if unmatchedFileRefs.length > 0 && onOpenFileRef}
        <FileReferenceChips refs={unmatchedFileRefs} onOpen={onOpenFileRef} />
      {/if}
      {#if unmatchedResearchRefs.length > 0 && onOpenResearchRef}
        <ResearchReferenceChips refs={unmatchedResearchRefs} onOpen={onOpenResearchRef} />
      {/if}
      {#if onSilentSend}
        <SlashCommandButtonBar
          {content}
          {onSilentSend}
          autoSelect={approvalUi}
          {isLatest}
        />
      {/if}
    {/if}

    {#if metadata?.workflowGenerated}
      <div class="wf-generated">Workflow generated</div>
    {/if}
  </div>
  {/if}

  {#if queued}
    <!-- Offline outbox: the bubble stays put and says what will happen to it.
         Same stamp geometry as the cost line, so a queued turn and a priced
         turn read as the same kind of annotation. -->
    <div class="cost-stamp queued-stamp">
      <span class="accent">queued · offline</span>
      <span class="stamp-sep" aria-hidden="true">/</span>
      <span>sends on reconnect</span>
    </div>
  {/if}

  {#if stampChunks.length > 0}
    <div class="cost-stamp" title="Model / tokens / latency / price for this turn">
      {#each stampChunks as chunk, i (i)}
        {#if i > 0}<span class="stamp-sep" aria-hidden="true">/</span>{/if}
        <span class:accent={chunk.accent}>{chunk.text}</span>
      {/each}
    </div>
  {/if}
  </div>
</div>

<style>
  /* The transcript is a ledger, not a stack of speech bubbles: every turn is one
     row with an 84px mono gutter (who / when) and a body column beside it,
     divided by a hairline. The row is full-bleed so the divider and the
     assistant wash reach the pane edges, while the content inside stays on the
     900px reading column via the centring padding. */
  .msg-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 16px;
    width: 100%;
    align-self: stretch;
    padding: 16px max(20px, calc((100% - 900px) / 2));
  }
  /* The wash and the divider belong to the whole TURN, not to its prose — a
     reply's attachments, workflow chips and build pill are part of the same
     thing the model said. Both live on .msg-slot in ChatArea; an
     attachment-only turn would otherwise draw an empty band of wash above an
     attachment sitting on bare page ground. */
  .msg-row.bodyless {
    padding-bottom: 0;
  }
  .msg-body {
    min-width: 0;
  }

  .msg-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    min-width: 0;
  }
  .meta-role {
    font-weight: 500;
    color: var(--text-ghost);
  }
  /* Burnt orange is "this one is the machine talking" — the only colour
     difference between the two registers besides the wash. */
  .msg-row.assistant .meta-role {
    color: var(--accent);
  }
  /* The wall-clock mark stays quiet until the row is hovered — available for
     reference without every turn shouting its timestamp. */
  .meta-time {
    opacity: 0;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.2s ease-out;
  }
  .msg-row:hover .meta-time,
  .msg-row:focus-within .meta-time {
    opacity: 1;
  }

  /* No bubble in the assistant register. The element stays so the heartbeat and
     entity-resolution variants below still have something to dress. */
  .msg-bubble {
    width: 100%;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0;
    background: none;
    color: var(--text-primary);
    font-family: var(--font-body);
    /* The one surface on the site that is read rather than scanned — full body
       size, not a label size. Everything nested in .chat-markdown sizes in em
       off this, so this is the anchor for the whole transcript. */
    font-size: var(--fs-body);
    line-height: 1.6;
  }
  /* The user turn keeps a bordered block, so a question still reads as an object
     placed on the page rather than as more prose. */
  /* Shrink to the question asked — `width: auto` on a block element is 100%,
     which put a two-word prompt in an empty-looking form field. */
  .msg-row.user .msg-bubble {
    width: fit-content;
    max-width: 100%;
    padding: 11px 13px;
    border-color: var(--line);
    background: var(--surface-sunken);
  }
  .user-text {
    white-space: pre-wrap;
    margin: 0;
  }

  /* Entity resolution in flight over the thread. The frame pulses in the
     design system's blue (--accent-ink, which --info also points at) rather
     than the burnt-orange accent, so "a background job is chewing on this" is
     never mistaken for "this is the live turn". */
  .msg-bubble.er-processing {
    position: relative;
    /* The frame only exists while the job runs, so it brings its own inset —
       the resting bubble has none. */
    padding: 11px 13px;
    border-color: var(--accent-ink);
    animation: er-border-pulse 1.8s ease-in-out infinite;
  }
  @keyframes er-border-pulse {
    0%,
    100% {
      border-color: var(--accent-ink-tint-22);
      background: transparent;
    }
    50% {
      border-color: var(--accent-ink);
      background: var(--accent-ink-tint-06);
    }
  }
  .er-legend {
    position: absolute;
    top: -1px;
    left: 12px;
    transform: translateY(-50%);
    padding: 0 6px;
    /* Opaque, so the border it straddles is cut rather than showing through.
       --surface-shell rather than --bg: the row it sits on carries the assistant
       wash, and this is the nearest opaque step to it. */
    background: var(--surface-shell);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--accent-ink);
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .msg-bubble.er-processing {
      animation: none;
      border-color: var(--accent-ink);
    }
  }

  /* MODEL / N TOK / LATENCY / £PRICE — the single most important detail of the
     redesign: every assistant turn is priced where it sits. */
  .cost-stamp {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .stamp-sep {
    opacity: 0.4;
  }
  .cost-stamp .accent {
    color: var(--accent);
  }

  /* The machinery row: petrol glyph and word (the "system is fine" colour),
     ghost metadata after it, `/` between chunks like every other ledger line. */
  .thinking-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .thinking-toggle .tt-glyph,
  .thinking-toggle .tt-word {
    color: var(--accent-ink);
  }
  .thinking-toggle .tt-sep {
    opacity: 0.4;
  }
  .thinking-toggle:hover {
    color: var(--text-muted);
  }
  .thinking-toggle:hover .tt-glyph,
  .thinking-toggle:hover .tt-word {
    color: var(--accent);
  }
  .wf-generated {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }

  @media (max-width: 799px) {
    /* No .msg-bubble override here any more. It used to nudge mobile UP (13.5px
       against 13px) — against a 16px base it would have quietly nudged mobile
       back DOWN, which is the opposite of the point. */
    .msg-meta,
    .cost-stamp {
      font-size: var(--fs-label-xs);
    }
  }
  .chat-markdown :global(p) {
    margin: 0 0 0.5em;
  }
  .chat-markdown :global(p:last-child) {
    margin-bottom: 0;
  }
  .chat-markdown :global(strong) {
    font-weight: 600;
  }
  .chat-markdown :global(em) {
    font-style: italic;
  }
  .chat-markdown :global(code) {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-sharp);
  }
  .chat-markdown :global(pre) {
    margin: 0.5em 0;
    padding: 0.6em 0.8em;
    border-radius: var(--radius-sharp);
    background: var(--surface-sunken);
    overflow-x: auto;
    font-size: max(0.8em, var(--fs-label-xs));
  }
  .chat-markdown :global(pre code) {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .chat-markdown :global(ul),
  .chat-markdown :global(ol) {
    margin: 0.3em 0;
    padding-left: 1.4em;
  }
  .chat-markdown :global(li) {
    margin: 0.15em 0;
  }
  .chat-markdown :global(h1),
  .chat-markdown :global(h2),
  .chat-markdown :global(h3) {
    font-weight: 600;
    margin: 0.5em 0 0.25em;
  }
  .chat-markdown :global(h1) { font-size: 1.1em; }
  .chat-markdown :global(h2) { font-size: 1.05em; }
  .chat-markdown :global(h3) { font-size: 1em; }
  .chat-markdown :global(blockquote) {
    border-left: 3px solid var(--line-strong);
    padding-left: 0.8em;
    margin: 0.4em 0;
    color: var(--text-secondary);
  }
  .chat-markdown :global(a) {
    color: var(--accent);
    text-decoration: underline;
  }
  /* Inline source citation — a mention of an @files / @research source that the
     reply named, turned into a click target that opens its viewer. Kept quiet
     (dotted underline + citation glyph) so it reads as a reference, not a link. */
  .chat-markdown :global(a.cite-link) {
    color: var(--accent);
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;
    font-style: normal;
  }
  .chat-markdown :global(a.cite-link)::after {
    content: '\2197'; /* ↗ */
    font-size: max(0.75em, var(--fs-label-xs)); /* 12px against the 16px bubble — the floor */
    vertical-align: super;
    margin-left: 1px;
    opacity: 0.6;
  }
  /* Inline intel entity — a name the knowledge graph knows about. Quieter still
     than a citation: a faint underline that only lights up on hover, because a
     reply may name a dozen entities and a dozen loud links would be unreadable.
     Uses accent-ink (teal) so it is visibly a different KIND of reference from
     an orange source citation. */
  .chat-markdown :global(a.entity-mention) {
    color: inherit;
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--accent-ink-tint-35);
    text-underline-offset: 3px;
    cursor: help;
    transition: color var(--t-fast) var(--ease-out),
      background var(--t-fast) var(--ease-out);
    border-radius: var(--radius-sharp);
  }
  .chat-markdown :global(a.entity-mention:hover),
  .chat-markdown :global(a.entity-mention:focus-visible) {
    color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
    text-decoration-color: var(--accent-ink);
    outline: none;
  }
  .chat-markdown :global(a.cite-link:hover) {
    text-decoration-style: solid;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .chat-markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.5em 0;
  }
  /* Tables — GFM tables wrapped in .md-table-wrap for horizontal scroll.
     Warm-brutalist: hard 1px borders, mono uppercase header, subtle zebra. */
  .chat-markdown :global(.md-table-wrap) {
    overflow-x: auto;
    max-width: 100%;
    margin: 0.7em 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .chat-markdown :global(.md-table-wrap table) {
    border-collapse: collapse;
    width: auto;
    min-width: 100%;
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
  }
  .chat-markdown :global(.md-table-wrap th),
  .chat-markdown :global(.md-table-wrap td) {
    padding: 6px 11px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
    border-right: 1px solid var(--line);
  }
  .chat-markdown :global(.md-table-wrap th:last-child),
  .chat-markdown :global(.md-table-wrap td:last-child) { border-right: none; }
  .chat-markdown :global(.md-table-wrap tbody tr:last-child td) { border-bottom: none; }
  .chat-markdown :global(.md-table-wrap thead th) {
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .chat-markdown :global(.md-table-wrap tbody tr:nth-child(even)) {
    background: color-mix(in srgb, var(--card-border) 7%, transparent);
  }
  .chat-markdown :global(.md-table-wrap td) { color: var(--text-primary); }

  /* A rewritten Hermes tool-log entry. Mono + ghost + a quiet accent tick, so a
     step the model took reads as machinery sitting beside the answer rather than
     as a sentence of the answer itself. Same left-tick geometry as the in-progress
     status-update line in ChatArea, which is the other "this is the machine
     talking" surface in the thread. */
  .chat-markdown :global(.tool-log-step) {
    margin: 0.5em 0;
    padding: 2px 0 2px 8px;
    border-left: 2px solid var(--accent-tint-20);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-ghost);
  }
  .chat-markdown :global(.tool-log-step + .tool-log-step) {
    margin-top: -0.25em;
  }

  /* Heartbeat-source message styling */
  .hb-msg {
    padding: 11px 13px;
    border-color: color-mix(in srgb, var(--error) 18%, transparent) !important;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--error) 4%, transparent),
      var(--surface-sunken)
    ) !important;
  }
  .hb-msg-trigger {
    opacity: 0.7;
    font-style: italic;
    font-size: max(0.85em, var(--fs-label-xs));
  }
  .hb-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin-bottom: 0.4em;
    padding-bottom: 0.3em;
    border-bottom: 1px dotted var(--line-strong);
  }
  .hb-pulse {
    color: var(--error);
    animation: hb-pulse-anim 2s ease-in-out infinite;
  }
  @keyframes hb-pulse-anim {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .hb-label { color: var(--text-secondary); }
</style>
