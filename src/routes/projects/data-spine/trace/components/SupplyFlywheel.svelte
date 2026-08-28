<script lang="ts">
  // SupplyFlywheel — why the market joins, and what it costs.
  //
  // Two moves. (1) A tier stepper: walk up from the three major MIS suppliers to
  // cross-sector federation and watch coverage and answerable questions accumulate.
  // (2) A running flywheel: the six-step loop that turns one certified integration into
  // a market that wants to be in the network. Then the bargain, and the risks — because
  // an accreditation worth having is a power worth scrutinising.
  import { onMount } from 'svelte';
  import {
    TIERS, LOOP, GIVE_GET, NETWORK_RISKS, TOP3_COVERAGE, SUPPLIER_COUNT,
    type Depth,
  } from '../lib/trace';
  import ConfidenceBadge from '../../components/ConfidenceBadge.svelte';

  let { depth = 'official' as Depth }: { depth?: Depth } = $props();

  let tier = $state(0);
  let spinCount = $state(0);
  let spinning = $state(true);
  let openRisk = $state<number | null>(0);
  const eli = $derived(depth === 'eli5');

  // plain lets — never $state (svelte5-pitfalls §1)
  let spinHandle: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    spinHandle = setInterval(() => { if (spinning) spinCount += 1; }, 1400);
    return () => clearInterval(spinHandle);
  });

  const active = $derived(TIERS[tier]);
  const onTiers = $derived(TIERS.slice(0, tier + 1));
  const unlockedCount = $derived(onTiers.reduce((a, t) => a + t.unlocks.length, 0));
  const totalUnlocks = TIERS.reduce((a, t) => a + t.unlocks.length, 0);
  const loopIdx = $derived(spinCount % LOOP.length);

  // ---- flywheel geometry --------------------------------------------------
  const CX = 168, CY = 168, R = 116;
  const nodeAt = (i: number) => {
    const a = (-90 + i * (360 / LOOP.length)) * (Math.PI / 180);
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  };
</script>

