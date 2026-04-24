<svelte:head><title>Files — Admin</title></svelte:head>
<script lang="ts">
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

  let fileInput: HTMLInputElement | null = $state(null);
  let uploadName = $state('');
  let uploadDesc = $state('');
  let uploadPerm = $state({ read: true, write: false, append: false, delete: false });
  let uploadBusy = $state(false);
  let uploadError = $state<string | null>(null);
  let selectedFileName = $state('');

  let editingId = $state<string | null>(null);
  let editDraft = $state<{
    name: string;
    description: string;
    permissions: { read: boolean; write: boolean; append: boolean; delete: boolean };
  } | null>(null);
  let editBusy = $state(false);

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

  async function refresh() {
    const res = await fetch('/api/files');
    if (res.ok) {
      const body = await res.json();
      files = body.files;
    }
  }

  function onFilePicked() {
    const f = fileInput?.files?.[0];
    selectedFileName = f ? f.name : '';
  }

  async function uploadFile(ev: SubmitEvent) {
    ev.preventDefault();
    uploadError = null;
    const el = fileInput;
    const f = el?.files?.[0];
    if (!f) { uploadError = 'Select a file first.'; return; }
    uploadBusy = true;
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (uploadName.trim()) fd.append('name', uploadName.trim());
      if (uploadDesc.trim()) fd.append('description', uploadDesc.trim());
      fd.append('permissions', JSON.stringify(uploadPerm));

      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        uploadError = msg.error || `Upload failed (${res.status})`;
        return;
      }
      await refresh();
      uploadName = '';
      uploadDesc = '';
      selectedFileName = '';
      if (el) el.value = '';
    } finally {
      uploadBusy = false;
    }
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

  async function deleteRow(f: FileRow) {
    if (!confirm(`Delete "${f.name}"? This removes the file from disk and cannot be undone.`)) return;
    const res = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    if (!res.ok) {
      alert(`Delete failed (${res.status})`);
      return;
    }
    files = files.filter((x) => x.id !== f.id);
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">File Store</div>
      <h1>Files consumed by workflows</h1>
      <p class="sub">
        Upload files the <code>File Store</code> canvas node can read, write, append, delete, or list.
        Per-file permissions gate every node operation.
      </p>
    </div>
    <a class="back-link" href="/admin">← Admin</a>
  </header>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Upload</span>
    </div>

    <form class="form" onsubmit={uploadFile}>
      <label class="field">
        <span class="sr-label-tight">File</span>
        <div class="file-picker">
          <input
            type="file"
            bind:this={fileInput}
            onchange={onFilePicked}
            required
            id="file-input"
          />
          <label for="file-input" class="file-btn">Choose file</label>
          <span class="file-name">{selectedFileName || 'No file selected'}</span>
        </div>
      </label>

      <div class="row">
        <label class="field">
          <span class="sr-label-tight">Name <em>— optional, defaults to filename</em></span>
          <input type="text" bind:value={uploadName} placeholder="reports/daily.csv" class="nm-text-input" />
        </label>
        <label class="field">
          <span class="sr-label-tight">Description <em>— optional</em></span>
          <input type="text" bind:value={uploadDesc} placeholder="What is this file for?" class="nm-text-input" />
        </label>
      </div>

      <div class="field">
        <span class="sr-label-tight">Permissions</span>
        <div class="perm-row">
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

      {#if uploadError}
        <div class="err-line">{uploadError}</div>
      {/if}
      <div class="form-actions">
        <button type="submit" class="nm-save-btn" disabled={uploadBusy}>
          {uploadBusy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Files</span>
      <span class="nm-sec-meta">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
    </div>

    {#if files.length === 0}
      <div class="empty">No files yet. Upload one above.</div>
    {:else}
      <div class="file-list">
        {#each files as f (f.id)}
          {#if editingId === f.id && editDraft}
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
          {:else}
            <div class="file-card">
              <div class="file-main">
                <div class="file-title">
                  <span class="file-name-text">{f.name}</span>
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

              <div class="file-perms">
                <span class="perm-chip" class:on={f.permissions?.read !== false}>R</span>
                <span class="perm-chip" class:on={!!f.permissions?.write}>W</span>
                <span class="perm-chip" class:on={!!f.permissions?.append}>A</span>
                <span class="perm-chip" class:on={!!f.permissions?.delete}>D</span>
              </div>

              <div class="file-actions">
                <a href={`/api/files/${f.id}/download`} class="row-link">Download</a>
                <button type="button" class="row-link" onclick={() => startEdit(f)}>Edit</button>
                <button type="button" class="row-link danger" onclick={() => deleteRow(f)}>Delete</button>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap {
    max-width: 980px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .sub code, code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover { text-decoration: underline; }

  /* .nm-sec, .nm-sec-hd, .sr-label-tight, .nm-sec-meta now provided by
   * $lib/styles/nm-tokens.css (canonical SR design language). */

  /* ——— Form ——— */
  .form { display: grid; gap: 0.9rem; }
  .field { display: grid; gap: 0.35rem; min-width: 0; }
  .field em { color: var(--text-ghost); font-style: normal; font-weight: 400; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
  @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }

  /* .nm-text-input now provided by $lib/styles/nm-tokens.css. */

  .file-picker {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    padding: 6px 8px 6px 6px;
  }
  .file-picker input[type="file"] {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .file-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: var(--text-primary);
    color: var(--bg);
    padding: 5px 10px;
    cursor: pointer;
    user-select: none;
  }
  .file-btn:hover { background: var(--accent); }
  .file-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ——— Permissions pills ——— */
  .perm-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .perm-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 5px 10px;
    background: rgba(26, 16, 8, 0.04);
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

  .err-line {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #c44;
    padding: 6px 8px;
    background: rgba(196, 68, 68, 0.08);
    border-left: 2px solid #c44;
  }
  .form-actions { display: flex; gap: 0.5rem; }

  /* .nm-save-btn now provided by $lib/styles/nm-tokens.css. */

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
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .file-card:hover { border-color: var(--text-primary); }
  .file-card.editing {
    grid-template-columns: 1fr;
    background: var(--bg-section);
    border-color: var(--accent);
    padding: 1rem 1.1rem 1.15rem;
  }
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
  .row-link.danger { color: #c44; }
  .row-link.danger:hover { color: #a33; }

  .edit-grid { display: grid; gap: 0.9rem; }
  .edit-actions { display: flex; gap: 0.5rem; }

  @media (max-width: 640px) {
    .file-card { grid-template-columns: 1fr; align-items: flex-start; }
    .file-perms, .file-actions { justify-content: flex-start; }
  }
</style>
