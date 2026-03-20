<svelte:head><title>Edit: {data.post.title} — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let title = $state(data.post.title);
  let slug = $state(data.post.slug);
  let excerpt = $state(data.post.excerpt);
  let content = $state(data.post.content);
  let tags = $state(data.post.tags.join(', '));
  let status = $state(data.post.status);

  let saving = $state(false);
  let saved = $state(false);
  let deleting = $state(false);
  let errorMsg = $state<string | null>(null);

  // Track if content has been modified
  let dirty = $derived(
    title !== data.post.title ||
    slug !== data.post.slug ||
    excerpt !== data.post.excerpt ||
    content !== data.post.content ||
    tags !== data.post.tags.join(', ')
  );

  function slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function save() {
    saving = true;
    errorMsg = null;
    try {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/admin/blog/${data.post.id}?token=${adminToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug, excerpt, content, tags: tagList }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMsg = body.error ?? `Error ${res.status}`;
        return;
      }

      // Update local data reference
      data.post.title = title;
      data.post.slug = slug;
      data.post.excerpt = excerpt;
      data.post.content = content;
      data.post.tags = tagList;

      saved = true;
      setTimeout(() => (saved = false), 2000);
    } finally {
      saving = false;
    }
  }

  async function togglePublish() {
    const newStatus = status === 'published' ? 'draft' : 'published';
    saving = true;
    errorMsg = null;
    try {
      const res = await fetch(`/api/admin/blog/${data.post.id}?token=${adminToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        status = newStatus;
        data.post.status = newStatus;
      } else {
        const body = await res.json().catch(() => ({}));
        errorMsg = body.error ?? `Error ${res.status}`;
      }
    } finally {
      saving = false;
    }
  }

  async function deletePost() {
    if (!confirm('Delete this post?')) return;
    deleting = true;
    try {
      await fetch(`/api/admin/blog/${data.post.id}?token=${adminToken}`, { method: 'DELETE' });
      goto(`/admin/blog?token=${adminToken}`);
    } finally {
      deleting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="max-w-3xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <a
      href="/admin/blog?token={adminToken}"
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      &larr; All Posts
    </a>
    <div class="flex items-center gap-3">
      <span
        class="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
        style="font-family: var(--font-mono); background: {status === 'published'
          ? 'rgba(var(--accent-rgb, 120,80,40), 0.15)'
          : 'rgba(0,0,0,0.06)'}; color: {status === 'published'
          ? 'var(--accent)'
          : 'var(--text-ghost)'};"
      >
        {status}
      </span>
      {#if saved}
        <span
          class="text-[10px] uppercase tracking-[0.2em]"
          style="color: var(--accent); font-family: var(--font-mono);"
        >Saved</span>
      {/if}
    </div>
  </div>

  {#if errorMsg}
    <div
      class="mb-6 p-3 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {errorMsg}
    </div>
  {/if}

  <!-- Title -->
  <input
    type="text"
    bind:value={title}
    placeholder="Post title"
    class="w-full mb-4 text-2xl font-bold bg-transparent outline-none"
    style="color: var(--text-primary); font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.01em;"
  />

  <!-- Slug -->
  <div class="flex items-center gap-2 mb-4">
    <span class="text-[10px] uppercase tracking-[0.2em] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Slug
    </span>
    <input
      type="text"
      bind:value={slug}
      class="flex-1 px-2 py-1 text-xs rounded bg-transparent"
      style="border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-mono); outline: none;"
    />
    <button
      onclick={() => (slug = slugify(title))}
      class="text-[9px] uppercase tracking-[0.15em] px-2 py-1 rounded"
      style="color: var(--text-ghost); font-family: var(--font-mono); border: 1px solid var(--card-border);"
    >
      Auto
    </button>
  </div>

  <!-- Excerpt -->
  <textarea
    bind:value={excerpt}
    placeholder="Brief excerpt…"
    rows="2"
    class="w-full mb-4 px-3 py-2 text-sm rounded-lg resize-none"
    style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-body); outline: none;"
  ></textarea>

  <!-- Tags -->
  <div class="flex items-center gap-2 mb-6">
    <span class="text-[10px] uppercase tracking-[0.2em] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
      Tags
    </span>
    <input
      type="text"
      bind:value={tags}
      placeholder="tag1, tag2, …"
      class="flex-1 px-2 py-1 text-xs rounded bg-transparent"
      style="border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-mono); outline: none;"
    />
  </div>

  <hr class="rule mb-6" />

  <!-- Content editor -->
  <textarea
    bind:value={content}
    placeholder="Write your post content here… (HTML supported)"
    rows="24"
    class="w-full px-4 py-3 text-sm rounded-lg resize-y leading-relaxed"
    style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); font-family: var(--font-mono); outline: none; min-height: 400px;"
  ></textarea>

  <!-- Actions -->
  <div class="flex items-center justify-between mt-6">
    <button
      onclick={deletePost}
      disabled={deleting}
      class="text-[10px] uppercase tracking-[0.2em] px-3 py-2 rounded-lg transition-colors"
      style="color: #8b3a1a; font-family: var(--font-mono); border: 1px solid rgba(139,58,26,0.2);"
    >
      {deleting ? '…' : 'Delete'}
    </button>

    <div class="flex gap-3">
      <button
        onclick={togglePublish}
        disabled={saving}
        class="text-[10px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        style="font-family: var(--font-mono); border: 1px solid var(--card-border); color: var(--text-secondary);"
      >
        {status === 'published' ? 'Unpublish' : 'Publish'}
      </button>

      <button
        onclick={save}
        disabled={saving || !dirty}
        class="text-[10px] uppercase tracking-[0.2em] px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
        style="background: var(--accent); color: white; font-family: var(--font-mono);"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>

  <!-- Preview -->
  {#if content}
    <div class="mt-10">
      <p class="label mb-4">Preview</p>
      <hr class="rule mb-6" />
      <div class="prose">
        {@html content}
      </div>
    </div>
  {/if}
</div>

<style>
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  .prose :global(h2) { font-size: 1.5rem; }
  .prose :global(h3) { font-size: 1.25rem; }
  .prose :global(p) {
    margin-bottom: 1.25em;
    line-height: 1.8;
    font-size: 1rem;
    color: var(--text-secondary);
  }
  .prose :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 0.2em 0.5em;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }
  .prose :global(pre) {
    padding: 1.25em 1.5em;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    background: var(--card-bg);
    border: 2px solid var(--card-border);
  }
  .prose :global(pre code) { padding: 0; background: none; border: none; }
  .prose :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1.25em;
    margin: 1.5em 0;
    font-style: italic;
    color: var(--text-muted);
  }
  .prose :global(ul), .prose :global(ol) { padding-left: 1.5em; margin-bottom: 1.25em; }
  .prose :global(li) { margin-bottom: 0.5em; line-height: 1.8; color: var(--text-secondary); }
  .prose :global(img) { max-width: 100%; margin: 1.5em 0; }
</style>
