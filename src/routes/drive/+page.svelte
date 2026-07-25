<svelte:head><title>Drive — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FileViewerModal from '$lib/components/drive/FileViewerModal.svelte';
  import InteractModelModal from '$lib/components/drive/InteractModelModal.svelte';
  import RagChatPanel from '$lib/components/drive/RagChatPanel.svelte';
  import type { RagCollection } from '$lib/db/schema';

  let { data } = $props();

  type FileRow = {
    id: string;
    name: string;
    description: string | null;
    mimeType: string;
    sizeBytes: number;
    permissions: { read?: boolean; write?: boolean; append?: boolean; delete?: boolean } | null;
    uploadedBy: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  };

  let files = $state<FileRow[]>(data.files as FileRow[]);

  // Effective upload cap = min(server BODY_SIZE_LIMIT, endpoint MAX_BYTES), from the load.
  const maxUploadBytes = (data.maxUploadBytes as number | undefined) ?? 20 * 1024 * 1024;
  function fmtLimit(): string {
    return `${Math.floor(maxUploadBytes / 1024 / 1024)} MB`;
  }

  // ——— Folders (virtual — derived from '/' in file names; empty folders keep a .keep marker) ———
  const FOLDER_MARKER = '.keep';
  let currentPath = $state(''); // '' = root
  let newFolderName = $state('');
  let creatingFolder = $state(false);
  let moveOpen = $state(false);

  function isMarker(name: string): boolean {
    return name === FOLDER_MARKER || name.endsWith('/' + FOLDER_MARKER);
  }
  function joinPath(dir: string, name: string): string {
    return dir ? `${dir}/${name}` : name;
  }
  // remainder of a file name below currentPath, or null if it isn't under it
  function underCurrent(name: string): string | null {
    if (!currentPath) return name;
    const p = currentPath + '/';
    return name.startsWith(p) ? name.slice(p.length) : null;
  }

  // Files shown directly in the current folder (exclude markers + deeper subfolder contents)
  const visibleFiles = $derived(
    files.filter((f) => {
      if (isMarker(f.name)) return false;
      const rem = underCurrent(f.name);
      return rem !== null && !rem.includes('/') && matchesQuery(f.name);
    }),
  );

  // Immediate subfolders of the current folder, with real-file counts. When a
  // search query is active, only folders whose name matches are shown.
  const subfolders = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const f of files) {
      const rem = underCurrent(f.name);
      if (rem === null) continue;
      const slash = rem.indexOf('/');
      if (slash <= 0) continue; // a file directly here (or empty remainder)
      const seg = rem.slice(0, slash);
      if (!counts.has(seg)) counts.set(seg, 0);
      if (!isMarker(f.name)) counts.set(seg, (counts.get(seg) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .filter(({ name }) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const crumbs = $derived.by(() => {
    const segs = currentPath ? currentPath.split('/') : [];
    const out: { label: string; path: string }[] = [{ label: 'Drive', path: '' }];
    let acc = '';
    for (const s of segs) {
      acc = acc ? `${acc}/${s}` : s;
      out.push({ label: s, path: acc });
    }
    return out;
  });

  // Every folder path in the store, for the Move-to picker
  const allFolders = $derived.by(() => {
    const set = new Set<string>();
    for (const f of files) {
      if (!f.name.includes('/')) continue;
      const dir = f.name.slice(0, f.name.lastIndexOf('/'));
      const segs = dir.split('/');
      let acc = '';
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s;
        set.add(acc);
      }
    }
    return [...set].sort();
  });

  function navigate(path: string) {
    currentPath = path;
    selected = {};
    moveOpen = false;
  }

  // ——— Live search filter (scoped to the current folder) ———
  let query = $state('');
  function matchesQuery(name: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return baseName(name).toLowerCase().includes(q);
  }

  let fileInput: HTMLInputElement | null = $state(null);
  let folderInput: HTMLInputElement | null = $state(null);
  let uploadDesc = $state('');
  let uploadPerm = $state({ read: true, write: false, append: false, delete: false });
  let uploadBusy = $state(false);
  let uploadError = $state<string | null>(null);
  let uploadProgress = $state<{ done: number; total: number; current: string } | null>(null);
  let uploadFailures = $state<{ name: string; error: string }[]>([]);

  // ——— Drag-and-drop upload state ———
  let dragDepth = $state(0);
  const dragActive = $derived(dragDepth > 0);

  // ——— Multi-select / download state ———
  let selected = $state<Record<string, boolean>>({});
  // Scope to visibleFiles (current folder + active search) so bulk actions —
  // download, move, interact — never operate on files hidden by the filter.
  const selectedFiles = $derived(visibleFiles.filter((f) => selected[f.id]));
  const allSelected = $derived(visibleFiles.length > 0 && visibleFiles.every((f) => selected[f.id]));
  let zipBusy = $state(false);

  // ——— View mode (list | grid) — grid by default, persisted per browser ———
  let viewMode = $state<'list' | 'grid'>('grid');
  let onboardDismissed = $state(true); // assume dismissed until localStorage says otherwise (avoids SSR flash)
  onMount(() => {
    const v = localStorage.getItem('drive:view');
    if (v === 'grid' || v === 'list') viewMode = v;
    onboardDismissed = localStorage.getItem('drive:onboarded') === '1';
    loadCollections();
  });
  function dismissOnboard() {
    onboardDismissed = true;
    try { localStorage.setItem('drive:onboarded', '1'); } catch { /* ignore */ }
  }
  function setView(v: 'list' | 'grid') {
    viewMode = v;
    try { localStorage.setItem('drive:view', v); } catch { /* ignore */ }
  }
  function isImage(mime: string): boolean {
    return mime.startsWith('image/');
  }
  function extBadge(name: string): string {
    const parts = name.split('.');
    if (parts.length < 2) return 'FILE';
    const ext = parts.pop()!.toUpperCase();
    return ext.length <= 5 ? ext : ext.slice(0, 4);
  }

  let editingId = $state<string | null>(null);
  let editDraft = $state<{
    name: string;
    description: string;
    permissions: { read: boolean; write: boolean; append: boolean; delete: boolean };
  } | null>(null);
  let editBusy = $state(false);

  let busyId: string | null = $state(null);
  let extractResult: { name: string; text: string; meta: unknown } | null = $state(null);
  let convertModalFor: { id: string; name: string } | null = $state(null);
  let convertSource: 'markdown' | 'text' | 'json' | 'csv' | 'xlsx' = $state('markdown');
  let convertFormat: 'docx' | 'pdf' | 'html' | 'xlsx' | 'csv' = $state('pdf');

  const EXTRACT_MIME_RE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|text\/markdown|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|audio\/.+|video\/.+)$/;

  function canExtract(mimeType: string, name: string): boolean {
    if (EXTRACT_MIME_RE.test(mimeType)) return true;
    const lower = name.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.csv') || lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.xlsx');
  }

  async function runExtract(file: { id: string; name: string }) {
    busyId = file.id;
    extractResult = null;
    try {
      const res = await fetch(`/api/files/${file.id}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) {
        alert(`Extract failed: ${data.code ?? ''} ${data.error ?? 'unknown'}`);
        return;
      }
      extractResult = { name: file.name, text: data.text.slice(0, 5000), meta: data.meta };
      await invalidateAll();
      await refresh();
    } finally {
      busyId = null;
    }
  }

  async function runConvert() {
    if (!convertModalFor) return;
    busyId = convertModalFor.id;
    try {
      const res = await fetch(`/api/files/${convertModalFor.id}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: convertSource, format: convertFormat }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Convert failed: ${data.code ?? ''} ${data.error ?? 'unknown'}`);
        return;
      }
      convertModalFor = null;
      await invalidateAll();
      await refresh();
    } finally {
      busyId = null;
    }
  }

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function fmtDate(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleString();
  }

  function baseName(name: string): string {
    return name.split('/').pop() || name;
  }

  async function refresh() {
    const res = await fetch('/api/files');
    if (res.ok) {
      const body = await res.json();
      files = body.files;
    }
  }

  async function uploadOne(f: File, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('name', name);
    if (uploadDesc.trim()) fd.append('description', uploadDesc.trim());
    fd.append('permissions', JSON.stringify(uploadPerm));
    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: msg.error || `Upload failed (${res.status})` };
    }
    return { ok: true };
  }

  // Upload a batch immediately into the current folder (drop or picker). Folder picks keep
  // their relative path. Oversize files are rejected client-side so the server's body limit
  // never returns an opaque 500.
  async function uploadFiles(list: FileList | File[] | null) {
    const arr = list ? Array.from(list) : [];
    if (arr.length === 0) return;
    uploadError = null;
    uploadFailures = [];
    const ok: File[] = [];
    for (const f of arr) {
      if (f.size > maxUploadBytes) {
        uploadFailures = [...uploadFailures, { name: f.name, error: `too large (max ${fmtLimit()})` }];
      } else {
        ok.push(f);
      }
    }
    if (ok.length === 0) {
      uploadError = `Nothing uploaded — file(s) exceed the ${fmtLimit()} limit.`;
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
        if (!result.ok) uploadFailures = [...uploadFailures, { name, error: result.error }];
      }
      uploadProgress = { done: ok.length, total: ok.length, current: '' };
      await refresh();
      if (uploadFailures.length > 0) uploadError = `${uploadFailures.length} file(s) skipped or failed.`;
    } finally {
      uploadBusy = false;
      setTimeout(() => { if (!uploadBusy) uploadProgress = null; }, 1800);
    }
  }

  // ——— Folder actions ———
  async function createFolder() {
    const raw = newFolderName.trim().replace(/[\\/]+/g, '-');
    if (!raw) return;
    const path = joinPath(currentPath, raw);
    creatingFolder = true;
    try {
      const fd = new FormData();
      fd.append('file', new File([''], FOLDER_MARKER, { type: 'application/x-directory' }));
      fd.append('name', `${path}/${FOLDER_MARKER}`);
      fd.append('permissions', JSON.stringify({ read: true, write: true, append: true, delete: true }));
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        alert(m.error || `Create folder failed (${res.status})`);
        return;
      }
      newFolderName = '';
      await refresh();
    } finally {
      creatingFolder = false;
    }
  }

  async function moveSelected(target: string) {
    const picks = selectedFiles;
    moveOpen = false;
    if (picks.length === 0) return;
    const failures: string[] = [];
    for (const f of picks) {
      const newName = joinPath(target, baseName(f.name));
      if (newName === f.name) continue;
      const res = await fetch(`/api/files/${f.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        failures.push(`${baseName(f.name)}: ${m.error || res.status}`);
      }
    }
    selected = {};
    await refresh();
    if (failures.length) alert(`Some files could not be moved:\n${failures.join('\n')}`);
  }

  async function deleteFolder(seg: string) {
    const path = joinPath(currentPath, seg);
    const prefix = path + '/';
    const inFolder = files.filter((f) => f.name === path || f.name.startsWith(prefix));
    const realCount = inFolder.filter((f) => !isMarker(f.name)).length;
    if (!confirm(`Delete folder "${seg}"${realCount ? ` and its ${realCount} file(s)` : ''}? This cannot be undone.`)) return;
    for (const f of inFolder) {
      await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    }
    await refresh();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    uploadFiles(e.dataTransfer?.files ?? null);
  }

  function onPick() {
    uploadFiles(fileInput?.files ?? null);
    if (fileInput) fileInput.value = '';
  }
  function onFolderPick() {
    uploadFiles(folderInput?.files ?? null);
    if (folderInput) folderInput.value = '';
  }

  // ——— Selection + copy-out ———
  function toggleAll() {
    const next = { ...selected };
    if (allSelected) for (const f of visibleFiles) delete next[f.id];
    else for (const f of visibleFiles) next[f.id] = true;
    selected = next;
  }
  function clearSelection() {
    selected = {};
  }

  function triggerDownload(href: string, filename?: string) {
    const a = document.createElement('a');
    a.href = href;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadSelected() {
    const picks = selectedFiles;
    if (picks.length === 0) return;
    if (picks.length === 1) {
      triggerDownload(`/api/files/${picks[0].id}/download`, baseName(picks[0].name));
      return;
    }
    zipBusy = true;
    try {
      const res = await fetch('/api/files/download-zip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: picks.map((f) => f.id) }),
      });
      if (!res.ok) { alert(`Download failed (${res.status})`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'drive-files.zip');
      URL.revokeObjectURL(url);
    } finally {
      zipBusy = false;
    }
  }

  // Native drag-to-desktop (Chromium supports the DownloadURL flavour).
  function onFileDragStart(e: DragEvent, f: FileRow) {
    if (!e.dataTransfer) return;
    const url = `${location.origin}/api/files/${f.id}/download`;
    e.dataTransfer.setData('DownloadURL', `${f.mimeType || 'application/octet-stream'}:${baseName(f.name)}:${url}`);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function startEdit(f: FileRow) {
    editingId = f.id;
    editDraft = {
      name: f.name,
      description: f.description ?? '',
      permissions: {
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
        alert(msg.error || 'Save failed');
        return;
      }
      await refresh();
      cancelEdit();
    } finally {
      editBusy = false;
    }
  }

  // ——— File viewer (double-click preview) ———
  let viewerFile = $state<FileRow | null>(null);
  function openViewer(f: FileRow) {
    viewerFile = f;
  }

  // ——— "Interact using model" — RAG collections ———
  let interactOpen = $state(false);
  let chatCollection = $state<RagCollection | null>(null);
  let collections = $state<RagCollection[]>([]);
  let collectionsLoaded = $state(false);

  async function loadCollections() {
    try {
      const res = await fetch('/api/files/rag');
      if (res.ok) {
        const body = await res.json();
        collections = body.collections ?? [];
      }
    } finally {
      collectionsLoaded = true;
    }
  }

  function onCollectionCreated(c: RagCollection) {
    interactOpen = false;
    collections = [c, ...collections.filter((x) => x.id !== c.id)];
    chatCollection = c;
    selected = {};
  }

  function onCollectionChanged(c: RagCollection) {
    collections = collections.map((x) => (x.id === c.id ? c : x));
  }

  async function reindexCollection(c: RagCollection) {
    const res = await fetch(`/api/files/rag/${c.id}/reindex`, { method: 'POST' });
    if (!res.ok) { alert(`Reindex failed (${res.status})`); return; }
    const next = { ...c, status: 'indexing' } as RagCollection;
    collections = collections.map((x) => (x.id === c.id ? next : x));
    loadCollections();
  }

  async function deleteCollection(c: RagCollection) {
    if (!confirm(`Delete knowledge base "${c.name}"? The index is removed; the source files stay.`)) return;
    const res = await fetch(`/api/files/rag/${c.id}`, { method: 'DELETE' });
    if (!res.ok) { alert(`Delete failed (${res.status})`); return; }
    collections = collections.filter((x) => x.id !== c.id);
    if (chatCollection?.id === c.id) chatCollection = null;
  }

  function ragStatusLabel(c: RagCollection): string {
    if (c.status === 'ready') return `${c.chunkCount} chunks`;
    if (c.status === 'indexing' || c.status === 'pending') return 'indexing…';
    if (c.status === 'error') return 'failed';
    return c.status;
  }

  async function deleteRow(f: FileRow) {
    if (!confirm(`Delete "${f.name}"? This removes the file from disk and cannot be undone.`)) return;
    const res = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    if (!res.ok) {
      alert(`Delete failed (${res.status})`);
      return;
    }
    files = files.filter((x) => x.id !== f.id);
    delete selected[f.id];
  }
</script>

<!-- Stop the browser from navigating when a file is dropped outside the zone. -->
<svelte:window
  ondragover={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
  ondrop={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
/>

<div class="drive-root">
  <PageHeader title="Drive" />

  <main class="drive-wrap">
    {#if !onboardDismissed}
      <section class="onboard" aria-label="What you can do in Drive">
        <button type="button" class="onboard-x" onclick={dismissOnboard} aria-label="Dismiss">✕</button>
        <div class="onboard-hd">
          <span class="onboard-kicker">Your files, on the server</span>
          <h2 class="onboard-title">Store it, preview it, ask about it.</h2>
        </div>
        <div class="onboard-grid">
          <div class="onboard-step">
            <span class="onboard-num">01</span>
            <strong>Drop to upload</strong>
            <p>Drag files (or a whole folder) onto the zone below, or click to browse. Organise them into folders.</p>
          </div>
          <div class="onboard-step">
            <span class="onboard-num">02</span>
            <strong>Double-click to preview</strong>
            <p>Images, PDFs, video, audio, Word docs, Markdown and code all open in place — syntax-highlighted, no download needed.</p>
          </div>
          <div class="onboard-step">
            <span class="onboard-num">03</span>
            <strong>Interact using model</strong>
            <p>Select a few documents and build a knowledge base, then chat with them — answers are grounded in your files and cite their sources.</p>
          </div>
          <div class="onboard-step">
            <span class="onboard-num">04</span>
            <strong>Search &amp; grab</strong>
            <p>Filter instantly by name, download a selection as a zip, or drag files straight back out to your desktop.</p>
          </div>
        </div>
      </section>
    {/if}

    <!-- ——— Drag-and-drop upload zone ——— -->
    <div
      class="dropzone"
      class:active={dragActive}
      role="button"
      tabindex="0"
      aria-label="Upload files — drop here or click to browse"
      onclick={() => fileInput?.click()}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
      ondragenter={() => dragDepth++}
      ondragleave={() => dragDepth--}
      ondragover={(e) => e.preventDefault()}
      ondrop={onDrop}
    >
      <input class="hidden-input" type="file" bind:this={fileInput} onchange={onPick} multiple />
      <input
        class="hidden-input"
        type="file"
        bind:this={folderInput}
        onchange={onFolderPick}
        multiple
        {...({ webkitdirectory: 'true', directory: 'true', mozdirectory: 'true' } as Record<string, string>)}
      />

      <svg class="dz-icon" width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 15V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
        <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
      </svg>
      <div class="dz-title">{dragActive ? 'Drop to upload' : currentPath ? `Drop into ${currentPath.split('/').pop()}` : 'Drop files here'}</div>
      <div class="dz-sub">
        or <span class="dz-link">browse</span>
        <span class="dz-dot">·</span>
        <button
          type="button"
          class="dz-link dz-folder"
          onclick={(e) => { e.stopPropagation(); folderInput?.click(); }}
        >upload a folder</button>
      </div>

      <div class="dz-perms" onclick={(e) => e.stopPropagation()} role="group" aria-label="Permissions for uploaded files">
        <span class="dz-perms-label">New file access</span>
        <label class="perm-toggle" class:on={uploadPerm.read}>
          <input type="checkbox" bind:checked={uploadPerm.read} />
          <span class="perm-code">R</span><span class="perm-name">Read</span>
        </label>
        <label class="perm-toggle" class:on={uploadPerm.write}>
          <input type="checkbox" bind:checked={uploadPerm.write} />
          <span class="perm-code">W</span><span class="perm-name">Write</span>
        </label>
        <label class="perm-toggle" class:on={uploadPerm.append}>
          <input type="checkbox" bind:checked={uploadPerm.append} />
          <span class="perm-code">A</span><span class="perm-name">Append</span>
        </label>
        <label class="perm-toggle" class:on={uploadPerm.delete}>
          <input type="checkbox" bind:checked={uploadPerm.delete} />
          <span class="perm-code">D</span><span class="perm-name">Delete</span>
        </label>
      </div>
    </div>

    {#if uploadProgress && uploadProgress.total > 0}
      <div class="progress-line">
        <div class="progress-bar" style="width: {(uploadProgress.done / uploadProgress.total) * 100}%"></div>
        <span class="progress-text">
          {uploadProgress.done}/{uploadProgress.total}
          {#if uploadProgress.current} — {uploadProgress.current}{/if}
        </span>
      </div>
    {/if}
    {#if uploadError}
      <div class="err-line">{uploadError}</div>
    {/if}
    {#if uploadFailures.length > 0}
      <details class="fail-list">
        <summary>{uploadFailures.length} failed</summary>
        <ul>
          {#each uploadFailures as fail}
            <li><code>{fail.name}</code> — {fail.error}</li>
          {/each}
        </ul>
      </details>
    {/if}

    <!-- ——— Files ——— -->
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <nav class="crumbs" aria-label="Folder path">
          {#each crumbs as c, i (c.path)}
            {#if i < crumbs.length - 1}
              <button type="button" class="crumb crumb-link" onclick={() => navigate(c.path)}>{c.label}</button>
              <span class="crumb-sep">/</span>
            {:else}
              <span class="crumb crumb-current">{c.label}</span>
            {/if}
          {/each}
        </nav>
        <div class="hd-right">
          <div class="drive-search">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M9.3 9.3L12.5 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
            </svg>
            <input
              class="search-input"
              type="text"
              placeholder="Search files…"
              bind:value={query}
              aria-label="Search files by name"
            />
            {#if query}
              <button type="button" class="search-clear" onclick={() => (query = '')} aria-label="Clear search">✕</button>
            {/if}
          </div>
          <span class="nm-sec-meta">
            {subfolders.length ? `${subfolders.length} folder${subfolders.length === 1 ? '' : 's'} · ` : ''}{visibleFiles.length} {visibleFiles.length === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>

      {#snippet permChips(f: FileRow)}
        <span class="perm-chip" class:on={f.permissions?.read !== false}>R</span>
        <span class="perm-chip" class:on={!!f.permissions?.write}>W</span>
        <span class="perm-chip" class:on={!!f.permissions?.append}>A</span>
        <span class="perm-chip" class:on={!!f.permissions?.delete}>D</span>
      {/snippet}

      {#snippet fileActions(f: FileRow)}
        <button type="button" class="row-link" onclick={() => openViewer(f)}>Preview</button>
        <a href={`/api/files/${f.id}/download`} class="row-link" download={baseName(f.name)}>Download</a>
        {#if canExtract(f.mimeType, f.name)}
          <button type="button" class="row-link" disabled={busyId === f.id} onclick={() => runExtract(f)}>
            {busyId === f.id ? 'Extracting…' : 'Extract'}
          </button>
        {/if}
        <button type="button" class="row-link" disabled={busyId === f.id} onclick={() => (convertModalFor = { id: f.id, name: f.name })}>Convert</button>
        <button type="button" class="row-link" onclick={() => startEdit(f)}>Edit</button>
        <button type="button" class="row-link danger" onclick={() => deleteRow(f)}>Delete</button>
      {/snippet}

      {#snippet editCard()}
        {#if editDraft}
          <div class="file-card editing">
            <div class="edit-grid">
              <label class="field">
                <span class="sr-label-tight">Name</span>
                <input type="text" bind:value={editDraft.name} class="nm-text-input" />
              </label>
              <label class="field">
                <span class="sr-label-tight">Description</span>
                <input type="text" bind:value={editDraft.description} class="nm-text-input" />
              </label>
              <div class="field">
                <span class="sr-label-tight">Permissions</span>
                <div class="perm-row">
                  <label class="perm-toggle" class:on={editDraft.permissions.read}>
                    <input type="checkbox" bind:checked={editDraft.permissions.read} />
                    <span class="perm-code">R</span><span class="perm-name">Read</span>
                  </label>
                  <label class="perm-toggle" class:on={editDraft.permissions.write}>
                    <input type="checkbox" bind:checked={editDraft.permissions.write} />
                    <span class="perm-code">W</span><span class="perm-name">Write</span>
                  </label>
                  <label class="perm-toggle" class:on={editDraft.permissions.append}>
                    <input type="checkbox" bind:checked={editDraft.permissions.append} />
                    <span class="perm-code">A</span><span class="perm-name">Append</span>
                  </label>
                  <label class="perm-toggle" class:on={editDraft.permissions.delete}>
                    <input type="checkbox" bind:checked={editDraft.permissions.delete} />
                    <span class="perm-code">D</span><span class="perm-name">Delete</span>
                  </label>
                </div>
              </div>
              <div class="edit-actions">
                <button type="button" class="nm-save-btn" onclick={saveEdit} disabled={editBusy}>
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" class="btn-ghost" onclick={cancelEdit}>Cancel</button>
              </div>
            </div>
          </div>
        {/if}
      {/snippet}

      <div class="select-bar">
        <label class="select-all" class:disabled={visibleFiles.length === 0}>
          <input type="checkbox" checked={allSelected} disabled={visibleFiles.length === 0} onchange={toggleAll} />
          <span>Select all</span>
        </label>
        {#if selectedFiles.length > 0}
          <span class="sel-count">{selectedFiles.length} selected</span>
          <button type="button" class="nm-save-btn rag-interact-btn" onclick={() => (interactOpen = true)} title="Build a knowledge base from the selected files and chat with them">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5l1.4 3.1 3.1 1.4-3.1 1.4L7 12.5 5.6 7.4 2.5 6l3.1-1.4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            Interact using model
          </button>
          <button type="button" class="nm-save-btn sel-dl" onclick={downloadSelected} disabled={zipBusy}>
            {zipBusy ? 'Zipping…' : selectedFiles.length > 1 ? `Download ${selectedFiles.length} (.zip)` : 'Download'}
          </button>
          <div class="move-wrap">
            <button type="button" class="row-link" aria-expanded={moveOpen} onclick={() => (moveOpen = !moveOpen)}>Move to…</button>
            {#if moveOpen}
              <div class="move-menu">
                <button type="button" class="move-item" onclick={() => moveSelected('')}>Drive (root)</button>
                {#each allFolders as folder (folder)}
                  <button type="button" class="move-item" onclick={() => moveSelected(folder)}>{folder}</button>
                {/each}
              </div>
            {/if}
          </div>
          <button type="button" class="row-link" onclick={clearSelection}>Clear</button>
        {:else}
          <span class="sel-hint">Drop files to add them here · select to download · drag out to your desktop. Max {fmtLimit()}.</span>
        {/if}
        <div class="newfolder">
          <input
            class="nm-text-input nf-input"
            placeholder="New folder…"
            bind:value={newFolderName}
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createFolder(); } }}
          />
          <button type="button" class="row-link" onclick={createFolder} disabled={creatingFolder || !newFolderName.trim()}>
            {creatingFolder ? 'Adding…' : '+ Folder'}
          </button>
        </div>
        <div class="view-toggle" role="group" aria-label="View mode">
          <button type="button" class="vt-btn" class:on={viewMode === 'list'} aria-pressed={viewMode === 'list'} title="List view" onclick={() => setView('list')}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3h10M2 7h10M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
            <span>List</span>
          </button>
          <button type="button" class="vt-btn" class:on={viewMode === 'grid'} aria-pressed={viewMode === 'grid'} title="Grid view" onclick={() => setView('grid')}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="4" height="4" stroke="currentColor" stroke-width="1.3"/><rect x="8.5" y="1.5" width="4" height="4" stroke="currentColor" stroke-width="1.3"/><rect x="1.5" y="8.5" width="4" height="4" stroke="currentColor" stroke-width="1.3"/><rect x="8.5" y="8.5" width="4" height="4" stroke="currentColor" stroke-width="1.3"/></svg>
            <span>Grid</span>
          </button>
        </div>
      </div>

      {#if subfolders.length === 0 && visibleFiles.length === 0}
        <div class="empty">This folder is empty — drop files above{currentPath ? '.' : ', or add a folder.'}</div>
      {:else if viewMode === 'grid'}
        <div class="file-grid" role="list">
          {#each subfolders as fol (fol.name)}
            <div
              class="folder-tile"
              role="button"
              tabindex="0"
              title={`Open ${fol.name}`}
              onclick={() => navigate(joinPath(currentPath, fol.name))}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(joinPath(currentPath, fol.name)); } }}
            >
              <button type="button" class="folder-del" title="Delete folder" aria-label={`Delete folder ${fol.name}`} onclick={(e) => { e.stopPropagation(); deleteFolder(fol.name); }}>×</button>
              <svg class="folder-icon" width="46" height="38" viewBox="0 0 46 38" fill="none" aria-hidden="true">
                <path d="M2 6a2 2 0 012-2h12l3.5 3.5H42a2 2 0 012 2V32a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.6"/>
              </svg>
              <div class="tile-name">{fol.name}</div>
              <div class="tile-meta"><span>{fol.count} item{fol.count === 1 ? '' : 's'}</span></div>
            </div>
          {/each}
          {#each visibleFiles as f (f.id)}
            {#if editingId === f.id && editDraft}
              <div class="grid-edit">{@render editCard()}</div>
            {:else}
              <div
                class="file-tile"
                class:sel={selected[f.id]}
                role="listitem"
                draggable="true"
                ondragstart={(e) => onFileDragStart(e, f)}
                ondblclick={() => openViewer(f)}
                title={`${f.name} — double-click to preview`}
              >
                <label class="tile-check" title="Select">
                  <input type="checkbox" checked={!!selected[f.id]} onchange={(e) => (selected[f.id] = e.currentTarget.checked)} />
                </label>
                <div class="tile-thumb">
                  {#if isImage(f.mimeType)}
                    <img src={`/api/files/${f.id}/download?inline=1`} alt={f.name} loading="lazy" />
                  {:else}
                    <svg class="tile-icon" width="38" height="46" viewBox="0 0 38 46" fill="none" aria-hidden="true">
                      <path d="M5 1.5h19L36 13v30.5a1.5 1.5 0 01-1.5 1.5h-29A1.5 1.5 0 014 43.5V3A1.5 1.5 0 015.5 1.5z" stroke="currentColor" stroke-width="1.4"/>
                      <path d="M24 1.5V13h12" stroke="currentColor" stroke-width="1.4"/>
                    </svg>
                    <span class="tile-ext">{extBadge(f.name)}</span>
                  {/if}
                </div>
                <div class="tile-name">{baseName(f.name)}</div>
                <div class="tile-meta">
                  <span>{fmtSize(f.sizeBytes)}</span>
                  <span class="tile-chips">{@render permChips(f)}</span>
                </div>
                <div class="tile-actions">{@render fileActions(f)}</div>
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <div class="file-list" role="list">
          {#each subfolders as fol (fol.name)}
            <div
              class="folder-row"
              role="button"
              tabindex="0"
              onclick={() => navigate(joinPath(currentPath, fol.name))}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(joinPath(currentPath, fol.name)); } }}
            >
              <svg class="folder-icon-sm" width="22" height="18" viewBox="0 0 46 38" fill="none" aria-hidden="true"><path d="M2 6a2 2 0 012-2h12l3.5 3.5H42a2 2 0 012 2V32a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.6"/></svg>
              <span class="folder-row-name">{fol.name}</span>
              <span class="folder-row-count">{fol.count} item{fol.count === 1 ? '' : 's'}</span>
              <button type="button" class="row-link danger" onclick={(e) => { e.stopPropagation(); deleteFolder(fol.name); }}>Delete</button>
            </div>
          {/each}
          {#each visibleFiles as f (f.id)}
            {#if editingId === f.id && editDraft}
              {@render editCard()}
            {:else}
              <div
                class="file-card"
                class:sel={selected[f.id]}
                role="listitem"
                draggable="true"
                ondragstart={(e) => onFileDragStart(e, f)}
                ondblclick={() => openViewer(f)}
                title="Double-click to preview · drag out to copy to your desktop"
              >
                <label class="file-check" title="Select">
                  <input type="checkbox" checked={!!selected[f.id]} onchange={(e) => (selected[f.id] = e.currentTarget.checked)} />
                </label>
                <div class="file-main">
                  <div class="file-title">
                    <span class="file-name-text">{baseName(f.name)}</span>
                    <span class="file-mime"><code>{f.mimeType}</code></span>
                  </div>
                  {#if f.description}
                    <div class="file-desc">{f.description}</div>
                  {/if}
                  <div class="file-meta">
                    <span>{fmtSize(f.sizeBytes)}</span>
                    <span class="dot">·</span>
                    <span>Updated {fmtDate(f.updatedAt)}</span>
                    {#if f.uploadedBy}
                      <span class="dot">·</span>
                      <span>by {f.uploadedBy}</span>
                    {/if}
                  </div>
                </div>
                <div class="file-perms">{@render permChips(f)}</div>
                <div class="file-actions">{@render fileActions(f)}</div>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </section>

    <!-- ——— Knowledge bases (RAG "Interact using model") ——— -->
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Knowledge bases</span>
        <span class="nm-sec-meta">{collections.length} {collections.length === 1 ? 'base' : 'bases'}</span>
      </div>

      {#if collections.length > 0}
        <div class="kb-list">
          {#each collections as c (c.id)}
            <div class="kb-card">
              <button type="button" class="kb-main" onclick={() => (chatCollection = c)} title="Open chat">
                <span class="kb-name">{c.name}</span>
                <span class="kb-meta">
                  <span class="kb-status kb-{c.status}">{ragStatusLabel(c)}</span>
                  <span class="dot">·</span>
                  <span>{(c.fileNames ?? []).length} file{(c.fileNames ?? []).length === 1 ? '' : 's'}</span>
                  {#if c.embeddingModel}<span class="dot">·</span><span>{c.embeddingModel.replace('openai/', '')}</span>{/if}
                </span>
              </button>
              <div class="kb-actions">
                <button type="button" class="row-link" onclick={() => (chatCollection = c)}>Open chat</button>
                <button type="button" class="row-link" disabled={c.status === 'indexing' || c.status === 'pending'} onclick={() => reindexCollection(c)}>Reindex</button>
                <button type="button" class="row-link danger" onclick={() => deleteCollection(c)}>Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="kb-empty">
          Select one or more documents above and hit <strong>Interact using model</strong> to build your first
          knowledge base — then chat with your files and get answers cited from the source.
        </p>
      {/if}
    </section>
  </main>
</div>

{#if extractResult}
  <section class="nm-sec drive-panel">
    <h3>Extracted from {extractResult.name}</h3>
    <pre class="extract-pre">{extractResult.text}</pre>
    <details>
      <summary>Metadata</summary>
      <pre>{JSON.stringify(extractResult.meta, null, 2)}</pre>
    </details>
    <button class="nm-save-btn" onclick={() => (extractResult = null)}>Close</button>
  </section>
{/if}

{#if convertModalFor}
  <section class="nm-sec drive-panel">
    <h3>Convert {convertModalFor.name}</h3>
    <label>From
      <select bind:value={convertSource} class="nm-text-input">
        <option value="markdown">Markdown</option>
        <option value="text">Plain text</option>
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="xlsx">XLSX</option>
      </select>
    </label>
    <label>To
      <select bind:value={convertFormat} class="nm-text-input">
        <option value="docx">DOCX</option>
        <option value="pdf">PDF</option>
        <option value="html">HTML</option>
        <option value="xlsx">XLSX</option>
        <option value="csv">CSV</option>
      </select>
    </label>
    <div class="convert-actions">
      <button class="nm-save-btn" disabled={busyId === convertModalFor.id} onclick={runConvert}>
        {busyId === convertModalFor.id ? 'Converting…' : 'Convert'}
      </button>
      <button class="row-link" onclick={() => (convertModalFor = null)}>Cancel</button>
    </div>
  </section>
{/if}

{#if viewerFile}
  <FileViewerModal file={viewerFile} onClose={() => (viewerFile = null)} />
{/if}

{#if interactOpen}
  <InteractModelModal
    files={selectedFiles.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))}
    onClose={() => (interactOpen = false)}
    onCreated={onCollectionCreated}
  />
{/if}

{#if chatCollection}
  <RagChatPanel
    collection={chatCollection}
    onClose={() => (chatCollection = null)}
    onChanged={onCollectionChanged}
    defaultChatModelId={data.defaultChatModelId}
  />
{/if}

<style>
  .drive-root {
    min-height: 100vh;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .drive-wrap {
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }

  /* ——— Dropzone ——— */
  .hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    pointer-events: none;
  }
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2.25rem 1.5rem;
    margin-bottom: 1.25rem;
    background: var(--bg-section);
    border: 2px dashed var(--card-border);
    color: var(--text-secondary);
    cursor: pointer;
    text-align: center;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .dropzone:hover {
    border-color: var(--text-muted);
  }
  .dropzone:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .dropzone.active {
    border-color: var(--accent);
    border-style: solid;
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .dz-icon { color: var(--text-muted); }
  .dropzone.active .dz-icon { color: var(--accent); }
  .dz-title {
    font-family: var(--font-brand);
    font-size: 1.15rem;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    color: var(--text-primary);
  }
  .dropzone.active .dz-title { color: var(--accent); }
  .dz-sub {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dz-dot { color: var(--text-ghost); }
  .dz-link {
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .dz-link:hover { color: var(--accent-hover); }
  .dz-perms {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--divider);
    width: 100%;
    max-width: 520px;
    justify-content: center;
    cursor: default;
  }
  .dz-perms-label {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-ghost);
    margin-right: 0.2rem;
  }

  /* ——— Upload progress / failures ——— */
  .progress-line {
    position: relative;
    height: 22px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: var(--accent);
    transition: width 120ms ease;
  }
  .progress-text {
    position: relative;
    z-index: 1;
    display: block;
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    mix-blend-mode: difference;
  }
  .fail-list {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--error);
    padding: 6px 8px;
    background: var(--error-bg);
    border-left: 2px solid var(--error);
    margin-bottom: 1rem;
  }
  .fail-list summary { cursor: pointer; }
  .fail-list ul { margin: 6px 0 0 1.2rem; padding: 0; }
  .fail-list code { font-size: 11px; }
  .err-line {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--error);
    padding: 6px 8px;
    background: var(--error-bg);
    border-left: 2px solid var(--error);
    margin-bottom: 1rem;
  }

  /* ——— Form (WebDAV + edit) ——— */
  .field { display: grid; gap: 0.35rem; min-width: 0; }
  @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }

  /* ——— Permission toggles ——— */
  .perm-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .perm-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 5px 10px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
  }
  .perm-toggle:hover { border-color: var(--text-primary); }
  .perm-toggle input { appearance: none; -webkit-appearance: none; position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
  .perm-code {
    display: inline-block;
    width: 1em;
    text-align: center;
    font-weight: 700;
    color: var(--text-primary);
  }
  .perm-name {
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .perm-toggle.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .perm-toggle.on .perm-code { color: var(--bg); }

  .btn-ghost {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .btn-ghost:hover { border-color: var(--text-primary); color: var(--text-primary); }

  /* ——— Select bar ——— */
  .select-bar {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
    padding: 0.5rem 0 0.75rem;
    border-bottom: 1px solid var(--divider);
    margin-bottom: 0.6rem;
  }
  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    cursor: pointer;
  }
  .select-all input { accent-color: var(--accent); cursor: pointer; }
  .sel-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
  }
  .sel-dl { padding: 5px 12px; }
  .sel-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }

  /* ——— File list ——— */
  .empty {
    padding: 1.5rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    border: 1px dashed var(--card-border);
  }
  .file-list { display: grid; gap: 0.6rem; }
  .file-card {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .file-card:hover { border-color: var(--text-primary); }
  .file-card[draggable="true"] { cursor: grab; }
  .file-card[draggable="true"]:active { cursor: grabbing; }
  .file-card.sel {
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .file-card.editing {
    grid-template-columns: 1fr;
    background: var(--bg-section);
    border-color: var(--accent);
    padding: 1rem 1.1rem 1.15rem;
  }
  .file-check {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  .file-check input { accent-color: var(--accent); cursor: pointer; width: 15px; height: 15px; }
  .file-main { min-width: 0; }
  .file-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .file-name-text {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    word-break: break-all;
  }
  .file-mime { font-size: 10px; }
  .file-desc {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
  .file-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .file-meta .dot { color: var(--text-ghost); }

  .file-perms {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .perm-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
  }
  .perm-chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .file-actions {
    display: flex;
    gap: 0.75rem;
    flex-shrink: 0;
    align-items: center;
  }
  .row-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
  .row-link.danger { color: var(--error); }
  .row-link.danger:hover { color: var(--error-hover); }

  .edit-grid { display: grid; gap: 0.9rem; }
  .edit-actions { display: flex; gap: 0.5rem; }

  @media (max-width: 640px) {
    .file-card {
      grid-template-columns: auto 1fr;
      align-items: flex-start;
    }
    .file-perms, .file-actions { justify-content: flex-start; grid-column: 2; }
  }

  /* ——— View toggle ——— */
  .view-toggle {
    margin-left: auto;
    display: inline-flex;
    border: 1px solid var(--card-border);
    flex-shrink: 0;
  }
  .vt-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    background: var(--bg);
    border: none;
    padding: 5px 10px;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }
  .vt-btn + .vt-btn { border-left: 1px solid var(--card-border); }
  .vt-btn:hover { color: var(--text-primary); }
  .vt-btn.on { background: var(--accent); color: var(--bg); }
  .vt-btn svg { display: block; }

  /* ——— Grid (Windows-Explorer-esque) view ——— */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.6rem;
  }
  .grid-edit { grid-column: 1 / -1; }
  .file-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 1rem 0.75rem 0.85rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    text-align: center;
    min-width: 0;
  }
  .file-tile:hover { border-color: var(--text-primary); }
  .file-tile[draggable="true"] { cursor: grab; }
  .file-tile[draggable="true"]:active { cursor: grabbing; }
  .file-tile.sel { border-color: var(--accent); background: var(--accent-tint-08); }
  .tile-check {
    position: absolute;
    top: 6px;
    left: 6px;
    display: inline-flex;
    opacity: 0;
    transition: opacity 100ms ease;
  }
  .file-tile:hover .tile-check,
  .file-tile.sel .tile-check { opacity: 1; }
  .tile-check input { accent-color: var(--accent); cursor: pointer; width: 15px; height: 15px; }
  .tile-thumb {
    width: 100%;
    height: 68px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    color: var(--text-muted);
  }
  .tile-thumb img {
    max-width: 100%;
    max-height: 68px;
    object-fit: contain;
    border: 1px solid var(--card-border);
  }
  .tile-icon { color: var(--text-muted); }
  .tile-ext {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--bg);
    background: var(--accent);
    padding: 1px 4px;
  }
  .tile-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    line-height: 1.3;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    width: 100%;
  }
  .tile-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-muted);
  }
  .tile-chips { display: inline-flex; gap: 2px; }
  .tile-chips .perm-chip { width: 16px; height: 16px; font-size: 8px; }
  .tile-actions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    padding: 6px;
    background: var(--surface-elevated);
    border-top: 1px solid var(--card-border);
    opacity: 0;
    visibility: hidden;
    transition: opacity 100ms ease;
  }
  .file-tile:hover .tile-actions,
  .file-tile.sel .tile-actions { opacity: 1; visibility: visible; }

  /* ——— Breadcrumbs ——— */
  .crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
    min-width: 0;
  }
  .crumb {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.02em;
  }
  .crumb-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
  }
  .crumb-link:hover { text-decoration: underline; }
  .crumb-current { color: var(--text-primary); font-weight: 500; }
  .crumb-sep { color: var(--text-ghost); }

  /* ——— New folder + Move-to ——— */
  .newfolder {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .nf-input {
    width: 130px;
    padding: 4px 8px;
    font-size: 11px;
  }
  .select-all.disabled { opacity: 0.4; }
  .move-wrap { position: relative; }
  .move-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    min-width: 180px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
  }
  .move-item {
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--divider);
    padding: 7px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .move-item:last-child { border-bottom: none; }
  .move-item:hover { background: var(--accent-tint-08); color: var(--text-primary); }

  /* ——— Folder entries ——— */
  .folder-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 1rem 0.75rem 0.85rem;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    text-align: center;
    cursor: pointer;
    min-width: 0;
  }
  .folder-tile:hover { border-color: var(--accent); }
  .folder-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .folder-icon { color: var(--accent); }
  .folder-del {
    position: absolute;
    top: 4px;
    right: 6px;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 1;
    color: var(--text-ghost);
    cursor: pointer;
    opacity: 0;
    transition: opacity 100ms ease, color 100ms ease;
  }
  .folder-tile:hover .folder-del { opacity: 1; }
  .folder-del:hover { color: var(--error); }

  .folder-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.7rem 1rem;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .folder-row:hover { border-color: var(--accent); }
  .folder-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .folder-icon-sm { color: var(--accent); flex-shrink: 0; }
  .folder-row-name {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    word-break: break-all;
  }
  .folder-row-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }

  /* ——— Onboarding ——— */
  .onboard {
    position: relative;
    border: 1px solid var(--card-border);
    background: linear-gradient(180deg, var(--accent-tint-08, color-mix(in srgb, var(--accent) 6%, transparent)), transparent);
    padding: 20px 22px 18px;
    margin-bottom: 1.1rem;
  }
  .onboard-x {
    position: absolute;
    top: 10px;
    right: 12px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
  }
  .onboard-x:hover { color: var(--accent); border-color: var(--accent); }
  .onboard-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .onboard-title {
    font-family: var(--font-display);
    font-size: clamp(19px, 3.4vw, 25px);
    line-height: 1.12;
    color: var(--text-primary);
    margin: 4px 0 14px;
  }
  .onboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px 20px;
  }
  .onboard-step {
    display: grid;
    gap: 3px;
  }
  .onboard-num {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .onboard-step strong {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-primary);
  }
  .onboard-step p {
    margin: 2px 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* ——— Search ——— */
  .hd-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .drive-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    min-width: 180px;
  }
  .drive-search:focus-within { border-color: var(--accent); }
  .search-icon { color: var(--text-muted); flex-shrink: 0; }
  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-primary);
  }
  .search-input:focus { outline: none; }
  .search-clear {
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 0 2px;
  }
  .search-clear:hover { color: var(--accent); }

  /* ——— Interact-using-model button ——— */
  .rag-interact-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* ——— Knowledge bases ——— */
  .kb-list {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }
  .kb-card {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0.9rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .kb-card:hover { border-color: var(--accent); }
  .kb-main {
    display: grid;
    gap: 3px;
    text-align: left;
    border: none;
    background: none;
    cursor: pointer;
    min-width: 0;
    padding: 0;
  }
  .kb-name {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kb-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .kb-meta .dot { color: var(--text-ghost); }
  .kb-status { text-transform: uppercase; letter-spacing: 0.06em; }
  .kb-status.kb-ready { color: var(--success, #2d7a3a); }
  .kb-status.kb-indexing,
  .kb-status.kb-pending { color: var(--warn, #b0892a); }
  .kb-status.kb-error { color: var(--error); }
  .kb-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .kb-empty {
    margin: 0.2rem 0 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  @media (max-width: 640px) {
    .kb-card { grid-template-columns: 1fr; }
  }

  /* ——— Extract / convert panels ——— */
  .drive-panel {
    max-width: 1100px;
    margin: 1rem auto;
  }
  .extract-pre { white-space: pre-wrap; max-height: 280px; overflow: auto; }
  .convert-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
</style>
