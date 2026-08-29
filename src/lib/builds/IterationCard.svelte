<script lang="ts">
  import LaneThinking from './LaneThinking.svelte';
  import LaneTools from './LaneTools.svelte';
  import LaneOutput from './LaneOutput.svelte';
  import type { IterationCardData } from './feed';

  let {
    iter,
    isActive = false,
  }: {
    iter: IterationCardData;
    /** true for the most recent / currently-running iteration. Active iterations
     *  expand by default; older ones collapse to a 1-line summary the user can
     *  click to re-open. */
    isActive?: boolean;
  } = $props();

  const label = $derived(iter.id === '__unscoped__' ? 'System' : `Iteration ${iter.id.slice(0, 8)}`);

  // Default state: only the active iteration is expanded. Past iterations
  // collapse to a single summary line so the user isn't scrolling through
  // a history of every tool call.
  let expanded = $state(isActive);
  let thinkingOpen = $state(false);

  // 1-line collapsed summary — try, in order: a tool count + last system log,
  // last text line in the output lane, or a fallback. Plan/achieved would
  // be more useful but we'd need to thread iteration metadata through feed;
  // this is good enough for now.
  const summary = $derived.by(() => {
    const lastSys = iter.systemLogs[iter.systemLogs.length - 1];
    const out = iter.lanes.output.trim();
    const lastOutLine = out ? out.split('\n').filter((s) => s.trim()).pop() : '';
    const toolCount = iter.lanes.tools.length;
    const parts: string[] = [];
    if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`);
    if (lastOutLine) parts.push(lastOutLine.slice(0, 140));
    else if (lastSys) parts.push(lastSys.split('\n')[0].slice(0, 140));
    return parts.join(' · ') || 'No activity recorded';
  });

  function toggle(): void {
    expanded = !expanded;
  }

  function openThinking(e: Event): void {
    e.stopPropagation();
    thinkingOpen = true;
  }
  function closeThinking(): void {
    thinkingOpen = false;
  }
</script>

<section class="nm-sec iter" class:collapsed={!expanded}>
  <header class="nm-sec-hd iter-hdr" onclick={toggle} role="button" tabindex="0" onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle()}>
    <span class="caret">{expanded ? '▾' : '▸'}</span>
    <span class="sr-label-tight">{label}</span>
    {#if !expanded}
      <span class="iter-summary">{summary}</span>
    {/if}
    {#if iter.lanes.thinking}
      <button class="iter-think-btn" type="button" onclick={openThinking} title="View thinking in terminal">[think]</button>
    {/if}
  </header>

  {#if expanded}
    {#if iter.lanes.thinking}
      <LaneThinking content={iter.lanes.thinking} />
    {/if}

    {#if iter.lanes.tools.length > 0}
      <LaneTools tools={iter.lanes.tools} />
    {/if}

    {#if iter.lanes.output}
      <LaneOutput content={iter.lanes.output} />
    {/if}

    {#each iter.systemLogs as log, i (i)}
      <pre class="syslog">{log}</pre>
    {/each}
  {/if}
</section>

{#if thinkingOpen}
  <!-- Terminal-style thinking modal: fixed-position overlay with monospace,
       black background, white text. Closed with × or Escape. -->
  <div
    class="think-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Iteration thinking"
    tabindex="-1"
    onclick={closeThinking}
    onkeydown={(e) => e.key === 'Escape' && closeThinking()}
  >
    <div class="think-frame" onclick={(e) => e.stopPropagation()} role="document">
      <header class="think-hdr">
        <span class="think-title">{label} · thinking</span>
        <button class="think-x" type="button" onclick={closeThinking} aria-label="Close">×</button>
      </header>
      <pre class="think-body">{iter.lanes.thinking}</pre>
    </div>
  </div>
{/if}

<style>
  .iter { font-family: var(--font-body); }
  .iter-hdr {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    cursor: pointer;
    user-select: none;
  }
  .iter-hdr:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
  .caret {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    width: 12px;
    color: var(--text-muted);
  }
  .iter-summary {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .iter-think-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: transparent;
    border: 1px solid var(--card-border);
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    color: var(--text-muted);
    margin-left: auto;
  }
  .iter-think-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }
  .syslog {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    color: var(--text-muted);
    margin: 0.4rem 0 0;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .think-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 2rem;
  }
  .think-frame {
    width: 100%;
    max-width: 980px;
    max-height: 85vh;
    background: #000;
    color: #d8d8d8;
    border: 2px solid var(--success);
    display: flex;
    flex-direction: column;
    font-family: 'Menlo', 'Monaco', 'Consolas', 'Courier New', var(--font-mono), monospace;
  }
  .think-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--success);
    background: #0b0b0b;
  }
  .think-title {
    color: var(--success);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: var(--fs-label);
  }
  .think-x {
    background: transparent;
    border: none;
    color: #d8d8d8;
    font-size: 1.6rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.35rem;
  }
  .think-x:hover { color: #fff; }
  .think-body {
    margin: 0;
    padding: 0.9rem 1rem;
    font-size: var(--fs-label);
    line-height: 1.55;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
