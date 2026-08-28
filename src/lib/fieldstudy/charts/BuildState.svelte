<script lang="ts">
  /**
   * Built / next build / designed — a status matrix, not a chart.
   *
   * The subject of this figure is the distinction its author drew himself, so
   * the figure's only job is to keep that distinction legible: three states,
   * each with a glyph AND a word AND a colour. Never colour alone — the
   * status trio is the reserved palette, and green-vs-amber is exactly the
   * adjacent pair colour-blind readers lose. Ordered live-first so the shape
   * of the answer ("the foundation, not the machine") is visible before any
   * row is read.
   */
  type State = 'live' | 'next' | 'designed';
  type Row = { name: string; state: State; note?: string };

  let { data }: { data?: unknown } = $props();

  const rows = $derived((data as { rows?: Row[] } | undefined)?.rows ?? []);

  const ORDER: Record<State, number> = { live: 0, next: 1, designed: 2 };
  const sorted = $derived([...rows].sort((a, b) => ORDER[a.state] - ORDER[b.state]));

  const LABEL: Record<State, string> = {
    live: 'In production',
    next: 'Next build',
    designed: 'Designed, not built',
  };
  const GLYPH: Record<State, string> = { live: '●', next: '◐', designed: '○' };
  const tally = $derived(
    (['live', 'next', 'designed'] as State[]).map((s) => ({
      state: s,
      n: rows.filter((r) => r.state === s).length,
    })),
  );
</script>

<div class="bs">
  <div class="bs-legend">
    {#each tally as t (t.state)}
      <span class="bs-key" data-state={t.state}>
        <span class="bs-glyph" aria-hidden="true">{GLYPH[t.state]}</span>
        {LABEL[t.state]}
        <b>{t.n}</b>
      </span>
    {/each}
  </div>

  <ul class="bs-rows">
    {#each sorted as r (r.name)}
      <li class="bs-row" data-state={r.state}>
        <span class="bs-glyph" aria-hidden="true">{GLYPH[r.state]}</span>
        <span class="bs-name">{r.name}</span>
        <span class="bs-state">{LABEL[r.state]}</span>
        {#if r.note}<span class="bs-note">{r.note}</span>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .bs { width: 100%; padding: 14px 16px 16px; }
  .bs-legend {
    display: flex; flex-wrap: wrap; gap: 6px 16px;
    padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--line);
  }
  .bs-key {
    display: inline-flex; align-items: baseline; gap: 6px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary);
  }
  .bs-key b { font-variant-numeric: tabular-nums; color: var(--text-primary); }

  .bs-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .bs-row {
    display: grid;
    grid-template-columns: 14px minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.6fr);
    align-items: baseline; gap: 10px;
    padding: 7px 0; border-bottom: 1px solid var(--line-hair);
  }
  .bs-glyph { font-size: var(--fs-label-xs); line-height: 1.4; }
  .bs-name { font-size: var(--fs-label); font-weight: 500; color: var(--text-primary); }
  .bs-state {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary);
  }
  .bs-note { font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); }

  /* The reserved status trio. Amber and green are the pair a deutan reader
     loses, which is why every mark also carries its glyph and its word. */
  [data-state='live'] .bs-glyph, .bs-key[data-state='live'] .bs-glyph { color: var(--success); }
  [data-state='next'] .bs-glyph, .bs-key[data-state='next'] .bs-glyph { color: var(--warn); }
  [data-state='designed'] .bs-glyph, .bs-key[data-state='designed'] .bs-glyph { color: var(--text-ghost); }

  @media (max-width: 720px) {
    .bs-row { grid-template-columns: 14px minmax(0, 1fr); row-gap: 2px; }
    .bs-state, .bs-note { grid-column: 2; }
  }
</style>
