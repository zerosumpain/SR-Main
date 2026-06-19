<script lang="ts">
  import { onMount } from 'svelte';
  let built = $state<string | null>(null);
  onMount(async () => {
    try {
      const r = await fetch('/broads-pilot/meta.json');
      if (r.ok) built = (await r.json()).built_at;
    } catch { /* offline — ignore */ }
  });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
</script>

<svelte:head><title>Broads Pilot — Method & Sources</title></svelte:head>

<div class="bp-doc">
  <div class="bp-doc-inner">
    <p class="bp-kicker">Method &amp; Sources</p>
    <h1>How Broads Pilot works</h1>

    <div class="bp-disclaimer">
      <strong>⚠ A planning aid only — not for navigation.</strong>
      Bridge clearances here are at <em>average high water</em> and change with the tide; figures are
      advisory and can differ from reality by tens of centimetres. Always check the on-site gauge
      boards, take a bridge pilot where one is required, and follow Broads Authority notices and your
      hire operator's guidance. Never rely on this tool for a go/no-go decision at a bridge.
    </div>

    <h2>Routing</h2>
    <p>
      The river network is built from <strong>OpenStreetMap</strong> — every navigable reach of the
      Bure, Ant, Thurne, Yare, Wensum, Chet and Waveney, plus the open broads — assembled into a
      single connected graph of ~440 segments. Routes are computed with a shortest-time search that
      follows the actual water, never straight lines, and obeys the river <strong>speed limits</strong>
      (3–6 mph). Times use a small efficiency allowance; they're realistic estimates, not promises.
    </p>
    <p>
      Speed limits are applied at a <em>representative per-reach</em> level from the Broads Authority's
      1992 byelaws rather than metre-by-metre, so a leg's time can vary slightly from the signs on the
      bank.
    </p>

    <h2>Bridges, the lock &amp; your boat</h2>
    <p>
      Each bridge carries its Broads Authority clearance as a <strong>band</strong> (sources disagree
      by a few centimetres, so we keep both figures). For the boat you pick, every bridge is classified
      <span class="v pass">pass</span>, <span class="v marginal">marginal</span> or
      <span class="v blocked">blocked</span> — using a <strong>0.3 m (1 ft) safety margin</strong>. The
      planner <strong>never auto-clears a marginal bridge</strong> and never routes a boat under a
      bridge it can't fit. <strong>Potter Heigham</strong> old bridge is treated as practically closed
      for standard cruisers (it needs a pilot and almost nothing gets through);
      <strong>Wroxham</strong> needs a mandatory pilot for hire craft. The only lock,
      <strong>Mutford</strong> at Oulton Broad, gates the way to the sea and must be booked.
    </p>

    <h2>Breydon Water &amp; daylight</h2>
    <p>
      The Northern and Southern Broads meet only at Great Yarmouth, across tidal
      <strong>Breydon Water</strong> — cross at slack water, about an hour after low water, so the
      current is weakest and the low Yarmouth bridges give most clearance. Hire boats may not navigate
      before sunrise or after sunset, so the planner budgets each day against the actual daylight for
      the date and flags trips that won't fit.
    </p>

    <h2>Boats &amp; fuel</h2>
    <p>
      Boat air drafts (canopy down) and the operator's "cannot pass" notes are the load-bearing facts
      and come from Richardsons. Hire operators don't publish fuel type, tank size or economy, so
      fuel and range here are <strong>estimates</strong> from a displacement-hull model
      (≈0.5–1.7 L/hr at 3–6 mph) — useful for budgeting and refuel planning, not exact. Diesel range
      comfortably exceeds a week's cruising, so fuel is shown as a cost, not a limit. The fleet shown
      is a representative selection, not the full 200+ hire fleet.
    </p>

    <h2>Moorings, pubs &amp; walks</h2>
    <p>
      Moorings combine OpenStreetMap with the Broads Authority's visitor moorings and yacht stations;
      charges are 2025-season figures and <strong>change every year</strong>, so each carries a
      "verified" year. Free staithes are small and first-come. Shore-power moorings are highlighted —
      running an engine to charge at a mooring is a byelaw offence. Pubs, dog-friendly walks and
      attractions come from OpenStreetMap plus a curated list, matched to moorings within walking
      distance.
    </p>

    <h2>Ratings</h2>
    <p>
      Ratings link out to TripAdvisor and Google. Where a Google Places key is configured, a numeric
      rating and a representative review highlight/lowlight are shown (cached, per Google's terms). We
      never scrape or store TripAdvisor reviews.
    </p>

    <h2>Known limitations</h2>
    <ul>
      <li>The lower Waveney below Haddiscoe (St Olaves → Burgh Castle) isn't fully in the map data, so routes there use the Haddiscoe New Cut instead.</li>
      <li>Speed limits are representative per reach, not the exact byelaw boundaries.</li>
      <li>Tide times for Breydon are advisory guidance, not a live feed; offline use shows cached map tiles only.</li>
      <li>The waterway graph slightly overshoots into non-navigable upper reaches; there are no moorings there, so routes don't use them.</li>
    </ul>

    <h2>Data &amp; credits</h2>
    <p class="bp-credits">
      Map data © OpenStreetMap contributors (ODbL). Navigation facts © Broads Authority. Boat
      specifications © Richardsons Boating Holidays. Built autonomously for Strange Ramblings.
      <br />Data last refreshed: <strong>{fmt(built)}</strong>.
    </p>

    <p><a class="bp-back" href="/projects/broads-pilot">← Back to the planner</a></p>
  </div>
</div>

<style>
  .bp-doc { position: absolute; inset: 0; overflow-y: auto; background: var(--bg); }
  .bp-doc-inner { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .bp-kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.62rem; color: var(--accent); margin-bottom: 0.4rem; }
  h1 { font-family: var(--font-display); text-transform: uppercase; font-size: 1.6rem; color: var(--text-primary); margin: 0 0 1rem; letter-spacing: 0.01em; }
  h2 { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.78rem; color: var(--accent); margin: 1.8rem 0 0.5rem; }
  p, li { font-family: var(--font-body); color: var(--text-secondary); line-height: 1.6; font-size: 0.94rem; }
  ul { padding-left: 1.1rem; }
  li { margin: 0.3rem 0; }
  strong { color: var(--text-primary); }
  .bp-disclaimer { background: rgba(230, 149, 0, 0.12); border: 1px solid rgba(230, 149, 0, 0.4); border-radius: 0.5rem; padding: 0.9rem 1rem; font-family: var(--font-body); color: var(--text-secondary); line-height: 1.55; font-size: 0.9rem; margin: 1rem 0 0.5rem; }
  .bp-disclaimer strong { color: var(--text-primary); }
  .v { font-family: var(--font-mono); font-size: 0.78rem; padding: 0.05rem 0.35rem; border-radius: 0.25rem; }
  .v.pass { color: #2e7d32; background: rgba(46, 125, 50, 0.12); }
  .v.marginal { color: #b06a00; background: rgba(230, 149, 0, 0.15); }
  .v.blocked { color: #c62828; background: rgba(198, 40, 40, 0.12); }
  .bp-credits { font-size: 0.82rem; color: var(--text-muted); }
  .bp-back { font-family: var(--font-mono); color: var(--accent); text-decoration: none; font-size: 0.85rem; }
</style>
