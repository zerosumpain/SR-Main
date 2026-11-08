<script lang="ts">
  // The App hub. The hero shows the whole idea in one drawing: devices, one doorway, the site.
  // The ink band counts what the app is made of, read from its own project files and the
  // site's route list, and lays out its targets as the pieces Apple ships.
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import AppEmblem from '../components/art/app/AppEmblem.svelte';
  import { APP } from '../lib/app';
  import { cascade } from '../lib/motion';

  let { data } = $props();
  const areas = $derived(data.facts.app.nativeAreas);
  const endpoints = $derived(areas.reduce((a, x) => a + x.endpoints, 0));
  const phones = APP.targets.filter((t) => t.platform === 'iOS' && t.type === 'application').length;
  const watches = APP.targets.filter((t) => t.platform === 'watchOS' && t.type === 'application').length;

  // What each target is, in words a visitor would use. Keyed by platform and kind, so a new
  // target still gets a sensible line.
  const PLATFORM: Record<string, string> = { iOS: 'iPhone', watchOS: 'Apple Watch' };
  const kindOf = (t: (typeof APP.targets)[number]) =>
    t.type === 'application' ? `the ${PLATFORM[t.platform] ?? t.platform} app` : `${PLATFORM[t.platform] ?? t.platform} widgets and live updates`;
</script>

<svelte:head><title>App — The Engine Room</title></svelte:head>

<PartHub part="app">
  {#snippet art()}<AppEmblem {phones} {watches} />{/snippet}

  <div class="live">
    <header class="l-head">
      <span class="er-kicker">What it’s made of · read from the app’s own source</span>
      <h2 class="er-display l-title">{APP.targets.length} pieces,<br />one doorway</h2>
    </header>
    <div class="stats" {@attach cascade()}>
      <Stat value={endpoints} label="doorways on the site the app can knock on" lead />
      <Stat value={APP.tabs.length} label="tabs on the phone" />
      <Stat value={APP.widgets.length + APP.complications.length} label="widgets, Lock Screen and watch-face extras" />
      <Stat value={APP.intents.length} label="things you can ask Siri to do" />
    </div>
    <ol class="targets" {@attach cascade(':scope > li', { gap: 0.1 })}>
      {#each APP.targets as t, i (t.id)}
        <li>
          <span class="t-no">{String(i + 1).padStart(2, '0')}</span>
          <svg viewBox="0 0 40 40" aria-hidden="true" class="t-ico">
            {#if t.platform === 'watchOS'}
              <rect x="10" y="9" width="20" height="22" rx="6" /><path d="M15 9V3h10v6M15 31v6h10v-6" />
            {:else}
              <rect x="12" y="3" width="16" height="34" rx="4" /><path d="M17 7h6" />
            {/if}
            {#if t.type !== 'application'}<rect class="ext" x="24" y="22" width="12" height="12" rx="2" />{/if}
          </svg>
          <b>{kindOf(t)}</b>
          <span class="t-kind">{t.type === 'application' ? 'an app' : 'an extension'} · {PLATFORM[t.platform] ?? t.platform}</span>
        </li>
      {/each}
    </ol>
  </div>
</PartHub>
<PageFoot />

<style>
  .l-head { margin-bottom: clamp(24px, 3vw, 40px); }
  .l-title { font-size: clamp(34px, 4.6vw, 68px); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px 28px; margin-bottom: clamp(32px, 4vw, 56px); }
  .targets { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px;
    background: var(--rule); border: 1px solid var(--rule); }
  .targets li { background: var(--ground); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
  .t-no { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); letter-spacing: 0.12em; }
  .t-ico { width: 44px; height: 44px; }
  .t-ico rect, .t-ico path { fill: none; stroke: var(--fg); stroke-width: 2.4; }
  .t-ico .ext { fill: var(--tone); stroke: var(--tone); }
  .targets b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 19px; line-height: 1.05; color: var(--fg); }
  .t-kind { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
</style>
