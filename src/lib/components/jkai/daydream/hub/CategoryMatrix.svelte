<script lang="ts">
  // Rows × columns of counts, every non-empty cell a link.
  //
  // The feed's first screen. Six families down, four reader states across,
  // and a number in each cell that answers "how much of what, in what state"
  // before a single row is read. A cell is a link so the selection is a URL
  // — shareable, server-rendered, and the back button means what it says.
  // Zero cells are muted and inert: an empty selection is a fact, and
  // making it clickable makes a filter that returns nothing look broken.
  //
  // Totals along both edges are links too — a whole column ("everything
  // undecided") or a whole row ("everything about places").
  import type { MatrixAxis } from './types';

  interface Props {
    rows: MatrixAxis[];
    cols: MatrixAxis[];
    /** cells[row.id][col.id] */
    cells: Record<string, Record<string, number>>;
    /** The URL a cell selects. Return null for a plain figure. */
    href: (row: string | null, col: string | null) => string | null;
    active?: { row: string | null; col: string | null };
    /** Column heading over the row labels — "family", "kind". */
    corner?: string;
  }

  let { rows, cols, cells, href, active = { row: null, col: null }, corner = '' }: Props = $props();

  const n = (r: string, c: string) => cells[r]?.[c] ?? 0;
  const rowTotal = (r: string) => cols.reduce((a, c) => a + n(r, c.id), 0);
  const colTotal = (c: string) => rows.reduce((a, r) => a + n(r.id, c), 0);
  const isActive = (r: string | null, c: string | null) => active.row === r && active.col === c;
</script>

<div class="cm" style="--cm-cols: {cols.length}">
  <div class="cm-head cm-corner">{corner}</div>
  {#each cols as c (c.id)}
    {@const t = colTotal(c.id)}
    {@const h = t ? href(null, c.id) : null}
    {#if h}
      <a class="cm-head cm-col t-{c.tone ?? 'steady'}" class:active={isActive(null, c.id)} href={h}>
        <span class="cm-col-label">{c.label}</span>
        <span class="cm-col-n">{t}</span>
      </a>
    {:else}
      <div class="cm-head cm-col t-{c.tone ?? 'steady'}" class:zero={!t}>
        <span class="cm-col-label">{c.label}</span>
        <span class="cm-col-n">{t}</span>
      </div>
    {/if}
  {/each}

  {#each rows as r (r.id)}
    {@const rt = rowTotal(r.id)}
    {@const rh = rt ? href(r.id, null) : null}
    {#if rh}
      <a class="cm-row t-{r.tone ?? 'steady'}" class:active={isActive(r.id, null)} href={rh}>
        {#if r.mark}<span class="cm-mark">{r.mark}</span>{/if}
        <span class="cm-row-label">{r.label}</span>
        <span class="cm-row-n">{rt}</span>
      </a>
    {:else}
      <div class="cm-row t-{r.tone ?? 'steady'}" class:zero={!rt}>
        {#if r.mark}<span class="cm-mark">{r.mark}</span>{/if}
        <span class="cm-row-label">{r.label}</span>
        <span class="cm-row-n">{rt}</span>
      </div>
    {/if}
    {#each cols as c (c.id)}
      {@const v = n(r.id, c.id)}
      {@const h = v ? href(r.id, c.id) : null}
      {#if h}
        <a class="cm-cell t-{c.tone ?? 'steady'}" class:active={isActive(r.id, c.id)} href={h}>{v}</a>
      {:else}
        <div class="cm-cell zero">{v}</div>
      {/if}
    {/each}
  {/each}
</div>

<style>
  .cm {
    display: grid;
    grid-template-columns: minmax(140px, 1.6fr) repeat(var(--cm-cols), minmax(72px, 1fr));
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    overflow-x: auto;
  }

  .cm-head,
  .cm-row,
  .cm-cell {
    --tone: var(--accent-ink);
    min-width: 0;
    background: var(--surface-card);
    color: var(--text-primary);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .t-urgent {
    --tone: var(--error);
  }
  .t-action {
    --tone: var(--accent);
  }
  .t-watch {
    --tone: var(--warn);
  }
  .t-good {
    --tone: var(--good);
  }
  .t-quiet {
    --tone: var(--text-ghost);
  }

  .cm-head {
    background: var(--card-bg);
    text-transform: uppercase;
    color: var(--text-muted);
    justify-content: space-between;
  }
  .cm-corner {
    color: var(--text-ghost);
  }
  .cm-col-n {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    letter-spacing: 0;
    color: var(--tone);
  }
  .cm-col.zero .cm-col-n {
    color: var(--text-ghost);
  }

  .cm-row {
    justify-content: flex-start;
    text-transform: none;
    letter-spacing: 0.02em;
    font-family: var(--font-body);
    font-size: var(--fs-label);
  }
  .cm-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    color: var(--tone);
    flex: 0 0 auto;
  }
  .cm-row-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-row-n {
    margin-left: auto;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .cm-row.zero {
    color: var(--text-ghost);
  }
  .cm-row.zero .cm-mark {
    color: var(--text-ghost);
  }

  .cm-cell {
    justify-content: center;
    font-family: var(--font-display);
    font-size: 20px;
    letter-spacing: -0.01em;
    color: var(--tone);
    font-variant-numeric: tabular-nums;
  }
  .cm-cell.zero {
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }

  a.cm-cell:hover,
  a.cm-row:hover,
  a.cm-head:hover {
    background: var(--accent-tint-08);
  }
  a.cm-cell.active,
  a.cm-row.active,
  a.cm-head.active {
    background: var(--text-primary);
    color: var(--bg);
    --tone: var(--accent-on-dark);
  }
  a.cm-row.active .cm-row-n,
  a.cm-head.active .cm-col-label {
    color: rgba(237, 228, 212, 0.7);
  }
  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* On a phone the matrix scrolls INSIDE its own box rather than squeezing
     "UNDECIDED" into a 54px track — `.cm` is `overflow-x: auto`, so the page
     never scrolls sideways. */
  @media (max-width: 480px) {
    .cm {
      grid-template-columns: minmax(104px, 1.4fr) repeat(var(--cm-cols), minmax(86px, 1fr));
    }
    .cm-head,
    .cm-row,
    .cm-cell {
      padding: 10px 8px;
    }
    .cm-mark {
      display: none;
    }
  }
</style>
