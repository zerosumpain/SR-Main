<script lang="ts">
  type Tone = 'normal' | 'error' | 'ghost';

  let {
    text,
    maxLines = 6,
    tone = 'normal' as Tone,
  }: { text: string; maxLines?: number; tone?: Tone } = $props();

  let expanded = $state(false);

  const lineCount = $derived(text ? text.split('\n').length : 0);
  const overflows = $derived(lineCount > maxLines);
  const clampStyle = $derived(
    expanded || !overflows
      ? ''
      : `max-height: calc(1.5em * ${maxLines}); overflow: hidden;`,
  );
</script>

<div class="co-wrap">
  <pre
    class="co-pre co-tone-{tone}"
    class:co-collapsed={overflows && !expanded}
    style={clampStyle}>{text}</pre>
  {#if overflows}
    <button
      type="button"
      class="co-toggle"
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? `Collapse ↑` : `Expand ↓ (${lineCount} lines)`}
    </button>
  {/if}
</div>

<style>
  .co-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .co-pre {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    position: relative;
  }
  .co-tone-ghost { color: var(--text-ghost); }
  .co-tone-error { color: #c44; }
  .co-collapsed {
    mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  }
  .co-toggle {
    align-self: flex-start;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .co-toggle:hover { color: var(--accent-hover); }
</style>
