<script lang="ts">
  import { Marked } from 'marked';
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import SlashCommandButtonBar from './SlashCommandButtonBar.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import type { ApprovalUiSettings } from '$lib/server/models/settings';

  let {
    role,
    content,
    metadata,
    thinking,
    showThinking = false,
    conversationId = null,
    onSilentSend,
    approvalUi,
    isLatest = false,
    createdAt,
    prevCreatedAt,
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
    showThinking?: boolean;
    conversationId?: string | null;
    onSilentSend?: (command: string) => void | Promise<void>;
    approvalUi?: ApprovalUiSettings;
    isLatest?: boolean;
    /** ISO timestamp the bubble was created. Drives the "10:42:13" wall-clock
     *  mark rendered under each bubble. */
    createdAt?: string;
    /** ISO timestamp of the bubble immediately before this one in the
     *  thread. Used to render an "↳ Xs after" gap so John can eyeball
     *  response latency between consecutive bubbles without doing the
     *  subtraction in his head. */
    prevCreatedAt?: string;
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

  function formatGap(prev: string | undefined, curr: string | undefined): string {
    if (!prev || !curr) return '';
    const a = new Date(prev).getTime();
    const b = new Date(curr).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return '';
    const ms = b - a;
    if (ms < 1000) return `+${ms}ms`;
    if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) {
      const m = Math.floor(ms / 60_000);
      const s = Math.round((ms % 60_000) / 1000);
      return s > 0 ? `+${m}m ${s}s` : `+${m}m`;
    }
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `+${h}h ${m}m` : `+${h}h`;
  }

  let clockTime = $derived(formatClockTime(createdAt));
  let gap = $derived(formatGap(prevCreatedAt, createdAt));

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
  let hasThinking = $derived(showThinking && thinking && thinking.steps && thinking.steps.length > 0);
  let heartbeat = $derived(metadata?.heartbeat ?? null);
  let isHeartbeatTrigger = $derived(heartbeat?.kind === 'user-trigger');
  let heartbeatLabel = $derived.by(() => {
    if (!heartbeat) return '';
    if (heartbeat.kind === 'note') return 'heartbeat note';
    if (heartbeat.kind === 'reply') return `heartbeat reply (${heartbeat.activity})`;
    if (heartbeat.kind === 'user-trigger') return `heartbeat trigger (${heartbeat.activity})`;
    return 'heartbeat';
  });
</script>

<div class="flex flex-col {isUser ? 'items-end' : 'items-start'} mb-3">
  <div
    class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
    class:hb-msg={!!heartbeat}
    class:hb-msg-trigger={isHeartbeatTrigger}
    style="
      background: {isUser ? 'var(--accent)' : 'var(--card-bg)'};
      color: {isUser ? 'white' : 'var(--text-primary)'};
      border: {isUser ? 'none' : '1px solid var(--card-border)'};
    "
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
  {#if clockTime}
    <div class="msg-timestamp">
      <span class="ts-clock">{clockTime}</span>
      {#if gap}<span class="ts-gap" title="Time since the previous bubble">{gap}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .msg-timestamp {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    display: flex;
    gap: 8px;
    align-items: center;
    line-height: 1;
  }
  .ts-clock {
    letter-spacing: 0.04em;
  }
  .ts-gap {
    opacity: 0.7;
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
