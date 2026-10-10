<script lang="ts">
  // A count drawn as tally marks: five-bar gates, then the odd strokes, in the
  // landing's pen (notes-ink's inkTally). Reads as `label` to a screen reader,
  // or not at all when the count is already said in words beside it.
  //
  //   <Tally count={readingTime} label="{readingTime} minute read" />
  import { GATE_PITCH, inkTally } from '$lib/landing/notes-ink';

  let {
    count,
    label = null,
    seed = 17,
    tone = 'ink',
    height = 16,
  }: {
    count: number;
    /** The count in words. Null when the words are already beside the marks. */
    label?: string | null;
    seed?: number;
    tone?: 'ink' | 'accent' | 'pencil';
    /** Stroke height in px; one rule is 32. */
    height?: number;
  } = $props();

  let n = $derived(Math.max(0, Math.floor(count)));
  // Wide enough for every gate, so nothing folds into "+n".
  let w = $derived(Math.max(1, Math.ceil(n / 5)) * GATE_PITCH);
  let t = $derived(inkTally(n, w, height, seed));
</script>

{#if n > 0}
  <svg
    class="np-tally"
    data-tone={tone}
    viewBox="0 0 {w} {height}"
    width={w}
    {height}
    role={label ? 'img' : undefined}
    aria-label={label ?? undefined}
    aria-hidden={label ? undefined : 'true'}
    focusable="false"><path d={t.d} /></svg
  >
{/if}

<style>
  .np-tally {
    --tone: var(--text-primary);
    display: inline-block;
    vertical-align: baseline;
    overflow: visible;
  }
  .np-tally[data-tone='accent'] {
    --tone: var(--accent);
  }
  .np-tally[data-tone='pencil'] {
    --tone: var(--text-secondary);
  }
  path {
    fill: none;
    stroke: var(--tone);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  @media print {
    path {
      stroke: #1a1008;
    }
  }
</style>
