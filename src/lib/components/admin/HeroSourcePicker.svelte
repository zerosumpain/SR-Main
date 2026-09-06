<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { HeroSourceOption, HeroPreparationJob } from '$lib/constants/hero-background';

  let { sources, activeSource, initialJob }: {
    sources: HeroSourceOption[];
    activeSource: { sourceId: string; sourceName: string } | null;
    initialJob: HeroPreparationJob | null;
  } = $props();
  let choice = $state(untrack(() => activeSource?.sourceId ?? ''));
  let job = $state(untrack(() => initialJob));
  let sending = $state(false);
  let message = $state('');
  let problem = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  let busy = $derived(sending || job?.phase === 'running');

  async function poll() {
    try {
      const response = await fetch('/admin/content/hero/background');
      if (!response.ok) throw new Error('Could not check progress. Refresh this page to reconnect.');
      job = (await response.json()).job;
      if (disposed) return;
      if (job?.phase === 'running') timer = setTimeout(poll, 2000);
      else {
        if (job?.phase === 'failed') problem = job.error ?? 'Preparation failed. Your previous background is still active.';
        else message = 'Background updated. The prepared animation is now used on the homepage.';
        await invalidateAll();
      }
    } catch (error) {
      if (disposed) return;
      problem = error instanceof Error ? error.message : 'Could not check preparation progress.';
      // Keep observing the server job after a transient network failure.
      timer = setTimeout(poll, 5000);
    }
  }

  async function apply() {
    problem = ''; message = ''; sending = true;
    try {
      const response = await fetch('/admin/content/hero/background', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: choice }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change the background.');
      job = result.job;
      if (job?.phase === 'running') timer = setTimeout(poll, 1000);
      else { message = 'Included animation restored.'; await invalidateAll(); }
    } catch (error) { problem = error instanceof Error ? error.message : 'Could not change the background.'; }
    finally { sending = false; }
  }

  onMount(() => {
    if (job?.phase === 'running') timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  });
</script>

<section class="nm-sec source-picker" aria-labelledby="hero-source-title">
  <div class="nm-sec-hd"><h2 id="hero-source-title">Background video</h2></div>
  <p>Choose an MP4 from <a href="/drive">Drive → siteherobackground</a>.
    Prepare &amp; apply downscales it to small desktop and phone copies, then switches the public homepage.
    Your original file stays untouched.</p>
  <p class="source-info">Active: <strong>{activeSource?.sourceName ?? 'Included animation'}</strong></p>
  <form onsubmit={event => { event.preventDefault(); void apply(); }}>
    <div class="nm-field"><label for="hero-source" class="sr-label-tight">MP4 from siteherobackground</label>
      <select id="hero-source" class="nm-text-input" bind:value={choice} disabled={busy}>
        <option value="">Included animation</option>
        {#if activeSource && !sources.some(source => source.id === activeSource.sourceId)}
          <option value={activeSource.sourceId} disabled>{activeSource.sourceName} — source unavailable</option>
        {/if}
        {#each sources as source}
          <option value={source.id}>{source.name} · {(source.sizeBytes / 1_000_000).toFixed(2)} MB</option>
        {/each}
      </select>
    </div>
    <div class="source-actions">
      <button type="submit" class="nm-btn-ghost primary" disabled={busy || (choice !== '' && !sources.some(source => source.id === choice))}>
        {busy ? 'Preparing…' : choice ? 'Prepare & apply' : 'Use included animation'}
      </button>
      <button type="button" class="nm-btn-ghost" disabled={busy} onclick={() => invalidateAll()}>Refresh folder</button>
    </div>
  </form>
  {#if !sources.length}<p class="source-info">No eligible MP4s found. Add an MP4 directly to siteherobackground, then refresh.</p>{/if}
  <p class="source-info">MP4s up to 50 MB and 60 seconds. Automatic downscaling: 960px desktop / 480px phone, muted, plus a final-frame still.
    Copies are saved in siteherobackground/web-ready. The existing background stays active until preparation succeeds.</p>
  {#if job?.phase === 'running'}<p role="status">Preparing {job.sourceName}… You can leave this page and return to check progress.</p>{/if}
  {#if problem || job?.phase === 'failed'}<p role="alert">{problem || job?.error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  h2 { font-family: var(--font-display); font-size: var(--fs-body-lg); }
  p { font-size: var(--fs-body); line-height: 1.6; overflow-wrap: anywhere; }
  .source-info { font-size: var(--fs-label); color: var(--text-muted); margin-block: 8px; }
  .nm-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  select { width: 100%; max-width: 100%; }
  .source-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block: 14px; }
  .primary { color: var(--accent); border-color: var(--accent); }
  :is(button, select, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
