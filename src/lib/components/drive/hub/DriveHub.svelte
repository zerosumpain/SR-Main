<script lang="ts">
  // The owner's /drive — four sections, A to D, read top to bottom.
  //
  //   A  Vitals       what is in the drive           ink
  //   B  The shelf    browse, drag, drop, upload     paper
  //   C  Knowledge    the RAG collections            paper
  //   D  Links out    share links ever minted        ink
  //
  // /health alternates dark measurement bands with paper argument because it is
  // a document you READ. This is a tool you USE, so the rhythm is inverted: two
  // thin ink bands top and bottom, and the working surface gets everything
  // between them. Ink on this palette is for chrome and thin bands — a tall
  // solid ink area reads as intensity rather than editorial, which is the
  // lesson the landing pulse band cost (PR #611).
  //
  // The shell is `HealthShell` with `unifiedNav`, the same way /research and
  // /news wear it: the shared site bar stays the one wayfinding dialect, and
  // this page gains the grain and the ink footer. /health's own `hs-head`
  // masthead is that family's exception, not a pattern to spread.
  import { invalidateAll } from '$app/navigation';
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import DriveVitals from './DriveVitals.svelte';
  import DriveShelf from './DriveShelf.svelte';
  import DriveKnowledge from './DriveKnowledge.svelte';
  import DriveLinks from './DriveLinks.svelte';
  import FileViewerModal from '$lib/components/drive/FileViewerModal.svelte';
  import InteractModelModal from '$lib/components/drive/InteractModelModal.svelte';
  import RagChatPanel from '$lib/components/drive/RagChatPanel.svelte';
  import FolderIntelModal from '$lib/components/drive/FolderIntelModal.svelte';
  import { resolveFolderPolicy, type FolderSetting } from '$lib/jkai/intel/source-policy';
  import { baseName, isMarker } from '$lib/drive/paths';
  import { fmtSize } from '$lib/drive/stats';
  import type { RagCollection } from '$lib/db/schema';
  import type { FileRow, ShareRow } from './types';

  interface Props {
    /**
     * The loader's payload. `files` is `unknown[]` because `permissions` is a
     * jsonb column and Drizzle infers it as `unknown` — the row shape is
     * asserted here, once, rather than in the route file.
     */
    data: {
      files: unknown[];
      maxUploadBytes?: number;
      defaultChatModelId?: string;
      folderSettings?: unknown[];
      shareTtlDays?: number;
    };
  }

  let { data }: Props = $props();

  // Seeded from the loader once, then OWNED here: every mutation refetches
  // `/api/files` rather than invalidating the page, so the shelf does not lose
  // its folder and selection on each upload. `invalidateAll()` still runs after
  // extract and convert, which rewrite server-derived index fields.
  let files = $state<FileRow[]>(data.files as FileRow[]);
  let currentPath = $state('');
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  const maxUploadBytes = $derived(data.maxUploadBytes ?? 20 * 1024 * 1024);
  const shareTtlDays = $derived(data.shareTtlDays ?? 7);

  function notify(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  async function refresh() {
    // Every mutation ends here, so a silent failure is worse than an error: the
    // shelf would go on showing paths that have already moved. A 200 that is not
    // JSON is the auth-redirect case, and it used to reject out of an un-awaited
    // drop handler, leaving no undo strip and nothing on screen at all.
    try {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      if (!Array.isArray(body?.files)) throw new Error('unexpected response');
      files = body.files;
    } catch (err) {
      const why = err instanceof Error ? err.message : 'unknown';
      notify(`Could not reload the file list (${why}). Reload the page.`);
    }
  }

  function navigate(path: string) {
    currentPath = path;
  }

  // ——— per-folder entity-resolution policy ———
  let folderSettings = $state<FolderSetting[]>((data.folderSettings ?? []) as FolderSetting[]);
  let intelFolderPath = $state<string | null>(null);

  function erChipFor(path: string): { tone: 'full' | 'cats' | 'out'; label: string } {
    const pol = resolveFolderPolicy(path, folderSettings);
    if (!pol.included) return { tone: 'out', label: 'intel off' };
    if (pol.categoryIds.length) return { tone: 'cats', label: `intel ${pol.categoryIds.length} cat` };
    return { tone: 'full', label: 'intel full' };
  }

  async function reloadFolderSettings() {
    const res = await fetch('/api/drive/folders');
    if (!res.ok) return;
    const body = await res.json();
    folderSettings = (body.folders ?? []).map((f: Record<string, unknown>) => ({
      path: String(f.path ?? ''),
      intelMode: String(f.intelMode ?? 'inherit'),
      categoryIds: (f.categoryIds ?? []) as string[],
    })) as FolderSetting[];
  }

  async function onFolderIntelSaved(message: string) {
    intelFolderPath = null;
    notify(message);
    await reloadFolderSettings();
  }

  // ——— index status copy ———
  /** Why a modality is worth naming: OCR and transcripts are not the file's own text. */
  const MODALITY_NOTE: Record<string, string> = {
    ocr: ', read by a vision model (scanned document)',
    image: ' from an image description',
    audio: ' from an audio transcript',
  };

  function indexTitle(f: FileRow): string {
    const status = f.indexStatus ?? 'skipped';
    if (status === 'indexed') {
      const chunks = `${f.indexChunks} chunk${f.indexChunks === 1 ? '' : 's'}`;
      return `Searchable via @files — ${chunks}${MODALITY_NOTE[f.indexModality ?? ''] ?? ''}.`;
    }
    if (status === 'pending') return 'Not indexed yet — queued, or the last attempt was lost to a restart.';
    if (status === 'skipped') return 'This file type is not indexed.';
    return f.indexError || 'No text could be extracted.';
  }

  // ——— viewer, extract, convert ———
  let viewerFile = $state<FileRow | null>(null);
  let busyId = $state<string | null>(null);
  let extractResult = $state<{ name: string; text: string; meta: unknown } | null>(null);
  let convertFor = $state<{ id: string; name: string } | null>(null);
  let convertSource = $state<'markdown' | 'text' | 'json' | 'csv' | 'xlsx'>('markdown');
  let convertFormat = $state<'docx' | 'pdf' | 'html' | 'xlsx' | 'csv'>('pdf');

  async function runExtract(file: FileRow) {
    busyId = file.id;
    extractResult = null;
    try {
      const res = await fetch(`/api/files/${file.id}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      if (!res.ok) {
        notify(`Extract failed — ${body.error ?? 'unknown'}`);
        return;
      }
      extractResult = { name: file.name, text: body.text.slice(0, 5000), meta: body.meta };
      await invalidateAll();
      await refresh();
    } finally {
      busyId = null;
    }
  }

  async function runConvert() {
    if (!convertFor) return;
    busyId = convertFor.id;
    try {
      const res = await fetch(`/api/files/${convertFor.id}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: convertSource, format: convertFormat }),
      });
      const body = await res.json();
      if (!res.ok) {
        notify(`Convert failed — ${body.error ?? 'unknown'}`);
        return;
      }
      convertFor = null;
      await invalidateAll();
      await refresh();
    } finally {
      busyId = null;
    }
  }

  async function deleteFile(f: FileRow) {
    if (!confirm(`Delete "${f.name}"? This removes it from disk and cannot be undone.`)) return;
    const res = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    if (!res.ok) {
      notify(`Delete failed (${res.status}).`);
      return;
    }
    // The API cascades the derived intel note, and what left the graph with it
    // is not obvious from deleting a file.
    const body = await res.json().catch(() => null);
    const removed = body?.intel?.entitiesRemoved ?? 0;
    files = files.filter((x) => x.id !== f.id);
    if (removed > 0) {
      notify(`${baseName(f.name)} deleted — ${removed} entit${removed === 1 ? 'y' : 'ies'} removed from the Intel graph.`);
    }
  }

  // ——— knowledge bases ———
  let collections = $state<RagCollection[]>([]);
  let collectionsLoaded = $state(false);
  let chatCollection = $state<RagCollection | null>(null);
  let interactFiles = $state<FileRow[] | null>(null);
  /** Whatever the shelf currently has picked, so section C can act on it too. */
  let picked = $state<FileRow[]>([]);

  async function loadCollections() {
    try {
      const res = await fetch('/api/files/rag');
      if (res.ok) collections = (await res.json()).collections ?? [];
    } finally {
      collectionsLoaded = true;
    }
  }

  function onCollectionCreated(c: RagCollection) {
    interactFiles = null;
    collections = [c, ...collections.filter((x) => x.id !== c.id)];
    chatCollection = c;
  }

  async function reindexCollection(c: RagCollection) {
    const res = await fetch(`/api/files/rag/${c.id}/reindex`, { method: 'POST' });
    if (!res.ok) {
      notify(`Reindex failed (${res.status}).`);
      return;
    }
    collections = collections.map((x) => (x.id === c.id ? { ...c, status: 'indexing' } as RagCollection : x));
    loadCollections();
  }

  async function deleteCollection(c: RagCollection) {
    if (!confirm(`Delete knowledge base "${c.name}"? The index is removed; the source files stay.`)) return;
    const res = await fetch(`/api/files/rag/${c.id}`, { method: 'DELETE' });
    if (!res.ok) {
      notify(`Delete failed (${res.status}).`);
      return;
    }
    collections = collections.filter((x) => x.id !== c.id);
    if (chatCollection?.id === c.id) chatCollection = null;
  }

  // ——— share links ———
  let shares = $state<ShareRow[]>([]);
  let sharesLoaded = $state(false);
  let shareBusyId = $state<string | null>(null);
  let mintedShare = $state<{ url: string; name: string; expiresAt: string } | null>(null);
  let mintedCopied = $state(false);

  const sharedFileIds = $derived(new Set(shares.filter((s) => s.active).map((s) => s.fileId)));
  const liveShareCount = $derived(shares.filter((s) => s.active).length);

  async function loadShares() {
    const res = await fetch('/api/files/shares');
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    shares = (body?.shares ?? []) as ShareRow[];
    sharesLoaded = true;
  }

  async function shareFile(f: FileRow) {
    shareBusyId = f.id;
    try {
      const res = await fetch('/api/files/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileId: f.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        notify(`Could not create a link — ${body?.message ?? res.status}`);
        return;
      }
      mintedCopied = false;
      mintedShare = { url: body.url, name: baseName(f.name), expiresAt: body.expiresAt };
      await navigator.clipboard?.writeText(body.url).then(() => (mintedCopied = true)).catch(() => {});
      await loadShares();
    } finally {
      shareBusyId = null;
    }
  }

  async function revokeShare(s: ShareRow) {
    if (!confirm(`Revoke the link to "${baseName(s.fileName)}"? Anyone holding it stops being able to download.`)) return;
    shareBusyId = s.id;
    try {
      const res = await fetch(`/api/files/shares?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        notify(`Revoke failed (${res.status}).`);
        return;
      }
      await loadShares();
    } finally {
      shareBusyId = null;
    }
  }

  $effect(() => {
    loadCollections();
    loadShares();
  });

  const footer = $derived([
    'strangeramblings.com/drive · owner file store · sections A–D',
    `${files.filter((f) => !isMarker(f.name)).length} files · ${fmtSize(files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0))}`,
    `${liveShareCount} live share link${liveShareCount === 1 ? '' : 's'}`,
    'WebDAV, @files search and the workflow engine read the same store',
  ]);
</script>

<HealthShell
  path="/drive"
  unifiedNav
  maxWidth={1400}
  note={liveShareCount > 0
    ? `${liveShareCount} share link${liveShareCount === 1 ? '' : 's'} can be downloaded by anyone holding the URL — section D lists every one.`
    : null}
  {footer}
>
  {#if notice}
    <p class="dh-notice">{notice}</p>
  {/if}

  <DriveVitals {files} liveLinks={liveShareCount} knowledgeBases={collections.length} />

  <DriveShelf
    {files}
    {currentPath}
    {maxUploadBytes}
    {shareTtlDays}
    {sharedFileIds}
    {busyId}
    {shareBusyId}
    {erChipFor}
    {indexTitle}
    onNavigate={navigate}
    onRefresh={refresh}
    onNotice={notify}
    onPreview={(f) => (viewerFile = f)}
    onExtract={runExtract}
    onConvert={(f) => (convertFor = { id: f.id, name: f.name })}
    onShare={shareFile}
    onDelete={deleteFile}
    onInteract={() => (interactFiles = picked)}
    onErSettings={(path) => (intelFolderPath = path)}
    onSelectionChange={(next) => (picked = next)}
  />

  <DriveKnowledge
    {collections}
    loaded={collectionsLoaded}
    selectedCount={picked.length}
    onOpenChat={(c) => (chatCollection = c)}
    onReindex={reindexCollection}
    onDelete={deleteCollection}
    onInteract={() => picked.length && (interactFiles = picked)}
  />

  <DriveLinks
    {shares}
    loaded={sharesLoaded}
    ttlDays={shareTtlDays}
    busyId={shareBusyId}
    minted={mintedShare}
    {mintedCopied}
    onCopyMinted={() =>
      navigator.clipboard?.writeText(mintedShare!.url).then(() => (mintedCopied = true)).catch(() => {})}
    onDismissMinted={() => (mintedShare = null)}
    onRevoke={revokeShare}
  />
</HealthShell>

{#if extractResult}
  <div class="dh-panel-wrap" role="dialog" aria-label="Extracted text">
    <div class="dh-panel">
      <p class="dh-panel-kicker">Extracted from</p>
      <h3 class="dh-panel-title">{baseName(extractResult.name)}</h3>
      <pre class="dh-pre">{extractResult.text}</pre>
      <details class="dh-meta"><summary>Metadata</summary><pre>{JSON.stringify(extractResult.meta, null, 2)}</pre></details>
      <button type="button" class="nm-save-btn" onclick={() => (extractResult = null)}>Close</button>
    </div>
  </div>
{/if}

{#if convertFor}
  <div class="dh-panel-wrap" role="dialog" aria-label="Convert file">
    <div class="dh-panel">
      <p class="dh-panel-kicker">Convert</p>
      <h3 class="dh-panel-title">{baseName(convertFor.name)}</h3>
      <div class="dh-convert">
        <label class="dh-field">
          <span>From</span>
          <select class="nm-text-input" bind:value={convertSource}>
            <option value="markdown">Markdown</option>
            <option value="text">Plain text</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
        </label>
        <label class="dh-field">
          <span>To</span>
          <select class="nm-text-input" bind:value={convertFormat}>
            <option value="docx">DOCX</option>
            <option value="pdf">PDF</option>
            <option value="html">HTML</option>
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
          </select>
        </label>
      </div>
      <div class="dh-panel-acts">
        <button type="button" class="nm-save-btn" disabled={busyId === convertFor.id} onclick={runConvert}>
          {busyId === convertFor.id ? 'Converting' : 'Convert'}
        </button>
        <button type="button" class="nm-rowact dh-muted" onclick={() => (convertFor = null)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if viewerFile}
  <FileViewerModal file={viewerFile} onClose={() => (viewerFile = null)} />
{/if}

{#if interactFiles}
  <InteractModelModal
    files={interactFiles.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))}
    onClose={() => (interactFiles = null)}
    onCreated={onCollectionCreated}
  />
{/if}

{#if intelFolderPath !== null}
  <FolderIntelModal
    path={intelFolderPath}
    onClose={() => (intelFolderPath = null)}
    onSaved={onFolderIntelSaved}
  />
{/if}

{#if chatCollection}
  <RagChatPanel
    collection={chatCollection}
    onClose={() => (chatCollection = null)}
    onChanged={(c) => (collections = collections.map((x) => (x.id === c.id ? c : x)))}
    defaultChatModelId={data.defaultChatModelId ?? ''}
  />
{/if}

<style>
  .dh-notice {
    margin: 0;
    padding: 11px clamp(20px, 3vw, 44px);
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--warn);
  }

  /* Extract and convert are transient panels, not sections of the document, so
     they float. Opaque ground: --card-bg is a 7% tint and would show the page
     through the panel. */
  .dh-panel-wrap {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(26, 16, 8, 0.55);
  }
  .dh-panel {
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    padding: 24px 26px;
    max-width: 780px;
    width: 100%;
    max-height: 84vh;
    overflow-y: auto;
  }
  .dh-panel-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 8px;
  }
  .dh-panel-title {
    font-family: var(--font-display);
    font-size: 24px;
    line-height: 1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 18px;
    overflow-wrap: anywhere;
  }
  .dh-pre {
    background: var(--bg);
    border: 1px solid var(--line-hair);
    padding: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    max-height: 46vh;
    overflow: auto;
    white-space: pre-wrap;
    margin: 0 0 14px;
  }
  .dh-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin-bottom: 16px;
  }
  .dh-meta pre { overflow-x: auto; }
  .dh-convert {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .dh-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .dh-field :global(select) { text-transform: none; letter-spacing: 0; width: auto; }
  .dh-panel-acts { display: flex; align-items: center; gap: 16px; }
  .dh-muted { color: var(--text-muted); }
</style>
