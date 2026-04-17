<svelte:head><title>Blog — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let creating = $state(false);
  let newTitle = $state('');
  let searchQuery = $state('');
  let statusFilter: 'all' | 'draft' | 'published' = $state('all');
  let sortBy: 'updatedAt' | 'createdAt' | 'title' = $state('updatedAt');

  let draftCount = $derived(data.posts.filter((p) => p.status === 'draft').length);
  let publishedCount = $derived(data.posts.filter((p) => p.status === 'published').length);

  let filteredPosts = $derived(() => {
    let posts = [...data.posts];

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter((p) => p.title.toLowerCase().includes(q));
    }

    // Filter by status
    if (statusFilter !== 'all') {
      posts = posts.filter((p) => p.status === statusFilter);
    }

    // Sort
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
        goto(`/admin/blog/${post.id}?token=${adminToken}`);
      }
    } finally {
      creating = false;
    }
  }

  function formatDate(d: Date | string | null): string {
    if (!d) return '—';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-10">
    <a href="/admin?token={adminToken}" class="back-link back-link--xs">Admin</a>
    <h1
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Blog Posts
    </h1>
  </div>

  <!-- New post -->
  <div class="mb-8 flex gap-2">
    <input
      type="text"
      bind:value={newTitle}
      placeholder="New post title…"
      onkeydown={(e) => e.key === 'Enter' && createPost()}
      class="flex-1 px-3 py-2 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;"
    />
    <button
      onclick={createPost}
      disabled={creating || !newTitle.trim()}
      class="text-[10px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      {creating ? '…' : 'Create'}
    </button>
  </div>

  <!-- Search, filters, sort -->
  <div class="mb-6">
    <!-- Search -->
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search posts…"
      class="w-full px-3 py-2 rounded-lg text-sm mb-4"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body); outline: none;"
    />

    <!-- Tabs + Sort row -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-1">
        <button
          class="tab-btn"
          class:active={statusFilter === 'all'}
          onclick={() => (statusFilter = 'all')}
        >
          All <span class="tab-count">{data.posts.length}</span>
        </button>
        <button
          class="tab-btn"
          class:active={statusFilter === 'draft'}
          onclick={() => (statusFilter = 'draft')}
        >
          Draft <span class="tab-count">{draftCount}</span>
        </button>
        <button
          class="tab-btn"
          class:active={statusFilter === 'published'}
          onclick={() => (statusFilter = 'published')}
        >
          Published <span class="tab-count">{publishedCount}</span>
        </button>
      </div>

      <select
        bind:value={sortBy}
        class="sort-select"
      >
        <option value="updatedAt">Last updated</option>
        <option value="createdAt">Created</option>
        <option value="title">Title</option>
      </select>
    </div>
  </div>

  <!-- Posts list -->
  <div>
    {#if filteredPosts().length === 0}
      <p class="text-sm py-8" style="color: var(--text-muted);">No posts found.</p>
    {:else}
      {#each filteredPosts() as post}
        <a
          href="/admin/blog/{post.id}?token={adminToken}"
          class="block py-4 group transition-colors hover:bg-[rgba(196,87,10,0.04)]"
          style="border-bottom: 1px solid var(--divider);"
        >
          <div class="flex justify-between items-baseline gap-4">
            <div class="flex items-baseline gap-3">
              {#if post.coverImageUrl}
                <img
                  src={post.coverImageUrl}
                  alt=""
                  class="shrink-0 rounded"
                  style="width: 28px; height: 28px; object-fit: cover;"
                />
              {/if}
              <span
                class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded shrink-0"
                style="font-family: var(--font-mono); background: {post.status === 'published'
                  ? 'rgba(var(--accent-rgb, 120,80,40), 0.15)'
                  : 'rgba(0,0,0,0.06)'}; color: {post.status === 'published'
                  ? 'var(--accent)'
                  : 'var(--text-ghost)'};"
              >
                {post.status}
              </span>
              <span
                class="text-sm font-medium group-hover:text-[var(--accent)] transition-colors"
                style="color: var(--text-primary);"
              >
                {post.title}
              </span>
            </div>
            <span class="label shrink-0" style="font-size: 10px;">
              {formatDate(post.updatedAt)}
            </span>
          </div>
        </a>
      {/each}
    {/if}
  </div>
</div>

<style>
  .tab-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-ghost);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .tab-btn:hover {
    color: var(--text-secondary);
  }

  .tab-btn.active {
    background: rgba(196, 87, 10, 0.12);
    color: var(--accent);
    border-color: var(--accent);
  }

  .tab-count {
    font-size: 9px;
    opacity: 0.7;
    margin-left: 2px;
  }

  .sort-select {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 24px;
  }
</style>
