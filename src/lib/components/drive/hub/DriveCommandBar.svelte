<script lang="ts">
  // The shelf's control strip: where you are, what you are looking for, and
  // what happens to whatever you have picked.
  //
  // The breadcrumbs are DROP TARGETS as well as links, and that is why they are
  // here rather than in the section head. A tile grid can only express "put this
  // inside that"; dropping on a crumb is the only way to move something UP
  // without first navigating away from the thing you want to move.
  import type { Crumb } from '$lib/drive/paths';
  import type { DragPayload, DropVerdict } from '$lib/drive/move';
  import type { ViewMode } from './types';

  interface Props {
    crumbs: Crumb[];
    folderCount: number;
    fileCount: number;
    query: string;
    viewMode: ViewMode;
    newFolderName: string;
    creatingFolder: boolean;
    selectedCount: number;
    allSelected: boolean;
    anyVisible: boolean;
    zipBusy: boolean;
    /** Every folder in the store, for the keyboard-reachable Move-to menu. */
    folders: string[];
    uploadLimitLabel: string;
    /** Non-null only while something is being dragged inside the page. */
    dragging: DragPayload | null;
    hotTarget: string | null;
    verdictFor: (target: string) => DropVerdict;
    onNavigate: (path: string) => void;
    onSetView: (v: ViewMode) => void;
    onCreateFolder: () => void;
    onToggleAll: () => void;
    onClearSelection: () => void;
    onDownloadSelected: () => void;
    onInteract: () => void;
    onMoveTo: (path: string) => void;
    onErSettings: () => void;
    onTargetEnter: (path: string) => void;
    onTargetLeave: (path: string) => void;
    onTargetDrop: (path: string) => void;
  }

  let {
    crumbs, folderCount, fileCount, query = $bindable(), viewMode,
    newFolderName = $bindable(), creatingFolder, selectedCount, allSelected, anyVisible,
    zipBusy, folders, uploadLimitLabel, dragging, hotTarget, verdictFor, onNavigate,
    onSetView, onCreateFolder, onToggleAll, onClearSelection, onDownloadSelected,
    onInteract, onMoveTo, onErSettings, onTargetEnter, onTargetLeave, onTargetDrop,
  }: Props = $props();

  let moveOpen = $state(false);

  /** A crumb only lights when what is in flight could actually land on it. */
  function crumbState(path: string): 'idle' | 'ready' | 'hot' | 'blocked' {
    if (!dragging) return 'idle';
    if (!verdictFor(path).ok) return hotTarget === path ? 'blocked' : 'idle';
    return hotTarget === path ? 'hot' : 'ready';
  }
</script>

