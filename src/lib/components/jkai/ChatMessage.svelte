<script lang="ts">
  import { Marked } from 'marked';
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import SlashCommandButtonBar from './SlashCommandButtonBar.svelte';
  import QueuedMessageBadge from './QueuedMessageBadge.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import type { ApprovalUiSettings } from '$lib/server/models/settings';

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

  let renderedContent = $derived(
    role === 'assistant'
      ? injectConvParam(sanitizeChatHtml(marked.parse(content) as string), conversationId)
      : ''
  );

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
    class="text-sm {bubbled ? 'max-w-[85%] rounded-lg px-3 py-2' : 'msg-plain w-full'}"
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
      <div class="chat-markdown">{@html renderedContent}</div>
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
    background: rgba(0, 0, 0, 0.1);
    padding: 0.1em 0.35em;
    border-radius: 3px;
  }
  .chat-markdown :global(pre) {
    margin: 0.5em 0;
    padding: 0.6em 0.8em;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.15);
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
  .chat-markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--card-border);
    margin: 0.5em 0;
  }

  /* Heartbeat-source message styling */
  .hb-msg {
    border-color: rgba(196, 60, 60, 0.18) !important;
    background: linear-gradient(180deg, rgba(196, 60, 60, 0.04), var(--card-bg)) !important;
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
    color: #c44;
    animation: hb-pulse-anim 2s ease-in-out infinite;
  }
  @keyframes hb-pulse-anim {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .hb-label { color: var(--text-secondary); }
</style>
