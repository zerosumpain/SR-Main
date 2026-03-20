<svelte:head><title>Blog — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let creating = $state(false);
  let newTitle = $state('');

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
    <a
      href="/admin?token={adminToken}"
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      &larr; Admin
    </a>
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

  <!-- Posts list -->
  <div>
    {#if data.posts.length === 0}
      <p class="text-sm py-8" style="color: var(--text-muted);">No posts yet.</p>
    {:else}
      {#each data.posts as post}
        <a
          href="/admin/blog/{post.id}?token={adminToken}"
          class="block py-4 group transition-colors hover:bg-[rgba(196,87,10,0.04)]"
          style="border-bottom: 1px solid var(--divider);"
        >
          <div class="flex justify-between items-baseline gap-4">
            <div class="flex items-baseline gap-3">
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
