<svelte:head><title>Edit: {data.post.title} — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { BODY_FONT_OPTIONS, DEFAULT_BODY_FONT } from '$lib/blog/fonts';
  import { AUTOPILOT_MODES } from '$lib/blog/assistant/autopilot';
  import WritingDesk from '$lib/components/blog/WritingDesk.svelte';
  import MediaLibrary from '$lib/components/blog/MediaLibrary.svelte';
  import PostStatsCard from '$lib/components/blog/PostStatsCard.svelte';
  import { goto } from '$app/navigation';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import RichEditor from '$lib/components/RichEditor.svelte';
  import ClaimReviewPanel from '$lib/components/ClaimReviewPanel.svelte';
  import BlogAssistantWidget from '$lib/components/BlogAssistantWidget.svelte';
  import BlogAssistantMarginCallouts from '$lib/components/BlogAssistantMarginCallouts.svelte';
  import { createProposalStore } from '$lib/blog/assistant/proposal-store';
  import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';
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
  let coverImageAlt = $state<string>(data.post.coverImageAlt ?? '');
  // The post-level reading face. Defaults to 'read' (the Selawik / Segoe UI
  // stack) for anything the loader did not give a value for.
  let bodyFont = $state<string>(data.post.bodyFont ?? DEFAULT_BODY_FONT);
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

  // ---------------------------------------------------------------------
  // Blog assistant. Restored 2026-08-19 — commit 708ab5a9 deleted the mount
  // on 2026-05-07 while resolving a stash-pop conflict, and the later admin
  // consolidation moved this page with it already gone. See
  // docs/plans/2026-08-19-writing-voice-system.md.
  // ---------------------------------------------------------------------

  const proposalStore = createProposalStore();
  let proposalTick = $state(0); // bump to force re-render of derived lists
  let editorContainer = $state<HTMLDivElement | undefined>();
  let widgetSendMessage = $state<((text: string) => Promise<void>) | undefined>();

  /**
   * Durably record what happened to a proposal. This is the point of the
   * exercise: until now accept/reject decisions existed only in the browser
   * tab and died on reload, which is why prod holds proposals and no
   * resolutions at all. Rejections and edited acceptances are the strongest
   * statements of prose taste available.
   */
  async function recordResolution(payload: {
    proposalId: string;
    status: 'accepted' | 'rejected';
    kind: 'prose' | 'meta';
    field?: string;
    original?: string;
    suggested?: string;
    final?: string;
    reason?: string;
  }) {
    try {
      await fetch(`/api/admin/blog/${data.post.id}/resolve-proposal?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // The edit itself already happened. A lost audit row must not surface
      // to the author as a failure.
    }
  }

  const asText = (v: unknown): string | undefined =>
    v === null || v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v);

  // Always-on idle review. After 12s of no edits, ask the server for at most
  // two unobtrusive suggestions; rate-limit to one scan per 30s.
  let autoReviewEnabled = $state<boolean>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('blog-assistant-auto') !== 'off'
      : true,
  );
  function setAutoReview(v: boolean) {
    autoReviewEnabled = v;
    try { localStorage.setItem('blog-assistant-auto', v ? 'on' : 'off'); } catch { /* ignore */ }
    if (!v && idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  // Plain `let`, never $state — these are internal handles, and an effect that
  // both read and wrote them would loop (svelte5-pitfalls §1).
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAutoScanAt = 0;
  // Deliberately a one-time snapshot of the loaded length — svelte will warn
  // that this "only captures the initial value of data", which is the point.
  // Without it, a single typo on a freshly-loaded post trips a scan at once.
  let lastScanLen = data.post.content.length;
  let autoScanInflight = false;

  const IDLE_DELAY_MS = 12_000;
  const AUTO_COOLDOWN_MS = 30_000;
  const MAX_PENDING_BEFORE_SKIP = 6;
  // Skip auto-review when fewer than this many characters have changed since
  // the last scan. Single-typo fixes shouldn't burn an LLM call.
  const MIN_DELTA_CHARS = 80;

  function scheduleAutoScan() {
    if (!autoReviewEnabled) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(runAutoScan, IDLE_DELAY_MS);
  }

  async function runAutoScan() {
    idleTimer = null;
    if (autoScanInflight || !autoReviewEnabled) return;
    if (Date.now() - lastAutoScanAt < AUTO_COOLDOWN_MS) return;
    const pendingNow = proposalStore.list().filter((p) => p.status === 'pending');
    if (pendingNow.length >= MAX_PENDING_BEFORE_SKIP) return;
    if (Math.abs(content.length - lastScanLen) < MIN_DELTA_CHARS) return;
    autoScanInflight = true;
    lastAutoScanAt = Date.now();
    lastScanLen = content.length;
    try {
      const pendingHints = pendingNow.map((p) => (p.kind === 'prose' ? p.original : `${p.field}`));
      const r = await fetch(`/api/admin/blog/${data.post.id}/assistant/auto-review?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending: pendingHints }),
      });
      if (!r.ok) return;
      const body = await r.json();
      const fresh = (body?.proposals ?? []) as Proposal[];
      for (const p of fresh) {
        proposalStore.add(p);
        if (p.kind === 'prose' && richApi) richApi.applyProposal(p);
      }
      if (fresh.length > 0) proposalTick++;
    } catch { /* silent — this is a background scan */ }
    finally { autoScanInflight = false; }
  }

  // ---------------------------------------------------------------------
  // Autopilot — one editorial pass over the whole post.
  //
  // It produces ordinary proposals, so everything downstream (the margin
  // callouts, accept/reject, the revision snapshot, the `proposal_resolved`
  // taste signal) works unchanged. Nothing here writes the post.
  // ---------------------------------------------------------------------
  let mediaOpen = $state(false);
  let openBlockers = $state(0);
  let autopilotRunning = $state(false);
  let autopilotPhase = $state<string | null>(null);
  let autopilotSummary = $state<string | null>(null);

  async function runAutopilot(mode: string) {
    if (autopilotRunning) return;
    autopilotRunning = true;
    autopilotPhase = 'Starting…';
    autopilotSummary = null;

    // Save first. The pass runs against the SERVER's copy of the body, so an
    // unsaved edit would be reviewed in its old form and every anchor computed
    // against text the editor no longer shows.
    try {
      if (dirty) {
        await save();
        if (errorMsg) {
          autopilotPhase = null;
          return;
        }
      }

      const res = await fetch(`/api/admin/blog/${data.post.id}/autopilot?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok || !res.body) {
        autopilotSummary = `Autopilot failed (${res.status}).`;
        return;
      }

      // NDJSON: read whole lines, keep the trailing partial for the next chunk.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let added = 0;
      let dropped = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'phase') {
            autopilotPhase = String(ev.message ?? '');
          } else if (ev.type === 'candidates') {
            dropped = Array.isArray(ev.dropped) ? ev.dropped.length : 0;
          } else if (ev.type === 'proposal') {
            const proposal = ev.proposal as Proposal;
            proposalStore.add(proposal);
            if (proposal.kind === 'prose' && richApi) richApi.applyProposal(proposal);
            proposalTick++;
            added++;
          } else if (ev.type === 'error') {
            autopilotSummary = String(ev.error ?? 'Autopilot failed.');
          } else if (ev.type === 'done') {
            const offVoice = Number(ev.offVoice ?? 0);
            if (ev.reason === 'too-short') {
              autopilotSummary = 'Too short to review yet.';
            } else {
              // Report what was discarded as well as what survived. A pass that
              // silently drops half its output looks like a weak model rather
              // than a guard doing its job.
              const bits = [`${added} suggestion${added === 1 ? '' : 's'} in the margin`];
              if (dropped) bits.push(`${dropped} unsafe or empty`);
              if (offVoice) bits.push(`${offVoice} off-voice`);
              autopilotSummary = added === 0 && !dropped && !offVoice
                ? 'Nothing worth changing — the post reads well.'
                : bits.join(' · ');
            }
          }
        }
      }
      // The authorship select is driven by the loader's copy; keep it honest.
      if (added > 0 && (data.post.authorship === 'human' || data.post.authorship === 'unknown')) {
        data.post.authorship = 'assisted';
      }
    } catch (e) {
      autopilotSummary = e instanceof Error ? e.message : 'Autopilot failed.';
    } finally {
      autopilotRunning = false;
      autopilotPhase = null;
    }
  }

  async function acceptMetaProposal(p: MetaProposal) {
    proposalStore.resolve(p.id, 'accepted');
    proposalTick++;
    // apply-proposal records its own resolution, so no recordResolution here.
    const res = await fetch(`/api/admin/blog/${data.post.id}/apply-proposal?token=${adminToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposalId: p.id,
        field: p.field,
        value: p.suggestedValue,
        suggested: p.suggestedValue,
        reason: p.reason,
      }),
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
    window.dispatchEvent(new CustomEvent('jkai:revisions-changed'));
  }

  function rejectMetaProposal(p: MetaProposal) {
    proposalStore.resolve(p.id, 'rejected');
    proposalTick++;
    void recordResolution({
      proposalId: p.id,
      status: 'rejected',
      kind: 'meta',
      field: p.field,
      original: asText(p.currentValue),
      suggested: asText(p.suggestedValue),
      reason: p.reason,
    });
  }

  async function regenerate(p: Proposal, note: string) {
    proposalStore.resolve(p.id, 'rejected');
    proposalTick++;
    // A regenerate is a rejection with John's own words attached — the single
    // most explicit statement of taste the editor can produce. Record the note.
    void recordResolution({
      proposalId: p.id,
      status: 'rejected',
      kind: p.kind,
      field: p.kind === 'meta' ? p.field : undefined,
      original: p.kind === 'prose' ? p.original : asText(p.currentValue),
      suggested: p.kind === 'prose' ? p.suggested : asText(p.suggestedValue),
      reason: note,
    });
    const summary = p.kind === 'prose'
      ? `the prose change at "${p.original.slice(0, 40)}…"`
      : `the ${p.field} change to ${JSON.stringify(p.suggestedValue).slice(0, 40)}`;
    await widgetSendMessage?.(`I rejected ${summary}. Try a different version: ${note}`);
  }

  function onProposalArrived(p: Proposal) {
    proposalTick++;
    if (p.kind === 'prose' && richApi) richApi.applyProposal(p);
  }

  let proseProposals = $derived(
    proposalTick >= 0 ? proposalStore.list().filter((p): p is ProseProposal => p.kind === 'prose') : [],
  );

  function acceptProse(p: ProseProposal, modifiedText?: string) {
    if (!richApi) return;
    // Recording happens in RichEditor's onProposalAccepted callback below —
    // one place, so every accept path is captured exactly once.
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

  // After a rollback, update the editor + form fields from the returned post.
  $effect(() => {
    const handler = (ev: Event) => {
      const post = (ev as CustomEvent).detail?.post;
      if (!post) return;
      title = post.title ?? title;
      slug = post.slug ?? slug;
      excerpt = post.excerpt ?? excerpt;
      tags = Array.isArray(post.tags) ? (post.tags as string[]).join(', ') : tags;
      coverImageUrl = post.coverImageUrl ?? coverImageUrl;
      status = post.status ?? status;
      if (typeof post.content === 'string') {
        content = post.content;
        data.post.content = post.content;
        // Props don't reactively swap content — push it in, then clear any
        // orphan suggestion marks left behind by the replaced document.
        richApi?.setContent?.(post.content);
        richApi?.clearAllSuggestions?.();
      }
      data.post = post;
    };
    window.addEventListener('jkai:post-rolled-back', handler);
    return () => window.removeEventListener('jkai:post-rolled-back', handler);
  });

  let dirty = $derived(
    title !== data.post.title ||
    slug !== data.post.slug ||
    excerpt !== data.post.excerpt ||
    content !== data.post.content ||
    tags !== data.post.tags.join(', ') ||
    coverImageUrl !== (data.post.coverImageUrl ?? null) ||
    coverImageAlt !== (data.post.coverImageAlt ?? '') ||
    bodyFont !== (data.post.bodyFont ?? DEFAULT_BODY_FONT)
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
      const payload = { title, slug, excerpt, content, tags: tagList, coverImageUrl, coverImageAlt, bodyFont, ...overrides };
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
      // Mirror ONLY what was actually sent.
      //
      // Callers suppress fields by passing `undefined` (`save({ content:
      // undefined })`), which JSON.stringify then OMITS from the request — so
      // the server keeps its old value. This block used to mirror every field
      // unconditionally, so after a cover-image upload the page believed the
      // body had been saved: `dirty` went false, the Save button greyed out,
      // and the server still held the previous body. Unsaved prose, no warning.
      const sent = (k: string) => !(k in overrides) || overrides[k] !== undefined;
      if (sent('title')) data.post.title = title;
      if (sent('slug')) data.post.slug = slug;
      if (sent('excerpt')) data.post.excerpt = excerpt;
      if (sent('content')) data.post.content = content;
      if (sent('tags')) data.post.tags = tagList;
      if (sent('coverImageAlt')) data.post.coverImageAlt = coverImageAlt;
      if (sent('bodyFont')) data.post.bodyFont = bodyFont;
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
    scheduleAutoScan();
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

    // Publishing SAVES FIRST. This used to PUT `{ status }` on its own, so
    // hitting Publish with unsaved edits in the editor published the previous
    // body — the one thing a publish button must never do. Going back to draft
    // does not need the save, but doing it anyway costs nothing and keeps the
    // two paths identical.
    if (dirty) {
      await save();
      if (errorMsg) return;
    }

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
      {#if openBlockers > 0 && status !== 'published'}
        <!-- Advisory, never a lock. A gate that refuses to publish is a gate
             that gets worked around; one that says what is outstanding gets
             read. -->
        <span class="blocker-flag" title="Deterministic faults found by the pre-publish checks">
          {openBlockers} to fix
        </span>
      {/if}
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
    <label class="nm-field">
      <span class="sr-label-tight">Reading face</span>
      <select class="nm-text-input" bind:value={bodyFont}>
        {#each BODY_FONT_OPTIONS as f (f.key)}
          <option value={f.key}>{f.label} — {f.hint}</option>
        {/each}
      </select>
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
      <img class="cover" src={coverImageUrl} alt={coverImageAlt || 'Cover'} />
      <label class="nm-field" style="margin-top: 0.75rem;">
        <span class="sr-label-tight">Alt text</span>
        <input
          class="nm-text-input"
          type="text"
          bind:value={coverImageAlt}
          placeholder="What the image shows, for a reader who cannot see it"
        />
      </label>
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

  <WritingDesk
    postId={data.post.id}
    {adminToken}
    onBlockersChanged={(n) => (openBlockers = n)}
  />

  <MediaLibrary
    postId={data.post.id}
    open={mediaOpen}
    onClose={() => (mediaOpen = false)}
    onInsert={(item) => {
      richApi?.insertMedia(item);
      mediaOpen = false;
    }}
  />

  {#if !isMarkdown}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Autopilot</span>
        {#if autopilotPhase}
          <span class="ap-phase">{autopilotPhase}</span>
        {:else if autopilotSummary}
          <span class="ap-phase">{autopilotSummary}</span>
        {/if}
      </div>
      <div class="ap-modes">
        {#each AUTOPILOT_MODES as m (m.key)}
          <button
            class="ap-mode"
            onclick={() => runAutopilot(m.key)}
            disabled={autopilotRunning}
            title={m.blurb}
          >
            <span class="ap-mode-label">{m.label}</span>
            <span class="ap-mode-blurb">{m.blurb}</span>
          </button>
        {/each}
      </div>
      <p class="muted ap-note">
        Runs one pass over the whole post in your voice and leaves suggestions in the margin.
        It never edits or publishes anything — you accept each one. Paragraphs containing links or
        embedded media are held back, because a plain-text rewrite would delete them. A post that
        has been through a pass is tagged <strong>assisted</strong>, which keeps it out of the
        voice corpus.
      </p>
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Content · {isMarkdown ? 'Markdown' : 'Rich Text (HTML)'}</span>
      {#if !isMarkdown}
        <span style="margin-left: auto;">
          <button class="nm-btn-ghost" onclick={() => (mediaOpen = true)}>Media library</button>
        </span>
      {/if}
      {#if isMarkdown}
        <span style="margin-left: auto;">
          <button class="nm-btn-ghost" onclick={convertToRichText} disabled={converting}>
            {converting ? 'Converting…' : 'Convert to Rich Text'}
          </button>
        </span>
      {/if}
    </div>
    {#if isMarkdown}
      <MarkdownEditor {content} onSave={saveContent} onAutoSave={saveContent} {uploadImage} voiceCard={data.voiceCard} />
    {:else}
      <div bind:this={editorContainer} class="editor-host">
        <RichEditor
          {content}
          onSave={saveContent}
          onAutoSave={saveContent}
          {uploadImage}
          voiceCard={data.voiceCard}
          bind:api={richApi}
          onProposalAccepted={(id, finalText, preAcceptHtml) => {
            proposalStore.resolve(id, 'accepted');
            proposalTick++;
            const p = proposalStore.get(id);
            void recordResolution({
              proposalId: id,
              status: 'accepted',
              kind: 'prose',
              original: p?.kind === 'prose' ? p.original : undefined,
              suggested: p?.kind === 'prose' ? p.suggested : undefined,
              final: finalText,
              reason: p?.reason,
            });
            // Capture a revision so the author can roll this change back.
            void fetch(`/api/admin/blog/${data.post.id}/revisions?token=${adminToken}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                proposalId: id,
                field: 'content',
                previousValue: preAcceptHtml,
                reason: 'assistant accepted: content',
              }),
            }).catch(() => undefined);
            window.dispatchEvent(new CustomEvent('jkai:revisions-changed'));
          }}
          onProposalRejected={(id) => {
            const p = proposalStore.get(id);
            proposalStore.resolve(id, 'rejected');
            proposalTick++;
            void recordResolution({
              proposalId: id,
              status: 'rejected',
              kind: 'prose',
              original: p?.kind === 'prose' ? p.original : undefined,
              suggested: p?.kind === 'prose' ? p.suggested : undefined,
              reason: p?.reason,
            });
          }}
        />
        <BlogAssistantMarginCallouts
          proposals={proseProposals}
          editorEl={editorContainer}
          onAccept={(p, modifiedText) => acceptProse(p, modifiedText)}
          onReject={(p) => rejectProse(p)}
          onRegenerate={(p, note) => regenerate(p, note)}
        />
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

  <!-- Readers. The loader has been making four Umami round-trips per page load
       since BlogStatsCard was retired in April and rendering them with
       nothing; this is the surface they were computed for, now joined by the
       first-party dwell figures Umami structurally cannot answer. -->
  <PostStatsCard umami={data.stats ?? null} reads={data.reads ?? null} />

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
    {autoReviewEnabled}
    onSetAutoReview={setAutoReview}
    {onProposalArrived}
    onAcceptMeta={acceptMetaProposal}
    onRejectMeta={rejectMetaProposal}
    onRegenerate={regenerate}
    onClear={() => { richApi?.clearAllSuggestions?.(); proposalTick++; }}
    bind:sendMessage={widgetSendMessage}
  />

</PageWrap>

<style>
  .editor-host { position: relative; }

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

  .ap-modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.5rem;
  }

  .ap-mode {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.6rem 0.75rem;
    text-align: left;
    background: transparent;
    border: 1px solid var(--card-border);
    cursor: pointer;
    transition: border-color 0.15s ease-out;
  }

  .ap-mode:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .ap-mode:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .ap-mode-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-primary);
  }

  .ap-mode-blurb {
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }

  .ap-phase {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .ap-note {
    margin-top: 0.75rem;
  }

  .blocker-flag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--warn);
    border: 1px solid var(--warn);
    padding: 0.1rem 0.4rem;
  }
</style>
