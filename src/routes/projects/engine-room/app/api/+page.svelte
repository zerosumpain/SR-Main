<script lang="ts">
  // Native API — the app's doorway into the site. Every endpoint is listed from the route
  // ledger (lib/routes.ts) joined to the build-time route manifest, so the list is what the
  // deployed build serves, and a new native route without a ledger entry fails the drift
  // test. Pairing lifetimes come from $lib/server/native-auth through facts.
  //
  // Four bands: the door itself (paired phone or stranger), pairing step by step, the way
  // notifications come back, and the map of every endpoint by area.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Counter from '../../components/kit/Counter.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import OnTheSite from '../../components/OnTheSite.svelte';
  import Doorway from '../../components/art/app/Doorway.svelte';
  import Pairing, { type PairStep } from '../../components/art/app/Pairing.svelte';
  import { APP_COPY as C, AREA_COPY, PAIRING_COPY, DOORWAY_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';
  import { cascade, shown } from '../../lib/motion';

  let { data } = $props();
  const f = $derived(data.facts.app);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  let mode = $state<'paired' | 'stranger'>('paired');

  const STEPS = Object.keys(PAIRING_COPY) as PairStep[];
  let step = $state<PairStep>('code');
  const si = $derived(STEPS.indexOf(step));

  let privateMode = $state(false);

  // Every /api/native route the study shows, grouped by its first segment — including the
  // ones another page explains in depth (Daydream's, for instance).
  const native = $derived(data.facts.routes.filter((r) => r.path.startsWith('/api/native/')));
  const areaOf = (p: string) => p.split('/')[3];
  const areas = $derived(f.nativeAreas.filter((a) => native.some((r) => areaOf(r.path) === a.area)));
  const top = $derived(Math.max(1, ...areas.map((a) => a.endpoints)));
  let picked = $state<string | null>(null);
  const area = $derived(picked ?? areas[0]?.area ?? null);
  const areaRoutes = $derived(native.filter((r) => areaOf(r.path) === area));
</script>

<svelte:head><title>Native API — App — The Engine Room</title></svelte:head>

<LeafHead part="app" title="Native API" line={C.api.line.eng} lineEli5={C.api.line.plain} />

<!-- 1 · the door -->
<Band surface="deep" part="app" label="One doorway">
  <Instrument kicker="The one way in" title="Who gets through the door?" bare
    reading="Every request from the phone arrives at the same door. Switch between a phone I’ve paired and anything else.">
    {#snippet controls()}
      <div class="seg" role="group" aria-label="Who is knocking">
        <button class:on={mode === 'paired'} aria-pressed={mode === 'paired'} onclick={() => (mode = 'paired')}>A paired phone</button>
        <button class:on={mode === 'stranger'} aria-pressed={mode === 'stranger'} onclick={() => (mode = 'stranger')}>Anything else</button>
      </div>
    {/snippet}
    <div class="door-wrap"><Doorway {mode} /></div>
    <p class="say" aria-live="polite">{t(mode === 'paired' ? DOORWAY_COPY.paired : DOORWAY_COPY.stranger)}</p>
  </Instrument>
</Band>

<!-- 2 · pairing -->
<Band surface="ink" part="app" label="Pairing a phone">
  <div class="pair">
    <div class="p-words">
      <span class="er-kicker">Getting in · step by step</span>
      <h2 class="er-display p-title">Pairing<br />a phone</h2>
      <div class="p-stats" {@attach cascade()}>
        <Stat value={f.pairCodeMinutes} unit="min" label="a pairing code lasts before it’s useless" />
        <Stat value={f.deviceTokenDays} unit="days" label="a paired phone’s key lasts, unless I switch it off sooner" />
      </div>
    </div>
    <div class="p-stage">
      <Steps items={STEPS.map((s) => ({ id: s, label: PAIRING_COPY[s].label }))} selected={step} onselect={(id) => (step = id as PairStep)} />
      <div class="p-art"><Pairing {step} /></div>
      <p class="say" aria-live="polite"><b>{si + 1} · {PAIRING_COPY[step].label}.</b> {t(PAIRING_COPY[step])}</p>
      <div class="p-nav">
        <button disabled={si === 0} onclick={() => (step = STEPS[si - 1])}>← Back</button>
        <button class="go" disabled={si === STEPS.length - 1} onclick={() => (step = STEPS[si + 1])}>Next step →</button>
      </div>
    </div>
  </div>
</Band>

<!-- 3 · coming back -->
<Band surface="paper" part="app" label="Notifications">
  <div class="push">
    <div class="phone-wrap" {@attach shown()}>
      <svg viewBox="0 0 300 520" class="lock" role="img" aria-label={privateMode ? 'A private notification that only says there is something to see.' : 'A notification showing its detail.'}>
        <defs><linearGradient id="api-wall" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#3a2410" /><stop offset="1" stop-color="#96613a" /></linearGradient></defs>
        <rect x="10" y="10" width="280" height="500" rx="46" fill="#241709" />
        <rect x="22" y="22" width="256" height="476" rx="36" fill="url(#api-wall)" />
        <rect x="112" y="34" width="76" height="22" rx="11" fill="#000" />
        <rect x="104" y="96" width="44" height="52" rx="8" class="dig" /><rect x="154" y="96" width="44" height="52" rx="8" class="dig" />
        <g class="note" class:priv={privateMode}>
          <rect x="34" y="232" width="232" height={privateMode ? 64 : 120} rx="18" class="n-card" />
          <rect x="50" y="248" width="22" height="22" rx="6" class="n-ico" />
          <text x="82" y="264" class="n-from">THE SITE</text>
          {#if privateMode}
            <text x="50" y="286" class="n-body">Something to see</text>
          {:else}
            <rect x="50" y="284" width="190" height="10" rx="5" class="n-ln" />
            <rect x="50" y="302" width="160" height="10" rx="5" class="n-ln" />
            <rect x="50" y="320" width="120" height="10" rx="5" class="n-ln" />
          {/if}
        </g>
      </svg>
    </div>
    <div class="push-words">
      <span class="er-kicker">Coming back</span>
      <h2 class="er-display p-title dark">The site<br />writes back</h2>
      <p class="er-lede">{t(C.api.push)}</p>
      <label class="toggle">
        <input type="checkbox" bind:checked={privateMode} />
        <span class="tg-track" aria-hidden="true"><span class="tg-dot"></span></span>
        Private notifications on this phone
      </label>
      <p class="say">{privateMode ? t(DOORWAY_COPY.redacted) : (eli ? 'Family members only see the areas they’ve been given. A parent can look at the app as a child sees it, but can’t act as them.' : 'Member access is per area, checked on every native route. View-as is read-only.')}</p>
    </div>
  </div>
</Band>

<!-- 4 · every endpoint -->
<Band surface="ink" part="app" label="Every endpoint">
  <header class="m-head">
    <span class="er-kicker">From the route list this build serves</span>
    <h2 class="er-display p-title"><span class="hl"><Counter value={native.length} /></span> doorways,<br />{areas.length} areas</h2>
    <p class="er-lede">Each bar is one area of the site the phone can reach, drawn as long as the number of endpoints in it. Pick one to see every endpoint, who may use it and what it’s for.</p>
  </header>
  <div class="map">
    <ul class="bars" {@attach cascade(':scope > li', { gap: 0.03, y: 10 })}>
      {#each areas as a (a.area)}
        <li>
          <button class:on={area === a.area} aria-pressed={area === a.area} onclick={() => (picked = a.area)}>
            <span class="b-name">{words(a.area)}</span>
            <span class="b-track"><span class="b-fill" style="width:{(a.endpoints / top) * 100}%"></span></span>
            <span class="b-n">{a.endpoints}</span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="list">
      {#if area}
        {#key area}
          <h3 class="l-title">{words(area)}</h3>
          <p class="l-what">{AREA_COPY[area] ?? ''}</p>
          <OnTheSite routes={areaRoutes} title="Endpoints" compact />
        {/key}
      {/if}
    </div>
  </div>
</Band>

<PageFoot />

<style>
  .door-wrap { max-width: 860px; margin: 8px auto 0; }
  .say { margin: 18px 0 0; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); max-width: 70ch; }
  .say b { color: var(--fg); }

  .pair { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: clamp(28px, 5vw, 80px); align-items: start; }
  .p-title { font-size: clamp(34px, 4.6vw, 68px); margin-bottom: 26px; }
  .p-title .hl { color: var(--tone-text); }
  .p-stats { display: grid; gap: 22px; }
  .p-art { margin: 24px 0 0; padding: 18px; border: 1px solid var(--rule); background: var(--wash); }
  .p-nav { display: flex; gap: 8px; margin-top: 18px; }
  .p-nav button { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
    padding: 10px 16px; border-radius: var(--radius-pill); background: transparent; color: var(--fg); border: 1px solid var(--rule-strong); }
  .p-nav button.go { background: var(--tone-text); color: var(--er-ink); border-color: var(--tone-text); }
  .p-nav button:disabled { opacity: 0.35; cursor: default; }

  .push { display: grid; grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .phone-wrap { max-width: 300px; justify-self: center; width: 100%; }
  .lock { display: block; width: 100%; height: auto; }
  .dig { fill: rgba(243, 235, 221, 0.85); }
  .n-card { fill: rgba(26, 16, 8, 0.75); transition: height 0.5s var(--er-ease); }
  .n-ico { fill: var(--er-bronze-ink); }
  .n-from { font-family: var(--er-mono); font-size: 13px; letter-spacing: 0.1em; fill: rgba(243, 235, 221, 0.7); }
  .n-body { font-family: var(--er-body); font-size: 16px; fill: #f3ebdd; }
  .n-ln { fill: rgba(243, 235, 221, 0.8); }
  .phone-wrap:global([data-armed]) .note { opacity: 0; transform: translateY(-60px); }
  .phone-wrap:global([data-armed][data-shown]) .note { opacity: 1; transform: none; transition: opacity 0.6s 0.3s, transform 0.8s 0.3s var(--er-ease); }
  .toggle { display: inline-flex; align-items: center; gap: 12px; margin-top: 24px; cursor: pointer; font-size: var(--fs-nav); color: var(--fg); }
  .toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .tg-track { width: 48px; height: 28px; border-radius: var(--radius-pill); background: var(--rule-strong); position: relative; transition: background 0.3s; }
  .tg-dot { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: var(--radius-pill); background: var(--ground); transition: transform 0.3s var(--er-ease); }
  .toggle input:checked + .tg-track { background: var(--you); }
  .toggle input:checked + .tg-track .tg-dot { transform: translateX(20px); }
  .toggle input:focus-visible + .tg-track { outline: 2px solid var(--you); outline-offset: 2px; }

  .m-head { max-width: 780px; margin-bottom: clamp(24px, 3vw, 40px); }
  .map { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: clamp(24px, 4vw, 56px); align-items: start; }
  .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .bars button { width: 100%; display: grid; grid-template-columns: minmax(9ch, 14ch) minmax(0, 1fr) 3ch; gap: 12px; align-items: center; padding: 8px 10px;
    background: transparent; border: 1px solid transparent; border-radius: var(--radius-sharp); cursor: pointer; color: var(--fg-2); font-family: var(--er-body); font-size: var(--fs-label); text-align: left; }
  .bars button:hover { background: var(--wash); color: var(--fg); }
  .bars button.on { border-color: var(--tone-text); color: var(--fg); background: var(--wash); }
  .b-name { text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .b-track { height: 14px; background: var(--rule); position: relative; }
  .b-fill { position: absolute; inset: 0 auto 0 0; background: var(--tone); transition: background 0.3s; }
  .bars button.on .b-fill { background: var(--tone-text); }
  .b-n { font-family: var(--er-mono); font-size: var(--fs-label-xs); text-align: right; color: var(--fg); }
  .list { border-top: 3px solid var(--tone-text); padding-top: 16px; }
  .l-title { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 28px; margin: 0 0 6px; }
  .list :global(.ots-row) { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); }
  .list :global(.ots-who) { grid-column: 2; text-align: left; }
  .l-what { margin: 0 0 18px; font-family: var(--er-serif); font-style: italic; font-size: 19px; color: var(--fg-2); }

  @media (max-width: 900px) {
    .pair, .push, .map { grid-template-columns: minmax(0, 1fr); }
  }
</style>
