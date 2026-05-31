<svelte:head>
  <title>Heart 1 — Physiological Cycle</title>
  <meta name="description" content="PBF blood flow with a physiologically accurate 6-phase cardiac cycle." />
  <meta name="robots" content="noindex" />
</svelte:head>

<script lang="ts">
  import HeartPhysioSim from '$lib/components/HeartPhysioSim.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let bpm = $state(70);
  let count = $state(3000);
  let stats = $state({ fps: 0, msSolve: 0, msRender: 0, phase: 'diastasis', cyclePhi: 0, particleCount: 0 });

  const phaseLabels: Record<string, string> = {
    atrialSystole: 'ATRIAL SYSTOLE',
    isoContract:   'ISO. CONTRACTION',
    ejection:      'VENT. EJECTION',
    isoRelax:      'ISO. RELAXATION',
    rapidFilling:  'RAPID FILLING',
    diastasis:     'DIASTASIS',
  };
</script>

<div class="page">
  <PageHeader title="heart / 1" titleHref="/heart" />

  <section class="hero">
    <div class="canvas-wrap">
      <HeartPhysioSim {bpm} particleCount={count} onstats={(s) => (stats = s)} />
    </div>

    <div class="caption">
      <p class="label">/heart/1&ensp;·&ensp;6-PHASE PHYSIO PBF</p>
      <p class="display">{bpm}<span class="unit">&thinsp;BPM</span></p>
      <p class="phase">{phaseLabels[stats.phase] ?? stats.phase.toUpperCase()}</p>
      <div class="cycle-bar">
        <div class="cycle-fill" style:width="{(stats.cyclePhi * 100).toFixed(1)}%"></div>
        <div class="seg s1" title="atrial systole"></div>
        <div class="seg s2" title="iso contract"></div>
        <div class="seg s3" title="ejection"></div>
        <div class="seg s4" title="iso relax"></div>
        <div class="seg s5" title="rapid filling"></div>
        <div class="seg s6" title="diastasis"></div>
      </div>
      <p class="sub">
        Real cardiac cycle: 10% atrial kick → 5% iso. contract → 30% ventricular ejection
        → 10% iso. relax → 15% rapid passive fill → 30% diastasis. Force ratio
        ventricular : atrial ≈ 5:1.
        <span class="lite">Lite solver: 1 iter, no viscosity, FPS-watchdog at 30.</span>
      </p>
      <nav class="variants">
        <span class="vlabel">VARIANTS</span>
        <a href="/heart">/heart</a>
        <a href="/heart/1" class="active">/heart/1 · physio cycle</a>
        <a href="/heart/2">/heart/2 · field advection</a>
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
      <input id="count" type="range" min="800" max="7000" step="100" bind:value={count} />
      <span class="num">{count}</span>
      <span class="hint">live · auto-trims if FPS &lt; 30</span>
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
  .hero {
    position: relative;
    min-height: calc(100vh - var(--site-nav-height, 56px));
  }
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
  .caption .display .unit { font-size: 0.35em; color: var(--text-secondary); margin-left: 0.2em; letter-spacing: 0; }
  .caption .phase {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em;
    color: var(--accent); margin: 0.4rem 0 0.6rem;
  }
  .caption .sub {
    margin-top: 1.25rem; max-width: 360px; color: var(--text-secondary);
    font-size: 14px; line-height: 1.55;
  }
  .caption .sub .lite {
    display: block; margin-top: 0.5rem; font-family: var(--font-mono);
    font-size: 11px; color: var(--text-muted); letter-spacing: 0.05em;
  }

  .cycle-bar {
    position: relative; width: 280px; height: 6px;
    background: rgba(26, 16, 8, 0.08); border-radius: 3px; overflow: hidden;
    pointer-events: auto;
  }
  .cycle-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: var(--accent); opacity: 0.85;
    transition: width 0.05s linear;
  }
  .cycle-bar .seg {
    position: absolute; top: 0; bottom: 0; border-right: 1px solid rgba(26, 16, 8, 0.15);
  }
  .seg.s1 { left: 0;     width: 10%; }
  .seg.s2 { left: 10%;   width: 5%;  }
  .seg.s3 { left: 15%;   width: 30%; }
  .seg.s4 { left: 45%;   width: 10%; }
  .seg.s5 { left: 55%;   width: 15%; }
  .seg.s6 { left: 70%;   width: 30%; border-right: none; }

  .controls {
    border-top: 2px solid rgba(26, 16, 8, 0.08);
    padding: 1.5rem 2rem 2.5rem;
    display: grid; grid-template-columns: 1fr 1fr; column-gap: 2rem; row-gap: 1rem;
    align-items: center; background: var(--bg);
  }
  .ctrl { display: grid; grid-template-columns: 90px 1fr 60px auto; gap: 0.75rem; align-items: center; }
  .ctrl label { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
                letter-spacing: 0.15em; color: var(--text-muted); }
  .ctrl input[type='range'] { accent-color: var(--accent); width: 100%; }
  .ctrl .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums;
               color: var(--text-primary); text-align: right; }
  .ctrl .hint { font-size: 11px; color: var(--text-ghost); font-family: var(--font-mono); }

  .presets { display: flex; flex-wrap: wrap; gap: 0.4rem; grid-column: 1 / -1; }
  .presets button {
    background: transparent; border: 1px solid var(--card-border); color: var(--text-primary);
    padding: 0.35rem 0.75rem; border-radius: 4px; font-family: var(--font-mono);
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .presets button:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  .stats {
    grid-column: 1 / -1; display: grid; grid-template-columns: repeat(8, auto);
    gap: 0 0.5rem; font-family: var(--font-mono); font-size: 11px; margin: 0.25rem 0 0;
    color: var(--text-secondary);
  }
  .stats dt { text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .stats dd { margin: 0 1.5rem 0 0; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .variants {
    margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
    align-items: center; pointer-events: auto;
  }
  .variants .vlabel {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.15em; color: var(--text-muted);
  }
  .variants a {
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
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
