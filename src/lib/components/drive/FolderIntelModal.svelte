<script lang="ts">
  // Entity-resolution settings for one Drive folder.
  //
  // Drive folders are virtual — a path prefix, not a row — so this edits
  // `drive_folder_settings` keyed on the path, and shows the RESOLVED policy
  // beside the stored one. That distinction is the whole UI: a folder set to
  // "inherit" still has an effective answer, and without seeing where it came
  // from you cannot tell why files here are (or are not) in the graph.
  //
  // Saving re-syncs everything beneath the path, so switching to Exclude also
  // removes intel already extracted from files in here — otherwise "exclude"
  // would only mean "exclude from now on", which is not what it says.

  import type { IntelCategory } from '$lib/db/schema';
  import type { IntelMode, ResolvedPolicy } from '$lib/jkai/intel/source-policy';

  let {
    path,
    onClose,
    onSaved,
  }: {
    /** '' is the Drive root. */
    path: string;
    onClose: () => void;
    onSaved: (message: string) => void;
  } = $props();

  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);

  let mode = $state<IntelMode>('inherit');
  let selectedIds = $state<string[]>([]);
  let categories = $state<IntelCategory[]>([]);
  let resolved = $state<ResolvedPolicy | null>(null);
  let newCategory = $state('');

  const label = $derived(path || 'Drive (root)');

  // The stored setting is what this dialog edits; `resolved` is what the folder
  // ACTUALLY does once inheritance is applied. Recomputed locally as the mode
  // control changes so the consequence is visible before saving.
  const effective = $derived.by(() => {
    if (mode === 'include') return { included: true, from: 'this folder' };
    if (mode === 'exclude') return { included: false, from: 'this folder' };
    if (!resolved) return { included: true, from: 'the default' };
    return {
      included: resolved.included,
      from: resolved.decidedBy === null
        ? 'the default'
        : resolved.decidedBy === path
          ? 'the default'
          : `“${resolved.decidedBy || 'Drive (root)'}”`,
    };
  });

  $effect(() => {
    const p = path;
    loading = true;
    error = null;
    let cancelled = false;

    fetch(`/api/drive/folders?path=${encodeURIComponent(p)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`load failed (${res.status})`))))
      .then((body) => {
        if (cancelled) return;
        categories = body.categories ?? [];
        resolved = body.resolved ?? null;
        mode = (body.folder?.intelMode as IntelMode) ?? 'inherit';
        selectedIds = body.folder?.categoryIds ?? [];
        loading = false;
      })
      .catch((err) => {
        if (cancelled) return;
        error = err instanceof Error ? err.message : String(err);
        loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  function toggle(id: string) {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((c) => c !== id)
      : [...selectedIds, id];
  }

  /** Categories inherited from a parent folder — shown, but not editable here. */
  const inheritedIds = $derived(
    (resolved?.categoryIds ?? []).filter((id) => !selectedIds.includes(id)),
  );

  async function addCategory() {
    const name = newCategory.trim();
    if (!name || busy) return;
    busy = true;
    try {
      const res = await fetch('/api/jkai/intel/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `create failed (${res.status})`);
      const created = body.category as IntelCategory;
      if (!categories.some((c) => c.id === created.id)) categories = [...categories, created];
      if (!selectedIds.includes(created.id)) selectedIds = [...selectedIds, created.id];
      newCategory = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/drive/folders', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, intelMode: mode, categoryIds: selectedIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `save failed (${res.status})`);

      const s = body.sync ?? {};
      const parts = [`${s.filesConsidered ?? 0} file(s) re-checked`];
      if (s.notesDeleted) parts.push(`${s.notesDeleted} source(s) removed from the graph`);
      if (s.entitiesRemoved) parts.push(`${s.entitiesRemoved} entities dropped`);
      if (s.notesRecategorised) parts.push(`${s.notesRecategorised} re-categorised`);
      onSaved(`Saved — ${parts.join(', ')}.`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && onClose()} />

<div class="fi-backdrop" use:portal onclick={() => !busy && onClose()} role="presentation">
  <div
    class="fi-modal"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="Folder entity-resolution settings"
  >
    <header class="fi-hdr">
      <span class="fi-kicker">Entity resolution</span>
      <h2 class="fi-title">{label}</h2>
      <p class="fi-sub">
        Whether files in this folder feed the Intel knowledge graph, and which categories the
        intelligence read from them carries. Both are inherited by subfolders.
      </p>
    </header>

    <div class="fi-body">
      {#if loading}
        <p class="fi-loading">Loading…</p>
      {:else}
        <span class="fi-label">Feed the Intel graph</span>
        <div class="fi-modes" role="radiogroup" aria-label="Entity resolution mode">
          {#each [{ v: 'inherit', l: 'Inherit', d: 'Follow the nearest parent folder.' }, { v: 'include', l: 'Include', d: 'Extract entities from files here.' }, { v: 'exclude', l: 'Exclude', d: 'Keep them out of the graph entirely.' }] as opt (opt.v)}
            <button
              type="button"
              class="fi-mode"
              class:on={mode === opt.v}
              role="radio"
              aria-checked={mode === opt.v}
              disabled={busy}
              onclick={() => (mode = opt.v as IntelMode)}
            >
              <span class="fi-mode-l">{opt.l}</span>
              <span class="fi-mode-d">{opt.d}</span>
            </button>
          {/each}
        </div>

        <p class="fi-effective" class:out={!effective.included}>
          Files here are <strong>{effective.included ? 'included in' : 'excluded from'}</strong>
          entity resolution, decided by {effective.from}.
          {#if !effective.included}
            Saving removes intel already extracted from them.
          {/if}
        </p>

        <span class="fi-label">Categories</span>
        {#if categories.length === 0}
          <p class="fi-none">No categories yet — create the first one below.</p>
        {:else}
          <div class="fi-cats">
            {#each categories as c (c.id)}
              <button
                type="button"
                class="fi-cat"
                class:on={selectedIds.includes(c.id)}
                style="--cat: {c.color}"
                disabled={busy}
                onclick={() => toggle(c.id)}
              >{c.name}</button>
            {/each}
          </div>
        {/if}

        {#if inheritedIds.length}
          <p class="fi-none">
            Also inherited from parent folders:
            {inheritedIds.map((id) => categories.find((c) => c.id === id)?.name ?? id).join(', ')}
          </p>
        {/if}

        <div class="fi-new">
          <input
            class="fi-input"
            type="text"
            placeholder="New category…"
            bind:value={newCategory}
            maxlength="60"
            disabled={busy}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addCategory();
              }
            }}
          />
          <button type="button" class="fi-add" disabled={busy || !newCategory.trim()} onclick={addCategory}>
            + Add
          </button>
        </div>

        {#if error}<p class="fi-warn">{error}</p>{/if}
      {/if}
    </div>

    <footer class="fi-foot">
      <button type="button" class="fi-cancel" onclick={onClose} disabled={busy}>Cancel</button>
      <button type="button" class="fi-save" onclick={save} disabled={busy || loading}>
        {busy ? 'Saving…' : 'Save & re-sync'}
      </button>
    </footer>
  </div>
</div>

<style>
  .fi-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: color-mix(in srgb, var(--text-primary) 45%, transparent);
    backdrop-filter: blur(2px);
  }
  /* Opaque surface — a --card-bg tint would show the page through the panel. */
  .fi-modal {
    width: min(520px, 100%);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md, 4px);
    overflow: hidden;
  }
  .fi-hdr {
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--card-border);
  }
  .fi-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .fi-title {
    font-family: var(--font-display);
    font-size: 21px;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 4px 0 6px;
    overflow-wrap: anywhere;
  }
  .fi-sub {
    margin: 0;
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .fi-body {
    padding: 16px 20px;
    overflow-y: auto;
  }
  .fi-label {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  .fi-label + .fi-cats,
  .fi-label ~ .fi-modes {
    margin-bottom: 10px;
  }
  .fi-modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .fi-mode {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 9px;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp, 2px);
    cursor: pointer;
    color: var(--text-secondary);
  }
  .fi-mode:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .fi-mode.on {
    border-color: var(--accent);
    background: var(--accent-tint-08);
    color: var(--text-primary);
  }
  .fi-mode-l {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fi-mode-d {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-ghost);
  }

  .fi-effective {
    margin: 0 0 16px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    padding: 8px 10px;
    background: var(--accent-tint-04);
    border-radius: var(--radius-sharp, 2px);
  }
  .fi-effective.out {
    background: var(--warn-bg);
    color: var(--warn);
  }

  .fi-cats {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .fi-cat {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 9px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--cat, var(--accent-ink));
    border-radius: var(--radius-sharp, 2px);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .fi-cat:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .fi-cat.on {
    background: var(--accent-tint-08);
    border-color: var(--accent);
    color: var(--accent);
  }
  .fi-none {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-ghost);
  }

  .fi-new {
    display: flex;
    gap: 6px;
    margin-top: 12px;
  }
  .fi-input {
    flex: 1;
    font-family: var(--font-body);
    font-size: 13px;
    padding: 7px 9px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp, 2px);
    color: var(--text-primary);
  }
  .fi-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .fi-add,
  .fi-cancel {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 7px 12px;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp, 2px);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .fi-add:hover:not(:disabled),
  .fi-cancel:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .fi-warn {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--error);
  }
  .fi-loading {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-ghost);
  }

  .fi-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--card-border);
  }
  .fi-save {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 7px 14px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp, 2px);
    color: #fff;
    cursor: pointer;
  }
  .fi-save:disabled,
  .fi-add:disabled,
  .fi-cancel:disabled,
  .fi-mode:disabled,
  .fi-cat:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: 560px) {
    .fi-modes {
      grid-template-columns: 1fr;
    }
  }
</style>
