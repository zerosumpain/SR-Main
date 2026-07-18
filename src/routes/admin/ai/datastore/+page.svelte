<svelte:head><title>Datastore — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type CollectionRow = {
    id: string;
    slug: string;
    name: string | null;
    description: string | null;
    isSystem: boolean;
    updatedAt: string | Date;
    recordCount: number;
  };

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let collections = $state<CollectionRow[]>(data.collections as CollectionRow[]);

  let newSlug = $state('');
  let newName = $state('');
  let newDescription = $state('');
  let creating = $state(false);
  let errorMsg = $state('');

  function apiBase(): string {
    return adminToken
      ? `/api/admin/datastore/collections?token=${adminToken}`
      : '/api/admin/datastore/collections';
  }

  function slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/(^[^a-z0-9]+|-+$)/g, '');
  }

  async function createCollection() {
    const slug = slugify(newSlug.trim() || newName.trim());
    errorMsg = '';
    if (!slug) {
      errorMsg = 'Enter a slug or name';
      return;
    }
    creating = true;
    try {
      const res = await fetch(apiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: newName.trim() || undefined,
          description: newDescription.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        goto(`/admin/ai/datastore/${slug}?token=${adminToken}`);
      } else {
        errorMsg = body.error ?? 'Could not create the collection';
      }
    } catch {
      errorMsg = 'Network error';
    } finally {
      creating = false;
    }
  }

  function fmtDate(d: string | Date): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="AI"
    title="Datastore"
    sub="Permanent, flexible collections of jsonb records — shared sitewide across workflows, jkai chat and the nightly engine. Row-level permissions, schema validation, versioned audit trail. Click a collection to browse and query."
  />

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">New collection</span></div>
    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">Slug</span>
        <input
          class="nm-text-input"
          type="text"
          bind:value={newSlug}
          placeholder="e.g. reading-list"
          onkeydown={(e) => e.key === 'Enter' && createCollection()}
        />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Name <em>(optional)</em></span>
        <input
          class="nm-text-input"
          type="text"
          bind:value={newName}
          placeholder="Reading list"
          onkeydown={(e) => e.key === 'Enter' && createCollection()}
        />
      </label>
    </div>
    <label class="nm-field">
      <span class="sr-label-tight">Description <em>(optional)</em></span>
      <input class="nm-text-input" type="text" bind:value={newDescription} placeholder="What this collection holds" />
    </label>
    <div class="create-actions">
      <button class="nm-save-btn" onclick={createCollection} disabled={creating}>
        {creating ? 'Creating…' : 'Create collection'}
      </button>
      {#if errorMsg}<span class="result-bad">{errorMsg}</span>{/if}
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Collections</span>
      <span class="nm-sec-meta">{collections.length}</span>
    </div>

    {#if collections.length === 0}
      <div class="nm-empty">No collections yet — create one above.</div>
    {:else}
      <div class="coll-list">
        {#each collections as c (c.id)}
          <a class="coll-row" href={`/admin/ai/datastore/${c.slug}?token=${adminToken}`}>
            <div class="coll-main">
              <span class="coll-name">{c.name || c.slug}</span>
              {#if c.description}<span class="coll-desc">{c.description}</span>{/if}
              <span class="coll-slug">{c.slug}</span>
            </div>
            {#if c.isSystem}<span class="nm-pill" data-state="info">system</span>{/if}
            <span class="coll-count">{c.recordCount} {c.recordCount === 1 ? 'record' : 'records'}</span>
            <span class="coll-date">{fmtDate(c.updatedAt)}</span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .create-actions { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; }
  .result-bad { font-family: var(--font-mono); font-size: 11px; color: var(--error); }

  .coll-list { display: flex; flex-direction: column; border-top: 1px solid var(--divider); }
  .coll-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 0.5rem;
    border-bottom: 1px solid var(--divider);
    text-decoration: none;
    color: inherit;
    transition: background 120ms ease;
  }
  .coll-row:hover { background: var(--accent-tint-08); }
  .coll-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .coll-name { font-size: 0.95rem; color: var(--text-primary); font-weight: 500; }
  .coll-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coll-slug {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }
  .coll-count { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); white-space: nowrap; }
  .coll-date {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .coll-row { grid-template-columns: 1fr auto; }
    .coll-count, .coll-date { display: none; }
  }
</style>