<div class="cb">
  <div class="cb-row">
    <nav class="cb-crumbs" aria-label="Folder path">
      {#each crumbs as c, i (c.path)}
        {#if i > 0}<span class="cb-sep" aria-hidden="true">/</span>{/if}
        <button
          type="button"
          class="cb-crumb s-{crumbState(c.path)}"
          class:current={i === crumbs.length - 1}
          aria-current={i === crumbs.length - 1 ? 'location' : undefined}
          onclick={() => onNavigate(c.path)}
          ondragenter={() => dragging && onTargetEnter(c.path)}
          ondragleave={() => dragging && onTargetLeave(c.path)}
          ondragover={(e) => {
            if (!dragging) return;
            e.preventDefault();
            onTargetEnter(c.path);
            if (e.dataTransfer) e.dataTransfer.dropEffect = verdictFor(c.path).ok ? 'move' : 'none';
          }}
          ondrop={(e) => { if (dragging) { e.preventDefault(); onTargetDrop(c.path); } }}
        >{c.label}</button>
      {/each}
    </nav>

    <div class="cb-right">
      <div class="cb-search">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" />
          <path d="M9.3 9.3L12.5 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" />
        </svg>
        <input
          type="text"
          class="nm-text-input"
          placeholder="Filter files"
          bind:value={query}
          aria-label="Filter files in this folder by name"
        />
        {#if query}
          <button type="button" class="nm-act cb-x" onclick={() => (query = '')} aria-label="Clear filter">✕</button>
        {/if}
      </div>

      <span class="cb-count">
        {folderCount} folder{folderCount === 1 ? '' : 's'} · {fileCount} file{fileCount === 1 ? '' : 's'}
      </span>

      <div class="cb-view" role="group" aria-label="View mode">
        <button type="button" class="cb-vt" class:on={viewMode === 'grid'}
          aria-pressed={viewMode === 'grid'} onclick={() => onSetView('grid')}>Grid</button>
        <button type="button" class="cb-vt" class:on={viewMode === 'list'}
          aria-pressed={viewMode === 'list'} onclick={() => onSetView('list')}>List</button>
      </div>
    </div>
  </div>

  <div class="cb-row cb-actions">
    <label class="cb-selall" class:off={!anyVisible}>
      <input type="checkbox" checked={allSelected} disabled={!anyVisible} onchange={onToggleAll} />
      <span>Select all</span>
    </label>

    {#if selectedCount > 0}
      <span class="cb-sel">{selectedCount} selected</span>
      <button type="button" class="nm-save-btn" onclick={onInteract}>Interact using model</button>
      <button type="button" class="nm-act" onclick={onDownloadSelected} disabled={zipBusy}>
        {zipBusy ? 'Zipping' : selectedCount > 1 ? `Download ${selectedCount} as .zip` : 'Download'}
      </button>

      <!-- The keyboard-reachable equivalent of dragging onto a folder. Drag is a
           pointer gesture with no keyboard analogue, so this stays. -->
      <div class="cb-move">
        <button type="button" class="nm-act" aria-expanded={moveOpen} onclick={() => (moveOpen = !moveOpen)}>Move to</button>
        {#if moveOpen}
          <div class="cb-menu">
            <button type="button" class="cb-item" onclick={() => { moveOpen = false; onMoveTo(''); }}>Drive (root)</button>
            {#each folders as folder (folder)}
              <button type="button" class="cb-item" onclick={() => { moveOpen = false; onMoveTo(folder); }}>{folder}</button>
            {/each}
          </div>
        {/if}
      </div>

      <button type="button" class="nm-act" onclick={onClearSelection}>Clear</button>
    {:else}
      <span class="cb-hint">
        Drag a file onto a folder to move it. Drop from your desktop to upload — max {uploadLimitLabel}.
      </span>
    {/if}

    <div class="cb-spacer"></div>

    <div class="cb-new">
      <input
        class="nm-text-input"
        placeholder="New folder"
        bind:value={newFolderName}
        aria-label="New folder name"
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreateFolder(); } }}
      />
      <button type="button" class="nm-act" onclick={onCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
        {creatingFolder ? 'Adding' : 'Add'}
      </button>
    </div>

    <button
      type="button"
      class="nm-act"
      onclick={onErSettings}
      title="Whether files here feed the Intel knowledge graph, and under which categories"
    >Intel policy</button>
  </div>
</div>

<style>
  .cb {
    border: 1px solid var(--line-strong);
    background: var(--surface-elevated);
    margin-bottom: 16px;
  }
  .cb-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 14px;
  }
  .cb-actions { border-top: 1px solid var(--line-hair); }
  .cb-spacer { flex: 1; }

  /* ——— breadcrumbs, which are also drop targets ——— */
  .cb-crumbs {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .cb-crumb {
    background: none;
    border: 1px solid transparent;
    padding: 3px 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    cursor: pointer;
  }
  .cb-crumb:hover,
  .cb-crumb.current { color: var(--text-primary); }
  /* Dashed while a drag is live and this crumb would take it; filled under the
     pointer. Two states, because "you may drop here" and "let go now" are
     different messages. */
  .cb-crumb.s-ready { border-color: var(--accent); border-style: dashed; }
  .cb-crumb.s-hot { border-color: var(--accent); background: var(--accent); color: var(--bg); }
  .cb-crumb.s-blocked { border-color: var(--error); color: var(--error); cursor: no-drop; }
  .cb-sep { font-family: var(--font-mono); color: var(--text-ghost); }

  .cb-right {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
    flex-wrap: wrap;
  }
  .cb-search {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-muted);
  }
  .cb-search :global(.nm-text-input), .cb-new :global(.nm-text-input) {
    width: 172px;
    padding: 5px 9px;
  }
  .cb-new :global(.nm-text-input) { width: 130px; }
  .cb-x { color: var(--text-ghost); }
  .cb-count, .cb-hint, .cb-selall, .cb-sel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .cb-count, .cb-selall { text-transform: uppercase; color: var(--text-muted); }
  .cb-hint { white-space: normal; }
  .cb-sel { text-transform: uppercase; color: var(--accent); }

  .cb-view { display: flex; border: 1px solid var(--line-strong); }
  .cb-vt {
    background: none;
    border: none;
    padding: 5px 11px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .cb-vt.on { background: var(--text-primary); color: var(--bg); }

  .cb-selall {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
  }
  .cb-selall.off { opacity: 0.4; cursor: default; }
  .cb-selall input { accent-color: var(--accent); }

  .cb-move { position: relative; }
  .cb-menu {
    position: absolute;
    top: calc(100% + 7px);
    left: 0;
    z-index: 30;
    min-width: 190px;
    max-height: 280px;
    overflow-y: auto;
    /* Opaque: --card-bg is a 7% tint and would show the shelf through it. */
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
  }
  .cb-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    cursor: pointer;
  }
  .cb-item:hover { background: var(--accent); color: var(--bg); }

  .cb-new { display: inline-flex; align-items: center; gap: 9px; }

  @media (max-width: 720px) {
    .cb-right { margin-left: 0; }
    .cb-spacer { display: none; }
  }
</style>
