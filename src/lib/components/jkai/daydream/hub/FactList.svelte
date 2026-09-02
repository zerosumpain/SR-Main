<script lang="ts">
  // Label / value rows — the structured half of a drill-through.
  //
  // A fact with a source is a link; one without is text. The value column
  // takes the slack so a long merchant name wraps under itself rather than
  // pushing the label column about. Digits line up (`tabular-nums`).
  import type { FactRow } from './types';

  interface Props {
    rows: FactRow[];
    /** Two columns of pairs on a wide screen. */
    columns?: 1 | 2;
  }

  let { rows, columns = 1 }: Props = $props();
</script>

<dl class="fl" class:two={columns === 2}>
  {#each rows as r, i (r.label + i)}
    <div class="fl-row t-{r.tone ?? 'steady'}">
      <dt class="fl-k">{r.label}</dt>
      <dd class="fl-v" class:mono={r.mono}>
        {#if r.href}<a href={r.href}>{r.value}</a>{:else}{r.value}{/if}
      </dd>
    </div>
  {/each}
</dl>

<style>
  .fl {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    margin: 0;
    border-top: 1px solid var(--line-hair);
  }
  .fl.two {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    column-gap: 24px;
  }
  .fl-row {
    --tone: var(--text-primary);
    display: grid;
    grid-template-columns: minmax(96px, 30%) 1fr;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-hair);
    min-width: 0;
  }
  .fl-row.t-urgent {
    --tone: var(--error);
  }
  .fl-row.t-action {
    --tone: var(--accent);
  }
  .fl-row.t-watch {
    --tone: var(--warn);
  }
  .fl-row.t-good {
    --tone: var(--good);
  }
  .fl-row.t-quiet {
    --tone: var(--text-ghost);
  }
  .fl-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    padding-top: 2px;
  }
  .fl-v {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--tone);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .fl-v.mono {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .fl-v a {
    color: var(--accent);
    text-decoration: none;
  }
  .fl-v a:hover {
    text-decoration: underline;
  }
</style>
