<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { bridgeVerdict } from '$lib/broads-pilot/passability';
  import { fmtClearance, mToFtIn } from '../lib/format';
  import type { Boat, Bridge, Verdict } from '$lib/broads-pilot/types';

  // Class grouping for the <select>: recommended/generic first, then the fleets.
  const GROUPS: { key: Boat['class']; label: string }[] = [
    { key: 'generic', label: 'Recommended (typical hire boat)' },
    { key: 'modern', label: 'Modern cruisers' },
    { key: 'classic', label: 'Classic / wooden' },
    { key: 'dayboat', label: 'Day boats' },
  ];

  const grouped = $derived.by(() => {
    const fleet = app.data?.fleet ?? [];
    return GROUPS.map((g) => ({
      ...g,
      boats: fleet.filter((b) => b.class === g.key),
    })).filter((g) => g.boats.length > 0);
  });

  // Pass-matrix: classify every bridge, blocked-first so hazards lead.
  const VERDICT_COLOR: Record<Verdict, string> = {
    pass: 'var(--success)',
    marginal: 'var(--warn)',
    blocked: 'var(--error)',
  };
  const VERDICT_LABEL: Record<Verdict, string> = {
    pass: 'Pass',
    marginal: 'Tight',
    blocked: 'No',
  };
  const RANK: Record<Verdict, number> = { blocked: 0, marginal: 1, pass: 2 };

  // Short, scannable bridge name (drop the trailing "Bridge").
  const shortName = (n: string) => n.replace(/\s+Bridge$/i, '').trim();

  const matrix = $derived.by(() => {
    const boat = app.boat;
    const bridges: Bridge[] = app.data?.restrictions.bridges ?? [];
    if (!boat) return [];
    return bridges
      .map((b) => ({ bridge: b, verdict: bridgeVerdict(b, boat) }))
      .sort(
        (a, c) =>
          RANK[a.verdict] - RANK[c.verdict] ||
          a.bridge.name.localeCompare(c.bridge.name),
      );
  });

  const counts = $derived.by(() => {
    const acc = { pass: 0, marginal: 0, blocked: 0 } as Record<Verdict, number>;
    for (const m of matrix) acc[m.verdict]++;
    return acc;
  });

  function onSelect(e: Event & { currentTarget: HTMLSelectElement }) {
    app.selectBoat(e.currentTarget.value);
  }
</script>

