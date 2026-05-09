<svelte:head><title>Files — Admin</title></svelte:head>
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

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

  type Credential = {
    id: string;
    label: string;
    ownerEmail: string;
    lastUsedAt: string | Date | null;
    createdAt: string | Date;
  };
  let credentials = $state<Credential[]>(data.credentials as Credential[]);
  let credLabel = $state('');
  let credBusy = $state(false);
  let credError = $state<string | null>(null);
  let newCredSecret = $state<{ id: string; label: string; secret: string } | null>(null);
  let showSecret = $state(false);

  let fileInput: HTMLInputElement | null = $state(null);
  let folderInput: HTMLInputElement | null = $state(null);
  let uploadName = $state('');
  let uploadDesc = $state('');
  let uploadPerm = $state({ read: true, write: false, append: false, delete: false });
  let uploadBusy = $state(false);
  let uploadError = $state<string | null>(null);
  let selectedFileName = $state('');
  let pickedFiles = $state<File[]>([]);
  let isFolderPick = $state(false);
  let uploadProgress = $state<{ done: number; total: number; current: string } | null>(null);
  let uploadFailures = $state<{ name: string; error: string }[]>([]);

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

  async function refresh() {
    const res = await fetch('/api/files');
    if (res.ok) {
      const body = await res.json();
      files = body.files;
    }
  }

  function onFilePicked() {
    const list = fileInput?.files;
    if (!list || list.length === 0) {
      pickedFiles = [];
      isFolderPick = false;
      selectedFileName = '';
      return;
    }
    pickedFiles = Array.from(list);
    isFolderPick = false;
    selectedFileName = pickedFiles[0].name;
    if (folderInput) folderInput.value = '';
  }

  function onFolderPicked() {
    const list = folderInput?.files;
    if (!list || list.length === 0) {
      pickedFiles = [];
      isFolderPick = false;
      selectedFileName = '';
      return;
    }
    pickedFiles = Array.from(list);
    isFolderPick = true;
    const root = (pickedFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] ?? '';
    selectedFileName = root ? `${root}/  (${pickedFiles.length} files)` : `${pickedFiles.length} files`;
    if (fileInput) fileInput.value = '';
  }

  function clearPicked() {
    pickedFiles = [];
    isFolderPick = false;
    selectedFileName = '';
    if (fileInput) fileInput.value = '';
    if (folderInput) folderInput.value = '';
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

  async function uploadFile(ev: SubmitEvent) {
    ev.preventDefault();
    uploadError = null;
    uploadFailures = [];
    if (pickedFiles.length === 0) { uploadError = 'Select a file or folder first.'; return; }
    uploadBusy = true;
    uploadProgress = { done: 0, total: pickedFiles.length, current: '' };
    try {
      for (let i = 0; i < pickedFiles.length; i++) {
        const f = pickedFiles[i];
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        let name: string;
        if (isFolderPick) {
          name = rel || f.name;
        } else if (pickedFiles.length === 1) {
          name = uploadName.trim() || f.name;
        } else {
          name = f.name;
        }
        uploadProgress = { done: i, total: pickedFiles.length, current: name };
        const result = await uploadOne(f, name);
        if (!result.ok) uploadFailures = [...uploadFailures, { name, error: result.error }];
      }
      uploadProgress = { done: pickedFiles.length, total: pickedFiles.length, current: '' };
      await refresh();
      uploadName = '';
      uploadDesc = '';
      clearPicked();
      if (uploadFailures.length > 0) {
        uploadError = `${uploadFailures.length} of ${pickedFiles.length || uploadProgress.total} failed.`;
      }
    } finally {
      uploadBusy = false;
      setTimeout(() => { if (!uploadBusy) uploadProgress = null; }, 1500);
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

  async function refreshCredentials() {
    const res = await fetch('/api/admin/webdav-credentials');
    if (res.ok) {
      const body = await res.json();
      credentials = body.credentials;
    }
  }

  async function createCredential(ev: SubmitEvent) {
    ev.preventDefault();
    credError = null;
    if (!credLabel.trim()) { credError = 'Label required.'; return; }
    credBusy = true;
    try {
      const res = await fetch('/api/admin/webdav-credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: credLabel.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { credError = body.error || `HTTP ${res.status}`; return; }
      newCredSecret = { id: body.id, label: body.label, secret: body.secret };
      showSecret = false;
      credLabel = '';
      await refreshCredentials();
    } finally {
      credBusy = false;
    }
  }

  async function revokeCredential(c: Credential) {
    if (!confirm(`Revoke "${c.label}"? Devices using this credential will stop working immediately.`)) return;
    const res = await fetch(`/api/admin/webdav-credentials/${c.id}`, { method: 'DELETE' });
    if (!res.ok) { alert(`Revoke failed (${res.status})`); return; }
    credentials = credentials.filter((x) => x.id !== c.id);
  }

  function copySecret() {
    if (!newCredSecret) return;
    navigator.clipboard.writeText(newCredSecret.secret).catch(() => {});
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
      <div class="field">
        <span class="sr-label-tight">File or Folder</span>
        <div class="file-picker">
          <input
            type="file"
            bind:this={fileInput}
            onchange={onFilePicked}
            id="file-input"
            multiple
          />
          <label for="file-input" class="file-btn">Choose files</label>
          <input
            type="file"
            bind:this={folderInput}
            onchange={onFolderPicked}
            id="folder-input"
            multiple
            {...({ webkitdirectory: 'true', directory: 'true', mozdirectory: 'true' } as Record<string, string>)}
          />
          <label for="folder-input" class="file-btn">Choose folder</label>
          <span class="file-name">{selectedFileName || 'No file selected'}</span>
          {#if pickedFiles.length > 0}
            <button type="button" class="file-clear" onclick={clearPicked} title="Clear selection">×</button>
          {/if}
        </div>
        {#if isFolderPick && pickedFiles.length > 0}
          <span class="picker-hint">Files will be uploaded preserving folder paths.</span>
        {/if}
      </div>

      <div class="row">
        <label class="field">
          <span class="sr-label-tight">
            Name <em>— optional, defaults to filename{pickedFiles.length > 1 ? ' (ignored for multi-file uploads)' : ''}</em>
          </span>
          <input
            type="text"
            bind:value={uploadName}
            placeholder="reports/daily.csv"
            class="nm-text-input"
            disabled={pickedFiles.length > 1}
          />
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
      <div class="form-actions">
        <button type="submit" class="nm-save-btn" disabled={uploadBusy || pickedFiles.length === 0}>
          {uploadBusy ? 'Uploading…' : pickedFiles.length > 1 ? `Upload ${pickedFiles.length} files` : 'Upload'}
        </button>
      </div>
    </form>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">WebDAV access</span>
      <span class="nm-sec-meta">{credentials.length} {credentials.length === 1 ? 'credential' : 'credentials'}</span>
    </div>

    <p class="dav-blurb">
      Mount this file store as a network drive. Files dropped into the mount appear here under the
      <code>drive/</code> prefix; workflow files outside <code>drive/</code> stay invisible to the mount.
    </p>

    <details class="dav-howto" open>
      <summary>How to mount</summary>
      <div class="howto-body">

        <div class="howto-os">
          <strong>Windows 10 / 11</strong>
          <p>
            Windows ships two settings that block HTTPS WebDAV by default. Do these once before mounting:
          </p>
          <ol>
            <li><strong>Start the WebClient service.</strong> Press <kbd>Win</kbd>+<kbd>R</kbd> → <code>services.msc</code> → find <em>WebClient</em> → right-click → <em>Properties</em> → set <em>Startup type</em> to <strong>Automatic</strong> → click <em>Start</em> → OK.</li>
            <li><strong>Enable Basic Auth on HTTPS.</strong> Open PowerShell as Administrator and run:<br>
              <code class="block">reg add "HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters" /v BasicAuthLevel /t REG_DWORD /d 2 /f</code><br>
              Then restart the service:<br>
              <code class="block">net stop webclient &amp;&amp; net start webclient</code>
            </li>
          </ol>
          <p>Now mount it. Either path works:</p>
          <p><strong>Option A — Map network drive (recommended, gives you a Z: drive).</strong></p>
          <ol>
            <li>Open <em>File Explorer</em> → <em>This PC</em> → ribbon <em>Map network drive</em>.</li>
            <li>Drive letter: any free letter (e.g. <code>Z:</code>).</li>
            <li>Folder: <code>https://strangeramblings.com/dav/</code></li>
            <li>Tick <em>Connect using different credentials</em> and <em>Reconnect at sign-in</em>.</li>
            <li>Click <em>Finish</em>. Username = the device label, password = the secret.</li>
          </ol>
          <p><strong>Option B — single command in an elevated terminal:</strong></p>
          <code class="block">net use Z: https://strangeramblings.com/dav/ /user:LABEL "SECRET" /persistent:yes</code>
          <p>Replace <code>LABEL</code> and <code>SECRET</code> with the values from this page.</p>
        </div>

        <div class="howto-os">
          <strong>macOS</strong>
          <p>Finder → <kbd>⌘</kbd>+<kbd>K</kbd> → <code>https://strangeramblings.com/dav/</code> → username = the device label, password = the secret. Tick <em>Remember this password in my keychain</em> for persistence.</p>
        </div>

        <div class="howto-os">
          <strong>Linux</strong>
          <p>Quick: <code>gio mount davs://strangeramblings.com/dav/</code></p>
          <p>Persistent (<code>davfs2</code>): add to <code>/etc/fstab</code>:</p>
          <code class="block">https://strangeramblings.com/dav/  /mnt/sr-drive  davfs  user,rw,_netdev  0  0</code>
          <p>Store credentials in <code>~/.davfs2/secrets</code>:</p>
          <code class="block">/mnt/sr-drive  LABEL  SECRET</code>
        </div>

        <div class="howto-warn">
          <strong>Common Windows errors:</strong>
          <ul>
            <li><em>"The folder you entered does not appear to be valid"</em> — almost always <code>BasicAuthLevel</code> is still 1. Re-run step 2 above and restart the WebClient service.</li>
            <li><em>"0x80070043 – the network name cannot be found"</em> — WebClient service isn't running, or you typed <code>http://</code> instead of <code>https://</code>.</li>
            <li><em>50 MB upload limit</em> — Windows caps WebDAV at 50 MB out of the box. Raise it: <code>reg add "HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters" /v FileSizeLimitInBytes /t REG_DWORD /d 0xffffffff /f</code> then restart WebClient.</li>
          </ul>
        </div>

        <div class="howto-warn"><em>Permissions reminder:</em> the per-file R/W/A/D map shown in the file list gates workflow nodes only. The mount has full read/write regardless.</div>
      </div>
    </details>

    {#if newCredSecret}
      <div class="secret-card">
        <div class="secret-hd">
          <strong>Secret for "{newCredSecret.label}" — copy now, this is shown only once.</strong>
          <button type="button" class="row-link" onclick={() => (newCredSecret = null)}>Done</button>
        </div>
        <div class="secret-row">
          <code class="secret-val">{showSecret ? newCredSecret.secret : '•'.repeat(43)}</code>
          <button type="button" class="row-link" onclick={() => (showSecret = !showSecret)}>
            {showSecret ? 'Hide' : 'Show'}
          </button>
          <button type="button" class="row-link" onclick={copySecret}>Copy</button>
        </div>
      </div>
    {/if}

    <form class="form" onsubmit={createCredential}>
      <div class="row">
        <label class="field">
          <span class="sr-label-tight">Device label <em>— e.g. "MacBook", "iPhone Files"</em></span>
          <input type="text" bind:value={credLabel} placeholder="MacBook" class="nm-text-input" maxlength="64" />
        </label>
        <div class="field cred-submit">
          <span class="sr-label-tight">&nbsp;</span>
          <button type="submit" class="nm-save-btn" disabled={credBusy || !credLabel.trim()}>
            {credBusy ? 'Generating…' : 'Generate credential'}
          </button>
        </div>
      </div>
      {#if credError}<div class="err-line">{credError}</div>{/if}
    </form>

    {#if credentials.length > 0}
      <div class="cred-list">
        {#each credentials as c (c.id)}
          <div class="cred-card">
            <div class="cred-main">
              <div class="cred-label">{c.label}</div>
              <div class="cred-meta">
                <span>{c.ownerEmail}</span>
                <span class="dot">·</span>
                <span>Created {fmtDate(c.createdAt)}</span>
                <span class="dot">·</span>
                {#if c.lastUsedAt}
                  <span>Last used {fmtDate(c.lastUsedAt)}</span>
                {:else}
                  <span class="cred-muted">Never used</span>
                {/if}
              </div>
            </div>
            <button type="button" class="row-link danger" onclick={() => revokeCredential(c)}>Revoke</button>
          </div>
        {/each}
      </div>
    {/if}
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
                {#if canExtract(f.mimeType, f.name)}
                  <button type="button" class="row-link" disabled={busyId === f.id} onclick={() => runExtract(f)}>
                    {busyId === f.id ? 'Extracting…' : 'Extract'}
                  </button>
                {/if}
                <button type="button" class="row-link" disabled={busyId === f.id} onclick={() => (convertModalFor = { id: f.id, name: f.name })}>
                  Convert
                </button>
                <button type="button" class="row-link" onclick={() => startEdit(f)}>Edit</button>
                <button type="button" class="row-link danger" onclick={() => deleteRow(f)}>Delete</button>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>

  {#if extractResult}
    <section class="nm-sec" style="margin-top:1rem;">
      <h3>Extracted from {extractResult.name}</h3>
      <pre style="white-space:pre-wrap;max-height:280px;overflow:auto;">{extractResult.text}</pre>
      <details>
        <summary>Metadata</summary>
        <pre>{JSON.stringify(extractResult.meta, null, 2)}</pre>
      </details>
      <button class="nm-save-btn" onclick={() => (extractResult = null)}>Close</button>
    </section>
  {/if}

  {#if convertModalFor}
    <section class="nm-sec" style="margin-top:1rem;">
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
      <div style="display:flex;gap:.5rem;margin-top:.75rem;">
        <button class="nm-save-btn" disabled={busyId === convertModalFor.id} onclick={runConvert}>
          {busyId === convertModalFor.id ? 'Converting…' : 'Convert'}
        </button>
        <button class="row-link" onclick={() => (convertModalFor = null)}>Cancel</button>
      </div>
    </section>
  {/if}
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
    font-family: var(--font-brand);
    font-size: 1.75rem;
    font-weight: 500;
    line-height: 1.1;
    color: var(--text-primary);
    text-transform: lowercase;
    letter-spacing: -0.01em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.45ch;
  }
  .page-hdr h1::before {
    content: '>';
    color: var(--accent);
    opacity: 0.7;
    font-weight: 500;
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
    flex: 1;
    min-width: 0;
  }
  .file-clear {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .file-clear:hover { border-color: var(--text-primary); color: var(--text-primary); }
  .picker-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    margin-top: 2px;
  }
  .progress-line {
    position: relative;
    height: 22px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    overflow: hidden;
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
    color: #c44;
    padding: 6px 8px;
    background: rgba(196, 68, 68, 0.06);
    border-left: 2px solid #c44;
  }
  .fail-list summary { cursor: pointer; }
  .fail-list ul { margin: 6px 0 0 1.2rem; padding: 0; }
  .fail-list code { font-size: 11px; }

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

  /* ——— WebDAV section ——— */
  .dav-blurb {
    margin: 0 0 0.6rem;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .dav-howto {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 0.6rem;
    padding: 6px 10px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
  }
  .dav-howto summary {
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
  }
  .howto-body {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.5rem;
    font-family: var(--font-body);
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .howto-body code {
    font-size: 11px;
  }
  .howto-body code.block {
    display: block;
    padding: 6px 8px;
    margin: 4px 0;
    background: var(--bg);
    border: 1px solid var(--card-border);
    overflow-x: auto;
    white-space: nowrap;
    user-select: all;
  }
  .howto-os {
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--card-border);
  }
  .howto-os:last-of-type { border-bottom: none; }
  .howto-os > strong {
    display: block;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    margin-bottom: 0.3rem;
  }
  .howto-os p { margin: 0.3rem 0; }
  .howto-os ol, .howto-os ul {
    margin: 0.3rem 0 0.4rem 1.2rem;
    padding: 0;
  }
  .howto-os li { margin-bottom: 0.2rem; }
  .howto-warn ul {
    margin: 0.3rem 0 0 1.2rem;
    padding: 0;
  }
  .howto-warn li { margin-bottom: 0.25rem; }
  .howto-body kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    border: 1px solid var(--card-border);
    border-bottom-width: 2px;
    padding: 1px 5px;
    background: var(--bg);
    color: var(--text-primary);
  }
  .howto-warn {
    color: var(--text-muted);
    font-size: 11px;
    margin-top: 0.15rem;
  }
  .secret-card {
    border: 1px solid var(--accent);
    background: rgba(255, 196, 96, 0.08);
    padding: 0.75rem 0.9rem;
    margin-bottom: 0.7rem;
  }
  .secret-hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }
  .secret-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 5px 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .secret-val {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    padding: 0;
  }
  .cred-submit { align-self: end; }
  .cred-list {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.7rem;
  }
  .cred-card {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 1rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
  }
  .cred-card:hover { border-color: var(--text-primary); }
  .cred-label {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .cred-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.3rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .cred-meta .dot { color: var(--text-ghost); }
  .cred-muted { font-style: italic; color: var(--text-ghost); }

  @media (max-width: 640px) {
    .cred-card { grid-template-columns: 1fr; }
    .cred-submit { align-self: stretch; }
  }
</style>
