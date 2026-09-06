<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import HeroBackground from '$lib/components/landing/HeroBackground.svelte';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import { HERO_BACKGROUND_DEFAULTS, type HeroBackgroundAsset, type HeroBackgroundSettings } from '$lib/constants/hero-background';

  let { settings, asset, result }: {
    settings: HeroBackgroundSettings;
    asset: HeroBackgroundAsset | null;
    result?: { backgroundSaved?: boolean; backgroundError?: string } | null;
  } = $props();
  let draft = $state(untrack(() => ({ ...settings })));
  let preview = $state<HeroBackgroundSettings | null>(null);
  let replay = $state(0);
  let saving = $state(false);
  let ready = $state(false);
  onMount(() => { ready = true; });
  const fields = [
    { key: 'delayMs', label: 'Start delay (ms)', min: 0, max: 10000, step: 100 },
    { key: 'playbackRate', label: 'Playback speed', min: 0.25, max: 2, step: 0.25 },
    { key: 'holdMs', label: 'Hold last frame (ms)', min: 0, max: 15000, step: 100 },
    { key: 'fadeMs', label: 'Fade duration (ms)', min: 0, max: 15000, step: 100 },
    { key: 'playingOpacity', label: 'Playback opacity (%)', min: 0, max: 100, step: 1 },
    { key: 'finalTransparency', label: 'Final transparency (%)', min: 0, max: 100, step: 1 },
    { key: 'positionX', label: 'Horizontal position (%)', min: 0, max: 100, step: 1 },
    { key: 'positionY', label: 'Vertical position (%)', min: 0, max: 100, step: 1 },
  ] as const;
</script>

<section class="nm-sec" aria-labelledby="background-title">
  <div class="nm-sec-hd"><h2 id="background-title">Hero animation</h2></div>
  <p>Play once behind the hero, hold the last frame, then fade before layering it over the title.
    80% transparency leaves the image 20% visible.</p>
  {#if asset}
    <p class="asset-info">Web-ready animation · {asset.duration.toFixed(1)} seconds ·
      {(asset.desktopBytes / 1024).toFixed(0)} KB desktop / {(asset.mobileBytes / 1024).toFixed(0)} KB phone</p>
  {:else}
    <p class="asset-info" role="status">The animation from /drive/siteherobackground has not been prepared in this environment yet.
      You can save playback settings now; the homepage will keep its usual hero until the web-ready animation is available.</p>
  {/if}
  <form method="POST" action="?/background" use:enhance={() => {
    saving = true;
    return async ({ update }) => { try { await update({ reset: false }); } finally { saving = false; } };
  }}>
    <div class="checks">
      <label><input type="checkbox" name="enabled" bind:checked={draft.enabled} /> Play on page load</label>
      <label><input type="checkbox" name="overlayTitle" bind:checked={draft.overlayTitle} /> Layer over title after fading</label>
    </div>
    <div class="fields">
      {#each fields as field}
        <label class="nm-field"><span class="sr-label-tight">{field.label}</span>
          <input class="nm-text-input" type="number" name={field.key} min={field.min} max={field.max}
            step={field.step} required bind:value={draft[field.key]} />
        </label>
      {/each}
      <label class="nm-field"><span class="sr-label-tight">Frame fit</span>
        <select class="nm-text-input" name="fit" bind:value={draft.fit}>
          <option value="cover">Fill hero (crop edges)</option><option value="contain">Show whole frame</option>
        </select>
      </label>
    </div>
    <p class="asset-info">Muted, single playback. Reduced-motion and data-saving preferences show only the final still.
      Playback pauses when the hero is off screen.</p>
    <div class="actions">
      <button class="nm-btn-ghost save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save animation settings'}</button>
      <button class="nm-btn-ghost" type="button" disabled={!ready || !asset || !draft.enabled}
        onclick={() => { preview = { ...draft }; replay += 1; }}>Preview / replay</button>
      <button class="nm-btn-ghost" type="button" disabled={!ready} onclick={() => { draft = { ...HERO_BACKGROUND_DEFAULTS }; }}>Reset controls</button>
      <a href="/" target="_blank" rel="noreferrer">Open homepage ↗</a>
    </div>
    {#if result?.backgroundSaved}<p role="status">Animation settings saved.</p>{/if}
    {#if result?.backgroundError}<p role="alert">{result.backgroundError}</p>{/if}
  </form>
  {#if preview && asset}
    {#key `${replay}:${asset.desktop}`}
      <div class="animation-preview">
        <HeroBackground settings={preview} {asset} />
        <div class="preview-title"><LandingHero tag="Animation preview" /></div>
      </div>
    {/key}
  {/if}
</section>

<style>
  h2 { font-family: var(--font-display); font-size: var(--fs-body-lg); }
  p { font-size: var(--fs-body); line-height: 1.6; }
  .asset-info { color: var(--text-muted); font-size: var(--fs-label); margin-block: 8px; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-block: 20px; }
  .nm-field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .checks, .actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
  .checks { margin-top: 16px; }
  .checks label { display: flex; gap: 8px; align-items: center; }
  .checks input { accent-color: var(--accent); }
  .save { color: var(--accent); border-color: var(--accent); }
  .animation-preview { position: relative; isolation: isolate; overflow: hidden; min-height: 360px;
    display: flex; align-items: center; padding: clamp(16px, 3vw, 36px); border: 1px solid var(--line-strong); margin-top: 20px; }
  .preview-title { position: relative; z-index: 1; min-width: 0; }
  @media (max-width: 640px) { .preview-title :global(.lh-title) { font-size: 36px; } }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 3px;
  }
</style>
