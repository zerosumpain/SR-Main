<svelte:head>
  <title>Heart 2 — Field Advection</title>
  <meta name="description" content="Velocity-field advection blood flow — lightweight alternative to PBF." />
  <meta name="robots" content="noindex" />
</svelte:head>

<script lang="ts">
  import HeartFieldSim from '$lib/components/HeartFieldSim.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let bpm = $state(70);
  let count = $state(12000);
  let stats = $state({ fps: 0, msSolve: 0, msRender: 0, phase: 'rest', cyclePhi: 0, particleCount: 0 });

  const phaseLabels: Record<string, string> = {
    atrialSystole: 'ATRIAL SYSTOLE',
    ejection:      'VENT. EJECTION',
    filling:       'PASSIVE FILLING',
    rest:          'RESTING FLOW',
  };
</script>

<div class="page">
  <PageHeader title="heart / 2" titleHref="/heart" />

  <section class="hero">
    <div class="canvas-wrap">
      <HeartFieldSim {bpm} particleCount={count} onstats={(s) => (stats = s)} />
    </div>

    <div class="caption">
      <p class="label">/heart/2&ensp;·&ensp;FIELD ADVECTION</p>
      <p class="display">{bpm}<span class="unit">&thinsp;BPM</span></p>
      <p class="phase">{phaseLabels[stats.phase] ?? stats.phase.toUpperCase()}</p>
      <div class="cycle-bar">
        <div class="cycle-fill" style:width="{(stats.cyclePhi * 100).toFixed(1)}%"></div>
      </div>
      <p class="sub">
        Pre-baked velocity fields per cardiac mode. Particles advect through
        a weighted blend of resting flow, atrial kick, ventricular ejection
        and passive filling. ~30× cheaper than PBF — easily 12k+ particles.
      </p>
      <nav class="variants">
        <span class="vlabel">VARIANTS</span>
        <a href="/heart">/heart</a>
        <a href="/heart/1">/heart/1 · physio cycle</a>
        <a href="/heart/2" class="active">/heart/2 · field advection</a>
      </nav>
    </div>
  </section>

  <section class="controls">
    <div class="ctrl">
      <label for="bpm">BPM</label>
      <input id="bpm" type="range" min="40" max="180" step="1" bind:value={bpm} />
      <span class="num">{bpm}</span>
    </div>
    <div class="ctrl">
      <label for="count">Particles</label>
      <input id="count" type="range" min="2000" max="20000" step="500" bind:value={count} />
      <span class="num">{count}</span>
      <span class="hint">live</span>
    </div>
    <div class="presets">
      <button onclick={() => (bpm = 50)}>rest 50</button>
      <button onclick={() => (bpm = 70)}>calm 70</button>
      <button onclick={() => (bpm = 110)}>brisk 110</button>
      <button onclick={() => (bpm = 160)}>sprint 160</button>
    </div>
    <dl class="stats">
      <dt>FPS</dt><dd>{stats.fps.toFixed(0)}</dd>
      <dt>solve</dt><dd>{stats.msSolve.toFixed(2)} ms</dd>
      <dt>render</dt><dd>{stats.msRender.toFixed(2)} ms</dd>
      <dt>particles</dt><dd>{stats.particleCount}</dd>
    </dl>
  </section>

  <SiteFooter />
</div>

<style>
  .page { min-height: 100vh; background: var(--bg); color: var(--text-primary); display: flex; flex-direction: column; }
  .hero { position: relative; min-height: calc(100vh - var(--site-nav-height, 56px)); }
  .canvas-wrap { position: absolute; inset: 0; z-index: 1; }
  .caption {
    position: relative; z-index: 2; padding: 4rem 2rem 2rem; max-width: 540px;
    pointer-events: none;
  }
  .caption .label { color: var(--text-muted); margin-bottom: 0.5rem; }
  .caption .display {
    font-family: var(--font-display); font-size: clamp(72px, 12vw, 160px);
    line-height: 0.9; color: var(--accent); margin: 0; letter-spacing: -0.02em;
  }
  .caption .display .unit { font-size: max(0.35em, var(--fs-label-xs)); color: var(--text-secondary); margin-left: 0.2em; letter-spacing: 0; }
  .caption .phase {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em;
    color: var(--accent); margin: 0.4rem 0 0.6rem;
  }
  .caption .sub {
    margin-top: 1.25rem; max-width: 360px; color: var(--text-secondary);
    font-size: var(--fs-nav); line-height: 1.55;
  }
  .cycle-bar {
    position: relative; width: 280px; height: 6px;
    background: var(--line-hair); border-radius: var(--radius-sharp); overflow: hidden;
    pointer-events: auto;
  }
  .cycle-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: var(--accent); opacity: 0.85;
    transition: width 0.05s linear;
  }
  .controls {
    border-top: 2px solid var(--line-hair);
    padding: 1.5rem 2rem 2.5rem;
    display: grid; grid-template-columns: 1fr 1fr; column-gap: 2rem; row-gap: 1rem;
    align-items: center; background: var(--bg);
  }
  .ctrl { display: grid; grid-template-columns: 90px 1fr 60px auto; gap: 0.75rem; align-items: center; }
  .ctrl label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
                letter-spacing: 0.15em; color: var(--text-muted); }
  .ctrl input[type='range'] { accent-color: var(--accent); width: 100%; }
  .ctrl .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums;
               color: var(--text-primary); text-align: right; }
  .ctrl .hint { font-size: var(--fs-label-xs); color: var(--text-ghost); font-family: var(--font-mono); }
  .presets { display: flex; flex-wrap: wrap; gap: 0.4rem; grid-column: 1 / -1; }
  .presets button {
    background: transparent; border: 1px solid var(--line-strong); color: var(--text-primary);
    padding: 0.35rem 0.75rem; border-radius: var(--radius-round); font-family: var(--font-mono);
    font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .presets button:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .stats {
    grid-column: 1 / -1; display: grid; grid-template-columns: repeat(8, auto);
    gap: 0 0.5rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); margin: 0.25rem 0 0;
    color: var(--text-secondary);
  }
  .stats dt { text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .stats dd { margin: 0 1.5rem 0 0; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .variants {
    margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
    align-items: center; pointer-events: auto;
  }
  .variants .vlabel {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
    letter-spacing: 0.15em; color: var(--text-muted);
  }
  .variants a {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary);
    text-decoration: none; border-bottom: 1px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .variants a:hover { color: var(--accent); border-color: var(--accent); }
  .variants a.active { color: var(--accent); }
  @media (max-width: 720px) {
    .controls { grid-template-columns: 1fr; }
    .ctrl { grid-template-columns: 80px 1fr 50px; }
    .ctrl .hint { display: none; }
    .stats { grid-template-columns: repeat(4, auto); }
  }
</style>
