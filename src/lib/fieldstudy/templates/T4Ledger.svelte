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
  import type { Beat, Claim } from '../study';

  let { beat }: { beat: Beat } = $props();
  const l = $derived(beat.ledger);

  /**
   * Only lenses that DO something get a button.
   *
   * A lens with no tagged claim and no actor row re-ranks nothing and
   * highlights nothing — it is a control that lies. Both shipped studies had
   * them: this study's governance ledger declared four lenses and carried no
   * actor rows at all, so every one of its buttons was inert. Rather than add
   * a validator rule nobody reads, the template simply cannot render one.
   */
  function bites(name: string): boolean {
    if (!l) return false;
    if (l.byActor?.some((a) => a.actor === name)) return true;
    return [...l.benefits, ...l.risks].some((c) => c.lenses?.includes(name));
  }
  const liveLenses = $derived((l?.lenses ?? []).filter(bites));

  let lens = $state<string | null>(null);
  const active = $derived(
    lens ?? (liveLenses.includes(l?.activeLens ?? '') ? l!.activeLens! : liveLenses[0]) ?? '',
  );

  /** Re-rank, never filter: tagged claims rise, everything else holds its order. */
  function ranked(claims: Claim[]): Claim[] {
    if (!active) return claims;
    return claims
      .map((c, i) => ({ c, i, hit: c.lenses?.includes(active) ? 0 : 1 }))
      .sort((a, b) => a.hit - b.hit || a.i - b.i)
      .map((x) => x.c);
  }
  /** The chosen actor's row leads the table; the rest hold their order. */
  const actorRows = $derived(
    [...(l?.byActor ?? [])].sort((a, b) => Number(b.actor === active) - Number(a.actor === active)),
  );
</script>

{#if l}
  {#if liveLenses.length > 1}
    <div class="fs-lenses" role="group" aria-label="Whose eyes">
      <span class="fs-margin-label">Through whose eyes</span>
      <div class="fs-lens-row">
        {#each liveLenses as name (name)}
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
  {/if}

  <div class="fs-ledger">
    <section class="fs-col fs-col--benefit">
      <h3 class="fs-margin-label">Better off <span class="fs-count">{l.benefits.length}</span></h3>
      <ol>
        {#each ranked(l.benefits) as b, i (b.text)}
          <li class:lens-hit={active && b.lenses?.includes(active)}>
            <span class="fs-n">{String(i + 1).padStart(2, '0')}</span>
            <span class="fs-t">{b.text}</span>
            <ConfidenceChip level={b.confidence} />
          </li>
        {/each}
      </ol>
    </section>
    <section class="fs-col fs-col--risk">
      <h3 class="fs-margin-label">Worse off <span class="fs-count">{l.risks.length}</span></h3>
      <ol>
        {#each ranked(l.risks) as r, i (r.text)}
          <li class:lens-hit={active && r.lenses?.includes(active)}>
            <span class="fs-n">{String(i + 1).padStart(2, '0')}</span>
            <span class="fs-t">{r.text}</span>
            <ConfidenceChip level={r.confidence} />
          </li>
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
          {#each actorRows as a (a.actor)}
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
  .fs-count { color: var(--text-ghost); font-variant-numeric: tabular-nums; }
  .fs-col ol { list-style: none; margin: 12px 0 0; padding: 0; }
  .fs-col li {
    display: grid;
    /* The chip column is FIXED, not auto. Each li is its own grid, so an auto
       track sizes to that row's chip alone and the chips come out ragged down
       the column — FACT, CONTESTED and HYPOTHESIS are three different widths.
       A fixed track lines them up. */
    grid-template-columns: 28px minmax(0, 1fr) 104px;
    align-items: baseline;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .fs-col li > :global(.fs-chip) { justify-self: end; }
  /* Re-ranking has to be visible or it is not a control. The rise to the top
     does most of the work; this marks WHY a row rose. */
  .fs-col li.lens-hit .fs-t { color: var(--text-primary); }
  .fs-col li.lens-hit .fs-n { color: var(--accent); }
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
    max-width: 100%;
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
