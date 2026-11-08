<script lang="ts">
  // Permissions — what the app asks the phone for, generated from the Info.plist usage keys
  // and the entitlements file via app-manifest.json. Keys only, never the wording or values.
  // The hero lets a visitor answer each prompt as the phone would show it; below, every
  // permission and every Apple-granted capability as a card with its purpose.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Counter from '../../components/kit/Counter.svelte';
  import PermIcon from '../../components/art/app/PermIcon.svelte';
  import PermissionPrompt from '../../components/art/app/PermissionPrompt.svelte';
  import { APP, APP_COPY as C, PERMISSION_COPY, ENTITLEMENT_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { cascade } from '../../lib/motion';

  const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ');
  const eli = $derived(app.narrative === 'eli5');

  // Group the usage keys by what they touch, so related asks sit together.
  const groupOf = (k: string) =>
    /health/i.test(k) ? 'Health' : /location|motion/i.test(k) ? 'Where and how I move' : /camera|microphone|speech/i.test(k) ? 'Seeing and hearing' : 'Everything else';
  // How iOS itself names each thing in the prompt. Unknown keys fall back to their words.
  const ASKS_FOR: Record<string, string> = {
    HealthShare: 'to read your Health data', HealthUpdate: 'to save workouts to Health', LocationWhenInUse: 'to use your location while you use it',
    LocationAlwaysAndWhenInUse: 'to use your location, even when it’s closed', Motion: 'to see your motion and fitness activity', Camera: 'to use the camera',
    LocalNetwork: 'to find devices on your local network', SpeechRecognition: 'to use speech recognition', Microphone: 'to use the microphone',
  };
  const perms = APP.permissions.map((k) => ({ key: k, name: ASKS_FOR[k] ?? `to use ${words(k).toLowerCase()}`, why: PERMISSION_COPY[k] ?? 'do its job', group: groupOf(k) }));
  const groups = [...new Set(perms.map((p) => p.group))].map((g) => ({ g, items: perms.filter((p) => p.group === g) }));
</script>

<svelte:head><title>Permissions — App — The Engine Room</title></svelte:head>

<LeafHead part="app" title="Permissions" line={C.privacy.line.eng} lineEli5={C.privacy.line.plain} />

<Band surface="deep" part="app" label="Try the prompts">
  <div class="try">
    <div class="t-words">
      <span class="er-kicker">Asked of me · try it</span>
      <h2 class="er-display t-title">Every time<br />it has to <span class="hl">ask</span></h2>
      <p class="er-lede">iPhone never lets an app quietly help itself. The first time the app wants any of these, the phone stops and asks, in a box like this one, and the reason underneath is the app’s own. Answer each one and see the next.</p>
      <p class="t-count"><b><Counter value={APP.permissions.length} /></b> prompts the app can ever show, read from its project file.</p>
    </div>
    <PermissionPrompt items={perms} />
  </div>
</Band>

<Band surface="paper" part="app" label="Permissions">
  <header class="g-head">
    <span class="er-kicker">What each one is for</span>
    <h2 class="er-display g-title">Asked of me</h2>
  </header>
  {#each groups as gr (gr.g)}
    <section class="grp">
      <h3 class="grp-h">{gr.g} <span>{gr.items.length}</span></h3>
      <ul class="cards" {@attach cascade(':scope > li', { gap: 0.06 })}>
        {#each gr.items as p (p.key)}
          <li>
            <span class="c-ico"><PermIcon name={p.key} /></span>
            <b>{words(p.key)}</b>
            <span class="c-why">{p.why}</span>
            {#if !eli}<code class="c-key">NS{p.key}UsageDescription</code>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</Band>

<Band surface="ink" part="app" label="Capabilities">
  <header class="g-head">
    <span class="er-kicker">Granted by Apple · signed into the app</span>
    <h2 class="er-display g-title"><span class="hl"><Counter value={APP.entitlements.length} /></span> things Apple<br />had to allow first</h2>
    <p class="er-lede">These aren’t questions for me. They’re capabilities Apple has to approve before the app can ship at all, written into its signature.</p>
  </header>
  <ul class="cards dark" {@attach cascade(':scope > li', { gap: 0.06 })}>
    {#each APP.entitlements as e (e)}
      <li>
        <span class="c-ico"><PermIcon name={e} /></span>
        <b>{words(e)}</b>
        <span class="c-why">{ENTITLEMENT_COPY[e] ?? ''}</span>
      </li>
    {/each}
  </ul>
</Band>

<PageFoot />

<style>
  .try { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .t-title { font-size: clamp(34px, 4.6vw, 68px); margin-bottom: 22px; }
  .t-title .hl, .g-title .hl { color: var(--tone-text); }
  .t-count { margin: 22px 0 0; font-size: var(--fs-body-sm); color: var(--fg-2); }
  .t-count b { font-family: var(--er-display); font-weight: 400; font-size: 34px; color: var(--tone-text); margin-right: 6px; }
  @media (max-width: 900px) { .try { grid-template-columns: minmax(0, 1fr); } }

  .g-head { max-width: 780px; margin-bottom: clamp(24px, 3vw, 40px); }
  .g-title { font-size: clamp(32px, 4.2vw, 60px); margin-bottom: 16px; }
  .grp { display: grid; grid-template-columns: minmax(14ch, 0.28fr) minmax(0, 1fr); gap: 12px 28px; padding: 22px 0; border-top: 1px solid var(--rule); }
  @media (max-width: 760px) { .grp { grid-template-columns: minmax(0, 1fr); } }
  .grp-h { font-family: var(--er-mono); font-weight: 500; font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--fg-2); margin: 6px 0 0; display: flex; gap: 10px; align-items: baseline; }
  .grp-h span { color: var(--tone-text); }
  .cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .cards li { display: flex; flex-direction: column; gap: 8px; padding: 20px; border: 1px solid var(--rule); border-top: 3px solid var(--tone); background: var(--er-paper-hi);
    transition: transform 0.4s var(--er-ease), border-color 0.3s; }
  .cards.dark li { background: var(--lift); }
  .cards li:hover { transform: translateY(-4px); }
  .c-ico { width: 44px; height: 44px; margin-bottom: 6px; }
  .cards b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 18px; line-height: 1.1; color: var(--fg); }
  .c-why { font-size: var(--fs-label); line-height: 1.5; color: var(--fg-2); }
  .c-key { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); overflow-wrap: anywhere; margin-top: auto; }
</style>
