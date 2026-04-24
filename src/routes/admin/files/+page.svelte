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

  // Upload form
  let fileInput: HTMLInputElement | null = $state(null);
  let uploadName = $state('');
  let uploadDesc = $state('');
  let uploadPerm = $state({ read: true, write: false, append: false, delete: false });
  let uploadBusy = $state(false);
  let uploadError = $state<string | null>(null);

  // Edit row
  let editingId = $state<string | null>(null);
  let editDraft = $state<{ name: string; description: string; permissions: { read: boolean; write: boolean; append: boolean; delete: boolean } } | null>(null);
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
  <header>
    <div>
      <h1>File Store</h1>
      <p class="subtitle">Upload files for workflows to read, write, append, or delete via the <code>File Store</code> node. Permissions below gate every node operation.</p>
    </div>
    <a class="link" href="/admin">← Admin</a>
  </header>

  <section class="panel">
    <h2>Upload a file</h2>
    <form onsubmit={uploadFile}>
      <label class="field">
        <span>File</span>
        <input type="file" bind:this={fileInput} required />
      </label>
      <label class="field">
        <span>Name <em>(optional; defaults to filename)</em></span>
        <input type="text" bind:value={uploadName} placeholder="reports/daily.csv" />
      </label>
      <label class="field">
        <span>Description <em>(optional)</em></span>
        <input type="text" bind:value={uploadDesc} placeholder="What is this file for?" />
      </label>
      <fieldset class="perms">
        <legend>Permissions</legend>
        <label><input type="checkbox" bind:checked={uploadPerm.read} /> Read</label>
        <label><input type="checkbox" bind:checked={uploadPerm.write} /> Write (overwrite)</label>
        <label><input type="checkbox" bind:checked={uploadPerm.append} /> Append</label>
        <label><input type="checkbox" bind:checked={uploadPerm.delete} /> Delete</label>
      </fieldset>
      {#if uploadError}<div class="err">{uploadError}</div>{/if}
      <button type="submit" disabled={uploadBusy}>{uploadBusy ? 'Uploading…' : 'Upload'}</button>
    </form>
  </section>

  <section class="panel">
    <h2>Files ({files.length})</h2>
    {#if files.length === 0}
      <p class="muted">No files yet. Upload one above.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Permissions</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each files as f (f.id)}
            {#if editingId === f.id && editDraft}
              <tr class="editing">
                <td colspan="6">
                  <div class="edit-grid">
                    <label class="field">
                      <span>Name</span>
                      <input type="text" bind:value={editDraft.name} />
                    </label>
                    <label class="field">
                      <span>Description</span>
                      <input type="text" bind:value={editDraft.description} />
                    </label>
                    <fieldset class="perms">
                      <legend>Permissions</legend>
                      <label><input type="checkbox" bind:checked={editDraft.permissions.read} /> Read</label>
                      <label><input type="checkbox" bind:checked={editDraft.permissions.write} /> Write</label>
                      <label><input type="checkbox" bind:checked={editDraft.permissions.append} /> Append</label>
                      <label><input type="checkbox" bind:checked={editDraft.permissions.delete} /> Delete</label>
                    </fieldset>
                    <div class="actions">
                      <button type="button" onclick={saveEdit} disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
                      <button type="button" class="ghost" onclick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                </td>
              </tr>
            {:else}
              <tr>
                <td>
                  <div class="name">{f.name}</div>
                  {#if f.description}<div class="desc">{f.description}</div>{/if}
                </td>
                <td><code>{f.mimeType}</code></td>
                <td>{fmtSize(f.sizeBytes)}</td>
                <td>
                  <span class="perm" class:on={f.permissions?.read !== false}>R</span>
                  <span class="perm" class:on={!!f.permissions?.write}>W</span>
                  <span class="perm" class:on={!!f.permissions?.append}>A</span>
                  <span class="perm" class:on={!!f.permissions?.delete}>D</span>
                </td>
                <td class="when">{fmtDate(f.updatedAt)}</td>
                <td class="actions">
                  <a href={`/api/files/${f.id}/download`} class="link">Download</a>
                  <button type="button" class="link" onclick={() => startEdit(f)}>Edit</button>
                  <button type="button" class="link danger" onclick={() => deleteRow(f)}>Delete</button>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .wrap { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; color: var(--text, #e8e8e8); }
  header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem; }
  header h1 { margin: 0; font-size: 1.6rem; }
  .subtitle { margin: 0.25rem 0 0; color: var(--muted, #8a8a8a); font-size: 0.9rem; max-width: 60ch; }
  .panel { background: var(--panel, #151515); border: 1px solid var(--border, #2a2a2a); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.25rem; }
  .panel h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
  form { display: grid; gap: 0.75rem; max-width: 540px; }
  .field { display: grid; gap: 0.25rem; font-size: 0.85rem; }
  .field span em { color: var(--muted, #8a8a8a); font-style: italic; font-weight: normal; }
  .field input[type="text"], .field input[type="file"] { padding: 0.5rem 0.6rem; background: var(--input, #0f0f0f); border: 1px solid var(--border, #2a2a2a); border-radius: 4px; color: inherit; }
  .perms { border: 1px solid var(--border, #2a2a2a); border-radius: 4px; padding: 0.5rem 0.75rem; display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.85rem; }
  .perms legend { padding: 0 0.25rem; color: var(--muted, #8a8a8a); font-size: 0.8rem; }
  .perms label { display: flex; align-items: center; gap: 0.25rem; }
  button { padding: 0.5rem 1rem; background: var(--accent, #3a7bd5); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  button.ghost { background: transparent; border: 1px solid var(--border, #2a2a2a); color: inherit; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { text-align: left; padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--border, #2a2a2a); vertical-align: top; }
  th { color: var(--muted, #8a8a8a); font-weight: 500; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td.when { color: var(--muted, #8a8a8a); white-space: nowrap; font-size: 0.82rem; }
  td .name { font-weight: 500; }
  td .desc { color: var(--muted, #8a8a8a); font-size: 0.8rem; margin-top: 0.2rem; }
  .perm { display: inline-block; width: 1.3em; text-align: center; margin-right: 0.15rem; border-radius: 3px; padding: 0.1rem 0.3rem; background: var(--input, #0f0f0f); color: var(--muted, #555); font-size: 0.75rem; font-weight: 600; }
  .perm.on { background: var(--accent, #3a7bd5); color: white; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .link { color: var(--accent, #3a7bd5); text-decoration: none; background: none; border: none; cursor: pointer; padding: 0; font-size: 0.88rem; }
  .link:hover { text-decoration: underline; }
  .link.danger { color: #d0554a; }
  .err { color: #d0554a; font-size: 0.85rem; }
  .muted { color: var(--muted, #8a8a8a); }
  .editing { background: var(--input, #0f0f0f); }
  .edit-grid { display: grid; gap: 0.75rem; max-width: 640px; }
  code { background: var(--input, #0f0f0f); padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.82rem; }
</style>
