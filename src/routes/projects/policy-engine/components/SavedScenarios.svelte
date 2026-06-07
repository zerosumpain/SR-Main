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
    background: var(--paper-deep, #e7decc); border: 1px solid rgba(28,22,17,0.22); border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2); padding: 10px; font-family: 'DM Sans', system-ui, sans-serif;
  }
  @media (max-width: 600px) {
    .pop { position: fixed; left: 12px; right: 12px; width: auto; top: auto; bottom: 12px; max-height: 70vh; overflow-y: auto; }
  }
  .pop-save { display: flex; gap: 6px; margin-bottom: 8px; }
  .pop-input { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 5px; border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.7); font: inherit; font-size: 12px; color: var(--ink, #1c1611); }
  .pop-savebtn { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border: none; border-radius: 5px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
  .pop-savebtn:disabled { opacity: 0.4; cursor: default; }
  .pop-empty { margin: 2px 2px 0; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.6); }
  .pop-list { display: flex; flex-direction: column; gap: 3px; max-height: 280px; overflow-y: auto; }
  .pop-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 5px; }
  .pr-load { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex: 1; min-width: 0;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-radius: 5px; padding: 6px 9px; cursor: pointer; text-align: left; }
  .pr-load:hover { background: rgba(255,255,255,0.8); border-color: rgba(28,22,17,0.25); }
  .pr-name { font-size: 12.5px; color: var(--ink, #1c1611); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pr-date { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); flex-shrink: 0; }
  .pr-pin { background: rgba(58,95,168,0.1); border: 1px solid rgba(58,95,168,0.3); color: #3a5fa8; border-radius: 5px; padding: 6px 7px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; cursor: pointer; }
  .pr-pin:hover { background: rgba(58,95,168,0.18); }
  .pr-del { background: none; border: 1px solid rgba(177,69,94,0.3); color: #b1455e; border-radius: 5px; width: 26px; height: 28px; cursor: pointer; font-size: 11px; }
  .pr-del:hover { background: rgba(177,69,94,0.1); }
</style>
