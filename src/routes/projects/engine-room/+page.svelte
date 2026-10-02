<script lang="ts">
  // The index. Three features, one loop between them, and the one promise that makes the
  // study worth trusting: every figure on it is read from the code that runs the feature.
  //
  // The old index was seven chapters, two animated set pieces and a nineteen-screen tour.
  // It explained the whole site and went out of date with it. This page names three
  // things, shows how they feed each other, and gets out of the way.
  import Instrument from './components/viz/Instrument.svelte';
  import Steps from './components/viz/Steps.svelte';
  import Stat from './components/viz/Stat.svelte';
  import { PARTS, href } from './lib/nav';
  import { app } from './lib/appState.svelte';
  import { APP } from './lib/app';
  import { num, pct } from './lib/format';

  let { data } = $props();
  const eli = $derived(app.narrative === 'eli5');
  const f = $derived(data.facts);
  const live = $derived(data.live);

  // The loop, in the features' own vocabulary. Each step links to where it's explained.
  const loop = $derived([
    { id: 'notice', label: 'Daydream notices', sub: `one question every ${f.daydream.cadenceMinutes} min`, href: href('daydream', 'questions') },
    { id: 'decide', label: 'I decide', sub: f.daydream.stages.map((s) => s.label).join(' → '), href: href('daydream', 'inbox') },
    { id: 'queue', label: 'Ideas queue', sub: `${f.build.ideaSources.length} ways in, one backlog`, href: href('build', 'backlog') },
    { id: 'build', label: 'It builds', sub: `brief → preview → ${f.build.releasePolicies.at(-1)?.label.toLowerCase()}`, href: href('build', 'develop') },
    { id: 'pocket', label: 'In my pocket', sub: `${APP.tabs.length} tabs, ${APP.widgets.length + APP.complications.length} widgets`, href: href('app', 'surfaces') },
  ]);
  let picked = $state<string | null>(null);
  const pickedStep = $derived(loop.find((s) => s.id === picked) ?? null);

  const headline: Record<string, { value: string; label: string }> = $derived({
    daydream: { value: pct(live.daydream?.hitRate), label: `of rated notes were useful, last ${f.daydream.impactWindowDays} days` },
    build: { value: num(live.build?.lanes.shipped ?? (live.build ? 0 : null)), label: 'deliveries shipped as pull requests or deploys' },
    app: { value: num(f.app.nativeAreas.reduce((a, x) => a + x.endpoints, 0)), label: 'native endpoints the app can call' },
  });
</script>

<svelte:head>
  <title>The Engine Room — Daydream, Build and the App</title>
  <meta name="description" content="How three unusual parts of strangeramblings.com work: an assistant that daydreams about my life, a site that builds its own changes, and the iPhone app around it. Every figure is read from the running code." />
</svelte:head>

<section class="pe-route er-index">
  <header class="hero">
    <span class="pe-eyebrow">Field study · Three features, explained</span>
    <h1 class="hero-title">The Engine&nbsp;Room</h1>
    <p class="hero-line">
      {#if eli}
        Most of this site is an ordinary site. Three parts of it aren’t. While I’m busy it thinks about my life and
        writes down what it notices. The ideas I like, it builds into the site itself. And all of it lives in my
        pocket as an iPhone app. This is how those three work.
      {:else}
        Three subsystems worth explaining: an idle-cycle reasoning loop over my own data, an autonomous delivery
        pipeline that changes the site’s code behind a brief, a preview and CI, and a native app that reaches the
        site through one guarded API. Everything else here is ordinary engineering and isn’t covered.
      {/if}
    </p>
  </header>

  <nav class="parts" aria-label="The three parts">
    {#each PARTS as p (p.id)}
      <a class="part" href={href(p.id)} style="--tone:{p.tone}">
        <span class="p-no">Part {p.no}</span>
        <b class="p-name">{p.name}</b>
        <span class="p-strap">{p.strap}</span>
        <Stat value={headline[p.id].value} label={headline[p.id].label} tone={p.tone} />
        <span class="p-leaves">{p.leaves.map((l) => l.label).join(' · ')}</span>
      </a>
    {/each}
  </nav>

  <Instrument
    kicker="The loop"
    title="One feeds the next"
    reading="Select a step to see where it’s explained."
    readingEli5="Tap a step to see where it’s explained."
    takeaway="A daydream note can become a build idea, a build can change what the app shows, and the app is where I answer the next note."
  >
    <Steps items={loop.map(({ id, label, sub }) => ({ id, label, sub }))} selected={picked} onselect={(id) => (picked = picked === id ? null : id)} />
    {#if pickedStep}
      <p class="go"><a href={pickedStep.href}>Read about “{pickedStep.label}” →</a></p>
    {/if}
  </Instrument>

  <aside class="promise">
    <h2 class="pe-h2">How this study keeps up</h2>
    {#if eli}
      <p class="pe-prose">The last version of this page was written by hand, and it went out of date as fast as I changed the site.
        This one doesn’t copy anything. Stage names, limits and schedules are read from the code that runs each feature.
        Counts are read live from the database, totals only, never anyone’s data. What the app is made of is read from
        the app’s own source. If a feature changes and nobody updates the words, the build fails rather than the page lying.</p>
    {:else}
      <p class="pe-prose">Three mechanisms. Facts are imported from the feature modules on the server, so a changed cap or a new stage
        reaches the page on the next deploy. Explainer copy is keyed by the feature’s own union types with
        <code>satisfies Record&lt;…&gt;</code>, so a stage added without a sentence fails svelte-check, and a drift test pins the
        rest. Live aggregates come from the layout load, counts only, memoised and edge-cached. The app’s composition is a
        manifest generated from its Swift source{APP.source.commit ? ` (commit ${APP.source.commit})` : ''}.</p>
    {/if}
  </aside>
</section>

<style>
  .hero { margin: 8px 0 22px; }
  .hero-title { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(34px, 6vw, 56px); line-height: 1; letter-spacing: -0.03em; margin: 0 0 14px; }
  .hero-line { margin: 0; font-size: 18px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  .parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 0 0 26px; }
  .part { --tone: var(--accent-ink); display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-top: 3px solid var(--tone); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.5); padding: 14px 16px; transition: background 0.13s, border-color 0.13s; }
  .part:hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.34); border-top-color: var(--tone); }
  .p-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em; text-transform: uppercase; color: var(--tone); }
  .p-name { font-family: var(--fs-serif); font-weight: 600; font-size: 24px; letter-spacing: -0.01em; color: var(--text-primary); }
  .p-strap { font-size: var(--fs-label); color: rgba(28,22,17,0.7); margin-bottom: 4px; }
  .p-leaves { margin-top: 6px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }

  .go { margin: 12px 0 0; font-size: var(--fs-label); }
  .go a { color: var(--accent-ink); }
  .promise { margin: 6px 0 10px; }
</style>
