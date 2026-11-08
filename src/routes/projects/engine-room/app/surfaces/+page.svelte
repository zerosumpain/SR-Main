<script lang="ts">
  // Surfaces — everywhere the app shows up, generated from app-manifest.json (which
  // scripts/sync-app-manifest.mjs writes from the app's Swift source). The drawn phone and
  // watch change with the place picked, and the list beside them is the manifest's own.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Counter from '../../components/kit/Counter.svelte';
  import DeviceStage, { type Place } from '../../components/art/app/DeviceStage.svelte';
  import { APP, APP_COPY as C, TAB_COPY, MORE_COPY, WATCH_COPY, SURFACE_COPY, BACKGROUND_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';
  import { cascade, reveal } from '../../lib/motion';

  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  interface Row { name: string; what: string }
  const PLACES: Array<{ id: Place; label: string; rows: Row[]; note?: string }> = $derived([
    { id: 'phone', label: 'Inside the app', note: 'The tabs along the bottom of the app, and what each one is for.', rows: [
      ...APP.tabs.map((id) => ({ name: words(id), what: TAB_COPY[id] ?? '' })),
      ...APP.morePages.map((id) => ({ name: `More › ${words(id)}`, what: MORE_COPY[id] ?? '' })),
    ] },
    { id: 'lock', label: 'Lock Screen', note: SURFACE_COPY['live-activity'].plain,
      rows: APP.widgets.filter((w) => w.surface === 'live-activity').map((w) => ({ name: w.name, what: w.description ?? SURFACE_COPY['live-activity'].label })) },
    { id: 'home', label: 'Home Screen', note: SURFACE_COPY['home-screen'].plain,
      rows: APP.widgets.filter((w) => w.surface === 'home-screen').map((w) => ({ name: w.name, what: w.description ?? '' })) },
    { id: 'watch', label: 'Apple Watch', note: SURFACE_COPY['watch-face'].plain, rows: [
      ...APP.watchPages.map((id) => ({ name: `${words(id)} page`, what: WATCH_COPY[id] ?? '' })),
      ...APP.complications.map((c) => ({ name: `${c.name} complication`, what: c.description ?? '' })),
    ] },
    { id: 'siri', label: 'Siri and Shortcuts', note: `${APP.shortcuts} shortcuts with spoken phrases, also usable from the Action button.`,
      rows: APP.intents.map((i) => ({ name: i.title, what: '' })) },
    { id: 'background', label: 'In the background', note: 'Nothing on screen at all. The phone is in a pocket and the app still gets a turn.',
      rows: APP.backgroundModes.map((m) => ({ name: words(m), what: BACKGROUND_COPY[m] ? t(BACKGROUND_COPY[m]) : '' })) },
  ]);
  let place = $state<Place>('phone');
  const current = $derived(PLACES.find((p) => p.id === place)!);
  const total = $derived(PLACES.reduce((a, p) => a + p.rows.length, 0));

  // A drawn tile per game: a small pattern seeded from its position, so each looks its own.
  const glyph = (i: number) => i % 5;
</script>

<svelte:head><title>Surfaces — App — The Engine Room</title></svelte:head>

<LeafHead part="app" title="Surfaces" line={C.surfaces.line.eng} lineEli5={C.surfaces.line.plain} />

<Band surface="deep" part="app" label="Where it lives">
  <div class="stage-wrap">
    <div class="stage" {@attach reveal({ y: 40, duration: 1.1 })}>
      <DeviceStage {place} onpick={(p) => (place = p)} tabs={APP.tabs.length}
        homeWidgets={APP.widgets.filter((w) => w.surface === 'home-screen').length}
        complications={APP.complications.length} intents={APP.intents.length}
        watchPages={APP.watchPages.length} backgroundModes={APP.backgroundModes.length} />
    </div>
    <div class="panel">
      <span class="er-kicker">Where it lives · {total} things in {PLACES.length} places</span>
      <h2 class="er-display p-title">Pick a place</h2>
      <div class="places" role="tablist" aria-label="Place">
        {#each PLACES as p (p.id)}
          <button role="tab" aria-selected={place === p.id} class:on={place === p.id} onclick={() => (place = p.id)}>
            <span class="pl-lab">{p.label}</span><span class="pl-n">{p.rows.length}</span>
          </button>
        {/each}
      </div>
      <div class="detail" role="tabpanel" aria-live="polite">
        {#key place}
          <h3 class="d-title" {@attach reveal({ y: 12, duration: 0.5 })}>{current.label}</h3>
          {#if current.note}<p class="d-note">{current.note}</p>{/if}
          <ul class="rows" {@attach cascade(':scope > li', { y: 10, gap: 0.04, duration: 0.4 })}>
            {#each current.rows as r (r.name)}<li><b>{r.name}</b>{#if r.what}<span>{r.what}</span>{/if}</li>{/each}
          </ul>
        {/key}
      </div>
    </div>
  </div>
</Band>

<Band surface="ink" part="app" label="Family games">
  <div class="g-head">
    <span class="er-kicker">Also in the app · listed from its own catalogue</span>
    <h2 class="er-display g-title"><Counter value={APP.games.length} /> games<br />against the family</h2>
    <p class="er-lede g-lede">Quick head-to-heads the household can start from the Games tab. A game room lives on the site for as long as the game does, and everyone’s phone watches the same room.</p>
  </div>
  <ul class="games" {@attach cascade(':scope > li', { gap: 0.05 })}>
    {#each APP.games as g, i (g.id)}
      <li style="--r:{(i % 3) - 1}deg">
        <svg viewBox="0 0 60 60" aria-hidden="true" class="gl">
          {#if glyph(i) === 0}
            <circle cx="30" cy="30" r="20" /><circle class="f" cx="30" cy="30" r="8" />
          {:else if glyph(i) === 1}
            {#each [0, 1, 2] as c}<rect class:f={c === 1} x={8 + c * 16} y="20" width="13" height="20" rx="2" />{/each}
          {:else if glyph(i) === 2}
            <path d="M10 46 L30 12 L50 46Z" /><circle class="f" cx="30" cy="34" r="5" />
          {:else if glyph(i) === 3}
            {#each [0, 1, 2, 3] as c}<rect class:f={c === 0 || c === 3} x={12 + (c % 2) * 20} y={12 + Math.floor(c / 2) * 20} width="16" height="16" rx="2" />{/each}
          {:else}
            <rect x="12" y="12" width="36" height="36" rx="6" /><circle class="f" cx="22" cy="22" r="4" /><circle class="f" cx="38" cy="38" r="4" /><circle class="f" cx="30" cy="30" r="4" />
          {/if}
        </svg>
        <b>{g.title}</b>
      </li>
    {/each}
  </ul>
</Band>

<PageFoot />

<style>
  .stage-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 64px); align-items: start; }
  .stage { position: sticky; top: calc(var(--topH, 0px) + 20px); max-width: 600px; }
  .p-title { font-size: clamp(32px, 4vw, 56px); margin-bottom: 22px; }
  .places { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 24px; }
  .places button { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; cursor: pointer;
    padding: 12px 14px; background: var(--er-paper-hi); border: 1px solid var(--rule); border-radius: var(--radius-sharp);
    font-family: var(--er-body); font-size: var(--fs-nav); color: var(--fg); transition: background 0.25s, border-color 0.25s, color 0.25s; }
  .places button:hover { border-color: var(--tone-text); }
  .places button.on { background: var(--er-ink); border-color: var(--er-ink); color: var(--er-cream); }
  .pl-n { font-family: var(--er-display); font-size: 20px; color: var(--tone-text); }
  .places button.on .pl-n { color: var(--er-bronze-ink); }
  .detail { border-top: 3px solid var(--tone); padding-top: 16px; }
  .d-title { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 24px; margin: 0 0 8px; }
  .d-note { margin: 0 0 14px; font-family: var(--er-serif); font-style: italic; font-size: 19px; line-height: 1.4; color: var(--fg); }
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li { display: grid; grid-template-columns: minmax(12ch, 18ch) minmax(0, 1fr); gap: 4px 16px; padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: var(--fs-label); }
  .rows b { font-weight: 600; text-transform: capitalize; color: var(--fg); }
  .rows span { color: var(--fg-2); line-height: 1.5; }
  @media (max-width: 900px) {
    .stage-wrap { grid-template-columns: minmax(0, 1fr); }
    .stage { position: relative; top: 0; max-width: 460px; margin: 0 auto; }
  }
  @media (max-width: 480px) {
    .places { grid-template-columns: minmax(0, 1fr); }
    .rows li { grid-template-columns: minmax(0, 1fr); }
  }

  .g-head { margin-bottom: clamp(28px, 4vw, 48px); max-width: 760px; }
  .g-title { font-size: clamp(34px, 4.8vw, 72px); margin-bottom: 18px; }
  .g-title :global(.ctr) { color: var(--tone-text); }
  .games { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
  .games li { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--rule); background: var(--lift);
    transition: transform 0.4s var(--er-ease), border-color 0.3s; }
  .games li:hover { transform: rotate(var(--r)) translateY(-4px); border-color: var(--tone-text); }
  .gl { width: 54px; height: 54px; }
  .gl :global(*) { fill: none; stroke: var(--fg-2); stroke-width: 3; }
  .gl :global(.f) { fill: var(--tone-text); stroke: var(--tone-text); }
  .games b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 17px; line-height: 1.1; color: var(--fg); }
</style>