<section class="bp-boat">
  <div class="sec-label">Your boat</div>

  <label class="select-wrap" for="bp-boat-select">
    <span class="vh">Select boat</span>
    <select
      id="bp-boat-select"
      value={app.boat?.slug ?? ''}
      onchange={onSelect}
    >
      {#if !app.boat}
        <option value="" disabled>Choose a boat…</option>
      {/if}
      {#each grouped as g (g.key)}
        <optgroup label={g.label}>
          {#each g.boats as b (b.slug)}
            <option value={b.slug}>{b.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    <span class="chev" aria-hidden="true">▾</span>
  </label>

  {#if app.boat}
    {@const boat = app.boat}
    <div class="spec-card">
      <div class="spec-head">
        <span class="spec-name">{boat.name}</span>
        <span class="prop prop-{boat.propulsion}">{boat.propulsion}</span>
      </div>
      <dl class="specs">
        <div class="spec spec-key">
          <dt>Air draft</dt>
          <dd>{fmtClearance(boat.air_draft_m, app.units)}</dd>
        </div>
        <div class="spec">
          <dt>Beam</dt>
          <dd>{boat.beam_m != null ? mToFtIn(boat.beam_m) : '—'}</dd>
        </div>
        <div class="spec">
          <dt>Length</dt>
          <dd>
            {#if boat.length_ft != null}{boat.length_ft}&nbsp;ft{:else}—{/if}
          </dd>
        </div>
        <div class="spec">
          <dt>Sleeps</dt>
          <dd>{boat.sleeps}</dd>
        </div>
        <div class="spec">
          <dt>Draft</dt>
          <dd class:est={boat.water_draft_m == null}>
            {#if boat.water_draft_m != null}
              {mToFtIn(boat.water_draft_m)}
            {:else}<span class="dash">—</span>{/if}
          </dd>
        </div>
        <div class="spec">
          <dt>Fuel tank</dt>
          <dd class:est={boat.fuel_tank_l == null}>
            {#if boat.fuel_tank_l != null}
              {boat.fuel_tank_l}&nbsp;L
            {:else}<span class="dash">—</span>{/if}
          </dd>
        </div>
      </dl>
      {#if boat.water_draft_m == null || boat.fuel_tank_l == null}
        <p class="est-note">— = not published; planner uses class estimates.</p>
      {/if}
    </div>

    <!-- Bridge pass-matrix — the safety centrepiece. -->
    <div class="matrix">
      <div class="matrix-head">
        <span class="sec-label sec-label-accent">Bridge clearances</span>
        <span class="tally">
          {#if counts.blocked}<b style="color:{VERDICT_COLOR.blocked}">{counts.blocked} no</b>{/if}
          {#if counts.marginal}<b style="color:{VERDICT_COLOR.marginal}">{counts.marginal} tight</b>{/if}
          {#if counts.pass}<b style="color:{VERDICT_COLOR.pass}">{counts.pass} ok</b>{/if}
        </span>
      </div>
      <ul class="chips">
        {#each matrix as m (m.bridge.id)}
          <li
            class="chip chip-{m.verdict}"
            style="--vc:{VERDICT_COLOR[m.verdict]}"
            title={`${m.bridge.name} — ${m.bridge.clearance_ahw_m.toFixed(2)} m AHW · ${VERDICT_LABEL[m.verdict]}`}
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="chip-name">{shortName(m.bridge.name)}</span>
            <span class="chip-v">{VERDICT_LABEL[m.verdict]}</span>
          </li>
        {/each}
      </ul>
      <p class="legend">
        <span class="lg"><i style="background:{VERDICT_COLOR.pass}"></i> Pass</span>
        <span class="lg"><i style="background:{VERDICT_COLOR.marginal}"></i> Tight — pilot/low tide</span>
        <span class="lg"><i style="background:{VERDICT_COLOR.blocked}"></i> Won't fit</span>
      </p>
    </div>
  {/if}
</section>

<style>
  .bp-boat {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.9rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    font-family: var(--font-body);
    color: var(--text-primary);
  }

  .sec-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .sec-label-accent {
    color: var(--accent);
  }

  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  /* ---- select ---- */
  .select-wrap {
    position: relative;
    display: block;
  }
  select {
    width: 100%;
    min-height: 2.6rem;
    padding: 0.55rem 2rem 0.55rem 0.7rem;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    appearance: none;
    cursor: pointer;
  }
  select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .chev {
    position: absolute;
    right: 0.7rem;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--accent);
    font-size: 0.8rem;
  }

  /* ---- spec card ---- */
  .spec-card {
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 0.7rem;
  }
  .spec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
  }
  .spec-name {
    font-family: var(--font-display);
    font-size: 0.8rem;
    text-transform: uppercase;
    line-height: 1.15;
    color: var(--text-primary);
  }
  .prop {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.18rem 0.4rem;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
  }
  .prop-electric {
    color: var(--success);
    border-color: var(--success);
  }
  .prop-diesel {
    color: var(--text-secondary);
  }

  .specs {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.4rem 0.7rem;
    margin: 0;
  }
  .spec {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.25rem 0;
  }
  .spec-key {
    grid-column: 1 / -1;
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 0.45rem;
    margin-bottom: 0.1rem;
  }
  .spec dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .spec dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .spec-key dd {
    font-size: 1rem;
    color: var(--accent);
  }
  .est .dash {
    color: var(--text-ghost);
  }
  .est-note {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.35;
  }

  /* ---- pass-matrix ---- */
  .matrix-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }
  .tally {
    display: flex;
    gap: 0.55rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.05rem;
    padding: 0.3rem 0.55rem;
    border-radius: var(--radius-sharp);
    background: var(--surface-elevated);
    border: 1px solid var(--vc);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .chip-blocked {
    background: color-mix(in srgb, var(--vc) 12%, var(--surface-elevated));
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: var(--radius-pill);
    background: var(--vc);
    flex: 0 0 auto;
  }
  .chip-name {
    font-weight: 600;
    white-space: nowrap;
  }
  .chip-v {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vc);
    font-weight: 700;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.8rem;
    margin: 0.55rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .lg i {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: var(--radius-pill);
    display: inline-block;
  }
</style>
