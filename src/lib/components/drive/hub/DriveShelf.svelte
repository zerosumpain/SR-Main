<script lang="ts">
  // B — THE SHELF. The working surface, and the only section that follows
  // `currentPath`.
  //
  // Three drag gestures meet here and must not be confused with each other:
  //
  //   desktop  → shelf    upload into the folder you are stood in
  //   entry    → folder   MOVE (the new one) — a rename under the hood
  //   entry    → desktop  native `DownloadURL` copy-out, Chromium only
  //
  // They are told apart by `dragging`: an internal drag sets it on `dragstart`
  // and clears it on `dragend`, so anything arriving while it is null came from
  // outside the page. That has to be component state rather than a read of
  // `dataTransfer`, because `getData` is blocked during `dragover` — the browser
  // will not let a page read what is being dragged until it is dropped, so the
  // one moment you need to decide whether a target may light up is the one
  // moment you cannot ask. The same `dragstart` also sets `DownloadURL`, which
  // is what keeps copy-out working: one gesture, two directions, decided by
  // where it is released.
  import { untrack } from 'svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import DriveCommandBar from './DriveCommandBar.svelte';
  import DriveEditCard from './DriveEditCard.svelte';
  import DriveEntry from './DriveEntry.svelte';
  import {
    allFolders,
    baseName,
    crumbsFor,
    filesIn,
    folderOf,
    joinPath,
    subfoldersOf,
    FOLDER_MARKER,
  } from '$lib/drive/paths';
  import {
    dropVerdict,
    invertMoves,
    moveRequest,
    moveSummary,
    pathLabel,
    type DragPayload,
    type DropVerdict,
    type PlannedMove,
  } from '$lib/drive/move';
  import type { EditDraft, FileRow, UndoableMove, ViewMode } from './types';

  interface Props {
    files: FileRow[];
    currentPath: string;
    maxUploadBytes: number;
    shareTtlDays: number;
    sharedFileIds: Set<string>;
    busyId: string | null;
    shareBusyId: string | null;
    erChipFor: (path: string) => { tone: 'full' | 'cats' | 'out'; label: string };
    indexTitle: (f: FileRow) => string;
    onNavigate: (path: string) => void;
    onRefresh: () => Promise<void>;
    onNotice: (message: string) => void;
    onPreview: (f: FileRow) => void;
    onExtract: (f: FileRow) => void;
    onConvert: (f: FileRow) => void;
    onShare: (f: FileRow) => void;
    onDelete: (f: FileRow) => void;
    onInteract: () => void;
    onErSettings: (path: string) => void;
    /** Kept in step so section C can name the picks and act on them too. */
    onSelectionChange: (picked: FileRow[]) => void;
  }

  let {
    files, currentPath, maxUploadBytes, shareTtlDays, sharedFileIds, busyId, shareBusyId,
    erChipFor, indexTitle, onNavigate, onRefresh, onNotice, onPreview, onExtract, onConvert,
    onShare, onDelete, onInteract, onErSettings, onSelectionChange,
  }: Props = $props();

  const INDEX_LABEL: Record<string, string> = {
    indexed: 'INDEXED',
    pending: 'QUEUED',
    'no-text': 'NO TEXT',
    failed: 'FAILED',
  };

  // ——— browsing ———
  let query = $state('');
  let viewMode = $state<ViewMode>('grid');
  let selected = $state<Record<string, boolean>>({});
  let newFolderName = $state('');
  let creatingFolder = $state(false);

  const crumbs = $derived(crumbsFor(currentPath));
  const visibleFiles = $derived(filesIn(files, currentPath, query));
  const subfolders = $derived(subfoldersOf(files, currentPath, query));
  const selectedFiles = $derived(visibleFiles.filter((f) => selected[f.id]));
  const allSelected = $derived(visibleFiles.length > 0 && visibleFiles.every((f) => selected[f.id]));

  $effect(() => {
    const picked = selectedFiles;
    untrack(() => onSelectionChange(picked));
  });

  // A selection belongs to the folder it was made in — every bulk action reads
  // `visibleFiles`, so carrying picks across a navigation would silently narrow
  // them to nothing. The write is untracked: this effect depends on the path,
  // never on the map it clears.
  $effect(() => {
    currentPath;
    untrack(() => {
      selected = {};
    });
  });

  $effect(() => {
    try {
      const v = localStorage.getItem('drive:view');
      if (v === 'grid' || v === 'list') viewMode = v;
    } catch {
      /* private window — the default stands */
    }
  });

  function setView(v: ViewMode) {
    viewMode = v;
    try {
      localStorage.setItem('drive:view', v);
    } catch {
      /* ignore */
    }
  }

  function toggleAll() {
    const next = { ...selected };
    if (allSelected) for (const f of visibleFiles) delete next[f.id];
    else for (const f of visibleFiles) next[f.id] = true;
    selected = next;
  }

  // ——— drag and drop ———
  /** Non-null only while an INTERNAL drag is in flight. */
  let dragging = $state<DragPayload | null>(null);
  /** The path under the pointer, legal target or not. */
  let hotTarget = $state<string | null>(null);
  let uploadHover = $state(false);
  let moveBusy = $state(false);

  const dragVerdict = $derived(
    dragging && hotTarget !== null ? dropVerdict(files, dragging, hotTarget) : null,
  );

  function verdictFor(target: string): DropVerdict {
    if (!dragging) return { ok: false, reason: 'nothing is being dragged' };
    return dropVerdict(files, dragging, target);
  }

  function startFileDrag(e: DragEvent, f: FileRow) {
    if (!e.dataTransfer) return;
    // Dragging a selected file takes the whole selection; dragging an
    // unselected one takes just it and leaves the selection alone.
    const ids = selected[f.id] && selectedFiles.length > 1 ? selectedFiles.map((x) => x.id) : [f.id];
    dragging = { kind: 'files', ids };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('application/x-sr-drive', JSON.stringify(dragging));
    e.dataTransfer.setData('text/plain', ids.length === 1 ? baseName(f.name) : `${ids.length} files`);
    // Chromium's drag-to-desktop. Single file only: the flavour takes one URL,
    // and a multi-file drag that silently exported the first would be worse
    // than one that exports nothing.
    if (ids.length === 1) {
      const url = `${location.origin}/api/files/${f.id}/download`;
      e.dataTransfer.setData(
        'DownloadURL',
        `${f.mimeType || 'application/octet-stream'}:${baseName(f.name)}:${url}`,
      );
    }
  }

  function startFolderDrag(e: DragEvent, name: string) {
    if (!e.dataTransfer) return;
    dragging = { kind: 'folder', path: joinPath(currentPath, name) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-sr-drive', JSON.stringify(dragging));
    e.dataTransfer.setData('text/plain', name);
  }

  function endDrag() {
    dragging = null;
    hotTarget = null;
  }

  function targetEnter(path: string) {
    if (dragging) hotTarget = path;
  }

  /** `dragleave` fires when the pointer moves onto a CHILD, so check first. */
  function targetLeave(e: DragEvent, path: string) {
    if (!dragging) return;
    const to = e.relatedTarget as Node | null;
    if (e.currentTarget instanceof Node && to && e.currentTarget.contains(to)) return;
    if (hotTarget === path) hotTarget = null;
  }

  /** Fires continuously, so it is also where the target re-asserts itself. */
  function targetOver(e: DragEvent, path: string) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    hotTarget = path;
    if (e.dataTransfer) e.dataTransfer.dropEffect = verdictFor(path).ok ? 'move' : 'none';
  }

  async function targetDrop(path: string) {
    const payload = dragging;
    endDrag();
    if (!payload) return;
    const v = dropVerdict(files, payload, path);
    if (!v.ok) {
      onNotice(`Not moved — ${v.reason}.`);
      return;
    }
    await applyMoves(v.plan.moves, path, v.plan.blocked.length);
  }

  /** The Move-to menu lands here too, so both routes share one implementation. */
  async function moveSelectionTo(path: string) {
    if (selectedFiles.length === 0) return;
    const v = dropVerdict(files, { kind: 'files', ids: selectedFiles.map((f) => f.id) }, path);
    if (!v.ok) {
      onNotice(`Not moved — ${v.reason}.`);
      return;
    }
    await applyMoves(v.plan.moves, path, v.plan.blocked.length);
  }

  async function applyMoves(moves: PlannedMove[], target: string, blockedCount: number) {
    moveBusy = true;
    try {
      const res = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moves: moveRequest(moves) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        onNotice(body?.error ? `Move failed — ${body.error}` : `Move failed (${res.status})`);
        return;
      }
      selected = {};
      await onRefresh();
      const skipped = blockedCount ? ` · ${blockedCount} skipped, name already taken` : '';
      showUndo(`${moveSummary(moves, target)}${skipped}`, invertMoves(moves));
    } finally {
      moveBusy = false;
    }
  }

  // ——— undo ———
  let undoable = $state<UndoableMove | null>(null);
  // A timer HANDLE, never $state: a function that reads and writes it is called
  // from a reactive context, and the write would re-trigger what scheduled it.
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  function showUndo(summary: string, restore: { id: string; name: string }[]) {
    undoable = { summary, restore };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undoable = null), 12_000);
  }

  function dismissUndo() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    undoable = null;
  }

  async function undoMove() {
    const pending = undoable;
    dismissUndo();
    if (!pending) return;
    moveBusy = true;
    try {
      const res = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moves: pending.restore }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        onNotice(body?.error ? `Undo failed — ${body.error}` : `Undo failed (${res.status})`);
        return;
      }
      await onRefresh();
      onNotice('Move undone.');
    } finally {
      moveBusy = false;
    }
  }

  // ——— uploading ———
  let fileInput: HTMLInputElement | null = $state(null);
  let folderInput: HTMLInputElement | null = $state(null);
  let uploadPerm = $state({ read: true, write: false, append: false, delete: false });
  let uploadBusy = $state(false);
  let uploadProgress = $state<{ done: number; total: number; current: string } | null>(null);

  const limitLabel = $derived(`${Math.floor(maxUploadBytes / 1024 / 1024)} MB`);

  function isExternalDrag(e: DragEvent): boolean {
    return !dragging && !!e.dataTransfer?.types?.includes('Files');
  }

  async function uploadOne(f: File, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('name', name);
    fd.append('permissions', JSON.stringify(uploadPerm));
    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: msg.error || `Upload failed (${res.status})` };
    }
    return { ok: true };
  }

  async function uploadFiles(list: FileList | File[] | null) {
    const arr = list ? Array.from(list) : [];
    if (arr.length === 0) return;
    const failed: string[] = [];
    const ok: File[] = [];
    for (const f of arr) {
      // Guarded here because adapter-node rejects an oversize BODY before the
      // handler runs, so the endpoint's own 413 is unreachable and the browser
      // gets an opaque 500 instead.
      if (f.size > maxUploadBytes) failed.push(`${f.name} — over the ${limitLabel} limit`);
      else ok.push(f);
    }
    if (ok.length === 0) {
      onNotice(`Nothing uploaded — ${failed.join('; ')}.`);
      return;
    }
    uploadBusy = true;
    uploadProgress = { done: 0, total: ok.length, current: '' };
    try {
      for (let i = 0; i < ok.length; i++) {
        const f = ok[i];
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const name = joinPath(currentPath, rel || f.name);
        uploadProgress = { done: i, total: ok.length, current: name };
        const result = await uploadOne(f, name);
        if (!result.ok) failed.push(`${name} — ${result.error}`);
      }
      uploadProgress = { done: ok.length, total: ok.length, current: '' };
      await onRefresh();
      if (failed.length > 0) onNotice(`${failed.length} file(s) not uploaded: ${failed.slice(0, 3).join('; ')}.`);
    } finally {
      uploadBusy = false;
      setTimeout(() => {
        if (!uploadBusy) uploadProgress = null;
      }, 1800);
    }
  }

  function onShelfDrop(e: DragEvent) {
    if (dragging) {
      // Released on the background rather than a folder. The entries here are
      // already in this folder so there is nothing to do, but the drag still
      // has to be cleared or the next one starts with a stale payload.
      endDrag();
      return;
    }
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    uploadHover = false;
    uploadFiles(e.dataTransfer.files);
  }

  async function createFolder() {
    const raw = newFolderName.trim().replace(/[\\/]+/g, '-');
    if (!raw) return;
    creatingFolder = true;
    try {
      const fd = new FormData();
      fd.append('file', new File([''], FOLDER_MARKER, { type: 'application/x-directory' }));
      fd.append('name', `${joinPath(currentPath, raw)}/${FOLDER_MARKER}`);
      fd.append('permissions', JSON.stringify({ read: true, write: true, append: true, delete: true }));
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        onNotice(m.error || `Could not create the folder (${res.status}).`);
        return;
      }
      newFolderName = '';
      await onRefresh();
    } finally {
      creatingFolder = false;
    }
  }

  async function deleteFolder(seg: string) {
    const path = joinPath(currentPath, seg);
    const inFolder = files.filter((f) => f.name === path || f.name.startsWith(path + '/'));
    const real = inFolder.filter((f) => !f.name.endsWith('/' + FOLDER_MARKER)).length;
    if (!confirm(`Delete folder "${seg}"${real ? ` and its ${real} file(s)` : ''}? This cannot be undone.`)) return;
    for (const f of inFolder) await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    await onRefresh();
  }

  // ——— download ———
  let zipBusy = $state(false);

  async function downloadSelected() {
    const picks = selectedFiles;
    if (picks.length === 0) return;
    let href = `/api/files/${picks[0].id}/download`;
    let filename = baseName(picks[0].name);
    if (picks.length > 1) {
      zipBusy = true;
      try {
        const res = await fetch('/api/files/download-zip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: picks.map((f) => f.id) }),
        });
        if (!res.ok) {
          onNotice(`Download failed (${res.status}).`);
          return;
        }
        href = URL.createObjectURL(await res.blob());
        filename = 'drive-files.zip';
      } finally {
        zipBusy = false;
      }
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (picks.length > 1) URL.revokeObjectURL(href);
  }

  // ——— inline edit ———
  let editingId = $state<string | null>(null);
  let editDraft = $state<EditDraft | null>(null);
  let editBusy = $state(false);

  function startEdit(f: FileRow) {
    editingId = f.id;
    editDraft = {
      name: f.name, description: f.description ?? '', permissions: {
        read: f.permissions?.read !== false,
        write: !!f.permissions?.write,
        append: !!f.permissions?.append,
        delete: !!f.permissions?.delete,
      },
    };
  }

  function cancelEdit() {
    editingId = null;
    editDraft = null;
  }

  async function saveEdit() {
    if (!editingId || !editDraft) return;
    editBusy = true;
    try {
      const res = await fetch(`/api/files/${editingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editDraft.name,
          description: editDraft.description || null,
          permissions: editDraft.permissions,
        }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        onNotice(msg.error || 'Save failed.');
        return;
      }
      await onRefresh();
      cancelEdit();
    } finally {
      editBusy = false;
    }
  }

  // ——— per-entry inputs ———
  const EXTRACT_MIME_RE =
    /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|text\/markdown|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|audio\/.+|video\/.+)$/;

  function canExtract(f: FileRow): boolean {
    if (EXTRACT_MIME_RE.test(f.mimeType)) return true;
    const lower = f.name.toLowerCase();
    return ['.md', '.csv', '.pdf', '.docx', '.xlsx'].some((x) => lower.endsWith(x));
  }

  function indexChip(f: FileRow) {
    const status = f.indexStatus ?? 'skipped';
    if (status === 'skipped') return null;
    return { status, label: INDEX_LABEL[status], title: indexTitle(f) };
  }

  /** How a folder tile should read right now, under whatever is in flight. */
  function folderDrop(path: string): 'idle' | 'ready' | 'hot' | 'blocked' {
    if (!dragging) return 'idle';
    const v = dropVerdict(files, dragging, path);
    if (!v.ok) return hotTarget === path ? 'blocked' : 'idle';
    return hotTarget === path ? 'hot' : 'ready';
  }
</script>

<section class="b">
  <div class="b-inner">
    <SectionHead
      kicker="B / The shelf · {pathLabel(currentPath)}"
      title={['Drag it where', 'it belongs']}
      strap="Drop a file onto a folder to move it, or onto a breadcrumb to move it up. A folder takes its whole contents with it, and every move can be undone."
    >
      {#snippet aside()}
        <div class="b-upload">
          <input class="hidden" type="file" bind:this={fileInput} multiple
            onchange={() => { uploadFiles(fileInput?.files ?? null); if (fileInput) fileInput.value = ''; }} />
          <input class="hidden" type="file" bind:this={folderInput} multiple
            onchange={() => { uploadFiles(folderInput?.files ?? null); if (folderInput) folderInput.value = ''; }}
            {...{ webkitdirectory: 'true', directory: 'true', mozdirectory: 'true' } as Record<string, string>} />
          <button type="button" class="nm-save-btn" onclick={() => fileInput?.click()}>Upload files</button>
          <button type="button" class="nm-act b-muted" onclick={() => folderInput?.click()}>or a folder</button>
          <span class="b-perms" role="group" aria-label="Access for newly uploaded files">
            {#each [['read', 'R'], ['write', 'W'], ['append', 'A'], ['delete', 'D']] as const as [key, code] (key)}
              <label class="b-perm" class:on={uploadPerm[key]} title="New files get {code}">
                <input type="checkbox" bind:checked={uploadPerm[key]} />{code}
              </label>
            {/each}
          </span>
        </div>
      {/snippet}
    </SectionHead>

    <DriveCommandBar
      {crumbs}
      folderCount={subfolders.length}
      fileCount={visibleFiles.length}
      bind:query
      {viewMode}
      bind:newFolderName
      {creatingFolder}
      selectedCount={selectedFiles.length}
      {allSelected}
      anyVisible={visibleFiles.length > 0}
      {zipBusy}
      folders={allFolders(files)}
      uploadLimitLabel={limitLabel}
      {dragging}
      {hotTarget}
      {verdictFor}
      {onNavigate}
      onSetView={setView}
      onCreateFolder={createFolder}
      onToggleAll={toggleAll}
      onClearSelection={() => (selected = {})}
      onDownloadSelected={downloadSelected}
      {onInteract}
      onMoveTo={moveSelectionTo}
      onErSettings={() => onErSettings(currentPath)}
      onTargetEnter={targetEnter}
      onTargetLeave={(p) => (hotTarget === p ? (hotTarget = null) : null)}
      onTargetDrop={targetDrop}
    />

    {#if uploadProgress && uploadProgress.total > 0}
      <div class="b-progress">
        <div class="b-bar" style="width: {(uploadProgress.done / uploadProgress.total) * 100}%"></div>
        <span>{uploadProgress.done}/{uploadProgress.total}{uploadProgress.current ? ` — ${uploadProgress.current}` : ''}</span>
      </div>
    {/if}

    <!-- The whole surface is the upload zone, and the overlay only appears when
         an external drag is actually over it — the page this replaced spent
         200px of the fold on a permanently visible empty box. -->
    <div
      class="b-surface"
      class:uploading={uploadHover}
      class:moving={!!dragging}
      role="region"
      aria-label="Files in {pathLabel(currentPath)}"
      ondragenter={(e) => { if (isExternalDrag(e)) uploadHover = true; }}
      ondragover={(e) => { if (isExternalDrag(e)) { e.preventDefault(); uploadHover = true; } }}
      ondragleave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) uploadHover = false; }}
      ondrop={onShelfDrop}
    >
      {#if uploadHover}
        <div class="b-overlay">
          <p class="b-ov-title">Release to upload</p>
          <p class="b-ov-path">into {pathLabel(currentPath)}</p>
        </div>
      {/if}

      {#if subfolders.length === 0 && visibleFiles.length === 0}
        <p class="b-empty">
          {query
            ? `Nothing here matches "${query}".`
            : `This folder is empty. Drop files anywhere on this panel${currentPath ? '.' : ', or add a folder above.'}`}
        </p>
      {:else}
        <div class="b-items {viewMode}" role="list">
          {#if viewMode === 'list'}
            <!-- Column heads, so the mono columns under them read as a table
                 rather than as four stacked meta strings. They share
                 `--dl-cols` with every row, which is the only reason the two
                 cannot drift out of alignment. -->
            <div class="dl-head" aria-hidden="true">
              <span></span><span></span><span>Name</span><span>Size</span><span>Updated</span><span>Status</span><span>Access</span>
            </div>
          {/if}
          {#each subfolders as fol (fol.name)}
            {@const path = joinPath(currentPath, fol.name)}
            <DriveEntry
              item={{ kind: 'folder', name: fol.name, count: fol.count, path }}
              view={viewMode}
              flags={{
                drop: folderDrop(path),
                lifting: dragging?.kind === 'folder' && dragging.path === path,
                selected: false, busy: false, shareBusy: false, shared: false, canExtract: false,
              }}
              erChip={erChipFor(path)}
              index={null}
              {shareTtlDays}
              drag={{
                start: (e) => startFolderDrag(e, fol.name),
                end: endDrag,
                enter: () => targetEnter(path),
                leave: (e) => targetLeave(e, path),
                over: (e) => targetOver(e, path),
                drop: (e) => { if (dragging) { e.preventDefault(); e.stopPropagation(); targetDrop(path); } },
              }}
              on={{
                open: () => onNavigate(path),
                policy: () => onErSettings(path),
                remove: () => deleteFolder(fol.name),
              }}
            />
          {/each}

          {#each visibleFiles as f (f.id)}
            {#if editingId === f.id && editDraft}
              <DriveEditCard bind:draft={editDraft} busy={editBusy} onSave={saveEdit} onCancel={cancelEdit} />
            {:else}
              <DriveEntry
                item={{ kind: 'file', file: f }}
                view={viewMode}
                flags={{
                  drop: 'idle',
                  lifting: dragging?.kind === 'files' && dragging.ids.includes(f.id),
                  selected: !!selected[f.id],
                  busy: busyId === f.id,
                  shareBusy: shareBusyId === f.id,
                  shared: sharedFileIds.has(f.id),
                  canExtract: canExtract(f),
                }}
                erChip={erChipFor(folderOf(f.name))}
                index={indexChip(f)}
                {shareTtlDays}
                drag={{ start: (e) => startFileDrag(e, f), end: endDrag }}
                on={{
                  open: () => onPreview(f),
                  select: (v) => (selected[f.id] = v),
                  policy: () => onErSettings(folderOf(f.name)),
                  remove: () => onDelete(f),
                  edit: () => startEdit(f),
                  extract: () => onExtract(f),
                  convert: () => onConvert(f),
                  share: () => onShare(f),
                }}
              />
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

<!-- The status dock: what a live drag would do, then what the last one did. It
     is fixed because a drag can be released anywhere on the page, and the
     sentence naming the operation has to stay in view while it is. -->
{#if dragVerdict || undoable || moveBusy}
  <div class="dock" role="status" aria-live="polite">
    <div class="dock-strip" class:bad={dragVerdict && !dragVerdict.ok}>
      {#if dragVerdict}
        <span class="dock-tag">{dragVerdict.ok ? 'Move' : 'Blocked'}</span>
        <span class="dock-text">{dragVerdict.ok ? dragVerdict.label : dragVerdict.reason}</span>
      {:else if moveBusy}
        <span class="dock-tag">Working</span><span class="dock-text">Applying the move</span>
      {:else if undoable}
        <span class="dock-tag">Done</span>
        <span class="dock-text">{undoable.summary}</span>
        <button type="button" class="dock-undo" onclick={undoMove}>Undo</button>
        <button type="button" class="dock-x" onclick={dismissUndo} aria-label="Dismiss">✕</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .b {
    padding: clamp(34px, 4vw, 58px) clamp(20px, 3vw, 44px) clamp(30px, 3.4vw, 48px);
    background: var(--bg);
  }
  .b-inner { max-width: 1400px; margin: 0 auto; }
  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  /* ——— upload control, in the section head's aside ——— */
  .b-upload {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .b-muted { color: var(--text-muted); }
  .b-perms { display: inline-flex; gap: 3px; }
  .b-perm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    cursor: pointer;
  }
  .b-perm.on { border-color: var(--accent); color: var(--accent); }
  .b-perm input { display: none; }

  /* ——— upload progress ——— */
  .b-progress {
    position: relative;
    border: 1px solid var(--line-strong);
    padding: 8px 12px;
    margin-bottom: 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    overflow: hidden;
  }
  .b-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(196, 87, 10, 0.16);
    transition: width 0.2s ease-out;
  }
  .b-progress span { position: relative; }

  /* ——— the drop surface ——— */
  .b-surface {
    position: relative;
    border: 1px solid var(--line-strong);
    padding: 16px;
    min-height: 180px;
  }
  .b-surface.uploading { border-color: var(--accent); }
  .b-surface.moving { border-style: dashed; }
  .b-overlay {
    position: absolute;
    inset: 0;
    z-index: 12;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(237, 228, 212, 0.94);
    pointer-events: none;
  }
  .b-ov-title {
    font-family: var(--font-display);
    font-size: clamp(22px, 3vw, 34px);
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--accent);
    margin: 0;
  }
  .b-ov-path {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0;
  }
  .b-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    text-align: center;
    padding: 48px 12px;
    margin: 0;
  }

  .b-items.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 12px;
  }
  .b-items.list {
    display: flex;
    flex-direction: column;
    /* The one track definition. Every row reads it through `var(--dl-cols)`. */
    --dl-cols: 24px 24px minmax(0, 1fr) 76px 104px 96px 108px;
  }
  .dl-head {
    display: grid;
    grid-template-columns: var(--dl-cols);
    gap: 10px;
    padding: 0 10px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    border-bottom: 1px solid var(--line-strong);
  }
  @media (max-width: 1000px) {
    .dl-head { display: none; }
  }

  /* ——— the fixed status dock ——— */
  .dock {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    z-index: 90;
    pointer-events: none;
  }
  .dock-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.2);
    color: var(--bg);
    pointer-events: auto;
    max-width: min(92vw, 700px);
  }
  .dock-strip.bad { border-color: rgba(224, 139, 139, 0.5); }
  .dock-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    white-space: nowrap;
  }
  .dock-strip.bad .dock-tag { color: #e08b8b; }
  .dock-text {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dock-undo {
    background: var(--accent-on-dark);
    border: none;
    padding: 5px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .dock-x {
    background: none;
    border: none;
    padding: 0 2px;
    color: rgba(237, 228, 212, 0.55);
    cursor: pointer;
    font-size: var(--fs-label-xs);
  }
  .dock-x:hover { color: var(--bg); }
</style>
