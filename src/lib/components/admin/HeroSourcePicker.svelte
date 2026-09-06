<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { HERO_SLOTS, heroSlotLabel, type HeroSlot } from '$lib/constants/hero-slots';
  import type { HeroSourceOption, HeroPreparationJob } from '$lib/constants/hero-background';

  let { sources, slots, activity, initialJob, onselect }: {
    sources: HeroSourceOption[];
    slots: { id: HeroSlot; source: { sourceId: string; sourceName: string } | null }[];
    activity: { slot: HeroSlot; steps: number | null };
    onselect: (slot: HeroSlot) => void;
    initialJob: HeroPreparationJob | null;
  } = $props();
  let slot = $state<HeroSlot>(untrack(() => initialJob?.slot ?? 'default'));
  let activeSource = $derived(slots.find(s => s.id === slot)?.source ?? null);
  let choice = $state(untrack(() => slots.find(s => s.id === (initialJob?.slot ?? 'default'))?.source?.sourceId ?? ''));
  function selectSlot(id: HeroSlot) {
    slot = id; choice = slots.find(s => s.id === id)?.source?.sourceId ?? '';
    message = ''; problem = ''; onselect(id);
  }
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
        else message = `${heroSlotLabel(job?.slot ?? 'default')} updated. The animation will play when that slot matches.`;
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
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: choice, slot }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change the background.');
      job = result.job;
      if (job?.phase === 'running') timer = setTimeout(poll, 1000);
      else { message = slot === 'default' ? 'Included animation restored.' : `${heroSlotLabel(slot)} now uses Default.`; await invalidateAll(); }
    } catch (error) { problem = error instanceof Error ? error.message : 'Could not change the background.'; }
    finally { sending = false; }
  }

  onMount(() => {
    onselect(slot);
    if (job?.phase === 'running') timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  });
</script>

<section class="nm-sec source-picker" aria-labelledby="hero-source-title">
  <div class="nm-sec-hd"><h2 id="hero-source-title">Background video</h2></div>
  <p>Give each activity level a weekday and weekend animation. Choose a slot, then prepare an MP4 from
    <a href="/drive">Drive → siteherobackground</a>. Empty slots use Default; your originals stay untouched.</p>
  <p class="source-info">Current match: <strong>{heroSlotLabel(activity.slot)}</strong>
    · {activity.steps === null ? 'No step readings today' : `${activity.steps.toLocaleString()} steps today`}
    {#if activity.slot !== 'default' && !slots.find(s => s.id === activity.slot)?.source} · Using Default{/if}
  </p>
  <div class="slot-grid" aria-label="Animation slots">
    {#each HERO_SLOTS as entry}
      {@const assigned = slots.find(s => s.id === entry.id)?.source}
      <button type="button" class="slot" class:default-slot={entry.id === 'default'} aria-pressed={slot === entry.id}
        disabled={busy} onclick={() => selectSlot(entry.id)} aria-label={entry.label}>
        <span class="slot-title">{entry.label}</span>
        <span class="slot-source">{assigned?.sourceName.replace(/^siteherobackground\//i, '') ?? (entry.id === 'default' ? 'Included animation' : 'Uses Default')}</span>
      </button>
    {/each}
  </div>
  <h3>Editing: {heroSlotLabel(slot)}</h3>
  <p class="source-info">Assigned: <strong>{activeSource?.sourceName ?? (slot === 'default' ? 'Included animation' : 'Default animation')}</strong></p>
  <form onsubmit={event => { event.preventDefault(); void apply(); }}>
    <div class="nm-field"><label for="hero-source" class="sr-label-tight">MP4 from siteherobackground</label>
      <select id="hero-source" class="nm-text-input" bind:value={choice} disabled={busy}>
        <option value="">{slot === 'default' ? 'Included animation' : 'Use Default'}</option>
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
        {busy ? 'Preparing…' : choice ? 'Prepare & apply' : slot === 'default' ? 'Use included animation' : 'Use Default'}
      </button>
      <button type="button" class="nm-btn-ghost" disabled={busy} onclick={() => invalidateAll()}>Refresh folder</button>
    </div>
  </form>
  {#if !sources.length}<p class="source-info">No eligible MP4s found. Add an MP4 directly to siteherobackground, then refresh.</p>{/if}
  <p class="source-info">MP4s up to 50 MB and 60 seconds. Automatic downscaling: 960px desktop / 480px phone, muted, plus a final-frame still.
    Copies are saved in siteherobackground/web-ready. The slot changes only after preparation succeeds. Playback settings below apply to every slot.</p>
  {#if job?.phase === 'running'}<p role="status">Preparing {job.sourceName} for {heroSlotLabel(job.slot ?? 'default')}… You can leave this page and return to check progress.</p>{/if}
  {#if problem || job?.phase === 'failed'}<p role="alert">{problem || job?.error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-block: 12px; }
  .slot { display: flex; flex-direction: column; gap: 7px; text-align: left; padding: 14px; min-width: 0; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); cursor: pointer; }
  .slot[aria-pressed="true"] { border: 2px solid var(--accent); padding: 13px; }
  .default-slot { grid-column: 1 / -1; }
  .slot-title { font-size: var(--fs-body); font-weight: 600; }
  .slot-source { font-size: var(--fs-label); color: var(--text-muted); overflow-wrap: anywhere; }
  h3 { font-size: var(--fs-body); margin-block: 12px 0; }
  @media (max-width: 680px) { .slot-grid { grid-template-columns: 1fr; } }
  h2 { font-family: var(--font-display); font-size: var(--fs-body-lg); }
  p { font-size: var(--fs-body); line-height: 1.6; overflow-wrap: anywhere; }
  .source-info { font-size: var(--fs-label); color: var(--text-muted); margin-block: 8px; }
  .nm-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  select { width: 100%; max-width: 100%; }
  .source-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block: 14px; }
  .primary { color: var(--accent); border-color: var(--accent); }
  :is(button, select, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
