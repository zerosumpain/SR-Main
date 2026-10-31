<script lang="ts">
  /**
   * Who is with whom: hours each pair spent at the same place OUT of the
   * house (home together is the sub-line, not the shade — everyone is home
   * together at night), and journeys they made together. One hue, light to
   * dark, with the hours printed in every cell. Then the groups that form,
   * and where they go.
   */
  import type { PatternsReport } from '$lib/home/presence/patterns';

  let { together, names, focus }: { together: PatternsReport['together']; names: Record<string, string>; focus: string | null } = $props();

  const subjects = $derived(Object.keys(names));
  const cell = (a: string, b: string) => together.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)) ?? null;
  const peak = $derived(Math.max(1, ...together.pairs.map((p) => p.outHours)));
  const shade = (v: number) => (v ? 14 + Math.round((v / peak) * 70) : 0);
  const groups = $derived(together.groups.filter((g) => !focus || g.subjects.includes(focus)).slice(0, 8));
  const list = (s: string[]) => s.map((x) => names[x] ?? x).join(', ').replace(/, ([^,]*)$/, ' and $1');
</script>

<div class="tg-wrap">
  <table class="tg">
    <caption>Hours at the same place away from home. Under each: hours home together · journeys made together.</caption>
    <thead><tr><th scope="col"><span class="sr">Person</span></th>{#each subjects as s (s)}<th scope="col">{names[s]}</th>{/each}</tr></thead>
    <tbody>
      {#each subjects as a (a)}
        <tr class:lit={focus === a}>
          <th scope="row">{names[a]}</th>
          {#each subjects as b (b)}
            {@const c = a === b ? null : cell(a, b)}
            {#if a === b}
              <td class="self" aria-label="—"></td>
            {:else}
              <td
                style:background={c?.outHours ? `color-mix(in srgb, var(--accent-ink) ${shade(c.outHours)}%, var(--surface-card))` : undefined}
                class:dark={shade(c?.outHours ?? 0) >= 50}
                title={`${names[a]} and ${names[b]}: ${c?.outHours ?? 0} h out together, ${c?.homeHours ?? 0} h home together, ${c?.sharedTrips ?? 0} journeys together`}
              >
                <strong>{Math.round(c?.outHours ?? 0)}</strong>
                <small>{Math.round(c?.homeHours ?? 0)} · {c?.sharedTrips ?? 0}</small>
              </td>
            {/if}
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if together.whole.hours > 0}
  <p class="tg-whole"><strong>Everyone together, out:</strong> {together.whole.hours} h{together.whole.places.length ? ` — ${together.whole.places.map((p) => `${p.name} ${p.hours} h`).join(', ')}` : ''}.</p>
{/if}

{#if groups.length}
  <h3>The groups that form</h3>
  <ul class="rows">
    {#each groups as g (g.subjects.join('|'))}
      <li>
        <span><strong>{list(g.subjects)}</strong><small>{g.places.map((p) => `${p.name} ${p.hours} h`).join(' · ')}</small></span>
        <span class="num">{g.hours} h</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .tg-wrap {
    overflow-x: auto;
  }
  .tg {
    width: 100%;
    min-width: 380px;
    border-collapse: separate;
    border-spacing: 2px;
    table-layout: fixed;
    font: var(--fs-label-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  caption {
    text-align: left;
    padding-bottom: 8px;
    font: var(--fs-label) var(--font-body);
    color: var(--text-muted);
  }
  th {
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
  }
  tbody th {
    text-align: left;
    width: 70px;
  }
  tr.lit th {
    color: var(--accent);
    font-weight: 700;
  }
  td {
    height: 46px;
    text-align: center;
    background: var(--surface-rail);
    color: var(--text-primary);
    border-radius: 1px;
  }
  td strong {
    display: block;
    font: var(--fs-body) var(--font-display);
  }
  td small {
    color: inherit;
    opacity: 0.75;
  }
  td.dark {
    color: var(--bg);
  }
  td.self {
    background: transparent;
  }
  .tg-whole {
    margin: 12px 0 0;
    font-size: var(--fs-body-sm);
  }
  h3 {
    margin: 18px 0 6px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .rows small {
    display: block;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .num {
    font: var(--fs-label) var(--font-mono);
    white-space: nowrap;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
