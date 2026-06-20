<script lang="ts">
  // Tide times for the planner date — the low-water windows that govern when you
  // can pass the low tide-dependent bridges. Real Gorleston (Great Yarmouth)
  // predictions + each bridge's average offset; projects approximate windows
  // beyond the baked dates. Drives (and is driven by) app.date.
  import { app } from '../lib/appState.svelte';
  import {
    hasTideData,
    gorlestonExtremesOnDay,
    hasRealDataForDay,
    bridgeTideWindows,
    breydonCrossings,
    fmtTideTime,
  } from '../lib/tide';
  import type { Bridge } from '../lib/types';

  const tides = $derived(app.data?.tides ?? null);
  const day = $derived(app.date);

  const dayInput = $derived(day.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })); // YYYY-MM-DD
  const dayLabel = $derived(
    day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }),
  );
  const isToday = $derived(dayInput === new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
  const real = $derived(hasRealDataForDay(tides, day));

  function setDate(s: string) {
    if (s) app.date = new Date(`${s}T12:00:00`);
  }
  function shift(days: number) {
    app.date = new Date(app.date.getTime() + days * 86_400_000);
  }
  function today() {
    app.date = new Date();
  }

  // Gorleston extremes for the day (real predictions only).
  const gorleston = $derived(gorlestonExtremesOnDay(tides, day));

  // Tide-dependent bridges with a known offset, most headroom-critical first.
  const tideBridges = $derived.by(() => {
    const bridges: Bridge[] = app.data?.restrictions.bridges ?? [];
    return bridges
      .filter((b) => b.tide_dependent && b.tide_offset_min != null)
      .sort((a, b) => a.clearance_band_m[0] - b.clearance_band_m[0])
      .map((b) => ({ bridge: b, lows: bridgeTideWindows(tides, b, day) }))
      .filter((r) => r.lows.length > 0);
  });

  const breydon = $derived(breydonCrossings(tides, day));
  const shortName = (n: string) => n.replace(/\s*\([^)]*\)/, '').replace(/\s+Bridge$/i, '').trim();
</script>

{#if hasTideData(tides)}
  <section class="tide" aria-label="Tide times">
    <div class="tide-head">
      <span class="sec-label sec-label-accent">Tides — best time to pass</span>
      <div class="date-ctl">
        <button class="step" onclick={() => shift(-1)} aria-label="Previous day">‹</button>
        <label class="date-wrap">
          <span class="vh">Plan date</span>
          <input type="date" value={dayInput} onchange={(e) => setDate(e.currentTarget.value)} />
          <span class="date-lbl">{dayLabel}</span>
        </label>
        <button class="step" onclick={() => shift(1)} aria-label="Next day">›</button>
        {#if !isToday}<button class="today" onclick={today}>Today</button>{/if}
      </div>
    </div>

    {#if real && gorleston.length}
      <p class="gorleston">
        <span class="g-label">Gorleston</span>
        {#each gorleston as e (e.at.getTime())}
          <span class="g-ev g-{e.type}">
            {e.type === 'low' ? 'LW' : 'HW'} {fmtTideTime(e.at)}{#if e.h != null}<span class="g-h">{e.h.toFixed(1)}m</span>{/if}
          </span>
        {/each}
      </p>
    {:else}
      <p class="approx-note">
        No published table for {dayLabel} — showing <strong>approximate</strong> low-water
        windows projected from the nearest spring/neap cycle. Check a current Gorleston tide
        table before you rely on these.
      </p>
    {/if}

    <ul class="bridges">
      {#each tideBridges as { bridge, lows } (bridge.id)}
        <li class="b-row">
          <span class="b-name">{shortName(bridge.name)}</span>
          <span class="b-times">
            {#each lows as l (l.at.getTime())}
              <span class="b-t" class:approx={l.approx}>{fmtTideTime(l.at)}</span>
            {/each}
          </span>
        </li>
      {/each}
    </ul>

    {#if breydon.length}
      <p class="breydon">
        <span class="g-label">Breydon crossing</span>
        <span class="b-sub">slack water</span>
        {#each breydon as w (w.mid.getTime())}
          <span class="b-t" class:approx={w.approx}>{fmtTideTime(w.mid)}</span>
        {/each}
      </p>
    {/if}

    <p class="foot">
      Low water = maximum headroom. Pass the low bridges within ~1 h of the times shown
      (pilots at Potter Heigham &amp; Wroxham time it for you). Advisory — heights are at
      average high water; read the on-site gauge board. Source: Peel Ports Gorleston 2026.
    </p>
  </section>
{/if}

<style>
  .tide {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.9rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    font-family: var(--font-body);
    color: var(--text-primary);
  }
  .tide-head { display: flex; flex-direction: column; gap: 0.5rem; }
  .sec-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .sec-label-accent { color: var(--accent); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

  .date-ctl { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .step {
    width: 30px; height: 32px;
    display: grid; place-items: center;
    font-family: var(--font-mono); font-size: 1.1rem; line-height: 1;
    background: var(--surface-elevated); border: 1px solid var(--card-border);
    border-radius: var(--radius-round); color: var(--accent); cursor: pointer;
  }
  .step:hover { border-color: var(--text-muted); }
  .date-wrap { position: relative; display: inline-flex; align-items: center; gap: 0.4rem; }
  .date-wrap input[type='date'] {
    font-family: var(--font-mono); font-size: 0.78rem;
    padding: 0.35rem 0.5rem;
    background: var(--surface-elevated); border: 1px solid var(--card-border);
    border-radius: var(--radius-round); color: var(--text-primary);
    color-scheme: dark;
  }
  .date-lbl {
    font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600;
    color: var(--text-secondary); white-space: nowrap;
  }
  .today {
    font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0.3rem 0.55rem; background: transparent; border: 1px solid var(--card-border);
    border-radius: var(--radius-round); color: var(--text-secondary); cursor: pointer;
  }
  .today:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .gorleston, .breydon {
    margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.55rem;
    font-family: var(--font-mono); font-size: 0.78rem;
    padding-bottom: 0.55rem; border-bottom: 1px solid var(--card-border);
  }
  .g-label {
    font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted);
  }
  .b-sub { font-size: 0.6rem; color: var(--text-ghost); }
  .g-ev { display: inline-flex; align-items: baseline; gap: 0.2rem; font-weight: 600; }
  .g-low { color: var(--accent); }
  .g-high { color: var(--text-secondary); }
  .g-h { font-size: 0.62rem; font-weight: 400; color: var(--text-muted); }

  .bridges { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .b-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; }
  .b-name { font-family: var(--font-body); font-size: 0.86rem; color: var(--text-primary); }
  .b-times { display: inline-flex; gap: 0.4rem; flex-wrap: wrap; justify-content: flex-end; }
  .b-t {
    font-family: var(--font-mono); font-size: 0.84rem; font-weight: 700; color: var(--accent);
  }
  .breydon .b-t { color: var(--warn); }
  .b-t.approx { color: var(--text-muted); font-weight: 600; }
  .b-t.approx::after { content: '~'; font-size: 0.7em; vertical-align: super; }

  .approx-note, .foot {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    line-height: 1.45;
    color: var(--text-muted);
  }
  .approx-note {
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-round);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, var(--surface-elevated));
    color: var(--text-secondary);
  }
</style>
