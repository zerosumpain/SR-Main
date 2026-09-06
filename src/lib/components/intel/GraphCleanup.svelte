<script lang="ts">
  import type { CleanupResult } from '$lib/jkai/intel/cleanup-types';
  let result = $state<CleanupResult | null>(null);
  let busy = $state(false);
  let message = $state('');
  let failed = $state(false);
  async function inspect(apply = false) {
    busy = true;
    failed = false;
    message = '';
    try {
      const response = await fetch('/api/jkai/intel/cleanup', apply ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run' }),
      } : {});
      if (!response.ok) throw new Error(apply ? 'Cleanup could not complete. Please retry; failures are recorded in run history.' : 'The cleanup preview could not load. Please retry.');
      result = await response.json();
      message = apply ? 'Cleanup complete. The counts below show what changed.' : 'Preview only. Nothing has changed.';
    } catch (error) {
      failed = true;
      message = error instanceof Error ? error.message : 'Cleanup failed';
    } finally { busy = false; }
  }
</script>

<section aria-labelledby="cleanup-heading">
  <div class="heading"><h2 id="cleanup-heading"><span class="section-number" aria-hidden="true">02</span> Source cleanup</h2><a href="/jkai/intel/review">Open entity review →</a></div>
  <p>Remove intelligence from excluded folders and deleted Drive files. Shared entities keep their remaining evidence; confirmed, watched, dossier and memory-linked entities are retained.</p>
  <div class="actions">
    <button disabled={busy} onclick={() => inspect()}>{busy ? 'Checking…' : 'Preview cleanup'}</button>
    {#if result && !result.applied}
      <button class="primary" disabled={busy || !(result.counts.notesRemoved || result.counts.entitiesRemoved || result.counts.brokenMergesRestored)} onclick={() => inspect(true)}>Run cleanup</button>
    {/if}
    <span>Also runs during nightly intelligence maintenance. <a href="/jkai/intel">View run history</a></span>
  </div>
  {#if message}<p role="status" class:error={failed}>{message}</p>{/if}
  {#if result}
    <dl aria-label="Cleanup counts">
      <div><dt>Source notes</dt><dd>{result.counts.notesRemoved}</dd></div>
      <div><dt>Entities removed</dt><dd>{result.counts.entitiesRemoved}</dd></div>
      <div><dt>Entities refreshed</dt><dd>{result.counts.entitiesRefreshed}</dd></div>
      <div><dt>Protected entities</dt><dd>{result.counts.entitiesProtected}</dd></div>
      <div><dt>Needs review</dt><dd>{result.counts.reviewRequired}</dd></div>
    </dl>
    {#if result.counts.brokenMergesRestored}<p>{result.counts.brokenMergesRestored} hidden entities {result.applied ? 'restored' : 'to restore'} because their merge target no longer exists.</p>{/if}
    <p class="detail">Shared summaries and properties are rebuilt from remaining evidence. Owner edits are kept.</p>
    {#if result.counts.remaining}<p>More work remains. Preview again for the next batch, or leave it for nightly maintenance.</p>{/if}
    {#if result.notes.length || result.entities.length}
      <details><summary>{result.applied ? 'Changed sources and entities' : 'Sources and entities in this batch'} (up to 50 each)</summary>
        <ul>{#each result.notes as note}<li><strong>{note.title}</strong> · {note.reason}</li>{/each}
        {#each result.entities as entity}<li>{entity.name} · No remaining evidence</li>{/each}</ul>
      </details>
    {/if}
    {#if result.review.length}
      <details><summary>Unreferenced entities to review ({result.counts.reviewRequired})</summary>
        <p>These older nodes have no surviving provenance. They may have been made by hand, so automatic cleanup leaves them for your decision. A node with source evidence is kept even when it has no relationships.</p>
        {#if result.counts.reviewRequired > result.review.length}<p>Showing the first {result.review.length}.</p>{/if}
        <ul>{#each result.review as entity}<li><a href={`/jkai/intel/review?focus=${encodeURIComponent(entity.id)}`}>{entity.name}</a></li>{/each}</ul>
      </details>
    {/if}
  {/if}
</section>

<style>
  section { padding: 1.25rem 0; border-top: 1px solid var(--line-strong); }
  .heading, .actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  h2 { margin: 0; font-size: var(--fs-body-lg); }
  p, li { line-height: 1.5; overflow-wrap: anywhere; }
  .actions span, .detail { color: var(--text-muted); font-size: var(--fs-label); }
  a { color: var(--accent-ink); }
  button { padding: .55rem .8rem; border: 1px solid var(--line-strong); color: var(--text-primary); background: var(--surface-card); font: inherit; cursor: pointer; }
  button.primary { background: var(--accent); color: var(--bg); }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  dl { display: grid; grid-template-columns: repeat(auto-fit,minmax(125px,1fr)); gap: 1rem; padding: 1rem 0; border-block: 1px solid var(--line); }
  dt { color: var(--text-muted); font-size: var(--fs-label); }
  dd { margin: .25rem 0 0; font: 1.5rem var(--font-code); }
  details { padding: .65rem 0; border-top: 1px solid var(--line); }
  summary { cursor: pointer; }
  ul { padding-left: 1.25rem; }
  .error { color: var(--error); }
</style>
