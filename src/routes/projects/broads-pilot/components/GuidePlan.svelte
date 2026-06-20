<script lang="ts">
  // Renders the LLM-guided day plan: a friendly summary, weather, the ordered
  // stops (each with the engine-computed leg + the "why", clickable activities,
  // and mooring compliance), totals, compliance warnings and tips.
  import { app } from '../lib/appState.svelte';
  import { fmtDist, fmtTime } from '../lib/format';
  import type { Plan, PlanStop } from '../lib/guide-types';

  let { plan, onApply }: { plan: Plan; onApply: () => void } = $props();

  const isMulti = $derived(!!plan.days && plan.days > 1 && plan.stops.some((s) => s.day));
  const dayList = $derived(isMulti ? [...new Set(plan.stops.map((s) => s.day))].sort((a, b) => a - b) : []);
  const dayStops = (day: number) => plan.stops.filter((s) => s.day === day);
  const dayTotals = (day: number) => {
    const ss = dayStops(day);
    return { t: ss.reduce((a, s) => a + (s.leg?.time_s ?? 0), 0), d: ss.reduce((a, s) => a + (s.leg?.distance_m ?? 0), 0) };
  };

  const FACIL_LABEL: Record<string, string> = { water: 'Water', shore_power: 'Shore power', pump_out: 'Pump-out', toilets: 'Toilets', showers: 'Showers', refuse: 'Refuse' };
</script>

{#snippet kindIcon(kind: string)}
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'mooring'}
      <circle cx="10" cy="4" r="1.6" /><line x1="10" y1="5.6" x2="10" y2="17" /><line x1="6.5" y1="8.5" x2="13.5" y2="8.5" /><path d="M3.5 11.5a6.5 6.5 0 0 0 13 0" />
    {:else if kind === 'pub'}
      <path d="M5 3h7l-.7 8.5a2.5 2.5 0 0 1-5 0z" /><path d="M11.6 5h2.4a2 2 0 0 1 0 4h-2.1" /><line x1="6" y1="17" x2="12" y2="17" /><line x1="8.5" y1="14.5" x2="8.5" y2="17" />
    {:else if kind === 'walk'}
      <circle cx="6" cy="7" r="1.4" /><circle cx="14" cy="7" r="1.4" /><circle cx="3.5" cy="11" r="1.2" /><circle cx="16.5" cy="11" r="1.2" /><path d="M10 10c-2.4 0-4 1.8-4 4 0 1.6 1.4 2.5 4 2.5s4-.9 4-2.5c0-2.2-1.6-4-4-4z" />
    {:else if kind === 'shop'}
      <path d="M4 7h12l-.8 9H4.8z" /><path d="M7 7V5.5a3 3 0 0 1 6 0V7" />
    {:else if kind === 'fishing'}
      <path d="M3 4v8a4 4 0 0 0 4 4" /><path d="M3 4q4 0 4 4" /><circle cx="9" cy="16" r="1" /><line x1="14" y1="6" x2="14" y2="10" /><path d="M11.5 10h5l-2.5 4z" />
    {:else if kind === 'swim'}
      <circle cx="13.5" cy="6" r="1.6" /><path d="M4 8l4 2.5L11 8l3 2.5" /><path d="M3 14c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0" /><path d="M3 17c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0" />
    {:else if kind === 'fuel'}
      <rect x="4.5" y="4" width="7" height="13" rx="1" /><line x1="4.5" y1="8.5" x2="11.5" y2="8.5" /><path d="M11.5 7h2a1.5 1.5 0 0 1 1.5 1.5V13a1.3 1.3 0 0 0 2.6 0V8l-1.6-2" />
    {:else}
      <path d="M10 2.5l1.9 4.4 4.8.4-3.6 3.1 1.1 4.6L10 13l-4.2 2.6 1.1-4.6L3.3 7.3l4.8-.4z" />
    {/if}
  </svg>
{/snippet}

