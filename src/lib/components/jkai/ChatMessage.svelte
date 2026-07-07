<script lang="ts">
  import { Marked } from 'marked';
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import SlashCommandButtonBar from './SlashCommandButtonBar.svelte';
  import QueuedMessageBadge from './QueuedMessageBadge.svelte';
  import FileReferenceChips from './FileReferenceChips.svelte';
  import ResearchReferenceChips from './ResearchReferenceChips.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import { linkifyCitations, fileAnchors, researchAnchors, type CiteTarget } from '$lib/jkai/citation-linkify';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import type { ApprovalUiSettings } from '$lib/server/models/settings';

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
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: {
      workflowGenerated?: boolean;
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
    /** ISO timestamp the bubble was created. Drives the "10:42:13" wall-clock
     *  mark that fades in under each bubble on hover. */
    createdAt?: string;
    /** True when the bubble represents a message that was queued offline by
     *  the outbox (`$lib/jkai/pwa/outbox`) rather than POSTed live. Drives
     *  the inline "queued" badge so John can see at a glance that the
     *  message hasn't actually been sent to the server yet. */
    queued?: boolean;
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

  let renderedContent = $derived(
    role === 'assistant'
      ? wrapTables(injectConvParam(sanitizeChatHtml(marked.parse(content) as string), conversationId))
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
    if (!a) return;
    e.preventDefault();
    openCite(a);
  }
  function onCiteKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = citeFromEvent(e.target);
    if (!a) return;
    e.preventDefault();
    openCite(a);
  }

  let isUser = $derived(role === 'user');
  let thinkingOpen = $state(true);
  let hasThinking = $derived(thinking && thinking.steps && thinking.steps.length > 0);
  let heartbeat = $derived(metadata?.heartbeat ?? null);
  // User messages and heartbeat-sourced messages keep their distinct card
  // treatment; ordinary assistant replies render bubbleless as open prose so
  // long markdown can breathe at full reading width.
  let bubbled = $derived(isUser || !!heartbeat);
  let isHeartbeatTrigger = $derived(heartbeat?.kind === 'user-trigger');
  let heartbeatLabel = $derived.by(() => {
    if (!heartbeat) return '';
    if (heartbeat.kind === 'note') return 'heartbeat note';
    if (heartbeat.kind === 'reply') return `heartbeat reply (${heartbeat.activity})`;
    if (heartbeat.kind === 'user-trigger') return `heartbeat trigger (${heartbeat.activity})`;
    return 'heartbeat';
  });
</script>

