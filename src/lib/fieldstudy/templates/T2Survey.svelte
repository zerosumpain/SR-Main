<script lang="ts">
  /**
   * T2 · Survey — accounting.
   *
   * A landscape counted. Every row has identical fields and its own basis, the
   * total reconciles to the rows, and estimates are marked and excluded from
   * it. Never an undated count — the provenance strip carries the date.
   */
  import ProvenanceStrip from '../ProvenanceStrip.svelte';
  import type { Beat } from '../study';

  let { beat, depth = 'research' }: { beat: Beat; depth?: 'plain' | 'research' | 'technical' } = $props();
  const s = $derived(beat.survey);

  function textFor(p: { plain?: string; research: string; technical?: string }): string {
    if (depth === 'plain') return p.plain ?? p.research;
    if (depth === 'technical') return p.technical ?? p.research;
    return p.research;
  }
</script>

{#each beat.prose ?? [] as p, i (i)}
  <p class="fs-body" class:fs-dropcap={p.dropCap}>{textFor(p)}</p>
{/each}

{#if s}
  <div class="fs-table-scroll">
    <table class="fs-table">
      <thead>
        <tr>{#each s.columns as c, ci (ci)}<th>{c}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each s.rows as row, i (i)}
          <!-- `estimate` gets the dashed rule and sits outside the total. That
               is the whole reason basis is on the row rather than in a note. -->
          <tr class:pick={row.pick} class:estimate={row.basis === 'estimate'}>
            {#each row.cells as cell, j (j)}
              <!-- A cell the source does not carry is a dash, never a zero. -->
              <td class:num={typeof cell === 'number'}>{cell ?? '—'}</td>
            {/each}
          </tr>
        {/each}
        <tr class="sigma">
          <td>{s.total.label}</td>
          {#each s.columns.slice(1) as _c, j (j)}
            <td class="num">{j === s.columns.length - 2 ? s.total.value : ''}</td>
          {/each}
        </tr>
      </tbody>
    </table>
  </div>

  <ProvenanceStrip asOf={s.asOf}>{s.provenance}</ProvenanceStrip>

  {#if s.cannotTellYou?.length}
    <div class="fs-warn fs-cannot">
      <span class="label">What this cannot tell you</span>
      <ul>{#each s.cannotTellYou as line, li (li)}<li>{line}</li>{/each}</ul>
    </div>
  {/if}
{/if}

<style>
  /* Wide content scrolls inside its own container, never the page. */
  .fs-table-scroll {
    overflow-x: auto;
    max-width: 100%;
    margin-top: 22px;
  }
  .fs-table-scroll .fs-table {
    min-width: max-content;
  }
  .fs-cannot {
    margin-top: 18px;
  }
  .fs-cannot ul {
    margin: 9px 0 0;
    padding-left: 18px;
  }
  .fs-cannot li {
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-secondary);
  }
</style>
