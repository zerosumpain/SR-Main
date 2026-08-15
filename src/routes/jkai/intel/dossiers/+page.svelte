<script lang="ts">
  // The case-file index.
  //
  // The graph tells you what is connected to what. This tells you what you are
  // currently working on — which is the question actually asked of it every
  // morning. So the list leads with OPEN, shows how much evidence each enquiry
  // has actually accumulated, and keeps parked and closed work out of the way
  // without deleting it.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let title = $state('');
  let busy = $state(false);
  let toast = $state<string | null>(null);
  let showClosed = $state(false);

  // Plain handle, never $state: a timer read and cleared by the same helper is
  // the read-own-write cycle that locks the UI up.
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const open = $derived(data.dossiers.filter((d) => d.status === 'open'));
  const parked = $derived(data.dossiers.filter((d) => d.status === 'parked'));
  const closed = $derived(data.dossiers.filter((d) => d.status === 'closed'));

  function notify(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3200);
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    busy = true;
    try {
      const res = await fetch('/api/jkai/intel/dossiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: name }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
      const { dossier } = (await res.json()) as { dossier: { id: string } };
      title = '';
      // Straight into the new case file — creating one is always the start of
      // pinning something to it.
      await goto(`/jkai/intel/dossiers/${dossier.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create the dossier');
    } finally {
      busy = false;
    }
  }

  async function setStatus(id: string, status: string) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch('/api/jkai/intel/dossiers', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id], status }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
      await invalidateAll();
      notify(`Moved to ${status}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed');
    } finally {
      busy = false;
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<JkaiPageTitle title="INTEL / DOSSIERS" titleHref="/jkai/intel" />

<div class="wrap">
  <form class="new" onsubmit={create}>
    <input
      class="title"
      type="text"
      placeholder="Open a case file — what are you trying to find out?"
      aria-label="New dossier title"
      bind:value={title}
      maxlength="200"
    />
    <button type="submit" class="primary" disabled={busy || !title.trim()}>Open dossier</button>
  </form>

  {#if !data.dossiers.length}
    <p class="empty">
      No case files yet. A dossier is the working set for one line of enquiry — pin the
      entities, notes and findings that belong to it, and generate a cited brief across
      the lot.
    </p>
  {:else}
    {#snippet section(label: string, list: typeof data.dossiers)}
      <section>
        <h2 class="slabel">{label} <b>{list.length}</b></h2>
        {#if !list.length}
          <p class="none">Nothing here.</p>
        {:else}
          <ul class="grid">
            {#each list as d (d.id)}
              <li class="card">
                <a class="head" href="/jkai/intel/dossiers/{d.id}">
                  <span class="name">{d.title}</span>
                  {#if d.summary}<span class="sum">{d.summary}</span>{/if}
                </a>
                <div class="counts">
                  <span><b>{d.entityCount}</b> entit{d.entityCount === 1 ? 'y' : 'ies'}</span>
                  <span><b>{d.itemCount}</b> pinned</span>
                  {#if d.openQuestions.length}
                    <span><b>{d.openQuestions.length}</b> open question{d.openQuestions.length === 1 ? '' : 's'}</span>
                  {/if}
                  <span class="when">{when(d.updatedAt)}</span>
                </div>
                <div class="acts">
                  {#if d.status !== 'open'}
                    <button type="button" disabled={busy} onclick={() => setStatus(d.id, 'open')}>Reopen</button>
                  {/if}
                  {#if d.status === 'open'}
                    <button type="button" disabled={busy} onclick={() => setStatus(d.id, 'parked')}>Park</button>
                  {/if}
                  {#if d.status !== 'closed'}
                    <button type="button" disabled={busy} onclick={() => setStatus(d.id, 'closed')}>Close</button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/snippet}

    {@render section('Open', open)}
    {#if parked.length}{@render section('Parked', parked)}{/if}

    {#if closed.length}
      <button type="button" class="ghost toggle" onclick={() => (showClosed = !showClosed)}>
        {showClosed ? 'Hide' : 'Show'} {closed.length} closed
      </button>
      {#if showClosed}{@render section('Closed', closed)}{/if}
    {/if}
  {/if}
</div>

{#if toast}<div class="toast">{toast}</div>{/if}

<style>
  .wrap {
    padding: 16px 20px 32px;
    /* Full-bleed, like every Intel surface — a centred column beside a
       full-width graph read as a bug. Prose keeps its own measure below. */
    width: 100%;
  }

  .new {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-bottom: 14px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  .title {
    flex: 1;
    min-width: 220px;
    padding: 8px 10px;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }

  section {
    margin-bottom: 22px;
  }
  .slabel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin-bottom: 8px;
  }
  .slabel b {
    font-weight: 500;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .head:hover .name {
    color: var(--accent);
  }
  .name {
    font-size: var(--fs-body-sm);
    font-weight: 500;
    transition: color var(--t-fast) var(--ease-out);
  }
  .sum {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .counts b {
    font-weight: 500;
    color: var(--text-muted);
  }
  .counts .when {
    margin-left: auto;
  }

  .acts {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.primary {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .toggle {
    margin-bottom: 12px;
  }

  .empty,
  .none {
    font-size: var(--fs-body-sm);
    color: var(--text-ghost);
  }
  .empty {
    padding: 44px 0;
    text-align: center;
    max-width: 520px;
    margin: 0 auto;
    line-height: 1.6;
  }
  .none {
    font-size: var(--fs-label-xs);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 140;
    /* Floats over the list — must be opaque. */
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
