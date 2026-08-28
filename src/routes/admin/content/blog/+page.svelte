<svelte:head><title>Blog — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import {
    BLOG_AUTHORSHIP,
    AUTHORSHIP_HINT,
    MIN_CORPUS_WORDS,
    isBlogAuthorship,
    type BlogAuthorship,
  } from '$lib/blog/authorship';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { dur } from '$lib/motion';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let creating = $state(false);
  let newTitle = $state('');
  let searchQuery = $state('');
  let statusFilter: 'all' | 'draft' | 'published' = $state('all');
  let sortBy: 'updatedAt' | 'createdAt' | 'title' = $state('updatedAt');

  // Optimistic per-row authorship. Kept as an override map rather than synced
  // from props in an $effect — a prop->state sync effect here would re-track the
  // reassigned proxy for no benefit (svelte5-pitfalls §2).
  let authorshipOverride = $state<Record<number, string>>({});
  let savingAuthorship = $state<Record<number, boolean>>({});

  function authorshipOf(post: { id: number; authorship?: string | null }): BlogAuthorship {
    const v = authorshipOverride[post.id] ?? post.authorship;
    return isBlogAuthorship(v) ? v : 'unknown';
  }

  async function setAuthorship(id: number, value: string) {
    const prev = authorshipOverride[id];
    const rollback = () => {
      if (prev === undefined) delete authorshipOverride[id];
      else authorshipOverride[id] = prev;
    };
    authorshipOverride[id] = value;
    savingAuthorship[id] = true;
    try {
      const res = await fetch(`/api/admin/blog/${id}?token=${adminToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorship: value }),
      });
      if (!res.ok) rollback();
      // Re-run the loader so the corpus meter reflects the new tag rather than
      // drifting away from the rows it is supposed to be counting.
      else await invalidateAll();
    } catch {
      rollback();
    } finally {
      savingAuthorship[id] = false;
    }
  }

  let draftCount = $derived(data.posts.filter((p) => p.status === 'draft').length);
  let publishedCount = $derived(data.posts.filter((p) => p.status === 'published').length);

  let filteredPosts = $derived.by(() => {
    let posts = [...data.posts];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter((p) => p.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      posts = posts.filter((p) => p.status === statusFilter);
    }
    if (sortBy === 'title') {
      posts.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'updatedAt') {
      posts.sort((a, b) => {
        const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return db - da;
      });
    } else {
      posts.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
    }
    return posts;
  });

  function slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function createPost() {
    if (!newTitle.trim()) return;
    creating = true;
    try {
      const res = await fetch(`/api/admin/blog?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), slug: slugify(newTitle.trim()) }),
      });
      if (res.ok) {
        const post = await res.json();
        goto(`/admin/content/blog/${post.id}?token=${adminToken}`);
      }
    } finally {
      creating = false;
    }
  }

  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Content"
    title="Blog Posts"
    sub="Drafts, published posts, and tags. Create a new post inline; click any row to edit."
  />

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">New post</span>
    </div>
    <div class="create-row">
      <input
        type="text"
        bind:value={newTitle}
        placeholder="Title (slug auto-generated)…"
        onkeydown={(e) => e.key === 'Enter' && createPost()}
        class="nm-text-input"
      />
      <button
        class="nm-save-btn"
        onclick={createPost}
        disabled={creating || !newTitle.trim()}
      >{creating ? '…' : 'Create draft'}</button>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Posts</span>
      <span class="nm-sec-meta">
        {filteredPosts.length} / {data.posts.length}
        <span
          class="corpus-meter"
          title={`Human-written posts of at least ${MIN_CORPUS_WORDS} words — what the Voice Card can be built from. ${data.corpus.human.posts} tagged human in total.`}
        >
          · corpus {data.usable.posts} post{data.usable.posts === 1 ? '' : 's'},
          {data.usable.words.toLocaleString('en-GB')} words
        </span>
      </span>
    </div>

    <div class="filter-row">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search by title…"
        class="nm-text-input"
      />
      <div class="nm-tabs">
        <button class="nm-tab" class:active={statusFilter === 'all'} onclick={() => (statusFilter = 'all')}>
          All <span class="nm-tab-count">{data.posts.length}</span>
        </button>
        <button class="nm-tab" class:active={statusFilter === 'draft'} onclick={() => (statusFilter = 'draft')}>
          Draft <span class="nm-tab-count">{draftCount}</span>
        </button>
        <button class="nm-tab" class:active={statusFilter === 'published'} onclick={() => (statusFilter = 'published')}>
          Published <span class="nm-tab-count">{publishedCount}</span>
        </button>
      </div>
      <select class="nm-select" bind:value={sortBy}>
        <option value="updatedAt">Last updated</option>
        <option value="createdAt">Created</option>
        <option value="title">Title</option>
      </select>
    </div>

    {#if filteredPosts.length === 0}
      <div class="nm-empty">No posts match.</div>
    {:else}
      <div class="post-list">
        {#each filteredPosts as post (post.id)}
          <div
            class="post-row-wrap"
            animate:flip={{ duration: dur(200) }}
            out:fade={{ duration: dur(120) }}
          >
            <a
              class="post-row"
              href={`/admin/content/blog/${post.id}?token=${adminToken}`}
            >
              {#if post.coverImageUrl}
                <img class="cover" src={post.coverImageUrl} alt="" />
              {:else}
                <div class="cover cover-placeholder"></div>
              {/if}
              <div class="post-main">
                <span class="post-title">{post.title}</span>
                {#if post.excerpt}
                  <span class="post-excerpt">{post.excerpt.slice(0, 140)}{post.excerpt.length > 140 ? '…' : ''}</span>
                {/if}
              </div>
              <span class="nm-pill" data-state={post.status}>{post.status}</span>
              <span class="post-views" title="Views (7d)">
                {post.views7d == null ? '–' : post.views7d}
              </span>
              <span class="post-date">{fmtDate(post.updatedAt)}</span>
            </a>
            <!-- Sibling of the anchor, not a child: a <select> nested inside a
                 link both hijacks navigation and is an a11y violation. -->
            <label class="authorship-cell" title={AUTHORSHIP_HINT[authorshipOf(post)]}>
              <span class="visually-hidden">Authorship for {post.title}</span>
              <select
                class="nm-select authorship-select"
                data-authorship={authorshipOf(post)}
                value={authorshipOf(post)}
                disabled={savingAuthorship[post.id]}
                onchange={(e) => setAuthorship(post.id, e.currentTarget.value)}
              >
                {#each BLOG_AUTHORSHIP as a (a)}
                  <option value={a}>{a}</option>
                {/each}
              </select>
            </label>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .create-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .filter-row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 0.8rem;
  }
  .filter-row .nm-text-input { flex: 1; min-width: 200px; }
  .filter-row .nm-tabs { margin-bottom: 0; border-bottom: 0; }

  .post-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--divider);
  }
  .post-row-wrap {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--divider);
  }
  .post-row {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 36px 1fr auto auto auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 0.5rem;
    text-decoration: none;
    color: inherit;
    transition: background 120ms ease;
  }
  .post-row:hover { background: var(--accent-tint-08); }

  .authorship-cell {
    flex: 0 0 auto;
    padding-left: 0.6rem;
  }
  .authorship-select {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
  }
  /* Only 'human' feeds the Voice Card, so it is the one state worth reading
     off the list at a glance. Everything else stays deliberately quiet. */
  .authorship-select[data-authorship='human'] { color: var(--text-primary); }
  .authorship-select[data-authorship='generated'],
  .authorship-select[data-authorship='unknown'] { color: var(--text-ghost); }
  .authorship-select[data-authorship='assisted'] { color: var(--text-muted); }

  .corpus-meter { color: var(--text-ghost); }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .cover {
    width: 36px;
    height: 36px;
    object-fit: cover;
    border: 1px solid var(--card-border);
  }
  .cover-placeholder {
    background: var(--bg-section);
  }
  .post-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .post-title {
    font-size: 0.95rem;
    color: var(--text-primary);
    font-weight: 500;
  }
  .post-excerpt {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .post-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    letter-spacing: 0.06em;
  }
  .post-views {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    min-width: 2.5em;
    text-align: right;
  }

  @media (max-width: 640px) {
    .post-row {
      grid-template-columns: 36px 1fr auto;
    }
    .post-views, .post-date { display: none; }
  }
</style>
