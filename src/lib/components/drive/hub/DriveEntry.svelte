<script lang="ts">
  // One shelf entry — a folder or a file, in grid or list view.
  //
  // ONE markup for both views, not two. The list is a grid row and the tile is
  // a card, but they carry the same eight cells in the same order, and the
  // trick that lets one template be both is `display: contents` on the meta
  // wrapper: in list view it dissolves so its children land in the row's own
  // grid tracks, and in grid view it becomes the tile's flex meta line. The
  // page shipped before this had the two views written out separately, which is
  // how the list came to show a folder column the grid did not.
  //
  // Folders are drop targets, so this is also where a live drag is read: four
  // states, and only the one under the pointer ever goes red — painting every
  // illegal target red the moment a drag starts makes the page shout.
  import { baseName } from '$lib/drive/paths';
  import { fmtSize } from '$lib/drive/stats';
  import type { FileRow, ViewMode } from './types';

  export type EntryItem =
    | { kind: 'folder'; name: string; count: number; path: string }
    | { kind: 'file'; file: FileRow };

  interface Props {
    item: EntryItem;
    view: ViewMode;
    /** Grouped so the `{#each}` that renders these stays readable. */
    flags: {
      drop: 'idle' | 'ready' | 'hot' | 'blocked';
      lifting: boolean;
      selected: boolean;
      busy: boolean;
      shareBusy: boolean;
      shared: boolean;
      canExtract: boolean;
    };
    erChip: { tone: 'full' | 'cats' | 'out'; label: string };
    index: { label: string; title: string; status: string } | null;
    drag: {
      start: (e: DragEvent) => void;
      end: () => void;
      enter?: (e: DragEvent) => void;
      leave?: (e: DragEvent) => void;
      over?: (e: DragEvent) => void;
      drop?: (e: DragEvent) => void;
    };
    on: {
      open: () => void;
      select?: (v: boolean) => void;
      policy: () => void;
      remove: () => void;
      edit?: () => void;
      extract?: () => void;
      convert?: () => void;
      share?: () => void;
    };
    shareTtlDays: number;
  }

  let { item, view, flags, erChip, index, drag, on, shareTtlDays }: Props = $props();

  const isFolder = $derived(item.kind === 'folder');
  const file = $derived(item.kind === 'file' ? item.file : null);
  const label = $derived(item.kind === 'folder' ? item.name : baseName(item.file.name));

  function isImage(mime: string): boolean {
    return mime.startsWith('image/');
  }

  function extBadge(name: string): string {
    const parts = name.split('.');
    if (parts.length < 2) return 'FILE';
    const ext = parts.pop()!.toUpperCase();
    return ext.length <= 5 ? ext : ext.slice(0, 4);
  }

  function shortDate(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div
  class="ent {view} s-{flags.drop}"
  class:folder={isFolder}
  class:sel={flags.selected}
  class:lifting={flags.lifting}
  role="button"
  tabindex="0"
  draggable="true"
  title={isFolder
    ? `Open ${label} — or drop files on it to move them in`
    : `${label} — double-click to preview, drag onto a folder to move`}
  ondragstart={drag.start}
  ondragend={drag.end}
  ondragenter={drag.enter}
  ondragleave={drag.leave}
  ondragover={drag.over}
  ondrop={drag.drop}
  onclick={() => isFolder && on.open()}
  ondblclick={() => !isFolder && on.open()}
  onkeydown={(e) => {
    // keydown BUBBLES: without this the row steals Enter/Space from the select
    // checkbox, the download link and every action button inside it.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      on.open();
    }
  }}