<div class="msg-row flex flex-col {isUser ? 'items-end' : bubbled ? 'items-start' : 'items-stretch'} mb-3">
  <div
    class="text-sm {bubbled ? 'max-w-[85%] px-3 py-2' : 'msg-plain w-full'}"
    class:msg-bubble={bubbled}
    class:hb-msg={!!heartbeat}
    class:hb-msg-trigger={isHeartbeatTrigger}
    style={bubbled
      ? `background: ${isUser ? 'var(--accent)' : 'var(--card-bg)'}; color: ${isUser ? 'white' : 'var(--text-primary)'}; border: ${isUser ? 'none' : '1px solid var(--card-border)'};`
      : 'color: var(--text-primary);'}
  >
    {#if heartbeat}
      <div class="hb-badge">
        <span class="hb-pulse" aria-hidden="true">●</span>
        <span class="hb-label">{heartbeatLabel}</span>
      </div>
    {/if}
    {#if isUser}
      <p class="whitespace-pre-wrap">{content}</p>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="chat-markdown" onclick={onCiteClick} onkeydown={onCiteKey}>{@html linkified.html}</div>
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

    {#if hasThinking}
      <button
        onclick={() => { thinkingOpen = !thinkingOpen; }}
        class="mt-2 text-[10px] uppercase tracking-wider flex items-center gap-1"
        style="color: var(--text-ghost);"
      >
        <span>{thinkingOpen ? '\u25BC' : '\u25B6'}</span>
        <span>Thinking ({thinking!.steps.length} steps)</span>
      </button>

      {#if thinkingOpen}
        <ThinkingTimeline thinking={thinking!} />
      {/if}
    {/if}

    {#if metadata?.workflowGenerated}
      <div
        class="mt-2 pt-2 border-t text-[11px] flex items-center gap-1"
        style="border-color: var(--card-border); color: var(--text-ghost);"
      >
        <span>Workflow generated</span>
      </div>
    {/if}
  </div>
  {#if clockTime || queued}
    <div class="msg-timestamp">
      {#if clockTime}<span class="ts-clock">{clockTime}</span>{/if}
      {#if queued}
        <QueuedMessageBadge />
      {/if}
    </div>
  {/if}
</div>

<style>
  .msg-bubble {
    border-radius: var(--radius-round);
  }
  .msg-timestamp {
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    display: flex;
    gap: 8px;
    align-items: center;
    line-height: 1;
  }
  /* Wall-clock mark is quiet by default and fades in when the row is hovered,
     so it stays available for reference without cluttering the thread. */
  .ts-clock {
    letter-spacing: 0.04em;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .msg-row:hover .ts-clock,
  .msg-row:focus-within .ts-clock {
    opacity: 0.55;
  }
  /* Bubbleless assistant prose: no fill/border, just open text at full
     reading width with a hair of horizontal padding to align its optical
     left edge with the user bubble above it. */
  .msg-plain {
    padding: 2px 2px 0;
    line-height: 1.5;
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
    font-size: 0.85em;
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-sharp);
  }
  .chat-markdown :global(pre) {
    margin: 0.5em 0;
    padding: 0.6em 0.8em;
    border-radius: var(--radius-round);
    background: var(--bg-section);
    overflow-x: auto;
    font-size: 0.8em;
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
    border-left: 3px solid var(--card-border);
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
    font-size: 0.7em;
    vertical-align: super;
    margin-left: 1px;
    opacity: 0.6;
  }
  .chat-markdown :global(a.cite-link:hover) {
    text-decoration-style: solid;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .chat-markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--card-border);
    margin: 0.5em 0;
  }
  /* Tables — GFM tables wrapped in .md-table-wrap for horizontal scroll.
     Warm-brutalist: hard 1px borders, mono uppercase header, subtle zebra. */
  .chat-markdown :global(.md-table-wrap) {
    overflow-x: auto;
    max-width: 100%;
    margin: 0.7em 0;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
  }
  .chat-markdown :global(.md-table-wrap table) {
    border-collapse: collapse;
    width: auto;
    min-width: 100%;
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .chat-markdown :global(.md-table-wrap th),
  .chat-markdown :global(.md-table-wrap td) {
    padding: 6px 11px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--card-border);
    border-right: 1px solid var(--card-border);
  }
  .chat-markdown :global(.md-table-wrap th:last-child),
  .chat-markdown :global(.md-table-wrap td:last-child) { border-right: none; }
  .chat-markdown :global(.md-table-wrap tbody tr:last-child td) { border-bottom: none; }
  .chat-markdown :global(.md-table-wrap thead th) {
    background: var(--bg-section);
    font-family: var(--font-mono);
    font-size: 10.5px;
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

  /* Heartbeat-source message styling */
  .hb-msg {
    border-color: color-mix(in srgb, var(--error) 18%, transparent) !important;
    background: linear-gradient(180deg, color-mix(in srgb, var(--error) 4%, transparent), var(--card-bg)) !important;
  }
  .hb-msg-trigger {
    opacity: 0.7;
    font-style: italic;
    font-size: 0.85em;
  }
  .hb-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin-bottom: 0.4em;
    padding-bottom: 0.3em;
    border-bottom: 1px dotted var(--card-border);
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
