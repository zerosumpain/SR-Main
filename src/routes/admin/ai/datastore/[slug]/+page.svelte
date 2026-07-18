<svelte:head><title>{data.collection.name || data.collection.slug} — Datastore</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type PermissionSet = { read?: string[]; write?: string[]; delete?: string[] };
  type Rec = {
    id: string;
    key: string | null;
    data: Record<string, unknown>;
    permissions: PermissionSet | null;
    version: number;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    expiresAt: string | Date | null;
  };
  type Collection = {
    id: string;
    slug: string;
    name: string | null;
    description: string | null;
    schema: Record<string, unknown> | null;
    defaultPermissions: PermissionSet | null;
    settings: Record<string, unknown> | null;
    isSystem: boolean;
    createdBy: string | null;
    updatedAt: string | Date;
  };
  type AuditEntry = {
    id: string;
    recordId: string | null;
    actor: string | null;
    action: string | null;
    before: { data?: Record<string, unknown>; permissions?: PermissionSet | null } | null;
    after: Record<string, unknown> | null;
    createdAt: string | Date;
  };

  const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists', 'in'] as const;
  type Op = (typeof OPS)[number];
  type FilterRow = { path: string; op: Op; value: string };

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');
  const tokenQs = adminToken ? `?token=${adminToken}` : '';

  const slug = data.collection.slug;
  const collBase = `/api/admin/datastore/collections/${slug}`;

  let collection = $state<Collection>(data.collection as Collection);
  let records = $state<Rec[]>(data.records as Rec[]);
  let total = $state<number>(data.recordCount);

  // ——— Query console ———
  let filters = $state<FilterRow[]>([]);
  let sortField = $state<'updatedAt' | 'createdAt' | 'key' | 'path'>('updatedAt');
  let sortPath = $state('');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let limit = $state(50);
  let running = $state(false);
  let queryError = $state('');

  function addFilter() {
    filters = [...filters, { path: '', op: 'eq', value: '' }];
  }
  function removeFilter(i: number) {
    filters = filters.filter((_, idx) => idx !== i);
  }

  /** Coerce a raw string cell into number / boolean / string for the filter DSL. */
  function coerceScalar(raw: string): string | number | boolean {
    const t = raw.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t !== '' && /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(Number(t))) return Number(t);
    return raw;
  }

  function buildQueryBody() {
    const compiled = filters
      .filter((f) => f.path.trim())
      .map((f) => {
        if (f.op === 'exists') return { path: f.path.trim(), op: f.op };
        if (f.op === 'in') {
          return {
            path: f.path.trim(),
            op: f.op,
            value: f.value.split(',').map((v) => coerceScalar(v)),
          };
        }
        if (f.op === 'contains') {
          let value: unknown = f.value;
          try {
            value = JSON.parse(f.value);
          } catch {
            /* fall back to the raw string */
          }
          return { path: f.path.trim(), op: f.op, value };
        }
        return { path: f.path.trim(), op: f.op, value: coerceScalar(f.value) };
      });
    const sort =
      sortField === 'path'
        ? sortPath.trim()
          ? { path: sortPath.trim(), dir: sortDir }
          : { field: 'updatedAt' as const, dir: sortDir }
        : { field: sortField, dir: sortDir };
    return { filters: compiled, sort, limit: Number(limit) || 50, includeTotal: true };
  }

  async function runQuery() {
    running = true;
    queryError = '';
    try {
      const res = await fetch(`${collBase}/query${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildQueryBody()),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        records = body.records ?? [];
        if (typeof body.total === 'number') total = body.total;
      } else {
        queryError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      queryError = 'Network error';
    } finally {
      running = false;
    }
  }

  function resetQuery() {
    filters = [];
    sortField = 'updatedAt';
    sortPath = '';
    sortDir = 'desc';
    limit = 50;
    runQuery();
  }

  // ——— Record editor (inline panel) ———
  let selected = $state<Rec | null>(null);
  let dataText = $state('');
  let permsText = $state('');
  let recordError = $state('');
  let savingRecord = $state(false);
  let deletingRecord = $state(false);
  let auditEntries = $state<AuditEntry[]>([]);
  let auditLoading = $state(false);

  async function openRecord(rec: Rec) {
    selected = rec;
    dataText = JSON.stringify(rec.data, null, 2);
    permsText = rec.permissions ? JSON.stringify(rec.permissions, null, 2) : '';
    recordError = '';
    await loadAudit(rec.id);
  }
  function closeRecord() {
    selected = null;
    auditEntries = [];
  }

  async function loadAudit(recordId: string) {
    auditLoading = true;
    try {
      const res = await fetch(`${collBase}/audit${tokenQs ? tokenQs + '&' : '?'}recordId=${recordId}`);
      const body = await res.json().catch(() => ({}));
      auditEntries = res.ok ? (body.entries ?? []) : [];
    } catch {
      auditEntries = [];
    } finally {
      auditLoading = false;
    }
  }

  function parseJsonObject(text: string, label: string): Record<string, unknown> | null | 'error' {
    const t = text.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        recordError = `${label} must be a JSON object`;
        return 'error';
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      recordError = `${label}: ${e instanceof Error ? e.message : 'invalid JSON'}`;
      return 'error';
    }
  }

  async function saveRecord() {
    if (!selected) return;
    recordError = '';
    const parsedData = parseJsonObject(dataText, 'Data');
    if (parsedData === 'error' || parsedData === null) {
      if (parsedData === null) recordError = 'Data must be a JSON object';
      return;
    }
    const parsedPerms = parseJsonObject(permsText, 'Permissions');
    if (parsedPerms === 'error') return;

    savingRecord = true;
    try {
      const res = await fetch(`${collBase}/records/${selected.id}${tokenQs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: parsedData,
          permissions: parsedPerms, // object or null (clears row override)
          expectedVersion: selected.version,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.record) {
        applyUpdatedRecord(body.record as Rec);
        await loadAudit(body.record.id);
      } else {
        recordError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      recordError = 'Network error';
    } finally {
      savingRecord = false;
    }
  }

  function applyUpdatedRecord(rec: Rec) {
    records = records.map((r) => (r.id === rec.id ? rec : r));
    selected = rec;
    dataText = JSON.stringify(rec.data, null, 2);
    permsText = rec.permissions ? JSON.stringify(rec.permissions, null, 2) : '';
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!confirm('Delete this record? This cannot be undone.')) return;
    deletingRecord = true;
    try {
      const res = await fetch(`${collBase}/records/${selected.id}${tokenQs}`, { method: 'DELETE' });
      if (res.ok) {
        records = records.filter((r) => r.id !== selected!.id);
        total = Math.max(0, total - 1);
        closeRecord();
      } else {
        const body = await res.json().catch(() => ({}));
        recordError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      recordError = 'Network error';
    } finally {
      deletingRecord = false;
    }
  }

  /** Restore the record to an audit entry's before-image (data + permissions). */
  async function restore(entry: AuditEntry) {
    if (!selected || !entry.before) return;
    if (!confirm('Restore this record to the state before this change?')) return;
    dataText = JSON.stringify(entry.before.data ?? {}, null, 2);
    permsText = entry.before.permissions ? JSON.stringify(entry.before.permissions, null, 2) : '';
    await saveRecord();
  }

  // ——— New record ———
  let newKey = $state('');
  let newDataText = $state('{\n  \n}');
  let inserting = $state(false);
  let insertError = $state('');

  async function insertRecord() {
    insertError = '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(newDataText);
    } catch (e) {
      insertError = `Data: ${e instanceof Error ? e.message : 'invalid JSON'}`;
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      insertError = 'Data must be a JSON object';
      return;
    }
    inserting = true;
    try {
      const res = await fetch(`${collBase}/records${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim() || undefined, data: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.record) {
        records = [body.record as Rec, ...records];
        total += 1;
        newKey = '';
        newDataText = '{\n  \n}';
      } else {
        insertError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      insertError = 'Network error';
    } finally {
      inserting = false;
    }
  }

  // ——— Collection settings ———
  let settingsOpen = $state(false);
  let nameText = $state(collection.name ?? '');
  let descText = $state(collection.description ?? '');
  let schemaText = $state(collection.schema ? JSON.stringify(collection.schema, null, 2) : '');
  let defaultPermsText = $state(
    collection.defaultPermissions ? JSON.stringify(collection.defaultPermissions, null, 2) : '',
  );
  let collSettingsText = $state(collection.settings ? JSON.stringify(collection.settings, null, 2) : '');
  let savingSettings = $state(false);
  let settingsError = $state('');
  let settingsSaved = $state(false);

  async function saveSettings() {
    settingsError = '';
    const patch: Record<string, unknown> = {
      name: nameText.trim() || null,
      description: descText.trim() || null,
    };
    for (const [text, key, label] of [
      [schemaText, 'schema', 'Schema'],
      [defaultPermsText, 'defaultPermissions', 'Default permissions'],
      [collSettingsText, 'settings', 'Settings'],
    ] as const) {
      const t = text.trim();
      if (!t) {
        patch[key] = null;
        continue;
      }
      try {
        patch[key] = JSON.parse(t);
      } catch (e) {
        settingsError = `${label}: ${e instanceof Error ? e.message : 'invalid JSON'}`;
        return;
      }
    }
    savingSettings = true;
    try {
      const res = await fetch(`${collBase}${tokenQs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.collection) {
        collection = body.collection as Collection;
        settingsSaved = true;
        setTimeout(() => (settingsSaved = false), 2000);
      } else {
        settingsError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      settingsError = 'Network error';
    } finally {
      savingSettings = false;
    }
  }

  let deletingCollection = $state(false);
  async function deleteCollection() {
    if (!confirm(`Delete the entire "${slug}" collection and all its records?`)) return;
    deletingCollection = true;
    try {
      const res = await fetch(`${collBase}${tokenQs}`, { method: 'DELETE' });
      if (res.ok) {
        goto(`/admin/ai/datastore${tokenQs}`);
      } else {
        const body = await res.json().catch(() => ({}));
        settingsError = body.error ?? `Error ${res.status}`;
        deletingCollection = false;
      }
    } catch {
      settingsError = 'Network error';
      deletingCollection = false;
    }
  }

  // ——— Helpers ———
  function preview(rec: Rec): string {
    const s = JSON.stringify(rec.data);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  function fmtDate(d: string | Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Datastore"
    title={collection.name || collection.slug}
    crumbs={[{ label: 'Datastore', href: `/admin/ai/datastore${tokenQs}` }, { label: collection.slug }]}
  >
    {#snippet actions()}
      {#if collection.isSystem}<span class="nm-pill" data-state="info">system</span>{/if}
      <span class="nm-pill">{total} {total === 1 ? 'record' : 'records'}</span>
      <a class="nm-btn-ghost" href={`${collBase}/export${tokenQs}`}>Export JSON</a>
    {/snippet}
  </PageHeader>

  {#if collection.description}
    <p class="coll-desc">{collection.description}</p>
  {/if}

  <!-- Query console -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Query console</span>
      <button class="nm-link-btn" style="margin-left:auto" onclick={addFilter}>+ Filter</button>
    </div>

    {#each filters as f, i (i)}
      <div class="filter-row">
        <input class="nm-text-input path" type="text" bind:value={f.path} placeholder="data path e.g. status" />
        <select class="nm-select" bind:value={f.op}>
          {#each OPS as op}<option value={op}>{op}</option>{/each}
        </select>
        <input
          class="nm-text-input"
          type="text"
          bind:value={f.value}
          placeholder={f.op === 'exists' ? '(no value)' : f.op === 'in' ? 'a, b, c' : 'value'}
          disabled={f.op === 'exists'}
        />
        <button class="nm-link-btn danger" onclick={() => removeFilter(i)}>Remove</button>
      </div>
    {/each}

    <div class="query-controls">
      <label class="ctl">
        <span class="sr-label-tight">Sort</span>
        <select class="nm-select" bind:value={sortField}>
          <option value="updatedAt">updatedAt</option>
          <option value="createdAt">createdAt</option>
          <option value="key">key</option>
          <option value="path">data path…</option>
        </select>
      </label>
      {#if sortField === 'path'}
        <label class="ctl">
          <span class="sr-label-tight">Sort path</span>
          <input class="nm-text-input" type="text" bind:value={sortPath} placeholder="e.g. score" />
        </label>
      {/if}
      <label class="ctl">
        <span class="sr-label-tight">Dir</span>
        <select class="nm-select" bind:value={sortDir}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </label>
      <label class="ctl">
        <span class="sr-label-tight">Limit</span>
        <input class="nm-text-input limit" type="number" min="1" max="500" bind:value={limit} />
      </label>
      <button class="nm-save-btn" onclick={runQuery} disabled={running}>
        {running ? 'Running…' : 'Run query'}
      </button>
      <button class="nm-btn-ghost" onclick={resetQuery} disabled={running}>Reset</button>
      {#if queryError}<span class="result-bad">{queryError}</span>{/if}
    </div>
  </section>

  <!-- Records -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Records</span>
      <span class="nm-sec-meta">{records.length} shown · {total} total</span>
    </div>
    {#if records.length === 0}
      <div class="nm-empty">No records match.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Key</th><th>Data</th><th>Ver</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {#each records as rec (rec.id)}
              <tr class="rec-row" class:selected={selected?.id === rec.id} onclick={() => openRecord(rec)}>
                <td class="rec-key">{rec.key ?? '—'}</td>
                <td class="rec-data">{preview(rec)}</td>
                <td>{rec.version}</td>
                <td class="rec-date">{fmtDate(rec.updatedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Record editor -->
  {#if selected}
    <section class="nm-sec editor">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Edit record</span>
        <span class="rec-meta">
          {selected.key ? `key: ${selected.key} · ` : ''}v{selected.version} · id {selected.id.slice(0, 8)}
        </span>
        <button class="nm-link-btn" style="margin-left:auto" onclick={closeRecord}>Close</button>
      </div>

      {#if recordError}<div class="banner banner-error">{recordError}</div>{/if}

      <label class="nm-field">
        <span class="sr-label-tight">Data (JSON)</span>
        <textarea class="nm-textarea code" rows="12" bind:value={dataText}></textarea>
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Row permissions (JSON — blank = use collection default)</span>
        <textarea class="nm-textarea code" rows="5" bind:value={permsText} placeholder={'{ "read": ["*"], "write": ["owner"] }'}></textarea>
      </label>

      <div class="editor-actions">
        <button class="nm-save-btn" onclick={saveRecord} disabled={savingRecord}>
          {savingRecord ? 'Saving…' : 'Save (v' + selected.version + ')'}
        </button>
        <button class="nm-link-btn danger" onclick={deleteSelected} disabled={deletingRecord}>
          {deletingRecord ? 'Deleting…' : 'Delete record'}
        </button>
      </div>

      <div class="audit">
        <div class="nm-sec-hd"><span class="sr-label-tight">Revision history</span></div>
        {#if auditLoading}
          <div class="nm-empty">Loading…</div>
        {:else if auditEntries.length === 0}
          <div class="nm-empty">No history for this record.</div>
        {:else}
          <ul class="audit-list">
            {#each auditEntries as e (e.id)}
              <li class="audit-row">
                <span class="nm-pill" data-state={e.action === 'delete' ? 'error' : e.action === 'insert' ? 'success' : 'info'}>{e.action}</span>
                <span class="audit-actor">{e.actor}</span>
                <span class="audit-date">{fmtDate(e.createdAt)}</span>
                {#if e.before}
                  <button class="nm-link-btn" onclick={() => restore(e)}>Restore before</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {/if}

  <!-- New record -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">New record</span></div>
    <label class="nm-field">
      <span class="sr-label-tight">Key <em>(optional — enables upsert-by-key)</em></span>
      <input class="nm-text-input" type="text" bind:value={newKey} placeholder="natural key" />
    </label>
    <label class="nm-field">
      <span class="sr-label-tight">Data (JSON)</span>
      <textarea class="nm-textarea code" rows="6" bind:value={newDataText}></textarea>
    </label>
    <div class="editor-actions">
      <button class="nm-save-btn" onclick={insertRecord} disabled={inserting}>
        {inserting ? 'Inserting…' : 'Insert record'}
      </button>
      {#if insertError}<span class="result-bad">{insertError}</span>{/if}
    </div>
  </section>

  <!-- Collection settings -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Collection settings</span>
      <button class="nm-link-btn" style="margin-left:auto" onclick={() => (settingsOpen = !settingsOpen)}>
        {settingsOpen ? 'Hide' : 'Edit'}
      </button>
    </div>
    {#if settingsOpen}
      {#if settingsError}<div class="banner banner-error">{settingsError}</div>{/if}
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Name</span>
          <input class="nm-text-input" type="text" bind:value={nameText} />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Description</span>
          <input class="nm-text-input" type="text" bind:value={descText} />
        </label>
      </div>
      <label class="nm-field">
        <span class="sr-label-tight">JSON schema (blank = no validation)</span>
        <textarea class="nm-textarea code" rows="6" bind:value={schemaText} placeholder={'{ "type": "object", "required": ["title"] }'}></textarea>
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Default permissions (JSON)</span>
        <textarea class="nm-textarea code" rows="4" bind:value={defaultPermsText} placeholder={'{ "read": ["*"], "write": ["owner","jkai"] }'}></textarea>
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Settings (JSON — ttlSeconds, maxRecords, maxPayloadBytes)</span>
        <textarea class="nm-textarea code" rows="4" bind:value={collSettingsText} placeholder={'{ "maxRecords": 50000 }'}></textarea>
      </label>
      <div class="editor-actions">
        <button class="nm-save-btn" onclick={saveSettings} disabled={savingSettings}>
          {savingSettings ? 'Saving…' : 'Save settings'}
        </button>
        {#if settingsSaved}<span class="saved-flag">Saved</span>{/if}
      </div>

      {#if !collection.isSystem}
        <div class="danger-zone">
          <button class="nm-link-btn danger" onclick={deleteCollection} disabled={deletingCollection}>
            {deletingCollection ? 'Deleting…' : 'Delete collection'}
          </button>
        </div>
      {:else}
        <p class="muted">System collection — cannot be deleted, but its records remain editable.</p>
      {/if}
    {/if}
  </section>
</PageWrap>

<style>
  .coll-desc { margin: -0.75rem 0 1.25rem; font-size: 0.9rem; color: var(--text-secondary); max-width: 70ch; }
  .result-bad { font-family: var(--font-mono); font-size: 11px; color: var(--error); }
  .saved-flag {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--success);
  }
  .muted { margin: 0.5rem 0 0; font-size: 0.8rem; color: var(--text-muted); }

  .filter-row {
    display: grid;
    grid-template-columns: 1fr 120px 1fr auto;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .filter-row .path { min-width: 0; }
  .query-controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; margin-top: 0.6rem; }
  .ctl { display: grid; gap: 0.3rem; }
  .ctl .nm-select, .ctl .nm-text-input { min-width: 0; }
  .ctl .limit { width: 80px; }

  .table-scroll { overflow-x: auto; }
  .rec-row { cursor: pointer; }
  .rec-row.selected td { background: var(--accent-tint-08); }
  .rec-key { font-family: var(--font-mono); color: var(--text-primary); white-space: nowrap; }
  .rec-data {
    font-family: var(--font-mono);
    color: var(--text-muted);
    max-width: 520px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-date { white-space: nowrap; color: var(--text-ghost); }

  .editor { border-color: var(--accent); }
  .rec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .code { font-family: var(--font-mono); font-size: 11px; line-height: 1.5; }
  .editor-actions { display: flex; align-items: center; gap: 1rem; margin-top: 0.6rem; }

  .audit { margin-top: 1rem; }
  .audit .nm-sec-hd { margin-bottom: 0.5rem; }
  .audit-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .audit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--divider);
    font-size: 0.8rem;
  }
  .audit-row:last-child { border-bottom: none; }
  .audit-actor { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .audit-date { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); margin-left: auto; }

  .danger-zone { margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--divider); }

  @media (max-width: 640px) {
    .filter-row { grid-template-columns: 1fr 1fr; }
  }
</style>
