<script lang="ts">
  // The overview. Five bands, in the order a stranger needs them:
  //   1. what this is, in one breath, beside the machine itself (three meshing gears);
  //   2. live proof that it runs, as three counters;
  //   3. the loop told as a story, one beat per scroll, pinned beside a changing drawing;
  //   4. the three parts, each a door;
  //   5. why the figures on these pages can be trusted.
  //
  // Every number comes from data.facts (imported from the feature code) or data.live (the
  // database, totals only). The words are lib/story.ts, with an engineering twin for each.
  import Band from './components/kit/Band.svelte';
  import Counter from './components/kit/Counter.svelte';
  import LoopEngine from './components/art/LoopEngine.svelte';
  import LoopStory from './components/art/LoopStory.svelte';
  import PartGlyph from './components/art/PartGlyph.svelte';
  import { PARTS, href } from './lib/nav';
  import { app } from './lib/appState.svelte';
  import { APP } from './lib/app';
  import { OVERVIEW_COPY as C } from './lib/story';
  import { reveal, cascade, shown } from './lib/motion';

  let { data } = $props();
  const eli = $derived(app.narrative === 'eli5');
  const f = $derived(data.facts);
  const live = $derived(data.live);
  const endpoints = $derived(f.app.nativeAreas.reduce((a, x) => a + x.endpoints, 0));

  const channel = $derived(new Map<string, string>(f.daydream.channels.map((c) => [c.id, c.label])));
  const outcome = $derived(new Map<string, string>(f.daydream.outcomes.map((o) => [o.id, o.label])));
  const next = $derived(f.daydream.upcoming[0]);
  const question = $derived(next ? { channel: channel.get(next.channel) ?? next.channel, outcome: outcome.get(next.outcome) ?? next.outcome } : null);

  const figures = $derived([
    { part: 'daydream', value: live.daydream?.noticed ?? null, label: `notes it wrote me in the last ${f.daydream.impactWindowDays} days` },
    { part: 'build', value: live.build ? live.build.lanes.shipped ?? 0 : null, label: 'features it has built and shipped' },
    { part: 'app', value: endpoints, label: 'doorways the phone can knock on' },
  ] as const);

  const headline: Record<string, { value: number | null; suffix?: string; label: string }> = $derived({
    daydream: { value: live.daydream?.hitRate == null ? null : Math.round(live.daydream.hitRate * 100), suffix: '%', label: 'of the notes I rated were useful' },
    build: { value: live.build?.deliveries ?? null, label: 'features asked for so far' },
    app: { value: APP.tabs.length, label: 'tabs on the phone, and a watch app' },
  });

  const SOURCES = $derived([
    { k: 'Feature code', v: 'names, limits and schedules', how: 'imported at every deploy' },
    { k: 'Database', v: 'live totals, never anyone’s data', how: `re-read every few minutes` },
    { k: 'App source', v: 'tabs, widgets and permissions', how: 'read from its Swift' },
  ]);
</script>

<svelte:head>
  <title>The Engine Room — Daydream, Build and the App</title>
  <meta name="description" content="A website that thinks about my life while I'm busy, builds the ideas I say yes to, and lives in my pocket. How the three unusual parts of strangeramblings.com work, with every figure read from the running code." />
</svelte:head>

