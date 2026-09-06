<script lang="ts">
  // The inline rename / describe / permissions form, opened by an entry's Edit.
  //
  // It spans the full width of whichever view opened it, in both grid and list,
  // because a rename is a text task and a 168px tile is no place to do one.
  import type { EditDraft } from './types';

  interface Props {
    draft: EditDraft;
    busy: boolean;
    onSave: () => void;
    onCancel: () => void;
  }

  let { draft = $bindable(), busy, onSave, onCancel }: Props = $props();

  const PERMS = [
    ['read', 'R', 'Read'],
    ['write', 'W', 'Write'],
    ['append', 'A', 'Append'],
    ['delete', 'D', 'Delete'],
  ] as const;
</script>

<div class="ec">
  <label class="ec-field">
    <span class="sr-label-tight">Name</span>
    <input
      type="text"
      class="nm-text-input"
      bind:value={draft.name}
      onkeydown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSave(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    />
    <span class="ec-hint">A slash makes a folder — renaming to `a/b.pdf` moves it there.</span>
  </label>

  <label class="ec-field">
    <span class="sr-label-tight">Description</span>
    <input type="text" class="nm-text-input" bind:value={draft.description} />
    <span class="ec-hint">Shown under the name in list view.</span>
  </label>

  <div class="ec-field">
    <span class="sr-label-tight">Access</span>
    <div class="ec-perms">
      {#each PERMS as [key, code, name] (key)}
        <label class="ec-perm" class:on={draft.permissions[key]} title={name}>
          <input type="checkbox" bind:checked={draft.permissions[key]} />{code}
        </label>
      {/each}
    </div>
  </div>

  <div class="ec-acts">
    <button type="button" class="nm-save-btn" onclick={onSave} disabled={busy}>
      {busy ? 'Saving' : 'Save'}
    </button>
    <button type="button" class="nm-act b-muted" onclick={onCancel}>Cancel</button>
  </div>
</div>

<style>
  .ec {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto;
    gap: 16px 20px;
    align-items: end;
    background: var(--surface-elevated);
    border: 1px solid var(--accent);
    padding: 16px 18px;
  }
  .ec-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .ec-hint, .ec-perm {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .ec-hint { line-height: 1.4; }
  .ec-perms { display: flex; gap: 4px; }
  .ec-perm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .ec-perm.on { border-color: var(--accent); color: var(--accent); }
  .ec-perm input { display: none; }
  .ec-acts { display: flex; align-items: center; gap: 12px; }
  .b-muted { color: var(--text-muted); }

  @media (max-width: 900px) {
    .ec { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
  }
</style>
