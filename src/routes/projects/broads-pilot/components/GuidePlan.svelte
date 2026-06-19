<script lang="ts">
  // Renders the LLM-guided day plan: a friendly summary, weather, the ordered
  // stops (each with the engine-computed leg + the "why", clickable activities,
  // and mooring compliance), totals, compliance warnings and tips.
  import { app } from '../lib/appState.svelte';
  import { fmtDist, fmtTime } from '../lib/format';
  import type { Plan } from '../lib/guide-types';

  let { plan, onApply }: { plan: Plan; onApply: () => void } = $props();

  const KIND_ICON: Record<string, string> = { mooring: '⚓', pub: '🍺', walk: '🐾', attraction: '★', shop: '🛒', fishing: '🎣', swim: '🏊', fuel: '⛽' };
  const FACIL_LABEL: Record<string, string> = { water: 'Water', shore_power: 'Shore power', pump_out: 'Pump-out', toilets: 'Toilets', showers: 'Showers', refuse: 'Refuse' };
</script>

<div class="plan">
  <p class="summary">{plan.summary}</p>

  {#if plan.weather}
    <div class="weather">
      🌤 {plan.weather.tempC}°C · {plan.weather.description} · wind {plan.weather.windMph} mph {plan.weather.windDir}{plan.weather.precip > 0 ? ' · rain about' : ''}
    </div>
  {/if}

  {#if plan.warnings.length}
    <div class="warnings">
      {#each plan.warnings as w}<p class="warn">⚠ {w}</p>{/each}
    </div>
  {/if}

  <ol class="stops">
    {#each plan.stops as s, i (s.mooringId)}
      <li class="stop">
        <div class="stop-head">
          <span class="num">{i + 1}</span>
          <div class="stop-title">
            <span class="name">{s.name}</span>
            <span class="tier">{s.tier}</span>
          </div>
          {#if s.leg}
            <span class="leg">{fmtTime(s.leg.time_s)} · {fmtDist(s.leg.distance_m, app.units)} · {s.leg.fuel_l} L</span>
          {/if}
        </div>

        {#if s.leg?.crossesBreydon}<p class="flag tidal">⚓ This leg crosses Breydon Water — time it for slack water (~1 h after low water at Yarmouth).</p>{/if}
        {#if s.leg?.marginalBridges?.length}<p class="flag amber">▲ Tight clearance at {s.leg.marginalBridges.join(', ')} — check the gauge board.</p>{/if}

        <p class="why">{s.why}</p>

        {#if s.activities.length}
          <ul class="acts">
            {#each s.activities as a (a.poiId)}
              <li>
                <button class="act" onclick={() => app.select({ kind: 'poi', id: a.poiId })} title="Open details">
                  <span class="ic">{KIND_ICON[a.kind] ?? '•'}</span>
                  <span class="act-body">
                    <span class="act-name">{a.name}{a.dog ? ' · 🐾' : ''}{a.dist_m != null ? ` · ${fmtDist(a.dist_m, app.units)} walk` : ''}</span>
                    <span class="act-what">{a.what}</span>
                    {#if a.opening_hours}<span class="act-hours">Hours: {a.opening_hours}</span>{/if}
                  </span>
                  <span class="chev">›</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="mooring-info">
          <span class="mi"><strong>{s.mooring.charge}</strong></span>
          {#if s.mooring.shorePower}<span class="mi pill">⚡ Shore power</span>{/if}
          {#each s.mooring.facilities.filter((f) => f !== 'shore_power') as f}<span class="mi pill">{FACIL_LABEL[f] ?? f}</span>{/each}
          {#if s.mooring.capacityCaveat}<span class="mi caveat">small / first-come</span>{/if}
          <span class="mi verified">verified {s.mooring.lastVerified}</span>
        </div>
      </li>
    {/each}
  </ol>

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
  .weather { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-secondary); background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 0.4rem; padding: 0.4rem 0.6rem; }
  .warnings { display: flex; flex-direction: column; gap: 0.3rem; }
  .warn { margin: 0; font-family: var(--font-body); font-size: 0.82rem; line-height: 1.4; color: var(--text-primary); background: color-mix(in srgb, var(--warn) 14%, var(--surface-elevated)); border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent); border-radius: 0.4rem; padding: 0.45rem 0.6rem; }

  .stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .stop { border: 1px solid var(--card-border); border-radius: 0.5rem; padding: 0.7rem; background: var(--card-bg); display: flex; flex-direction: column; gap: 0.4rem; }
  .stop-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-family: var(--font-mono); font-size: 0.72rem; display: grid; place-items: center; }
  .stop-title { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 8rem; }
  .name { font-family: var(--font-body); font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
  .tier { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .leg { font-family: var(--font-mono); font-size: 0.66rem; color: var(--accent); }
  .flag { margin: 0; font-family: var(--font-body); font-size: 0.78rem; line-height: 1.35; padding: 0.35rem 0.5rem; border-radius: 0.35rem; }
  .flag.tidal { background: color-mix(in srgb, var(--warn) 12%, var(--surface-elevated)); color: var(--text-primary); }
  .flag.amber { background: rgba(230, 149, 0, 0.12); color: #8a5a00; }
  .why { margin: 0; font-family: var(--font-body); font-size: 0.86rem; line-height: 1.45; color: var(--text-secondary); }

  .acts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .act { width: 100%; text-align: left; display: flex; align-items: flex-start; gap: 0.5rem; background: var(--surface-elevated); border: 1px solid var(--card-border); border-left: 3px solid var(--accent); border-radius: 0.4rem; padding: 0.45rem 0.55rem; cursor: pointer; }
  .act:hover { border-color: var(--accent); }
  .act .ic { font-size: 1rem; line-height: 1.2; flex: 0 0 auto; }
  .act-body { display: flex; flex-direction: column; gap: 0.1rem; flex: 1 1 auto; }
  .act-name { font-family: var(--font-body); font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
  .act-what { font-family: var(--font-body); font-size: 0.78rem; color: var(--text-secondary); line-height: 1.35; }
  .act-hours { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
  .chev { color: var(--text-muted); font-size: 1.1rem; align-self: center; }

  .mooring-info { display: flex; flex-wrap: wrap; gap: 0.3rem 0.4rem; align-items: center; }
  .mi { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-secondary); }
  .mi.pill { background: var(--bg-section); border-radius: 0.3rem; padding: 0.1rem 0.35rem; }
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

  .apply { background: var(--accent); color: #fff; border: none; border-radius: 0.45rem; padding: 0.7rem; font-family: var(--font-mono); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .apply:hover { background: var(--accent-hover); }
  .disclaimer { margin: 0; font-family: var(--font-body); font-size: 0.68rem; color: var(--text-ghost); line-height: 1.4; }

  /* On the wider web modal, lay the stop cards in two columns so there's much
     less to scroll. Numbers keep the order clear. */
  @media (min-width: 720px) {
    .stops { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; align-items: start; }
    .summary { font-size: 1rem; }
  }
</style>
