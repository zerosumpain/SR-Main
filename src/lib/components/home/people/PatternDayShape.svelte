<script lang="ts">
  /**
   * The shape of each person's day: for every hour, where their observed time
   * went — home, school or work, family and friends, far afield, out and
   * about, or travelling between. Weekdays and weekends side by side. Each
   * column is that hour's share of observed time, so a column is full whether
   * the hour was seen on two days or sixty.
   *
   * The four away groups use the site's four chart hues in a validated stack
   * order (no adjacent pair under ΔE 11 for any colour vision); home and
   * travel are ink, not hues. A legend is always shown and every segment
   * names itself on hover, so no reading rests on colour alone.
   */
  import { GROUPS, groupOf, type Group, type PersonPattern } from '$lib/home/presence/patterns';
  import { hhmm } from './format';

  let { people }: { people: PersonPattern[] } = $props();

  const FILL: Record<Group, string> = {
    home: 'color-mix(in srgb, var(--text-primary) 13%, var(--surface-card))',
    duty: 'var(--chart-cat-1)',
    family: 'var(--chart-cat-3)',
    far: 'var(--chart-cat-4)',
    about: 'var(--chart-cat-2)',
    travel: 'var(--text-secondary)',
  };
  const H = 64;
  const GAP = 2;
  let w = $state(0);
  // The plot is the row less its 76 px label and 8 px gap.
  const W = $derived(Math.max(240, (w || 560) - 84));
  const col = $derived((W - GAP * 23) / 24);

  /** One hour's shares, folded into the page's six groups, in stack order. */
  function stack(hour: Partial<Record<string, number>>) {
    const by = new Map<Group, number>();
    for (const [slot, v] of Object.entries(hour)) by.set(groupOf(slot), (by.get(groupOf(slot)) ?? 0) + (v ?? 0));
    const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
    let y = H;
    return GROUPS.filter((g) => by.get(g.id)).map((g) => {
      const h = ((by.get(g.id) ?? 0) / total) * H;
      y -= h;
      return { id: g.id, label: g.label, share: (by.get(g.id) ?? 0) / total, y, h };
    });
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`;
</script>

<ul class="ds-legend" aria-label="Legend">
  {#each GROUPS as g (g.id)}<li><span class="sw" style:background={FILL[g.id]}></span>{g.label}</li>{/each}
</ul>

<div class="ds" bind:clientWidth={w}>
  {#each people as p (p.subject)}
    <section class="ds-person" aria-label={`${p.displayName}'s day`}>
      {#if people.length > 1}<h3>{p.displayName}</h3>{/if}
      {#each [['weekday', 'Weekdays'], ['weekend', 'Weekends']] as const as [type, label] (type)}
        <div class="ds-row">
          <span class="ds-type">{label}</span>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.displayName}, ${label.toLowerCase()}, share of each hour by kind of place`}>
            {#each p.dayShape[type] as hour, h (h)}
              {#each stack(hour) as s (s.id)}
                <rect x={h * (col + GAP)} y={s.y + (s.y > 0 ? GAP / 2 : 0)} width={col} height={Math.max(0, s.h - (s.y > 0 ? GAP / 2 : 0))} fill={FILL[s.id]} rx="1">
                  <title>{`${label} ${hhmm(h * 60)}–${hhmm(h * 60 + 59)}: ${s.label} ${pct(s.share)}`}</title>
                </rect>
              {/each}
            {/each}
          </svg>
        </div>
      {/each}
      <div class="ds-axis" aria-hidden="true">
        <span></span>
        <svg width={W} height="14" viewBox={`0 0 ${W} 14`}>
          {#each [0, 6, 12, 18, 23] as h (h)}<text x={h === 0 ? 0 : h === 23 ? W : h * (col + GAP) + col / 2} y="11" text-anchor={h === 0 ? 'start' : h === 23 ? 'end' : 'middle'}>{String(h).padStart(2, '0')}</text>{/each}
        </svg>
      </div>
    </section>
  {/each}
</div>

<style>
  .ds-legend {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .ds-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }
  .ds {
    display: grid;
    gap: 14px;
    min-width: 0;
    overflow: hidden;
  }
  h3 {
    margin: 0 0 4px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .ds-row,
  .ds-axis {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .ds-row svg,
  .ds-axis svg {
    width: 100%;
    display: block;
  }
  .ds-type {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .ds-axis text {
    font: 12px var(--font-mono);
    fill: var(--text-muted);
  }
</style>