>
  <span class="e-check">
    {#if file && on.select}
      <input
        type="checkbox"
        checked={flags.selected}
        onclick={(e) => e.stopPropagation()}
        onchange={(e) => on.select?.(e.currentTarget.checked)}
      />
      <span class="sr-only">Select {label}</span>
    {/if}
  </span>

  <span class="e-icon">
    {#if isFolder}
      <svg viewBox="0 0 46 38" fill="none" aria-hidden="true">
        <path d="M2 6a2 2 0 012-2h12l3.5 3.5H42a2 2 0 012 2V32a2 2 0 01-2 2H4a2 2 0 01-2-2z" stroke="currentColor" stroke-width="1.7" />
      </svg>
    {:else if file && isImage(file.mimeType)}
      <img src={`/api/files/${file.id}/download?inline=1`} alt="" loading="lazy" />
    {:else if file}
      <svg viewBox="0 0 38 46" fill="none" aria-hidden="true">
        <path d="M5 1.5h19L36 13v30.5a1.5 1.5 0 01-1.5 1.5h-29A1.5 1.5 0 014 43.5V3A1.5 1.5 0 015.5 1.5z" stroke="currentColor" stroke-width="1.4" />
        <path d="M24 1.5V13h12" stroke="currentColor" stroke-width="1.4" />
      </svg>
      <span class="e-ext">{extBadge(file.name)}</span>
    {/if}
  </span>

  <span class="e-main">
    <span class="e-name" title={file?.mimeType}>{label}</span>
    {#if file?.description}<span class="e-desc">{file.description}</span>{/if}
  </span>

  <!-- `display: contents` in list view, a flex meta line in grid view. -->
  <span class="e-meta">
    <span class="e-size">
      {item.kind === 'folder'
        ? `${item.count} item${item.count === 1 ? '' : 's'}`
        : fmtSize(item.file.sizeBytes)}
    </span>
    <span class="e-date">{file ? shortDate(file.updatedAt) : ''}</span>
    <span class="e-status">
      {#if isFolder}
        <span class="chip er-{erChip.tone}">{erChip.label}</span>
      {:else if index}
        <span class="chip idx-{index.status}" title={index.title}>{index.label}</span>
      {/if}
    </span>
    <span class="e-access">
      {#if file}
        <span class="perms" title="Read / write / append / delete">
          <span class="perm" class:on={file.permissions?.read !== false}>R</span><span
            class="perm" class:on={!!file.permissions?.write}>W</span><span
            class="perm" class:on={!!file.permissions?.append}>A</span><span
            class="perm" class:on={!!file.permissions?.delete}>D</span>
        </span>
      {/if}
    </span>
  </span>

  <span class="e-acts">
    {#if isFolder}
      <button type="button" class="nm-rowact" onclick={(e) => { e.stopPropagation(); on.policy(); }}>Policy</button>
      <button type="button" class="nm-rowact danger" onclick={(e) => { e.stopPropagation(); on.remove(); }}>Delete</button>
    {:else if file}
      <button type="button" class="nm-rowact" onclick={(e) => { e.stopPropagation(); on.open(); }}>Preview</button>
      <a class="nm-rowact" href={`/api/files/${file.id}/download`} download={label} onclick={(e) => e.stopPropagation()}>Download</a>
      {#if flags.canExtract}
        <button type="button" class="nm-rowact" disabled={flags.busy} onclick={(e) => { e.stopPropagation(); on.extract?.(); }}>
          {flags.busy ? 'Extracting' : 'Extract'}
        </button>
      {/if}
      <button type="button" class="nm-rowact" disabled={flags.busy} onclick={(e) => { e.stopPropagation(); on.convert?.(); }}>Convert</button>
      <button type="button" class="nm-rowact" onclick={(e) => { e.stopPropagation(); on.edit?.(); }}>Edit</button>
      <button
        type="button"
        class="nm-rowact"
        class:shared={flags.shared}
        disabled={flags.shareBusy}
        title={flags.shared
          ? 'Already has a live link — this mints another'
          : `Anyone with the link can download this for ${shareTtlDays} days`}
        onclick={(e) => { e.stopPropagation(); on.share?.(); }}
      >{flags.shareBusy ? 'Linking' : 'Share'}</button>
      <button type="button" class="nm-rowact danger" onclick={(e) => { e.stopPropagation(); on.remove(); }}>Delete</button>
    {/if}
  </span>
</div>

<style>
  .ent {
    min-width: 0;
    cursor: pointer;
    transition: border-color 0.14s ease-out, background 0.14s ease-out;
  }
  .ent.folder { color: var(--accent); }
  .lifting { opacity: 0.35; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* ——— drop states ——— */
  .s-ready { border-color: var(--accent) !important; border-style: dashed !important; }
  .s-hot {
    border-color: var(--accent) !important;
    background: var(--accent) !important;
    color: var(--bg) !important;
  }
  /* A filled accent target relights EVERYTHING inside it. Blunt on purpose:
     the folder icon is `--accent` at a higher specificity than any state
     selector, and the intel chip is petrol — both vanish on the fill. */
  .s-hot, .s-hot * { color: var(--bg) !important; }
  .s-hot .chip { border-color: rgba(237, 228, 212, 0.55) !important; }
  .s-blocked { border-color: var(--error) !important; cursor: no-drop; }

  /* ——— grid: a card ——— */
  .ent.grid {
    position: relative;
    /* A column, so the action row can sit on the tile's bottom edge. The grid
       stretches every tile to the tallest in its row, and a folder with two
       actions would otherwise leave a hole underneath them. */
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-strong);
    background: var(--surface-elevated);
    padding: 12px;
  }
  .ent.grid:hover { border-color: var(--text-primary); }
  .ent.grid.sel { border-color: var(--accent); background: rgba(196, 87, 10, 0.07); }
  .ent.grid .e-check {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 3;
    opacity: 0.4;
    transition: opacity 0.14s ease-out;
  }
  .ent.grid:hover .e-check,
  .ent.grid.sel .e-check,
  .ent.grid .e-check:focus-within { opacity: 1; }
  .ent.grid .e-icon {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    height: 84px;
    background: var(--bg);
    border: 1px solid var(--line-hair);
    color: var(--text-ghost);
    overflow: hidden;
  }
  .ent.grid.folder .e-icon {
    color: var(--accent);
    background: none;
    border: none;
    height: 54px;
    justify-content: flex-start;
  }
  .ent.grid .e-icon svg { width: 34px; height: 40px; }
  .ent.grid.folder .e-icon svg { width: 36px; height: 30px; }
  .ent.grid .e-main { display: block; margin: 10px 0 7px; }
  .ent.grid .e-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ent.grid .e-date { display: none; }
  .ent.grid .e-acts {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding-top: 9px;
    border-top: 1px solid var(--line-hair);
  }

  /* ——— list: a row ——— */
  .ent.list {
    position: relative;
    display: grid;
    /* One track definition, set on the container, so the header row above these
       and every row here cannot drift apart. */
    grid-template-columns: var(--dl-cols);
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .ent.list:hover { background: var(--surface-elevated); }
  .ent.list.sel { background: rgba(196, 87, 10, 0.07); box-shadow: inset 2px 0 0 var(--accent); }
  /* The wrapper dissolves, so size / date / intel / perms sit in the row's own
     tracks rather than in a nested box. */
  .ent.list .e-meta { display: contents; }
  .ent.list .e-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-ghost);
    overflow: hidden;
    height: 22px;
  }
  .ent.list.folder .e-icon { color: var(--accent); }
  .ent.list .e-icon svg { width: 18px; height: 20px; }
  .ent.list .e-ext { display: none; }
  .ent.list .e-acts { justify-content: flex-end; }

  /* ——— cells, shared ——— */
  .e-icon img { width: 100%; height: 100%; object-fit: cover; }
  .e-ext {
    position: absolute;
    bottom: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .e-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .e-name {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .ent.list .e-name, .e-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .e-desc { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .e-size, .e-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .e-status, .e-access, .e-acts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .e-check input { accent-color: var(--accent); }

  /* NOTHING changes size on hover — only colour. Revealing the action row on
     hover made every tile jump taller under the pointer, which reads as the
     grid flinching away from you. The words are always there, grey, and they
     take their colour when the entry is under the pointer; the one you are
     actually on then goes ink. */
  .e-acts .nm-rowact {
    color: var(--text-ghost);
    transition: color 0.14s ease-out;
  }
  .ent:hover .e-acts .nm-rowact,
  .ent:focus-within .e-acts .nm-rowact { color: var(--accent); }
  .ent:hover .e-acts .nm-rowact.danger,
  .ent:focus-within .e-acts .nm-rowact.danger { color: var(--error); }
  .ent:hover .e-acts .nm-rowact:hover { color: var(--text-primary); }

  .chip {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .chip.idx-indexed { border-color: rgba(45, 122, 58, 0.4); color: var(--success); }
  .chip.idx-pending { border-color: rgba(176, 137, 42, 0.4); color: var(--warn); }
  .chip.idx-failed, .chip.idx-no-text {
    border-color: rgba(204, 68, 68, 0.4);
    color: var(--error);
  }
  /* Petrol, never accent: this chip sits beside accent chrome constantly, and
     accent-on-accent fails colourblind separation. */
  .chip.er-full, .chip.er-cats { border-color: rgba(14, 91, 102, 0.4); color: var(--accent-ink); }
  .perms { display: inline-flex; gap: 1px; }
  .perm {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    opacity: 0.4;
  }
  .perm.on { color: var(--accent-ink); opacity: 1; }
  .nm-rowact.shared::after { content: '·'; margin-left: 2px; }

  @media (max-width: 1000px) {
    .ent.list { grid-template-columns: 24px 24px minmax(0, 1fr) auto; row-gap: 6px; }
    .ent.list .e-date, .ent.list .e-access { display: none; }
    .ent.list .e-acts { grid-column: 3 / -1; justify-content: flex-start; }
  }
</style>
