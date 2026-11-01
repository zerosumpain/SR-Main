<script lang="ts">
  /**
   * Times of day: for one kind of place at a time, the share of each hour
   * someone spent there — a line per day type, a small chart per person, all
   * on one scale sized to that kind, so lunch out at 4% reads as plainly as
   * school at 70%. The stacked-column version this replaces gave home 80% of
   * every column and left everything else a sliver; picking the kind is the
   * filter that fixes it.
   *
   * Weekdays and weekends are the site's first two chart hues (validated as a
   * pair) and weekends are also dashed, so the two never differ by colour
   * alone. One crosshair runs across every panel: hover or arrow keys pick an
   * hour, and each panel prints its own figures for it. The numbers are in a
   * table underneath.
   *
   * Kinds can be combined: pick shops and food and each line is the share of
   * the hour at either. Picks merge by slot, so "Away from home" with "Shops"
   * counts a shop hour once. Every button carries the total hours the people
   * in view spent there over the window, so the chart's shares have a size.
   */
  import { CATEGORIES, GROUPS, categoryLabel, type PersonPattern } from '$lib/home/presence/patterns';
  import { hhmm } from './format';

  let { people }: { people: PersonPattern[] } = $props();

  type DayType = 'weekday' | 'weekend';
  const TYPES: Array<{ id: DayType; label: string }> = [{ id: 'weekday', label: 'Weekdays' }, { id: 'weekend', label: 'Weekends' }];
  const COLOUR: Record<DayType, string> = { weekday: 'var(--chart-cat-1)', weekend: 'var(--chart-cat-2)' };

  // The kinds: "away from home" first, then the page's groups, then each
  // finer kind that anyone in view actually spent time at.
  const slotsOf = (g: (typeof GROUPS)[number]) => g.slots as readonly string[];
  const AWAY = ['family', 'homes', 'school', 'work', 'shops', 'food', 'outdoors', 'daysout', 'leisure', 'sport', 'health', 'services', 'community', 'stay', 'transport', 'far', 'other', 'unnamed', 'travel'];
  const groupKinds = GROUPS.filter((g) => g.id !== 'home').map((g) => ({ id: `g:${g.id}`, label: g.label, slots: slotsOf(g).filter((s) => s !== 'unplaced') }));
  const fine = $derived(
    CATEGORIES.filter((c) => !['home', 'school', 'work', 'family', 'far', 'unnamed'].includes(c.id))
      .filter((c) => people.some((p) => TYPES.some((t) => p.dayShape[t.id].some((h) => (h[c.id] ?? 0) > 0.002))))
      .map((c) => ({ id: `c:${c.id}`, label: categoryLabel(c.id), slots: [c.id] as readonly string[] })),
  );
  const kinds = $derived([{ id: 'away', label: 'Away from home', slots: AWAY as readonly string[] }, { id: 'g:home', label: 'Home', slots: ['home'] as readonly string[] }, ...groupKinds, ...fine]);

  let picked = $state<string[]>(['away']);
  let days = $state<'both' | DayType>('both');
  let hover = $state<number | null>(null);

  // Picks that vanished (a finer kind nobody in view visits) drop out; never none.
  const chosen = $derived.by(() => {
    const live = kinds.filter((k) => picked.includes(k.id));
    return live.length ? live : [kinds[0]];
  });
  const kind = $derived({
    id: chosen.map((k) => k.id).join('+'),
    label: chosen.map((k) => k.label).join(' + '),
    slots: [...new Set(chosen.flatMap((k) => k.slots))] as readonly string[],
  });
  function toggle(id: string) {
    const on = chosen.some((k) => k.id === id);
    if (on && chosen.length === 1) return; // keep one
    picked = on ? chosen.map((k) => k.id).filter((x) => x !== id) : [...chosen.map((k) => k.id), id];
  }

  /** Hours the people in view spent at these slots over the window: places by kind, plus time travelling. */
  const hoursAt = (slots: readonly string[]) =>
    people.reduce((a, p) => a
      + p.categories.reduce((b, c) => b + (slots.includes(c.category) ? c.hours : 0), 0)
      + (slots.includes('travel') ? p.travelHours : 0), 0);
  const totals = $derived(new Map(kinds.map((k) => [k.id, hoursAt(k.slots)])));
  const hrs = (h: number) => (h >= 10 ? `${Math.round(h).toLocaleString('en-GB')} h` : h >= 1 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : h > 0 ? `${Math.max(1, Math.round(h * 60))} min` : '0 h');
  const types = $derived(TYPES.filter((t) => days === 'both' || t.id === days));
  const value = (p: PersonPattern, t: DayType, h: number) => kind.slots.reduce((a, s) => a + ((p.dayShape[t][h] as Record<string, number | undefined>)?.[s] ?? 0), 0);
  const series = $derived(people.map((p) => ({
    p,
    lines: types.map((t) => ({ ...t, v: Array.from({ length: 24 }, (_, h) => value(p, t.id, h)) })),
  })));
  // One scale for every panel: the highest hour in view, up to a round step.
  const yMax = $derived.by(() => {
    const top = Math.max(0.01, ...series.flatMap((s) => s.lines.flatMap((l) => l.v)));
    return [0.02, 0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1].find((s) => s >= top) ?? 1;
  });
  const pct = (n: number) => `${n < 0.1 && n > 0 ? (n * 100).toFixed(1).replace(/\.0$/, '') : Math.round(n * 100)}%`;
  const peak = (v: number[]) => { let h = 0; v.forEach((x, i) => { if (x > v[h]) h = i; }); return h; };

  const big = $derived(people.length === 1);
  let w = $state(0);
  // Drawn at the width it shows at, so the 12 px labels stay 12 px: the grid's
  // own column width, as its auto-fill (260 px minimum, 18 px gaps) lays it out.
  const panelW = $derived.by(() => {
    if (big || !w) return Math.max(260, w || 560);
    const cols = Math.max(1, Math.floor((w + 18) / (260 + 18)));
    return Math.floor((w - 18 * (cols - 1)) / cols);
  });
  const PH = $derived(big ? 220 : 140);
  const M = { l: 34, r: 8, t: 8, b: 20 };
  const x = (h: number) => M.l + (h / 23) * (panelW - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / yMax) * (PH - M.t - M.b);
  const path = (v: number[]) => v.map((val, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(val).toFixed(1)}`).join('');
  const hourAt = (e: PointerEvent, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * panelW;
    return Math.max(0, Math.min(23, Math.round(((px - M.l) / (panelW - M.l - M.r)) * 23)));
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      hover = Math.max(0, Math.min(23, (hover ?? 12) + (e.key === 'ArrowRight' ? 1 : -1)));
    } else if (e.key === 'Escape') hover = null;
  }
</script>

<div class="td-controls" role="toolbar" aria-label="Choose what to chart">
  <div class="td-kinds" role="group" aria-label="Kinds of place: pick one or more">
    {#each kinds as k (k.id)}
      <button type="button" class:fine={k.id.startsWith('c:')} aria-pressed={chosen.some((c) => c.id === k.id)} onclick={() => toggle(k.id)}>{k.label}<span class="td-h">{hrs(totals.get(k.id) ?? 0)}</span></button>
    {/each}
  </div>
  <div class="td-days" role="group" aria-label="Days">
    {#each [['both', 'Both'], ['weekday', 'Weekdays'], ['weekend', 'Weekends']] as const as [id, label] (id)}
      <button type="button" aria-pressed={days === id} onclick={() => (days = id)}>{label}</button>
    {/each}
  </div>
</div>

<ul class="td-legend" aria-label="Legend">
  {#each types as t (t.id)}
    <li><svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke={COLOUR[t.id]} stroke-width="2" stroke-dasharray={t.id === 'weekend' ? '4 3' : undefined} /></svg>{t.label}</li>
  {/each}
  <li class="td-scale">Share of each hour at {kind.label.toLowerCase()} · <b>{hrs(hoursAt(kind.slots))}</b> in all{people.length > 1 ? ' between them' : ''}</li>
</ul>

<div class="td-grid" class:big bind:clientWidth={w}>
  {#each series as s (s.p.subject)}
    <figure class="td-panel">
      <figcaption>
        {#if !big}<strong>{s.p.displayName}</strong>{/if}
        <span class="td-read">
          {#if hover != null}
            {hhmm(hover * 60)} · {#each s.lines as l, i (l.id)}{i ? ' · ' : ''}{l.id === 'weekday' ? 'wkdy' : 'wknd'} <b>{pct(l.v[hover])}</b>{/each}
          {:else}
            {#each s.lines as l, i (l.id)}{i ? ' · ' : ''}{l.label} peak {hhmm(peak(l.v) * 60)} <b>{pct(l.v[peak(l.v)])}</b>{/each}
          {/if}
        </span>
      </figcaption>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <svg
        width={panelW} height={PH} viewBox={`0 0 ${panelW} ${PH}`} role="img" tabindex="0"
        aria-label={`${s.p.displayName}: share of each hour at ${kind.label.toLowerCase()}. ${s.lines.map((l) => `${l.label} peak ${hhmm(peak(l.v) * 60)}, ${pct(l.v[peak(l.v)])}`).join('; ')}. Arrow keys step through the hours.`}
        onpointermove={(e) => (hover = hourAt(e, e.currentTarget))} onpointerleave={() => (hover = null)} onkeydown={onKey} onblur={() => (hover = null)}
      >
        {#each [0, 0.5, 1] as f (f)}
          <line class="grid" x1={M.l} x2={panelW - M.r} y1={y(yMax * f)} y2={y(yMax * f)} />
          <text class="tick" x={M.l - 4} y={y(yMax * f) + 4} text-anchor="end">{pct(yMax * f)}</text>
        {/each}
        {#each [0, 6, 12, 18, 23] as h (h)}
          <text class="tick" x={x(h)} y={PH - 5} text-anchor={h === 0 ? 'start' : h === 23 ? 'end' : 'middle'}>{String(h).padStart(2, '0')}</text>
        {/each}
        {#if hover != null}<line class="cross" x1={x(hover)} x2={x(hover)} y1={M.t} y2={PH - M.b} />{/if}
        {#each s.lines as l (l.id)}
          <path d={path(l.v)} fill="none" stroke={COLOUR[l.id]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={l.id === 'weekend' ? '5 4' : undefined} />
          {#if hover != null}<circle cx={x(hover)} cy={y(l.v[hover])} r="4.5" fill={COLOUR[l.id]} stroke="var(--surface-card)" stroke-width="2" />{/if}
        {/each}
      </svg>
    </figure>
  {/each}
</div>

<details class="td-table">
  <summary>The numbers</summary>
  <div class="td-wrap">
    <table>
      <caption>Share of each hour at {kind.label.toLowerCase()}, by person and day type.</caption>
      <thead>
        <tr><th scope="col">Hour</th>{#each series as s (s.p.subject)}{#each s.lines as l (l.id)}<th scope="col">{s.p.displayName}<small>{l.label}</small></th>{/each}{/each}</tr>
      </thead>
      <tbody>
        {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
          <tr><th scope="row">{hhmm(h * 60)}</th>{#each series as s (s.p.subject)}{#each s.lines as l (l.id)}<td>{pct(l.v[h])}</td>{/each}{/each}</tr>
        {/each}
      </tbody>
    </table>
  </div>
</details>

<style>
  .td-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px 16px;
    margin-bottom: 12px;
  }
  .td-kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1 1 420px;
  }
  .td-kinds button {
    font: 500 var(--fs-label) var(--font-body);
    padding: 4px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }
  .td-h {
    margin-left: 6px;
    font: var(--fs-label-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .td-kinds button[aria-pressed='true'] .td-h {
    color: inherit;
    opacity: 0.8;
  }
  .td-scale b {
    color: var(--text-primary);
    font-weight: 600;
  }
  .td-kinds button.fine {
    border-style: dashed;
  }
  .td-kinds button[aria-pressed='true'] {
    background: var(--text-primary);
    border-color: var(--text-primary);
    border-style: solid;
    color: var(--bg);
  }
  .td-days {
    display: flex;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  .td-days button {
    font: 500 var(--fs-label) var(--font-mono);
    padding: 5px 10px;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }
  .td-days button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--bg);
  }
  button:focus-visible,
  svg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .td-legend {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .td-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .td-scale {
    color: var(--text-muted);
  }
  .td-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px 18px;
  }
  .td-grid.big {
    grid-template-columns: minmax(0, 1fr);
  }
  .td-panel {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 2px 8px;
    margin-bottom: 2px;
    font: var(--fs-label) var(--font-body);
  }
  .td-read {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .td-read b {
    color: var(--text-primary);
    font-weight: 600;
  }
  svg {
    display: block;
    max-width: 100%;
    height: auto;
    touch-action: pan-y;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick {
    font: 12px var(--font-mono);
    fill: var(--text-muted);
  }
  .cross {
    stroke: var(--text-muted);
    stroke-width: 1;
  }
  .td-table {
    margin-top: 12px;
  }
  .td-table summary {
    cursor: pointer;
    font: var(--fs-label) var(--font-mono);
    color: var(--text-secondary);
  }
  .td-wrap {
    overflow-x: auto;
    margin-top: 8px;
  }
  .td-table table {
    border-collapse: collapse;
    font: var(--fs-label-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .td-table caption {
    text-align: left;
    padding-bottom: 6px;
    font: var(--fs-label) var(--font-body);
    color: var(--text-muted);
  }
  .td-table th,
  .td-table td {
    padding: 3px 8px;
    border-bottom: 1px solid var(--line);
    text-align: right;
    white-space: nowrap;
  }
  .td-table th small {
    display: block;
    color: var(--text-muted);
    font-weight: 400;
  }
  @media print {
    .td-table {
      display: none;
    }
  }
</style>
