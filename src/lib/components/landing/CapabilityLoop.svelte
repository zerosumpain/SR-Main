<script lang="ts">
  import type { CapabilityFacts } from '$lib/landing/capabilities';

  let {
    facts,
    deploysPerDay,
    releases,
  }: { facts: CapabilityFacts; deploysPerDay: number | null; releases: number | null } = $props();

  let hit = $derived(facts.daydream.hitRate == null ? null : Math.round(facts.daydream.hitRate * 100));

  // Five stations on one winding path. Odd stations ride the crests and carry
  // their words above the arrow; even ones sit in the troughs with their words
  // below, so the text runs alongside the line the whole way.
  let steps = $derived([
    {
      k: `every ${facts.daydream.cadenceMinutes} min`,
      name: 'Daydream',
      body: 'Thinks on spare cycles, one narrow question at a time, and writes down what’s worth attention.',
    },
    {
      k: hit != null ? `${hit}% useful` : 'a human verdict',
      name: 'Decide',
      body: 'A person rates every note. Nothing downstream runs until a verdict lands.',
    },
    {
      k: 'brief to preview',
      name: 'Build',
      body: 'Accepted ideas become real code changes, with a brief, a running preview and tests.',
    },
    {
      k: deploysPerDay != null ? `${deploysPerDay} a day` : 'gated',
      name: 'Ship',
      body: `Production only through a gated pull request${releases != null ? `: ${releases.toLocaleString('en-GB')} releases so far` : ''}.`,
    },
    {
      k: `${facts.app.nativeEndpoints} endpoints`,
      name: 'Pocket',
      body: 'The iPhone and watch app carry it onto the Lock Screen, where the next note gets answered.',
    },
  ]);

  // Geometry in a 1000×220 box. Stations sit at the column centres (10%, 30%…)
  // so the HTML words above and below line up with them at any width.
  const X = [100, 300, 500, 700, 900];
  const Y = [56, 164, 56, 164, 56];
  const wave =
    `M8,${Y[0]} L${X[0]},${Y[0]}` +
    X.slice(1)
      .map((x, i) => ` C${X[i] + 80},${Y[i]} ${x - 80},${Y[i + 1]} ${x},${Y[i + 1]}`)
      .join('') +
    ` L976,${Y[4]}`;
  // The way back: Pocket feeds the next Daydream. Dashed, under everything.
  const back = `M920,${Y[4] + 8} C1000,${Y[4] + 30} 1000,206 900,206 L100,206 C20,206 0,${Y[0] + 30} 70,${Y[0] + 8}`;
</script>

<section class="loop-sec" aria-labelledby="loop-h">
  <header class="cap-hd">
    <h2 id="loop-h" class="cap-h">The loop</h2>
    <span class="cap-rule"></span>
    <a class="cap-meta" href="/projects/engine-room">How it changes itself →</a>
  </header>

  <div class="loop" role="list">
    {#each steps as s, i (s.name)}
      <div role="listitem" class="st" class:up={i % 2 === 0} style="--col: {i + 1}">
        <span class="st-k">{String(i + 1).padStart(2, '0')} · {s.k}</span>
        <span class="st-name">{s.name}</span>
        <span class="st-body">{s.body}</span>
      </div>
    {/each}

    <div class="path" aria-hidden="true">
      <svg viewBox="0 0 1000 220">
        <path class="back" d={back} />
        <path class="back-head" d="M62,{Y[0] + 2} L72,{Y[0] + 9} L60,{Y[0] + 14}" />
        <path class="wave" d={wave} />
        <path class="runner" d={wave} pathLength="1000" />
        <path class="head" d="M962,{Y[4] - 12} L984,{Y[4]} L962,{Y[4] + 12}" />
        {#each X as x, i (x)}
          <circle class="stn" cx={x} cy={Y[i]} r="11" />
          <circle class="stn-core" cx={x} cy={Y[i]} r="4" />
        {/each}
      </svg>
    </div>
  </div>
</section>

<style>
  .loop-sec {
    max-width: 1312px;
    margin: 0 auto;
    padding: 88px clamp(16px, 4vw, 64px);
  }
  .cap-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 20px;
    margin-bottom: 20px;
  }
  .cap-h {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(var(--fs-display-sm), 4vw, 2.75rem);
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
  }
  .cap-rule {
    flex: 1 1 40px;
    height: 1px;
    background: var(--line-strong);
  }
  .cap-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }

  /* Three rows over five columns: words for the crest stations, the arrow,
     words for the trough stations. */
  .loop {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: auto auto auto;
    column-gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .st {
    grid-column: var(--col);
    grid-row: 3;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 6px;
  }
  .st.up {
    grid-row: 1;
    justify-content: flex-end;
    padding: 0 0 6px;
  }
  .st-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .st-name {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
  }
  .st-body {
    font-size: var(--fs-nav);
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .path {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .path svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .wave,
  .back,
  .head,
  .back-head,
  .runner {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wave {
    stroke: var(--text-primary);
    stroke-width: 3;
  }
  .head {
    stroke: var(--text-primary);
    stroke-width: 3;
  }
  .back,
  .back-head {
    stroke: var(--accent-ink);
    stroke-width: 1.5;
    opacity: 0.6;
  }
  .back {
    stroke-dasharray: 2 7;
  }
  /* A pulse travels the arrow: a short bright dash slid along the path. */
  .runner {
    stroke: var(--accent);
    stroke-width: 6;
    stroke-dasharray: 60 940;
    animation: travel 6s linear infinite;
  }
  @keyframes travel {
    from {
      stroke-dashoffset: 60;
    }
    to {
      stroke-dashoffset: -940;
    }
  }
  .stn {
    fill: var(--bg);
    stroke: var(--text-primary);
    stroke-width: 3;
  }
  .stn-core {
    fill: var(--accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .runner {
      display: none;
    }
  }

  /* On a phone the wave would be too flat to read: stand the loop up as a
     single column on a vertical rail, the pulse running down it. */
  @media (max-width: 760px) {
    .loop {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      row-gap: 22px;
      position: relative;
      padding-left: 30px;
      border-left: 3px solid var(--text-primary);
      margin-left: 10px;
    }
    .st,
    .st.up {
      grid-column: 1;
      grid-row: auto;
      padding: 0;
      position: relative;
    }
    .st::before {
      content: '';
      position: absolute;
      left: -43px;
      top: 0;
      width: 16px;
      height: 16px;
      border-radius: 100px;
      background: var(--accent);
      border: 3px solid var(--text-primary);
      box-sizing: border-box;
    }
    .path {
      display: none;
    }
  }
</style>
