<script lang="ts">
  /**
   * Month by month: one figure at a time (picked by the buttons) for each
   * person across the kept months, and what changed between the last two
   * finished ones. A month still running says "so far"; one the trail window
   * only partly covered says from when. A change of tracker is marked, because
   * the months either side of it are not compared.
   */
  import { monthName, type MonthPerson, type PatternsHistoryView } from '$lib/home/presence/patterns-history';

  let { history, focus }: { history: PatternsHistoryView; focus: string | null } = $props();

  const METRICS = [
    { id: 'out', label: 'Hours out a day', get: (p: MonthPerson) => p.outPerDay, fmt: (v: number) => `${v} h` },
    { id: 'steps', label: 'Steps a day', get: (p: MonthPerson) => p.steps, fmt: (v: number) => Math.round(v).toLocaleString('en-GB') },
    { id: 'roam', label: 'Roams', get: (p: MonthPerson) => p.roamKm, fmt: (v: number) => `${v} km` },
    { id: 'alone', label: 'Out alone', get: (p: MonthPerson) => p.aloneOutShare, fmt: (v: number) => `${Math.round(v * 100)}%` },
    { id: 'away', label: 'Days far from home', get: (p: MonthPerson) => p.awayDays, fmt: (v: number) => String(v) },
    { id: 'places', label: 'Places', get: (p: MonthPerson) => p.distinctPlaces, fmt: (v: number) => String(v) },
  ] as const;
  let metric = $state<(typeof METRICS)[number]['id']>('out');
  const m = $derived(METRICS.find((x) => x.id === metric)!);

  const months = $derived(history.months);
  const people = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const mo of months) for (const p of mo.people) seen.set(p.subject, p.displayName);
    return [...seen].filter(([s]) => !focus || s === focus).map(([subject, name]) => ({ subject, name }));
  });
  const cell = (month: number, subject: string) => months[month].people.find((p) => p.subject === subject) ?? null;
  const switched = (month: number, subject: string) => {
    if (!month) return false;
    const a = cell(month - 1, subject), b = cell(month, subject);
    return !!a && !!b && a.source !== b.source;
  };
  const peak = $derived(Math.max(1e-9, ...months.flatMap((mo) => mo.people.map((p) => m.get(p) ?? 0))));
  const sub = (i: number) => {
    const mo = months[i];
    if (!mo.final) return 'so far';
    if (mo.coveredDays < mo.monthDays - 0.5) return `from ${new Date(mo.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}`;
    return '';
  };
  const changes = $derived(history.changes.filter((c) => !focus || c.subject === focus || c.subject == null));
  // Newest months are on the right: a narrow screen starts scrolled to them.
  let wrap = $state<HTMLDivElement>();
  $effect(() => {
    void months.length;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  });
</script>

<div class="mo-pick" role="group" aria-label="Figure">
  {#each METRICS as x (x.id)}
    <button type="button" aria-pressed={metric === x.id} onclick={() => (metric = x.id)}>{x.label}</button>
  {/each}
</div>

<div class="mo-wrap" bind:this={wrap}>
  <table class="mo">
    <thead>
      <tr>
        <th scope="col">Person</th>
        {#each months as mo, i (mo.month)}<th scope="col">{monthName(mo.month)}<small>{sub(i)}</small></th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each people as p (p.subject)}
        <tr>
          <th scope="row">{p.name}</th>
          {#each months as mo, i (mo.month)}
            {@const c = cell(i, p.subject)}
            {@const v = c ? m.get(c) : null}
            <td title={c ? `${p.name}, ${monthName(mo.month)}: seen ${Math.round(c.coverage * 100)}% of it, ${c.awayDays} days far from home, tracker ${c.source ?? 'unknown'}` : undefined}>
              {#if v == null}<span class="none">—</span>{:else}
                <span class="mo-v">{m.fmt(v)}</span>
                <span class="mo-bar" aria-hidden="true"><span style:width={`${(v / peak) * 100}%`}></span></span>
              {/if}
              {#if switched(i, p.subject)}<small>tracker changed</small>{/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<h3>{history.compared ? `${monthName(history.compared[1])} against ${monthName(history.compared[0])}` : 'What changed'}</h3>
{#if !history.compared}
  <p class="mo-quiet">Two finished months are needed before anything is compared.</p>
{:else if changes.length}
  <ul class="mo-changes">{#each changes as c, i (i)}<li>{c.text}</li>{/each}</ul>
{:else}
  <p class="mo-quiet">Nothing moved enough to mention{focus ? ' for this person' : ''}, or the tracker changed between the two months.</p>
{/if}

<style>
  .mo-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .mo-pick button {
    padding: 4px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    background: none;
    color: var(--text-secondary);
    font: var(--fs-label-xs) var(--font-mono);
    cursor: pointer;
  }
  .mo-pick button[aria-pressed='true'] {
    background: var(--accent-ink);
    border-color: var(--accent-ink);
    color: var(--surface-card);
  }
  .mo-pick button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .mo-wrap {
    overflow-x: auto;
  }
  .mo {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body-sm);
    font-variant-numeric: tabular-nums;
  }
  .mo th,
  .mo td {
    text-align: left;
    vertical-align: top;
    padding: 6px 12px 6px 0;
    border-bottom: 1px solid var(--line);
    min-width: 84px;
  }
  /* The names stay put while the months scroll under them on a phone. */
  .mo th:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    min-width: 72px;
    /* The card's own surface (cards sit on --surface-card, the page on --bg). */
    background: var(--surface-card);
  }
  .mo thead th {
    font: 500 var(--fs-label-xs) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--line-strong);
  }
  small {
    display: block;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    text-transform: none;
    letter-spacing: 0;
  }
  .mo-v {
    font-weight: 600;
  }
  .mo-bar {
    display: block;
    height: 4px;
    margin-top: 4px;
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  }
  .mo-bar span {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .none,
  .mo-quiet {
    color: var(--text-muted);
  }
  .mo-quiet {
    font-size: var(--fs-body-sm);
    font-style: italic;
  }
  h3 {
    margin: 18px 0 6px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mo-changes {
    margin: 0;
    padding-left: 1.2em;
    font-size: var(--fs-body);
    line-height: 1.45;
  }
  .mo-changes li {
    margin-bottom: 6px;
  }
</style>