<div class="plan">
  <p class="summary">{plan.summary}</p>

  {#if plan.weather}
    <div class="weather">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="2.6" /><path d="M7 2.5v1.4M7 10.1v1.4M2.5 7h1.4M10.1 7h1.4M3.8 3.8l1 1M9.2 9.2l1 1M10.2 3.8l-1 1M4.8 9.2l-1 1" /><path d="M9 12.5a3 3 0 0 1 5.7.8 2.4 2.4 0 0 1-.2 4.7H8a2.6 2.6 0 0 1-.5-5.2" /></svg>
      {plan.weather.tempC}°C · {plan.weather.description} · wind {plan.weather.windMph} mph {plan.weather.windDir}{plan.weather.precip > 0 ? ' · rain about' : ''}
    </div>
  {/if}

  {#if plan.warnings.length}
    <div class="warnings">
      {#each plan.warnings as w}<p class="warn">⚠ {w}</p>{/each}
    </div>
  {/if}

  {#snippet stopItem(s: PlanStop, badge: string)}
    <li class="stop">
      <div class="stop-head">
        <span class="num" class:home={s.isReturn}>{#if s.isReturn}<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="2.5" x2="5" y2="17.5" /><path d="M5 3.5h9l-2 2.5 2 2.5H5" /></svg>{:else}{badge}{/if}</span>
        <div class="stop-title">
          <span class="name">{s.name}</span>
          <span class="tier">{s.tier}</span>
        </div>
        {#if s.leg}
          <span class="leg">{fmtTime(s.leg.time_s)} · {fmtDist(s.leg.distance_m, app.units)} · {s.leg.fuel_l} L</span>
        {/if}
      </div>

      {#if s.leg?.crossesBreydon}<p class="flag tidal"><svg class="flag-ic" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="4" r="1.6" /><line x1="10" y1="5.6" x2="10" y2="17" /><line x1="6.5" y1="8.5" x2="13.5" y2="8.5" /><path d="M3.5 11.5a6.5 6.5 0 0 0 13 0" /></svg> This leg crosses Breydon Water — time it for slack water (~1 h after low water at Yarmouth).</p>{/if}
      {#if s.leg?.marginalBridges?.length}<p class="flag amber">▲ Tight clearance at {s.leg.marginalBridges.join(', ')} — check the gauge board.</p>{/if}

      <p class="why">{s.why}</p>

      {#if s.activities.length}
        <ul class="acts">
          {#each s.activities as a (a.poiId)}
            <li>
              <button class="act" onclick={() => app.select({ kind: 'poi', id: a.poiId })} title="Open details">
                <span class="ic">{@render kindIcon(a.kind)}</span>
                <span class="act-body">
                  <span class="act-name">{a.name}{a.dog ? ' · dog-friendly' : ''}{a.kind === 'walk' && a.length_mi ? ` · ${a.length_mi} mi route` : ''}{a.dist_m != null ? ` · ${fmtDist(a.dist_m, app.units)} away` : ''}</span>
                  <span class="act-what">{a.what}</span>
                  {#if a.opening_hours}<span class="act-hours">Hours: {a.opening_hours}</span>{/if}
                </span>
                <span class="chev">›</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if !s.isReturn}
        <div class="mooring-info">
          <span class="mi"><strong>{s.mooring.charge}</strong></span>
          {#if s.mooring.shorePower}<span class="mi pill"><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5 4.5 11h5L9 17.5 15.5 9h-5z" /></svg> Shore power</span>{/if}
          {#each s.mooring.facilities.filter((f) => f !== 'shore_power') as f}<span class="mi pill">{FACIL_LABEL[f] ?? f}</span>{/each}
          {#if s.mooring.capacityCaveat}<span class="mi caveat">small / first-come</span>{/if}
          <span class="mi verified">verified {s.mooring.lastVerified}</span>
        </div>
      {/if}
    </li>
  {/snippet}

  {#if isMulti}
    {#each dayList as day (day)}
      <div class="day-group">
        <div class="day-head">
          <span class="day-label">Day {day}{day === plan.days ? ' · home' : ''}</span>
          {#if dayTotals(day).t}<span class="day-meta">{fmtTime(dayTotals(day).t)} · {fmtDist(dayTotals(day).d, app.units)}</span>{/if}
        </div>
        <ol class="stops">
          {#each dayStops(day) as s (s.mooringId)}{@render stopItem(s, String(day))}{/each}
        </ol>
      </div>
    {/each}
  {:else}
    <ol class="stops">
      {#each plan.stops as s, i (s.mooringId)}{@render stopItem(s, String(i + 1))}{/each}
    </ol>
  {/if}

  <div class="totals">
    <span><span class="tl">Total cruising</span><strong>{fmtTime(plan.totals.time_s)}</strong></span>
    <span><span class="tl">Distance</span><strong>{fmtDist(plan.totals.distance_m, app.units)}</strong></span>
    <span><span class="tl">Fuel</span><strong>{plan.totals.fuel_l} L</strong></span>
  </div>

  {#if plan.tips.length}
    <div class="tips">
      <span class="tips-label">Skipper's tips</span>
      <ul>{#each plan.tips as t}<li>{t}</li>{/each}</ul>
    </div>
  {/if}

  <button class="apply" onclick={onApply}>Put this trip on the map →</button>
  <p class="disclaimer">Plan checked against your boat's clearances and the moorings; weather is live, tides are advisory. Always check on-site notices and gauge boards.</p>
</div>

<style>
  .plan { display: flex; flex-direction: column; gap: 0.7rem; }
  .summary { margin: 0; font-family: var(--font-body); font-size: 0.95rem; line-height: 1.5; color: var(--text-primary); }
  .weather { display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-secondary); background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.4rem 0.6rem; }
  .warnings { display: flex; flex-direction: column; gap: 0.3rem; }
  .warn { margin: 0; font-family: var(--font-body); font-size: 0.82rem; line-height: 1.4; color: var(--text-primary); background: color-mix(in srgb, var(--warn) 14%, var(--surface-elevated)); border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); border-radius: var(--radius-round); padding: 0.45rem 0.6rem; }

  .stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .day-group { display: flex; flex-direction: column; gap: 0.4rem; }
  .day-group + .day-group { margin-top: 0.6rem; }
  .day-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; border-bottom: 1.5px solid var(--accent); padding-bottom: 0.2rem; }
  .day-label { font-family: var(--font-display); text-transform: uppercase; font-size: 0.82rem; letter-spacing: 0.03em; color: var(--accent); }
  .day-meta { font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted); }
  .num.home { background: var(--text-primary); }
  .stop { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.7rem; background: var(--card-bg); display: flex; flex-direction: column; gap: 0.4rem; }
  .stop-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: var(--radius-pill); background: var(--accent); color: #fff; font-family: var(--font-mono); font-size: 0.72rem; display: grid; place-items: center; }
  .stop-title { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 8rem; }
  .name { font-family: var(--font-body); font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
  .tier { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .leg { font-family: var(--font-mono); font-size: 0.66rem; color: var(--accent); }
  .flag { margin: 0; font-family: var(--font-body); font-size: 0.78rem; line-height: 1.35; padding: 0.35rem 0.5rem; border-radius: var(--radius-round); }
  .flag .flag-ic { vertical-align: -2px; }
  .flag.tidal { background: color-mix(in srgb, var(--warn) 12%, var(--surface-elevated)); color: var(--text-primary); }
  .flag.amber { background: color-mix(in srgb, var(--warn) 12%, var(--surface-elevated)); color: var(--trend-down); }
  .why { margin: 0; font-family: var(--font-body); font-size: 0.86rem; line-height: 1.45; color: var(--text-secondary); }

  .acts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .act { width: 100%; text-align: left; display: flex; align-items: flex-start; gap: 0.5rem; background: var(--surface-elevated); border: 1px solid var(--card-border); border-left: 3px solid var(--accent); border-radius: var(--radius-round); padding: 0.45rem 0.55rem; cursor: pointer; }
  .act:hover { border-color: var(--accent); }
  .act .ic { display: inline-flex; line-height: 1.2; flex: 0 0 auto; color: var(--accent); margin-top: 1px; }
  .act-body { display: flex; flex-direction: column; gap: 0.1rem; flex: 1 1 auto; }
  .act-name { font-family: var(--font-body); font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
  .act-what { font-family: var(--font-body); font-size: 0.78rem; color: var(--text-secondary); line-height: 1.35; }
  .act-hours { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
  .chev { color: var(--text-muted); font-size: 1.1rem; align-self: center; }

  .mooring-info { display: flex; flex-wrap: wrap; gap: 0.3rem 0.4rem; align-items: center; }
  .mi { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-secondary); }
  .mi.pill { display: inline-flex; align-items: center; gap: 0.2rem; background: var(--bg-section); border-radius: var(--radius-sharp); padding: 0.1rem 0.35rem; }
  .mi.caveat { color: var(--warn); }
  .mi.verified { color: var(--text-ghost); margin-left: auto; }

  .totals { display: flex; gap: 1rem; flex-wrap: wrap; padding: 0.6rem 0; border-top: 1px solid var(--card-border); }
  .totals span { display: flex; flex-direction: column; }
  .tl { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .totals strong { font-family: var(--font-mono); font-size: 1rem; color: var(--text-primary); }

  .tips { display: flex; flex-direction: column; gap: 0.25rem; }
  .tips-label { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent); }
  .tips ul { margin: 0; padding-left: 1.1rem; }
  .tips li { font-family: var(--font-body); font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4; }

  .apply { background: var(--accent); color: #fff; border: none; border-radius: var(--radius-round); padding: 0.7rem; font-family: var(--font-mono); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .apply:hover { background: var(--accent-hover); }
  .disclaimer { margin: 0; font-family: var(--font-body); font-size: 0.68rem; color: var(--text-ghost); line-height: 1.4; }

  /* On the wider web modal, lay the stop cards in two columns so there's much
     less to scroll. Numbers keep the order clear. */
  @media (min-width: 720px) {
    .stops { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; align-items: start; }
    .summary { font-size: 1rem; }
  }
</style>
