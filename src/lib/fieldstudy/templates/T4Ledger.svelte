<script lang="ts">
  /**
   * T4 · Ledger — weighing.
   *
   * Two sides, re-lensed through many actors. Selecting a lens RE-RANKS; it
   * never filters, because a row disappearing when you change whose eyes you
   * are looking through is how a ledger stops being one.
   *
   * The risk column is never shorter than the benefit column. validate.ts
   * enforces that; the eye enforces it too, which is why they sit side by side.
   */
  import ConfidenceChip from '../ConfidenceChip.svelte';
  import type { Beat } from '../study';

  let { beat }: { beat: Beat } = $props();
  const l = $derived(beat.ledger);
  let lens = $state<string | null>(null);
  const active = $derived(lens ?? l?.activeLens ?? l?.lenses[0] ?? '');
</script>

{#if l}
  <div class="fs-lenses" role="group" aria-label="Whose eyes">
    <span class="fs-margin-label">Through whose eyes</span>
    <div class="fs-lens-row">
      {#each l.lenses as name, i (i)}
        <button
          type="button"
          class="fs-lens"
          class:on={active === name}
          aria-pressed={active === name}
          onclick={() => (lens = name)}
        >{name}</button>
      {/each}
    </div>
  </div>

  <div class="fs-ledger">
    <section class="fs-col fs-col--benefit">
      <h3 class="fs-margin-label">Better off</h3>
      <ol>
        {#each l.benefits as b, i (i)}
          <li><span class="fs-n">{String(i + 1).padStart(2, '0')}</span><span class="fs-t">{b.text}</span><ConfidenceChip level={b.confidence} /></li>
        {/each}
      </ol>
    </section>
    <section class="fs-col fs-col--risk">
      <h3 class="fs-margin-label">Worse off</h3>
      <ol>
        {#each l.risks as r, i (i)}
          <li><span class="fs-n">{String(i + 1).padStart(2, '0')}</span><span class="fs-t">{r.text}</span><ConfidenceChip level={r.confidence} /></li>
        {/each}
      </ol>
    </section>
  </div>

  <p class="fs-balance">{l.balance}</p>

  {#if l.byActor?.length}
    <div class="fs-table-scroll">
      <table class="fs-table">
        <thead>
          <tr><th>Actor</th><th>Gains</th><th>Loses</th><th>Net</th><th>In their own words</th></tr>
        </thead>
        <tbody>
          {#each l.byActor as a, i (i)}
            <tr class:pick={a.actor === active}>
              <td>{a.actor}</td>
              <td class="num">{a.gains}</td>
              <td class="num">{a.loses}</td>
              <td data-net={a.net}>{a.net}</td>
              <td class="fs-words">{a.quote ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  .fs-lenses { margin-top: 24px; }
  .fs-lens-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .fs-lens {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 5px 10px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.2s var(--ease-out), color 0.2s var(--ease-out);
  }
  .fs-lens:hover { color: var(--text-primary); background: var(--accent-tint-04); }
  .fs-lens.on {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }

  .fs-ledger {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
    margin-top: 26px;
  }
  .fs-col { min-width: 0; padding-top: 12px; }
  /* Petrol for what is gained, claret for what is lost — the two colours the
     system already uses for "settled" and "contested". */
  .fs-col--benefit { border-top: 2px solid var(--accent-ink); }
  .fs-col--risk { border-top: 2px solid #8a2d3a; }
  .fs-col ol { list-style: none; margin: 12px 0 0; padding: 0; }
  .fs-col li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .fs-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }
  .fs-t { font-size: var(--fs-label); line-height: 1.5; }

  .fs-balance {
    font-family: var(--fs-serif);
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--text-primary);
    margin: 24px 0 0;
    max-width: 58ch;
    text-wrap: pretty;
  }
  .fs-table-scroll { overflow-x: auto; max-width: 100%; margin-top: 24px; }
  .fs-table-scroll .fs-table { min-width: max-content; }
  .fs-words { font-style: italic; color: var(--text-muted); }
  /* The net column is the one place this table takes a colour, and it takes
     the two the system already uses for settled and contested. */
  [data-net='positive'] { color: var(--accent-ink); }
  [data-net='negative'] { color: #8a2d3a; }
  [data-net='even'] { color: var(--text-muted); }

  @media (max-width: 900px) {
    .fs-ledger { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  }
</style>