<!-- 1 · hero -->
<Band surface="ink" pad="hero" label="The Engine Room">
  <div class="hero">
    <div class="h-words">
      <span class="er-kicker" {@attach reveal({ y: 10 })}>A field study of strangeramblings.com</span>
      <h1 class="er-display h-title">
        <span class="ln"><span {@attach reveal({ y: 70, delay: 0, parent: true })}>A website</span></span>
        <span class="ln"><span {@attach reveal({ y: 70, delay: 0.07, parent: true })}>that <em data-part="daydream">thinks</em>,</span></span>
        <span class="ln"><span {@attach reveal({ y: 70, delay: 0.14, parent: true })}><em data-part="build">builds</em> itself</span></span>
        <span class="ln"><span {@attach reveal({ y: 70, delay: 0.21, parent: true })}>and lives in</span></span>
        <span class="ln"><span {@attach reveal({ y: 70, delay: 0.28, parent: true })}>my <em data-part="app">pocket</em>.</span></span>
      </h1>
      <p class="h-lede" {@attach reveal({ y: 20, delay: 0.4 })}>{eli ? C.hero.plain : C.hero.eng}</p>
      <div class="h-cta" {@attach reveal({ y: 20, delay: 0.5 })}>
        <a class="btn" href="#story">See how it works <span aria-hidden="true">↓</span></a>
        <button class="btn ghost" onclick={() => (app.askOpen = true)}><span aria-hidden="true">✦</span> Ask it a question</button>
      </div>
    </div>
    <div class="h-art" {@attach reveal({ y: 30, delay: 0.2, duration: 1.2 })}>
      <LoopEngine captions={{ daydream: `thinks every ${f.daydream.cadenceMinutes} min`, build: 'builds while I sleep', app: `${APP.targets.length} pieces, one doorway` }} />
    </div>
  </div>

  <ul class="figures" {@attach cascade()}>
    {#each figures as x (x.part)}
      <li data-part={x.part}>
        <b class="fg-n"><Counter value={x.value} /></b>
        <span class="fg-l">{x.label}</span>
      </li>
    {/each}
  </ul>
</Band>

<!-- 2 · the story -->
<Band surface="paper" id="story" label="How a thought becomes a feature">
  <header class="s-head">
    <span class="er-kicker">The loop, in five moves</span>
    <h2 class="er-display s-title" {@attach reveal({ y: 40 })}>How a passing thought<br />becomes a feature</h2>
    <p class="er-lede s-lede">Follow one idea all the way round. Scroll, and the drawing keeps up.</p>
  </header>
  <LoopStory {question} stages={f.daydream.stages.map((s) => s.label)} cadence={f.daydream.cadenceMinutes}
    gates={f.build.gates.filter((g) => g !== 'cmd' && g !== 'gate')} tabs={APP.tabs.length} />
</Band>

<!-- 3 · the parts -->
<Band surface="deep" label="The three parts">
  <header class="s-head">
    <span class="er-kicker">Three parts, ten chapters</span>
    <h2 class="er-display s-title" {@attach reveal({ y: 40 })}>Pick a door</h2>
  </header>
  <div class="doors" {@attach cascade(':scope > a', { gap: 0.12 })}>
    {#each PARTS as p (p.id)}
      {@const h = headline[p.id]}
      <a class="door" href={href(p.id)} data-part={p.id}>
        <span class="d-no">Part {p.no}</span>
        <span class="d-glyph"><PartGlyph part={p.id} /></span>
        <b class="d-name">{p.name}</b>
        <span class="d-strap">{p.strap}</span>
        <span class="d-fig"><b><Counter value={h.value} suffix={h.suffix ?? ''} /></b>{h.label}</span>
        <span class="d-asks">
          {#each p.leaves as l}<span>{l.ask}</span>{/each}
        </span>
        <span class="d-go">Go to {p.name} <span aria-hidden="true">→</span></span>
      </a>
    {/each}
  </div>
</Band>

<!-- 4 · trust -->
<Band surface="ink" label="How these pages stay true">
  <div class="trust">
    <header class="t-head">
      <span class="er-kicker">Why you can believe the numbers</span>
      <h2 class="er-display s-title" {@attach reveal({ y: 40 })}>Nothing here<br />is typed by hand</h2>
      <p class="er-lede">{eli ? C.trust.plain : C.trust.eng}</p>
    </header>
    <div class="pipe" {@attach shown({ amount: 0.4 })}>
      {#each SOURCES as s, i}
        <div class="p-src" style="--d:{i * 0.2}s"><b>{s.k}</b><span>{s.v}</span></div>
        <svg class="p-wire" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true" style="grid-row:{i + 1}">
          <path d="M0 20 H200" pathLength="1" data-draw style="--d:{0.3 + i * 0.2}s" />
          <path class="flow" d="M0 20 H200" />
        </svg>
        <span class="p-how" style="grid-row:{i + 1}">{s.how}</span>
      {/each}
      <div class="p-page"><b>This page</b><span>built from all three, every time it’s served</span></div>
      <div class="p-fail"><span class="pf-x" aria-hidden="true">✕</span><span><b>A feature changes and the words don’t?</b> The site refuses to build, so the page can’t quietly lie.</span></div>
    </div>
  </div>
</Band>

<style>
  /* hero */
  .hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: clamp(28px, 4vw, 72px); align-items: center; }
  .h-title { font-size: clamp(42px, 5.6vw, 92px); display: flex; flex-direction: column; margin-bottom: 28px; }
  .ln { display: block; overflow: hidden; padding-bottom: 0.03em; }
  .ln > span { display: inline-block; }
  .h-title em { font-style: normal; color: var(--tone-text); }
  .h-lede { font-size: clamp(16px, 1.35vw, 19px); line-height: 1.6; color: var(--fg-2); max-width: 54ch; margin: 0 0 28px; }
  .h-cta { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 8px; font-family: var(--er-mono); font-size: var(--fs-label); letter-spacing: 0.06em;
    text-transform: uppercase; padding: 13px 20px; border-radius: var(--radius-pill); text-decoration: none; cursor: pointer;
    background: var(--er-orange-ink); color: var(--er-ink); border: 1px solid var(--er-orange-ink); transition: background 0.2s, color 0.2s; }
  .btn:hover { background: var(--er-cream); border-color: var(--er-cream); }
  .btn.ghost { background: transparent; color: var(--fg); border-color: var(--rule-strong); }
  .btn.ghost:hover { border-color: var(--fg); background: var(--wash); }
  .h-art { min-width: 0; }

  .figures { list-style: none; margin: clamp(40px, 6vw, 88px) 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0;
    border-top: 1px solid var(--rule); }
  .figures li { padding: 22px 24px 4px 0; display: flex; flex-direction: column; gap: 8px; border-right: 1px solid var(--rule); padding-left: 24px; }
  .figures li:first-child { padding-left: 0; }
  .figures li:last-child { border-right: none; }
  .fg-n { font-family: var(--er-display); font-weight: 400; font-size: clamp(48px, 6vw, 92px); line-height: 0.9; color: var(--tone-text); }
  .fg-l { font-size: var(--fs-body-sm); color: var(--fg-2); max-width: 26ch; }

  @media (max-width: 960px) {
    .hero { grid-template-columns: minmax(0, 1fr); }
    .h-art { max-width: 560px; }
  }
  @media (max-width: 640px) {
    .figures { grid-template-columns: minmax(0, 1fr); }
    .figures li { border-right: none; border-bottom: 1px solid var(--rule); padding: 18px 0; }
  }

  /* section heads */
  .s-head { margin-bottom: clamp(28px, 4vw, 56px); max-width: 900px; }
  .s-title { font-size: clamp(34px, 4.6vw, 72px); margin-bottom: 22px; }
  .s-lede { max-width: 52ch; }

  /* doors */
  .doors { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .door { position: relative; display: flex; flex-direction: column; gap: 12px; padding: clamp(22px, 2.6vw, 36px); text-decoration: none; color: inherit;
    background: var(--er-paper-hi); overflow: hidden; transition: background 0.4s; }
  .door::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 6px; background: var(--tone); transform: scaleX(0.18); transform-origin: left;
    transition: transform 0.6s var(--er-ease); }
  .door:hover::after, .door:focus-visible::after { transform: scaleX(1); }
  .door:hover { background: #fbf6ec; }
  .d-no { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em; text-transform: uppercase; color: var(--tone-text); }
  .d-glyph { width: clamp(96px, 10vw, 140px); aspect-ratio: 1; margin: 6px 0 4px; }
  .d-name { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(34px, 3.6vw, 54px); line-height: 0.9; }
  .d-strap { font-family: var(--er-serif); font-style: italic; font-size: clamp(18px, 1.5vw, 21px); line-height: 1.3; color: var(--fg); }
  .d-fig { display: flex; flex-direction: column; gap: 2px; padding: 14px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); font-size: var(--fs-label); color: var(--fg-2); }
  .d-fig b { font-family: var(--er-display); font-weight: 400; font-size: 34px; line-height: 1; color: var(--tone-text); }
  .d-asks { display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-body-sm); color: var(--fg-2); }
  .d-asks span::before { content: '— '; color: var(--tone-text); }
  .d-go { margin-top: auto; padding-top: 10px; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--tone-text); }
  .door:hover .d-go span { display: inline-block; transform: translateX(6px); transition: transform 0.4s var(--er-ease); }
  @media (max-width: 960px) { .doors { grid-template-columns: minmax(0, 1fr); } }

  /* trust */
  .trust { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .pipe { display: grid; grid-template-columns: minmax(0, 1fr) minmax(40px, 0.7fr) minmax(0, 1fr); grid-template-rows: repeat(3, auto) auto; gap: 14px 0; align-items: center; }
  .p-src { grid-column: 1; border: 1px solid var(--rule-strong); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; background: var(--lift); }
  .p-src b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 18px; color: var(--fg); }
  .p-src span { font-size: var(--fs-label); color: var(--fg-3); }
  .p-wire { grid-column: 2; width: 100%; height: 40px; overflow: visible; }
  .p-wire path { fill: none; stroke: var(--rule-strong); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .p-wire .flow { stroke: var(--er-orange-ink); stroke-dasharray: 3 14; animation: pflow 1.4s linear infinite; vector-effect: non-scaling-stroke; }
  @keyframes pflow { to { stroke-dashoffset: -34; } }
  .p-how { grid-column: 2; align-self: start; margin-top: -2px; text-align: center; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); padding: 0 6px; transform: translateY(26px); }
  .p-page { grid-column: 3; grid-row: 1 / 4; align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 22px;
    border: 2px solid var(--er-orange-ink); background: rgba(232, 134, 58, 0.08); }
  .p-page b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(24px, 2.4vw, 34px); color: var(--er-orange-ink); line-height: 1; }
  .p-page span { font-size: var(--fs-label); color: var(--fg-2); }
  .p-fail { grid-column: 1 / -1; display: flex; gap: 14px; align-items: flex-start; margin-top: 16px; padding: 16px; border: 1px dashed var(--fail); font-size: var(--fs-label); color: var(--fg-2); line-height: 1.5; }
  .p-fail b { color: var(--fg); }
  .pf-x { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-pill); background: var(--fail); color: var(--er-ink); font-weight: 700; }
  @media (max-width: 960px) { .trust { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 560px) {
    .pipe { grid-template-columns: minmax(0, 1fr); }
    .p-wire, .p-how { display: none; }
    .p-page { grid-column: 1; grid-row: auto; }
  }
</style>
