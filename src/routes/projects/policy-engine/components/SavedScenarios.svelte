<script lang="ts">
  import type { SavedScenario } from '../lib/scenarios';

  interface Props {
    saved: SavedScenario[];
    suggestedName: string;
    onSave: (name: string) => void;
    onLoad: (s: SavedScenario) => void;
    onPin: (s: SavedScenario) => void;
    onDelete: (id: string) => void;
  }
  let { saved, suggestedName, onSave, onLoad, onPin, onDelete }: Props = $props();

  let open = $state(false);
  let draft = $state('');

  function doSave() {
    const n = draft.trim();
    if (!n) return;
    onSave(n);
    draft = '';
  }
  function fmtDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; }
  }
</script>

<div class="saved">
  <button class="tb-btn star" class:on={open} onclick={() => (open = !open)} aria-expanded={open} title="Save & load named scenarios">
    ★ Saved{saved.length ? ` (${saved.length})` : ''} ▾
  </button>

  {#if open}
    <div class="backdrop" onclick={() => (open = false)} role="presentation"></div>
    <div class="pop" role="dialog" aria-label="Saved scenarios">
      <div class="pop-save">
        <input class="pop-input" type="text" bind:value={draft} maxlength="60"
               placeholder={suggestedName === 'Custom scenario' ? 'Name this scenario…' : `e.g. ${suggestedName}`}
               onkeydown={(e) => e.key === 'Enter' && doSave()} aria-label="Scenario name" />
        <button class="pop-savebtn" onclick={doSave} disabled={!draft.trim()}>Save current</button>
      </div>

      {#if saved.length === 0}
        <p class="pop-empty">No saved scenarios yet — name the current lever settings above and save them. They’re stored in this browser.</p>
      {:else}
        <div class="pop-list">
          {#each saved as s (s.id)}
            <div class="pop-row">
              <button class="pr-load" onclick={() => { onLoad(s); open = false; }} title="Load into Scenario A">
                <span class="pr-name">{s.name}</span>
                <span class="pr-date">{fmtDate(s.createdAt)}</span>
              </button>
              <button class="pr-pin" onclick={() => { onPin(s); open = false; }} title="Pin as Scenario B (compare)">vs B</button>
              <button class="pr-del" onclick={() => onDelete(s.id)} title="Delete" aria-label="Delete {s.name}">✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .saved { position: relative; display: inline-block; }
  .tb-btn.star { border-color: rgba(154,123,31,0.5); color: #9a7b1f; }
  .tb-btn.star.on { background: #9a7b1f; color: #fff; border-color: #9a7b1f; }
  .backdrop { position: fixed; inset: 0; z-index: 70; }
  .pop {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 71; width: min(320px, calc(100vw - 24px));
    background: var(--paper-deep); border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-sharp);
 padding: 10px; font-family: var(--font-body);
  }
  @media (max-width: 600px) {
    .pop { position: fixed; left: 12px; right: 12px; width: auto; top: auto; bottom: 12px; max-height: 70vh; overflow-y: auto; }
  }
  .pop-save { display: flex; gap: 6px; margin-bottom: 8px; }
  .pop-input { flex: 1; min-width: 0; padding: 6px 8px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.7); font: inherit; font-size: var(--fs-label-xs); color: var(--ink); }
  .pop-savebtn { background: var(--ink); color: var(--paper); border: none; border-radius: var(--radius-sharp); padding: 6px 10px; font-size: var(--fs-label-xs); cursor: pointer; white-space: nowrap; }
  .pop-savebtn:disabled { opacity: 0.4; cursor: default; }
  .pop-empty { margin: 2px 2px 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.6); }
  .pop-list { display: flex; flex-direction: column; gap: 3px; max-height: 280px; overflow-y: auto; }
  .pop-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 5px; }
  .pr-load { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex: 1; min-width: 0;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 6px 9px; cursor: pointer; text-align: left; }
  .pr-load:hover { background: rgba(255,255,255,0.8); border-color: rgba(28,22,17,0.25); }
  .pr-name { font-size: var(--fs-label); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pr-date { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); flex-shrink: 0; }
  .pr-pin { background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); color: var(--accent-ink); border-radius: var(--radius-sharp); padding: 6px 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .pr-pin:hover { background: var(--accent-ink-tint-22); }
  .pr-del { background: none; border: 1px solid var(--error-border); color: var(--error); border-radius: var(--radius-sharp); width: 26px; height: 28px; cursor: pointer; font-size: var(--fs-label-xs); }
  .pr-del:hover { background: var(--error-bg); }
</style>