<div class="fw">
  <!-- ============ THE TIER STEPPER ============ -->
  <div class="tiers">
    <div class="t-head">
      <span class="t-lab">WHO IS ON THE NETWORK</span>
      <div class="t-steps">
        {#each TIERS as t, i}
          <button class="ts" class:on={i === tier} class:done={i < tier} onclick={() => (tier = i)}
            title={t.name}>
            <span class="ts-no">{t.no}</span>
            <span class="ts-nm">{t.name}</span>
          </button>
          {#if i < TIERS.length - 1}<span class="ts-arrow" class:lit={i < tier} aria-hidden="true">→</span>{/if}
        {/each}
      </div>
    </div>

    {#if eli}
      <div class="tbl-wrap">
        <table class="e-tbl">
          <thead>
            <tr><th class="c-n">Who joins</th><th>What they give</th><th>What they get</th><th class="c-u">What it lets you finally ask</th></tr>
          </thead>
          <tbody>
            {#each TIERS as t, i}
              <tr class:on={i === tier}>
                <th class="c-n"><button onclick={() => (tier = i)}>{t.no}. {t.name}</button><span class="cov">{t.coverage}% of schools</span></th>
                <td>{t.eli5Gives}</td>
                <td>{t.eli5Gets}</td>
                <td class="c-u">{t.eli5Unlock}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="e-note">
        Read it downwards. Each row only becomes possible because the row above it happened — and each row
        makes the network worth more to whoever is deciding about the next one. That is the whole argument
        for going in this order.
      </p>
    {:else}
    <div class="t-body">
      <div class="t-meta">
        <span class="t-who">{active.who}</span>
        <h4>{active.name}</h4>

        <div class="meters">
          <div class="meter">
            <div class="m-top"><span>SCHOOLS REACHABLE</span><b>{active.coverage}%</b></div>
            <div class="m-track"><div class="m-fill" style="width:{active.coverage}%"></div></div>
          </div>
          <div class="meter">
            <div class="m-top"><span>QUESTION CLASSES UNLOCKED</span><b>{unlockedCount}</b></div>
            <div class="m-track"><div class="m-fill q" style="width:{(unlockedCount / totalUnlocks) * 100}%"></div></div>
          </div>
        </div>

        <div class="gg">
          <div class="gg-c give"><span class="gg-l">They give</span><p>{active.gives}</p></div>
          <div class="gg-c get"><span class="gg-l">They get</span><p>{active.gets}</p></div>
        </div>

        <div class="hard">
          <span class="hard-l">△ The hard part</span>
          <p>{active.hardPart}</p>
          <ConfidenceBadge level={active.confidence} small />
        </div>
      </div>

      <div class="t-unlocks">
        <span class="u-lab">WHAT BECOMES ANSWERABLE</span>
        {#each onTiers as t, ti}
          <div class="u-group" class:current={ti === tier}>
            <span class="u-tier">{t.no} · {t.name}</span>
            <ul>
              {#each t.unlocks as u, ui}
                <li style="animation-delay:{ti === tier ? ui * 90 : 0}ms">{u}</li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>
    {/if}
  </div>

  <!-- ============ THE FLYWHEEL ============ -->
  <div class="loop">
    <div class="loop-viz">
      <svg viewBox="0 0 336 336" role="img" aria-label="A six-step loop: publish one spec, implement once, value returns to schools, certification becomes a buying criterion, products want in, they contribute back.">
        <circle cx={CX} cy={CY} r={R} class="ring" />
        {#each LOOP as st, i}
          {@const p = nodeAt(i)}
          <g class="node" class:on={i === loopIdx}>
            <circle cx={p.x} cy={p.y} r="21" class="nb" />
            <text x={p.x} y={p.y + 5} text-anchor="middle" class="nn">{st.no}</text>
          </g>
        {/each}
        <!-- the rotating marker rides OUTSIDE the node ring and is drawn last, or the
             node it is pointing at swallows it -->
        <g transform="rotate({spinCount * 60} {CX} {CY})" class="marker">
          <circle cx={CX} cy={CY - R - 28} r="7" class="mk" />
        </g>
        <text x={CX} y={CY - 8} text-anchor="middle" class="hub">THE</text>
        <text x={CX} y={CY + 12} text-anchor="middle" class="hub big">LOOP</text>
      </svg>
      <button class="spin-btn" onclick={() => (spinning = !spinning)}>{spinning ? '❚❚ pause' : '▶ play'}</button>
    </div>

    <div class="loop-steps">
      <span class="ls-lab">HOW THE MARKET JOINS — AND WHY IT KEEPS JOINING</span>
      {#each LOOP as st, i}
        <button class="ls" class:on={i === loopIdx} onclick={() => { spinCount += (i - loopIdx + LOOP.length) % LOOP.length; }}>
          <span class="ls-no">{st.no}</span>
          <span class="ls-actor">{st.actor}</span>
          <b>{st.title}</b>
          <span class="ls-body">{st.body}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- ============ THE BARGAIN ============ -->
  <div class="bargain">
    <span class="b-lab">THE BARGAIN, IN FULL — WHAT AN ACCREDITED SUPPLIER GIVES AND GETS</span>
    <p class="b-lede">
      {#if depth === 'eli5'}
        Companies will not join to be nice. They join because it saves them work and helps them sell. The
        deal has to be worth having on both sides — and it has to be the same deal for a big company and a
        small one.
      {:else if depth === 'technical'}
        Accreditation is a conformance status against a public test suite, not a commercial relationship.
        Read access is school-authorised and revocable within a request cycle; contribution obligations are
        expressed as signed non-PII partials under the same contract machinery as every other flow. Nothing
        here needs a bespoke API, and nothing here should be priced on contribution volume.
      {:else}
        A voluntary market joins a public standard when the standard is cheaper than the alternative and
        confers something saleable. Roughly {TOP3_COVERAGE}% of state schools sit behind three suppliers and
        the remainder behind {SUPPLIER_COUNT - 3}-plus more; the terms below are what would make joining the
        rational choice for both ends of that market.
      {/if}
    </p>
    <div class="gg-table">
      {#each GIVE_GET as g}
        <div class="ggr">
          <div class="ggc give"><span class="ggl">GIVES</span><p>{g.give}</p></div>
          <span class="ggx" aria-hidden="true">⇄</span>
          <div class="ggc get"><span class="ggl">GETS</span><p>{g.get}</p></div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ============ THE RISKS ============ -->
  <div class="risks">
    <span class="r-lab">⚖ WHY THIS IS ALSO DANGEROUS</span>
    <p class="r-lede">
      An accreditation schools ask for in procurement is a licence to trade in all but name. Every argument
      above is stronger for admitting that, and weaker for hiding it.
    </p>
    {#each NETWORK_RISKS as r, i}
      <div class="risk" class:open={openRisk === i}>
        <button class="r-t" onclick={() => (openRisk = openRisk === i ? null : i)} aria-expanded={openRisk === i}>
          <span class="r-chev" class:open={openRisk === i} aria-hidden="true">▸</span>
          <b>{r.title}</b>
          <ConfidenceBadge level={r.confidence} small />
        </button>
        {#if openRisk === i}
          <p class="r-b">{r.body}</p>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .fw { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp); background: var(--surface-elevated, #e8dece); overflow: hidden; }

  /* tiers */
  .tiers { padding: 16px 18px; }
  .t-lab, .u-lab, .ls-lab, .b-lab, .r-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,16,8,0.58); margin-bottom: 9px; }
  .t-steps { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .ts { display: flex; align-items: center; gap: 6px; background: #ffffff; border: 1.4px solid rgba(26,16,8,0.35);
    border-radius: var(--radius-sharp); padding: 6px 10px; cursor: pointer; }
  .ts:hover { border-color: var(--accent-ink, #0e5b66); }
  .ts-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink, #0e5b66); }
  .ts-nm { font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 500; color: var(--ink); }
  .ts.done { background: #eef6f0; border-color: rgba(47,125,79,0.5); }
  .ts.done .ts-no { color: #216b3f; }
  .ts.on { background: var(--accent-ink, #0e5b66); border-color: var(--accent-ink, #0e5b66); }
  .ts.on .ts-no { color: #a9d3d0; }
  .ts.on .ts-nm { color: #ffffff; font-weight: 600; }
  .ts-arrow { color: rgba(26,16,8,0.3); font-size: var(--fs-label-xs); }
  .ts-arrow.lit { color: rgba(47,125,79,0.75); }

  .t-body { display: grid; grid-template-columns: minmax(280px, 1.15fr) minmax(240px, 0.85fr); gap: 16px; margin-top: 14px; align-items: start; }
  .t-meta { background: #ffffff; border: 1.4px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 14px 16px; }
  .t-who { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; color: var(--accent-ink, #0e5b66); }
  .t-meta h4 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(19px, 2.4vw, 26px); line-height: 1.1; margin: 4px 0 12px; color: var(--ink); }

  .meters { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; }
  .m-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
  .m-top span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; color: rgba(26,16,8,0.6); }
  .m-top b { font-family: var(--fs-serif); font-weight: 600; font-size: 17px; color: var(--accent-ink, #0e5b66); }
  .m-track { height: 9px; background: rgba(26,16,8,0.08); border-radius: 2px; overflow: hidden; }
  .m-fill { height: 100%; background: var(--accent-ink, #0e5b66); border-radius: 2px; transition: width 0.6s cubic-bezier(0.22,1,0.36,1); }
  .m-fill.q { background: #2f7d4f; }

  .gg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .gg-c { border-left: 2px solid rgba(26,16,8,0.2); padding-left: 9px; }
  .gg-c.get { border-left-color: rgba(47,125,79,0.55); }
  .gg-l { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(26,16,8,0.55); margin-bottom: 3px; }
  .gg-c p { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(26,16,8,0.82); margin: 0; }

  .hard { background: #fdf4e6; border: 1px solid rgba(168,112,26,0.4); border-radius: var(--radius-sharp); padding: 9px 11px; }
  .hard-l { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    letter-spacing: 0.1em; color: #8c5a10; margin-bottom: 4px; }
  .hard p { font-size: var(--fs-label-xs); line-height: 1.5; color: #6f460b; margin: 0 0 6px; }

  .t-unlocks { background: #ffffff; border: 1.4px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 14px 16px; }
  .u-group { margin-bottom: 12px; opacity: 0.55; }
  .u-group.current { opacity: 1; }
  .u-group:last-child { margin-bottom: 0; }
  .u-tier { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .u-group ul { list-style: none; margin: 5px 0 0; padding: 0; }
  .u-group li { position: relative; font-size: var(--fs-label); line-height: 1.5; color: rgba(26,16,8,0.84);
    padding-left: 16px; margin-bottom: 4px; }
  .u-group.current li { animation: fw-in 0.45s ease both; }
  .u-group li::before { content: '✓'; position: absolute; left: 0; color: #2f7d4f; font-size: var(--fs-label-xs); }
  @keyframes fw-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }

  /* ELI5 tier table */
  .tbl-wrap { overflow-x: auto; margin-top: 14px; background: #ffffff; border: 1.4px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 2px 14px 8px; }
  .e-tbl { width: 100%; min-width: 760px; border-collapse: collapse; }
  .e-tbl th, .e-tbl td { text-align: left; vertical-align: top; padding: 10px 11px; font-size: var(--fs-label); line-height: 1.5; border-bottom: 1px solid rgba(26,16,8,0.12); }
  .e-tbl thead th { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(26,16,8,0.55); border-bottom: 1.5px solid rgba(26,16,8,0.3); }
  .e-tbl tbody th.c-n { width: 200px; }
  .e-tbl tbody th.c-n button { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--accent-ink, #0e5b66); background: transparent; border: none; padding: 0; text-align: left; cursor: pointer; }
  .e-tbl tbody th.c-n button:hover { text-decoration: underline; }
  .e-tbl tbody th.c-n .cov { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 400; color: rgba(26,16,8,0.55); margin-top: 3px; }
  .e-tbl tr.on { background: rgba(14,91,102,0.05); }
  .e-tbl tr.on th.c-n button { color: var(--ink); }
  .e-tbl td { color: rgba(26,16,8,0.84); }
  .e-tbl td.c-u, .e-tbl th.c-u { width: 28%; color: #216b3f; }
  .e-note { font-size: var(--fs-label); line-height: 1.55; color: rgba(26,16,8,0.72); margin: 12px 0 0; max-width: 100%; }

  /* flywheel */
  .loop { display: grid; grid-template-columns: 300px 1fr; gap: 16px; padding: 4px 18px 18px; align-items: start; }
  .loop-viz { position: relative; }
  .loop-viz svg { display: block; width: 100%; height: auto; max-width: 300px; }
  .ring { fill: none; stroke: rgba(26,16,8,0.22); stroke-width: 2; stroke-dasharray: 5 6; }
  .marker { transition: transform 0.8s cubic-bezier(0.22,1,0.36,1); }
  .mk { fill: var(--accent-ink, #0e5b66); stroke: #ede4d4; stroke-width: 2; }
  .nb { fill: #ffffff; stroke: rgba(26,16,8,0.4); stroke-width: 1.6; transition: fill 0.3s, stroke 0.3s; }
  .nn { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); fill: rgba(26,16,8,0.7); transition: fill 0.3s; }
  .node.on .nb { fill: var(--accent-ink, #0e5b66); stroke: #05343b; }
  .node.on .nn { fill: #ffffff; }
  .hub { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.2em; fill: rgba(26,16,8,0.45); }
  .hub.big { font-family: var(--fs-serif); font-size: 20px; letter-spacing: 0.02em; fill: rgba(26,16,8,0.62); }
  .spin-btn { position: absolute; bottom: 0; left: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--ink); background: #ffffff; border: 1.2px solid rgba(26,16,8,0.35); border-radius: var(--radius-sharp); padding: 4px 9px; cursor: pointer; }

  .loop-steps { display: flex; flex-direction: column; gap: 5px; }
  .ls { display: grid; grid-template-columns: 26px 1fr; grid-template-areas: 'no actor' 'no title' 'no body';
    gap: 1px 8px; text-align: left; background: #ffffff; border: 1.3px solid rgba(26,16,8,0.28);
    border-radius: var(--radius-sharp); padding: 8px 11px; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
  .ls.on { border-color: var(--accent-ink, #0e5b66); border-width: 1.8px; background: rgba(14,91,102,0.05); }
  .ls-no { grid-area: no; font-family: var(--fs-serif); font-weight: 600; font-size: 17px; color: rgba(26,16,8,0.35); align-self: center; }
  .ls.on .ls-no { color: var(--accent-ink, #0e5b66); }
  .ls-actor { grid-area: actor; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .ls b { grid-area: title; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.25; }
  .ls-body { grid-area: body; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(26,16,8,0.72); margin-top: 2px; }

  /* bargain */
  .bargain { background: #ffffff; border-top: 1.5px solid rgba(26,16,8,0.4); padding: 16px 18px; }
  .b-lede { font-size: var(--fs-label); line-height: 1.6; color: rgba(26,16,8,0.84); margin: 0 0 14px; max-width: 100%; }
  .gg-table { display: flex; flex-direction: column; gap: 8px; }
  .ggr { display: grid; grid-template-columns: 1fr 26px 1fr; gap: 8px; align-items: center; }
  .ggc { border: 1.2px solid rgba(26,16,8,0.25); border-radius: var(--radius-sharp); padding: 8px 11px; }
  .ggc.give { border-left: 3px solid #a8701a; }
  .ggc.get { border-left: 3px solid #2f7d4f; }
  .ggl { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    letter-spacing: 0.12em; margin-bottom: 3px; }
  .ggc.give .ggl { color: #8c5a10; }
  .ggc.get .ggl { color: #216b3f; }
  .ggc p { font-size: var(--fs-label); line-height: 1.5; color: rgba(26,16,8,0.84); margin: 0; }
  .ggx { text-align: center; color: rgba(26,16,8,0.35); font-size: var(--fs-body-sm); }

  /* risks */
  .risks { border-top: 1.5px solid rgba(26,16,8,0.4); padding: 16px 18px 18px; background: var(--error-bg, rgba(196,68,68,0.07)); }
  .r-lab { color: #8a2d3a; }
  .r-lede { font-size: var(--fs-label); line-height: 1.6; color: #6d232d; margin: 0 0 12px; max-width: 100%; }
  .risk { border: 1.2px solid rgba(138,45,58,0.32); border-radius: var(--radius-sharp); background: #ffffff; margin-bottom: 6px; }
  .risk.open { border-color: rgba(138,45,58,0.6); }
  .r-t { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent;
    border: none; padding: 9px 12px; cursor: pointer; }
  .r-chev { color: #8a2d3a; font-size: var(--fs-label-xs); transition: transform 0.15s; flex: 0 0 auto; }
  .r-chev.open { transform: rotate(90deg); }
  .r-t b { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.3; flex: 1; }
  .r-b { font-size: var(--fs-label); line-height: 1.6; color: rgba(26,16,8,0.84); margin: 0; padding: 0 12px 12px 30px; }

  @media (prefers-reduced-motion: reduce) {
    .marker, .m-fill { transition: none; }
    .u-group.current li { animation: none; }
  }

  @media (max-width: 860px) {
    .t-body { grid-template-columns: 1fr; }
    .loop { grid-template-columns: 1fr; }
    .loop-viz svg { max-width: 260px; margin: 0 auto; }
    .spin-btn { position: static; margin: 6px auto 0; display: block; }
  }
  @media (max-width: 640px) {
    .tiers, .bargain, .risks { padding-left: 12px; padding-right: 12px; }
    .loop { padding-left: 12px; padding-right: 12px; }
    .gg { grid-template-columns: 1fr; }
    .ggr { grid-template-columns: 1fr; }
    .ggx { display: none; }
  }
</style>
