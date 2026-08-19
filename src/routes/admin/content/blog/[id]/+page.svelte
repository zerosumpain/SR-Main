<svelte:head><title>Edit: {data.post.title} — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import RichEditor from '$lib/components/RichEditor.svelte';
  import ClaimReviewPanel from '$lib/components/ClaimReviewPanel.svelte';
  import { Marked } from 'marked';
  import type { RichEditorApi } from '$lib/components/rich-editor-api';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');

  let title = $state(data.post.title);
  let slug = $state(data.post.slug);
  let excerpt = $state(data.post.excerpt);
  let content = $state(data.post.content);
  let tags = $state(data.post.tags.join(', '));
  let status = $state(data.post.status);
  let coverImageUrl = $state<string | null>(data.post.coverImageUrl ?? null);
  let previewToken = $state(data.post.previewToken);

  let saving = $state(false);
  let saved = $state(false);
  let deleting = $state(false);
  let errorMsg = $state<string | null>(null);
  let coverUploading = $state(false);
  let previewCopied = $state(false);

  let contentFormat = $state<'html' | 'markdown'>(
    data.post.contentFormat === 'markdown' ? 'markdown' : 'html',
  );
  let isMarkdown = $derived(contentFormat === 'markdown');
  let converting = $state(false);
  let richApi = $state<RichEditorApi | undefined>();

  let dirty = $derived(
    title !== data.post.title ||
    slug !== data.post.slug ||
    excerpt !== data.post.excerpt ||
    content !== data.post.content ||
    tags !== data.post.tags.join(', ') ||
    coverImageUrl !== (data.post.coverImageUrl ?? null)
  );

  function slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function save(overrides: Record<string, unknown> = {}) {
    saving = true;
    errorMsg = null;
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const payload = { title, slug, excerpt, content, tags: tagList, coverImageUrl, ...overrides };
      const res = await fetch(`/api/admin/blog/${data.post.id}?token=${adminToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMsg = body.error ?? `Error ${res.status}`;
        return;
      }
      data.post.title = title;
      data.post.slug = slug;
      data.post.excerpt = excerpt;
      data.post.content = content;
      data.post.tags = tagList;
      if (overrides.coverImageUrl !== undefined) data.post.coverImageUrl = overrides.coverImageUrl as string | null;
      if (overrides.previewToken !== undefined) {
        data.post.previewToken = overrides.previewToken as string;
        previewToken = overrides.previewToken as string;
      }
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } finally {
      saving = false;
    }
  }

  async function saveContent(newContent: string) {
    content = newContent;
    await save();
  }

  async function uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('postId', String(data.post.id));
    const res = await fetch(`/api/admin/blog/upload-image?token=${adminToken}`, { method: 'POST', body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${res.status})`);
    }
    const body = await res.json();
    return body.url;
  }

  async function setCoverFromFile(file: File) {
    coverUploading = true;
    errorMsg = null;
    try {
      const url = await uploadImage(file);
      coverImageUrl = url;
      await save({ content: undefined, tags: undefined, coverImageUrl: url });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      coverUploading = false;
    }
  }

  async function uploadCoverImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await setCoverFromFile(file);
    };
    input.click();
  }

  function handleCoverPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setCoverFromFile(file);
        return;
      }
    }
  }

  function handleCoverDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    setCoverFromFile(file);
  }

  async function convertToRichText() {
    if (!confirm('Convert this post to the rich-text (HTML) editor? Markdown source will be replaced with rendered HTML.')) return;
    converting = true;
    errorMsg = null;
    try {
      const marked = new Marked({ gfm: true, breaks: false });
      const html = (await marked.parse(content || '')).toString();
      const res = await fetch(`/api/admin/blog/${data.post.id}?token=${adminToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: html, contentFormat: 'html' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMsg = body.error ?? `Error ${res.status}`;
        return;
      }
      content = html;
      data.post.content = html;
      data.post.contentFormat = 'html';
      contentFormat = 'html';
    } finally {
      converting = false;
    }
  }

  async function removeCoverImage() {
    coverImageUrl = null;
    await save({ content: undefined, tags: undefined, coverImageUrl: null });
  }

  function copyPreviewLink() {
    const url = `${window.location.origin}/blog/preview/${previewToken}`;
    navigator.clipboard.writeText(url);
    previewCopied = true;
    setTimeout(() => (previewCopied = false), 2000);
  }

  async function regeneratePreviewToken() {
    const newToken = crypto.randomUUID();
    previewToken = newToken;
    await save({ content: undefined, tags: undefined, previewToken: newToken });
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
      goto(`/admin/content/blog?token=${adminToken}`);
    } finally {
      deleting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Both editors handle Ctrl+S inside the content area; this is a fallback
    // for when focus is on metadata fields.
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === 's' &&
      !(e.target instanceof HTMLElement && e.target.closest('.editor-wrapper'))
    ) {
      e.preventDefault();
      save();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<PageWrap>
  <PageHeader
    kicker="Blog"
    title={title || 'Untitled draft'}
    crumbs={[{ label: 'Blog', href: `/admin/content/blog?token=${adminToken}` }, { label: 'Edit' }]}
  >
    {#snippet actions()}
      <span class="nm-pill" data-state={status}>{status}</span>
      {#if saved}<span class="saved-flag">Saved</span>{/if}
      <button class="nm-btn-ghost" onclick={togglePublish} disabled={saving}>
        {status === 'published' ? 'Unpublish' : 'Publish'}
      </button>
      <button class="nm-save-btn" onclick={() => save()} disabled={saving || !dirty}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/snippet}
  </PageHeader>

  {#if errorMsg}
    <div class="banner banner-error">{errorMsg}</div>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Metadata</span></div>
    <label class="nm-field">
      <span class="sr-label-tight">Title</span>
      <input class="nm-text-input title-input" type="text" bind:value={title} placeholder="Post title" />
    </label>
    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">Slug</span>
        <div class="slug-row">
          <input class="nm-text-input" type="text" bind:value={slug} />
          <button class="nm-btn-ghost" onclick={() => (slug = slugify(title))}>Auto</button>
        </div>
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Tags</span>
        <input class="nm-text-input" type="text" bind:value={tags} placeholder="tag1, tag2, …" />
      </label>
    </div>
    <label class="nm-field">
      <span class="sr-label-tight">Excerpt</span>
      <textarea class="nm-textarea" rows="2" bind:value={excerpt} placeholder="Brief excerpt…"></textarea>
    </label>
  </section>

  <section
    class="nm-sec"
    role="region"
    aria-label="Cover image (paste or drop image)"
    tabindex="-1"
    onpaste={handleCoverPaste}
    ondrop={handleCoverDrop}
    ondragover={(e) => e.preventDefault()}
  >
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Cover image</span>
      <span style="margin-left: auto; display: flex; gap: 0.5rem;">
        <button class="nm-btn-ghost" onclick={uploadCoverImage} disabled={coverUploading}>{coverUploading ? 'Uploading…' : 'Upload'}</button>
        {#if coverImageUrl}
          <button class="nm-link-btn danger" onclick={removeCoverImage}>Remove</button>
        {/if}
      </span>
    </div>
    {#if coverImageUrl}
      <img class="cover" src={coverImageUrl} alt="Cover" />
    {:else}
      <div class="nm-empty">No cover image. Click Upload, or paste / drop one here.</div>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Preview link</span>
      <span style="margin-left: auto; display: flex; gap: 0.5rem;">
        <button class="nm-btn-ghost" onclick={copyPreviewLink}>{previewCopied ? 'Copied!' : 'Copy link'}</button>
        <button class="nm-btn-ghost" onclick={regeneratePreviewToken}>Regenerate</button>
      </span>
    </div>
    <p class="muted">Share <code>/blog/preview/{previewToken}</code> to let someone read the draft without an admin session.</p>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Content · {isMarkdown ? 'Markdown' : 'Rich Text (HTML)'}</span>
      {#if isMarkdown}
        <span style="margin-left: auto;">
          <button class="nm-btn-ghost" onclick={convertToRichText} disabled={converting}>
            {converting ? 'Converting…' : 'Convert to Rich Text'}
          </button>
        </span>
      {/if}
    </div>
    {#if isMarkdown}
      <MarkdownEditor {content} onSave={saveContent} onAutoSave={saveContent} {uploadImage} />
    {:else}
      <RichEditor {content} onSave={saveContent} onAutoSave={saveContent} {uploadImage} bind:api={richApi} />
    {/if}
  </section>

  {#if !isMarkdown && richApi}
    <ClaimReviewPanel
      {adminToken}
      getHTML={() => richApi!.getHTML()}
      insertInlineLink={(snippet, url, title) => richApi!.linkSnippet(snippet, url, title)}
      insertFootnote={(snippet, url, title) => richApi!.addFootnote(snippet, url, title)}
    />
  {/if}

  <div class="bottom-row">
    <button class="nm-link-btn danger" onclick={deletePost} disabled={deleting}>
      {deleting ? '…' : 'Delete post'}
    </button>
  </div>

</PageWrap>

<style>
  .saved-flag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--success);
  }
  .title-input {
    font-family: var(--font-display);
    font-size: 1.2rem;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }
  .slug-row { display: flex; gap: 0.4rem; }
  .slug-row .nm-text-input { flex: 1; }
  .cover {
    max-width: 320px;
    width: 100%;
    height: auto;
    border: 1px solid var(--card-border);
  }
  .muted { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  .muted code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
  .bottom-row { display: flex; justify-content: flex-start; padding: 0.5rem 0 1.5rem; }
</style>
