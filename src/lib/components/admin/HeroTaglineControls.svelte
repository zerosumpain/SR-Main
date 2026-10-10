<script lang="ts">
  // The landing masthead's subtitle, the line under "JK's strange ramblings".
  // Saved to app_settings (`landing.tagline`); saving an empty box deletes
  // the setting so the built-in line shows again. "Reset to default" only
  // empties the box, like the animation panel's "Reset controls": nothing
  // changes until Save, so the owner's line can still be had back by reloading.
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import { DEFAULT_LANDING_TAGLINE, LANDING_TAGLINE_MAX } from '$lib/constants/landing-tagline';

  let { tagline, result }: {
    /** The saved tagline, or null while the default shows. */
    tagline: string | null;
    result?: { taglineSaved?: boolean; taglineReset?: boolean; taglineError?: string; taglineValue?: string } | null;
  } = $props();

  // A failed full-page (no-JS) save comes back with the typed line, so the box
  // keeps it; with JS, enhance keeps the draft and this runs only once anyway.
  let draft = $state(untrack(() => result?.taglineValue ?? tagline ?? ''));
  let unsaved = $derived(draft.trim() !== (tagline ?? ''));
  let saving = $state(false);
</script>

<section class="nm-sec" aria-labelledby="hero-tagline-title">
  <div class="nm-sec-hd"><h2 id="hero-tagline-title">Tagline</h2></div>
  <p>The line under “JK’s strange ramblings” on the homepage, in every view. Plain text, one line,
    up to {LANDING_TAGLINE_MAX} characters. Leave it empty to use the default.</p>
  <form method="POST" action="?/tagline" use:enhance={() => {
    saving = true;
    return async ({ result: outcome, update }) => {
      try {
        await update({ reset: false });
        // Show what was stored (trimmed), or the empty box the default stands behind.
        if (outcome.type === 'success') draft = tagline ?? '';
      } finally { saving = false; }
    };
  }}>
    <label class="nm-field"><span class="sr-label-tight">Tagline</span>
      <input class="nm-text-input" type="text" name="tagline" maxlength={LANDING_TAGLINE_MAX}
        placeholder={DEFAULT_LANDING_TAGLINE} bind:value={draft} aria-describedby="hero-tagline-count" />
    </label>
    <p class="summary" id="hero-tagline-count">{draft.length} / {LANDING_TAGLINE_MAX} characters ·
      {tagline === null ? 'Showing the default.' : 'Showing your saved line.'}{#if unsaved}{' '}Unsaved: press Save tagline.{/if}</p>
    <div class="actions">
      <button class="nm-btn-ghost save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save tagline'}</button>
      <button class="nm-btn-ghost" type="button" disabled={saving || draft === ''}
        onclick={() => { draft = ''; }}>Reset to default</button>
      <a href="/" target="_blank" rel="noreferrer">Open homepage ↗</a>
    </div>
    {#if result?.taglineError}<p role="alert">{result.taglineError}</p>{/if}
    {#if result?.taglineSaved}<p role="status">{result.taglineReset ? 'Tagline reset to the default.' : 'Tagline saved.'}</p>{/if}
  </form>
  <p class="summary">Default: {DEFAULT_LANDING_TAGLINE}</p>
</section>

<style>
  h2 { font-family: var(--font-display); font-size: var(--fs-body-lg); }
  p { font-size: var(--fs-body); line-height: 1.6; }
  .nm-field { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
  input { width: 100%; }
  .actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
  .save { color: var(--accent); border-color: var(--accent); }
  .summary { font-size: var(--fs-label); color: var(--text-muted); }
  :is(button, input, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
