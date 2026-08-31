<script lang="ts">
  import { onMount } from 'svelte';
  import { Marked } from 'marked';
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import SlashCommandButtonBar from './SlashCommandButtonBar.svelte';
  import FileReferenceChips from './FileReferenceChips.svelte';
  import ResearchReferenceChips from './ResearchReferenceChips.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import { stripLegacyToolLog } from '$lib/workflows/chat/legacy-tool-log';
  import { linkifyCitations, fileAnchors, researchAnchors, type CiteTarget } from '$lib/jkai/citation-linkify';
  import { linkifyEntities } from '$lib/jkai/intel/entity-linkify';
  import { codeRenderer, enhanceCodeBlocks, runLaneFor } from '$lib/jkai/code-blocks';
  import { openRunnerWindow } from '$lib/jkai/run-window';
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
    /** Off for the public share view: /jkai/run is owner-gated, so a Run button
     *  there would only ever open a sign-in page. Copy still works. */
    canRun = true,
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
    canRun?: boolean;
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

  // `codeRenderer` swaps the bare <pre><code> for highlight.js markup. It has to
  // be highlight.js and not shiki: sanitizeChatHtml allows `class` but no
  // `style`, and shiki colours via inline style — see $lib/jkai/code-blocks.
  const marked = new Marked({ gfm: true, breaks: true, renderer: codeRenderer });

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

  // The old gateway wrote its tool-call log into the text stream (`⚙️
  // mcp_jkai_recall_memories: "…"`), which is machinery, not answer. Strip it
  // BEFORE the markdown parse so both the live stream and stored history read
  // the same — see $lib/workflows/chat/legacy-tool-log. The steps are not lost:
  // they are the tool-call trace behind the *analyse* button, which is where
  // anyone who wants the play-by-play goes to read it.
  const answerText = $derived(role === 'assistant' ? stripLegacyToolLog(content) : content);
  let renderedContent = $derived(
    role === 'assistant'
      ? wrapTables(
          injectConvParam(
            sanitizeChatHtml(marked.parse(answerText) as string),
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
  // Code-block chrome goes on LAST, after both linkifiers. Run it earlier and
  // the toolbar's own words ("copy", the language label) become text runs that
  // citation matching would happily turn into a source link.
  let displayHtml = $derived(
    enhanceCodeBlocks(
      role === 'assistant' && entityMentions.length
        ? linkifyEntities(linkified.html, entityMentions).html
        : linkified.html,
      { allowRun: canRun },
    ),
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
  // --- Code-block toolbar -------------------------------------------------
  // The cards are injected into the sanitised HTML by `enhanceCodeBlocks`, so
  // their buttons are handled by delegation on this container — the same shape
  // the citation links use. The source is read back off the <code> element's
  // textContent: highlight.js only wraps spans around escaped text, so that
  // un-escapes to exactly what the model wrote.
  let runNotice = $state<string | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  function codeBtnFromEvent(target: EventTarget | null): HTMLElement | null {
    const el = target as HTMLElement | null;
    return el?.closest?.('.cc-copy, .cc-run, .cc-build') ?? null;
  }

  function sourceOf(btn: HTMLElement): { code: string; lang: string } | null {
    const card = btn.closest('.code-card');
    const codeEl = card?.querySelector('pre code');
    if (!card || !codeEl) return null;
    return { code: codeEl.textContent ?? '', lang: card.getAttribute('data-lang') ?? '' };
  }

  async function copyCode(btn: HTMLElement): Promise<void> {
    const src = sourceOf(btn);
    if (!src) return;
    try {
      await navigator.clipboard.writeText(src.code);
      // Ephemeral feedback written straight into the injected markup. A re-render
      // would wipe it, which is fine — it only has to survive 1.4 seconds.
      btn.textContent = 'copied';
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => { btn.textContent = 'copy'; }, 1400);
    } catch {
      runNotice = 'Could not reach the clipboard — select the block and copy by hand.';
    }
  }

  function runCode(btn: HTMLElement): void {
    const src = sourceOf(btn);
    if (!src) return;
    const lane = runLaneFor(src.lang);
    if (!lane) return;
    runNotice = null;
    // Called straight out of the click, with no await in front of it, or the
    // popup blocker stops treating the window as user-initiated.
    const res = openRunnerWindow(src.code, src.lang, lane);
    if (!res.ok) {
      runNotice =
        res.reason === 'blocked'
          ? 'Your browser blocked the runner window — allow pop-ups for this site and press run again.'
          : res.reason === 'too-big'
            ? 'That block is too large to hand to the runner.'
            : 'Could not stage the snippet — browser storage is unavailable.';
    }
  }

  onMount(() => () => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  /** Set when "build app" is clicked; cleared on confirm or cancel. A build
   *  costs real money, so the toolbar click only ever arms this bar. */
  let pendingBuild = $state<{ lang: string } | null>(null);

  function armBuild(btn: HTMLElement): void {
    const src = sourceOf(btn);
    if (!src) return;
    runNotice = null;
    pendingBuild = { lang: src.lang || 'code' };
  }

  function confirmBuild(): void {
    const p = pendingBuild;
    pendingBuild = null;
    if (!p || !onSilentSend) return;
    // The agent already has the snippet and the request that produced it in
    // context, so the brief is a pointer rather than a paraphrase — restating
    // the code here would just give it a second, worse copy to work from.
    void onSilentSend(
      `Take the ${p.lang} snippet you just wrote and build it as a real app with the autonomous builder — call build_create with a brief describing it.`,
    );
  }

  function handleCodeBtn(btn: HTMLElement): void {
    if (btn.classList.contains('cc-copy')) void copyCode(btn);
    else if (btn.classList.contains('cc-run')) runCode(btn);
    else if (btn.classList.contains('cc-build')) armBuild(btn);
  }

  function onCiteClick(e: MouseEvent) {
    const btn = codeBtnFromEvent(e.target);
    if (btn) {
      e.preventDefault();
      handleCodeBtn(btn);
      return;
    }
    const a = citeFromEvent(e.target);
    if (a) {
      e.preventDefault();
      openCite(a);
      return;
    }
    mentionEvents.handleClick(e);
  }
  function onCiteKey(e: KeyboardEvent) {
    const btn = codeBtnFromEvent(e.target);
    if (btn && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleCodeBtn(btn);
      return;
    }
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
    // How many times the model was called for this one reply. Absent on
    // older rows, which had no notion of it. Worth the space: the first
    // measured turn on the loop took NINE rounds, and rounds — not tool speed —
    // are what a reply costs.
    if (typeof stamp.rounds === 'number' && stamp.rounds > 1) {
      chunks.push({ text: `${stamp.rounds}×` });
    }
    // A Codex turn spends subscription quota, not cash, so `priceFor` returns
    // null and the cost is a true zero. Rendering "£0.00" would read as "this
    // was free" rather than "this is not billed in cash" — so say nothing, and
    // keep the £ for turns that actually have one.
    const billed = stamp.costUsd > 0 || stamp.provider !== 'codex';
    if (billed) chunks.push({ text: formatGbp(stamp.costUsd), accent: true });
    return chunks;
  });

  const roleLabel = $derived(isUser ? 'you / prompt' : role === 'system' ? 'system' : 'jkai / reply');

  // An attachment-only turn (the model returned a file and no prose) would
  // otherwise draw an empty bubble above the attachment block. Skip the bubble
  // and let the attachment be the message.
  // Checked against the STRIPPED text: a turn that died inside a tool call has
  // nothing but log lines in `content`, and that must draw no bubble at all
  // rather than an empty one.
  const hasBody = $derived(
    answerText.trim().length > 0 || !!heartbeat || hasThinking || !!metadata?.workflowGenerated,
  );
  let heartbeatLabel = $derived.by(() => {
    if (!heartbeat) return '';
    if (heartbeat.kind === 'note') return 'heartbeat note';
    if (heartbeat.kind === 'reply') return `heartbeat reply (${heartbeat.activity})`;
    if (heartbeat.kind === 'user-trigger') return `heartbeat trigger (${heartbeat.activity})`;
    return 'heartbeat';
  });
</script>

<!-- The question and answer use different registers: prompts are compact objects
     aligned to the right; replies are editorial copy on the left. -->
<div class="msg-row" class:user={isUser} class:assistant={!isUser} class:bodyless={!hasBody}>
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
      {#if runNotice}
        <p class="run-notice">{runNotice}</p>
      {/if}
      {#if pendingBuild && onSilentSend}
        <div class="build-confirm">
          <span class="bc-q">Build this {pendingBuild.lang} snippet as a real app? That starts an autonomous build.</span>
          <span class="bc-spacer"></span>
          <button type="button" class="bc-btn bc-cancel" onclick={() => { pendingBuild = null; }}>Cancel</button>
          <button type="button" class="bc-btn bc-go" onclick={confirmBuild}>Build it</button>
        </div>
      {/if}
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
  /* Prompts are compact objects; replies are the page's reading surface. */
  .msg-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 7px;
    width: 100%;
    padding: 0;
  }
  .msg-row.user { align-items:flex-end; }
  .msg-row.bodyless .msg-body { display:none; }
  .msg-body {
    min-width: 0;
    width:100%;
  }
  .msg-row.assistant .msg-body {
    max-width:76ch;
    padding-left:18px;
    border-left:3px solid var(--accent);
  }
  .msg-row.user .msg-body {
    width:auto;
    max-width:min(82%, 46rem);
  }

  .msg-meta {
    display: flex;
    align-items: baseline;
    gap: 9px;
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
  .msg-row.assistant .meta-role {
    color: var(--accent);
  }
  .meta-time {
    opacity: 0;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.2s ease-out;
  }
  .msg-row:hover .meta-time,
  .msg-row:focus-within .meta-time {
    opacity: 1;
  }

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
  .msg-row.user .msg-bubble {
    width: fit-content;
    max-width: 100%;
    padding: 12px 15px;
    border-color: var(--text-primary);
    background: var(--surface-card);
    line-height:1.5;
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
    .msg-row { gap:6px; }
    .msg-row.assistant .msg-body { padding-left:12px; border-left-width:2px; }
    .msg-row.user .msg-body { max-width:92%; }
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
    font-family: var(--font-code);
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

  /* Code cards — the chrome `enhanceCodeBlocks` wraps around each fenced block.
     :global because the markup arrives through {@html}, not the template. The
     card owns the frame, so the <pre> inside gives up its own margin and radius. */
  .chat-markdown :global(.code-card) {
    margin: 0.6em 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .chat-markdown :global(.code-card pre) {
    margin: 0;
    border-radius: 0;
  }
  .chat-markdown :global(.cc-bar) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-section);
    border-bottom: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .chat-markdown :global(.cc-lang) {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .chat-markdown :global(.cc-spacer) { flex: 1; }
  .chat-markdown :global(.cc-btn) {
    padding: 2px 8px;
    border-radius: var(--radius-sharp);
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    user-select: none;
  }
  .chat-markdown :global(.cc-btn:hover) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chat-markdown :global(.cc-run) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chat-markdown :global(.cc-run:hover) {
    background: var(--accent);
    color: var(--bg);
  }
  /* Petrol, not orange: it sits next to run and must not read as the same kind
     of action — one previews, the other commissions a build. */
  .chat-markdown :global(.cc-build) {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .chat-markdown :global(.cc-build:hover) {
    background: var(--accent-ink);
    color: var(--bg);
  }
  /* A language with no runtime still shows the button, greyed — the absence is
     the answer to "why can't I run this", and the title says which runtime. */
  .chat-markdown :global(.cc-run-off) {
    opacity: 0.35;
    cursor: default;
    border-color: var(--line);
  }
  .chat-markdown :global(.cc-run-off:hover) {
    border-color: var(--line);
    color: var(--text-secondary);
  }

  .run-notice {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--warn);
  }

  .build-confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 6px 0 0;
    padding: 8px 12px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--card-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .bc-q { color: var(--text-secondary); }
  .bc-spacer { flex: 1; }
  .bc-btn {
    padding: 4px 12px;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  .bc-btn:hover { opacity: 0.85; }
  /* Cancelling costs nothing, so it is the quiet default and comes first. */
  .bc-cancel {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--line-strong);
  }
  .bc-go {
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    font-weight: 600;
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
