<svelte:head><title>Edit: {data.post.title} — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import RichEditor from '$lib/components/RichEditor.svelte';
  import ClaimReviewPanel from '$lib/components/ClaimReviewPanel.svelte';
  import { Marked } from 'marked';

  type RichApi = {
    getHTML: () => string;
    linkSnippet: (snippet: string, url: string, title?: string) => boolean;
    addFootnote: (snippet: string, url: string, title?: string) => number;
    applyProposal: (p: ProseProposal) => boolean;
    acceptProposal: (id: string, modifiedText?: string) => boolean;
    rejectProposal: (id: string) => boolean;
  };
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import BlogAssistantWidget from '$lib/components/BlogAssistantWidget.svelte';
  import BlogAssistantMarginCallouts from '$lib/components/BlogAssistantMarginCallouts.svelte';
  import { createProposalStore } from '$lib/blog/assistant/proposal-store';
  import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';
  import BlogStatsCard from '$lib/components/BlogStatsCard.svelte';

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

  let contentFormat = $state<'html' | 'markdown'>(data.post.contentFormat);
  let isMarkdown = $derived(contentFormat === 'markdown');
  let converting = $state(false);
  let richApi = $state<RichApi | undefined>();

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
      goto(`/admin/blog?token=${adminToken}`);
    } finally {
      deleting = false;
    }
  }

  const proposalStore = createProposalStore();
  let proposalTick = $state(0); // bump to force re-render of derived lists
  let displayMode = $state<'inline' | 'margin'>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('blog-assistant-display-mode') as 'inline' | 'margin')) || 'inline',
  );
  let editorContainer = $state<HTMLDivElement | undefined>();

  function setDisplayMode(m: 'inline' | 'margin') {
    displayMode = m;
    try { localStorage.setItem('blog-assistant-display-mode', m); } catch { /* ignore */ }
  }

  async function acceptMetaProposal(p: MetaProposal) {
    proposalStore.resolve(p.id, 'accepted');
    proposalTick++;
    const res = await fetch(`/api/admin/blog/${data.post.id}/apply-proposal?token=${adminToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: p.id, field: p.field, value: p.suggestedValue }),
    });
    if (!res.ok) return;
    const body = await res.json();
    if (!body.post) return;
    if (p.field === 'title') title = body.post.title;
    if (p.field === 'excerpt') excerpt = body.post.excerpt;
    if (p.field === 'slug') slug = body.post.slug;
    if (p.field === 'tags') tags = (body.post.tags as string[]).join(', ');
    if (p.field === 'status') status = body.post.status;
    data.post = body.post;
  }

  function rejectMetaProposal(p: MetaProposal) {
    proposalStore.resolve(p.id, 'rejected');
    proposalTick++;
  }

  let widgetSendMessage = $state<((text: string) => Promise<void>) | undefined>();

  async function regenerate(p: Proposal, note: string) {
    // Mark the old proposal as superseded; widget will call SSE to fetch a new one.
    proposalStore.resolve(p.id, 'rejected');
    proposalTick++;
    const summary = p.kind === 'prose'
      ? `the prose change at "${p.original.slice(0, 40)}…"`
      : `the ${p.field} change to ${JSON.stringify(p.suggestedValue).slice(0, 40)}`;
    await widgetSendMessage?.(`I rejected ${summary}. Try a different version: ${note}`);
  }

  function onProposalArrived(p: Proposal) {
    proposalTick++;
    if (p.kind === 'prose' && richApi) {
      richApi.applyProposal(p);
    }
  }

  let proseProposals = $derived(
    proposalTick >= 0 ? proposalStore.list().filter((p): p is ProseProposal => p.kind === 'prose') : []
  );

  function acceptProse(p: ProseProposal, modifiedText?: string) {
    if (!richApi) return;
    richApi.acceptProposal(p.id, modifiedText);
    proposalStore.resolve(p.id, 'accepted');
    proposalTick++;
  }

  function rejectProse(p: ProseProposal) {
    if (!richApi) return;
    richApi.rejectProposal(p.id);
    proposalStore.resolve(p.id, 'rejected');
    proposalTick++;
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
    crumbs={[{ label: 'Blog', href: `/admin/blog?token=${adminToken}` }, { label: 'Edit' }]}
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

  <BlogStatsCard
    stats30d={data.stats.stats30d}
    statsLifetime={data.stats.statsLifetime}
    daily={data.stats.daily}
    referrers={data.stats.referrers}
    available={data.stats.available}
  />

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
      <div bind:this={editorContainer} class="editor-host" data-suggestion-display={displayMode}>
        <RichEditor
          {content}
          onSave={saveContent}
          onAutoSave={saveContent}
          {uploadImage}
          bind:api={richApi}
          {displayMode}
          onProposalAccepted={(id) => { proposalStore.resolve(id, 'accepted'); proposalTick++; }}
          onProposalRejected={(id) => { proposalStore.resolve(id, 'rejected'); proposalTick++; }}
        />
        {#if displayMode === 'margin'}
          <BlogAssistantMarginCallouts
            proposals={proseProposals}
            editorEl={editorContainer}
            onAccept={(p, modifiedText) => acceptProse(p, modifiedText)}
            onReject={(p) => rejectProse(p)}
            onRegenerate={(p, note) => regenerate(p, note)}
          />
        {/if}
      </div>
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

  <BlogAssistantWidget
    postId={data.post.id}
    {adminToken}
    history={data.history ?? []}
    {proposalStore}
    {displayMode}
    onSetDisplayMode={setDisplayMode}
    onProposalArrived={onProposalArrived}
    onAcceptMeta={acceptMetaProposal}
    onRejectMeta={rejectMetaProposal}
    onRegenerate={regenerate}
    onClear={() => { richApi?.clearAllSuggestions?.(); proposalTick++; }}
    bind:sendMessage={widgetSendMessage}
  />
</PageWrap>

<style>
  .saved-flag {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #2d7a3a;
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
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
  .content-area { min-height: 480px; line-height: 1.6; font-family: var(--font-mono); font-size: 12px; }
  .editor-host { position: relative; }
  .bottom-row { display: flex; justify-content: flex-start; padding: 0.5rem 0 1.5rem; }

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
