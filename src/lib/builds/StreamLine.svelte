<script lang="ts">
  import { parseRepoVerification } from '$lib/verification/repo';

  /**
   * One line in the V3 single-pane stream. Renders with a colored type tag,
   * the content (truncated for long bodies behind a click-to-expand), and
   * a streaming cursor for in-flight items.
   */
  let {
    line,
    buildId,
  }: {
    line: {
      key: string;
      id: number | null;
      type: string;
      content: string;
      iterationId: string | null;
      streaming: boolean;
    };
    buildId: string;
  } = $props();
  // Map raw log/live-event types to a small set of display tags + colors.
  const tagInfo = $derived.by(() => {
    const t = line.type;
    if (t === 'thinking') return { tag: 'thinks', cls: 'thinks' };
    if (t === 'text') return { tag: 'agent', cls: 'agent' };
    if (t === 'code') return { tag: 'tool', cls: 'tool' };
    if (t === 'output') return { tag: 'bash', cls: 'bash' };
    if (t === 'error') return { tag: 'error', cls: 'error' };
    if (t === 'lint') return { tag: 'lint', cls: 'lint' };
    if (t === 'system') return { tag: 'sys', cls: 'sys' };
    if (t === 'tool') return { tag: 'tool', cls: 'tool' };
    if (t === 'verification') return { tag: 'verify', cls: 'verify' };
    return { tag: t, cls: 'sys' };
  });

  const COLLAPSED_LENGTH = 240;
  const verification = $derived(line.type === 'verification' ? parseRepoVerification(line.content) : null);
  const readableContent = $derived(
    verification
      ? `${verification.label}: ${verification.status.replace('_', ' ')}${verification.detail ? ` — ${verification.detail}` : ''}`
      : line.content,
  );
  const isLong = $derived(readableContent.length > COLLAPSED_LENGTH);
  let expanded = $state(false);
  // Auto-expand streaming items so the user sees content arriving live.
  const showFull = $derived(expanded || !isLong || line.streaming);
  const display = $derived(showFull ? readableContent : readableContent.slice(0, COLLAPSED_LENGTH));

  void buildId; // reserved for future per-line actions (e.g. "open file at path")
</script>

<div class="line" data-tag={tagInfo.cls} class:streaming={line.streaming}>
  <span class="tag" data-tag={tagInfo.cls}>[{tagInfo.tag}]</span>
  <span class="body" class:truncated={!showFull}>
    {display}{#if !showFull}…{/if}{#if line.streaming}<span class="cursor">▍</span>{/if}
  </span>
  {#if isLong && !line.streaming}
    <button class="expand" type="button" onclick={() => (expanded = !expanded)}>
      {expanded ? 'collapse' : 'expand'}
    </button>
  {/if}
</div>

<style>
  .line {
    display: grid;
    grid-template-columns: auto 1fr auto;
    column-gap: 0.5rem;
    padding: 0.18rem 0.4rem;
    border-left: 2px solid transparent;
    align-items: baseline;
  }
  .line:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
  .line.streaming { border-left-color: var(--accent); }
  .tag {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 1px 6px;
    border: 1px solid currentColor;
    flex-shrink: 0;
    align-self: start;
  }
  .tag[data-tag='thinks'] { color: var(--text-muted); }
  .tag[data-tag='agent'] { color: var(--text-primary); }
  .tag[data-tag='tool'] { color: var(--accent); }
  .tag[data-tag='bash'] { color: var(--accent); }
  .tag[data-tag='error'] { color: var(--status-error, #c0392b); }
  .tag[data-tag='lint'] { color: var(--status-error, #c0392b); }
  .tag[data-tag='sys'] { color: var(--text-ghost); }
  .tag[data-tag='verify'] { color: var(--accent); }
  .body {
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    color: var(--text-primary);
    min-width: 0;
  }
  .body.truncated { color: var(--text-muted); }
  .line[data-tag='thinks'] .body { color: var(--text-muted); font-style: italic; }
  .line[data-tag='error'] .body { color: var(--status-error, #c0392b); }
  .line[data-tag='lint'] .body { color: var(--status-error, #c0392b); }
  .line[data-tag='sys'] .body { color: var(--text-ghost); }
  .line[data-tag='verify'] .body { color: var(--text-primary); font-weight: 600; }
  .cursor {
    display: inline-block;
    color: var(--accent);
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .expand {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 1px 6px;
    cursor: pointer;
    flex-shrink: 0;
    align-self: start;
  }
  .expand:hover { color: var(--accent); border-color: var(--accent); }
</style>
