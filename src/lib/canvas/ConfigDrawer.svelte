<script lang="ts">
  import { getPanel } from './nodes/panels/registry';

  type Props = {
    nodeId: string;
    nodeType: string;
    nodeLabel: string;
    config: Record<string, unknown>;
    workflowId: string;
    onSave: (nodeId: string, config: Record<string, unknown>) => void;
    onClose: () => void;
  };

  let { nodeId, nodeType, nodeLabel, config, workflowId, onSave, onClose }: Props = $props();

  // Local draft — changes tracked here until the user clicks Save
  let draft = $state<Record<string, unknown>>({ ...config });
  let dirty = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  const defaultConfig = $derived({ ...config });
  const PanelComponent = $derived(getPanel(nodeType));

  function onChange(next: Record<string, unknown>) {
    draft = next;
    dirty = true;
  }

  async function save() {
    if (!dirty || saving) return;
    saving = true;
    saveError = null;
    try {
      const res = await fetch(`/api/workflows/${workflowId}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      dirty = false;
      onSave(nodeId, draft);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function cancel() {
    onClose();
  }

  function revert() {
    draft = { ...defaultConfig };
    dirty = false;
    saveError = null;
  }

  // Reset draft when the selected node changes
  $effect(() => {
    draft = { ...config };
    dirty = false;
    saveError = null;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="drawer"
  role="dialog"
  aria-label="Node configuration"
  aria-modal="true"
>
  <div class="drawer-hdr">
    <div class="drawer-hdr-meta">
      <span class="drawer-type">{nodeType}</span>
      <span class="drawer-sep">·</span>
      <span class="drawer-label">{nodeLabel}</span>
    </div>
    <div class="drawer-hdr-actions">
      {#if dirty}
        <span class="drawer-dirty-badge">unsaved</span>
      {/if}
      <button
        class="drawer-close"
        onclick={cancel}
        aria-label="Close"
        title="Close (Esc)">✕</button>
    </div>
  </div>

  <div class="drawer-body">
    <PanelComponent config={draft} {onChange} />
  </div>

  <div class="drawer-foot">
    {#if saveError}
      <div class="drawer-save-err">⚠ {saveError}</div>
    {/if}
    <div class="drawer-foot-row">
      <button
        class="drawer-revert"
        onclick={revert}
        title="Reset to last saved values"
      >revert</button>
      <div class="drawer-foot-right">
        <button class="drawer-btn drawer-cancel" onclick={cancel}>Cancel</button>
        <button
          class="drawer-btn drawer-save"
          onclick={save}
          disabled={!dirty || saving}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  </div>
</div>

<style>
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 420px;
    z-index: 200;
    background: var(--card-bg, var(--bg-section));
    border-left: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 24px rgba(0,0,0,0.18);
    font-family: var(--font-mono);
  }

  .drawer-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--divider);
    flex-shrink: 0;
    background: var(--bg-section);
  }
  .drawer-hdr-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .drawer-type {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    flex-shrink: 0;
  }
  .drawer-sep {
    color: var(--text-ghost);
    opacity: 0.5;
    flex-shrink: 0;
  }
  .drawer-label {
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-hdr-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .drawer-dirty-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: var(--accent-tint-08, rgba(196,87,10,0.08));
    border: 1px solid var(--accent-tint-35, rgba(196,87,10,0.35));
    padding: 1px 5px;
  }
  .drawer-close {
    background: none;
    border: none;
    color: var(--text-ghost);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    line-height: 1;
  }
  .drawer-close:hover { color: var(--text-primary); }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
    min-height: 0;
  }

  .drawer-foot {
    flex-shrink: 0;
    border-top: 1px solid var(--divider);
    padding: 10px 14px;
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .drawer-save-err {
    font-size: 10px;
    color: #c44;
    letter-spacing: 0.05em;
  }
  .drawer-foot-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .drawer-foot-right {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .drawer-revert {
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    cursor: pointer;
    padding: 3px 0;
  }
  .drawer-revert:hover { color: var(--text-muted); text-decoration: underline; }
  .drawer-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 5px 14px;
    border: 1px solid var(--card-border);
    cursor: pointer;
  }
  .drawer-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .drawer-cancel {
    background: var(--bg);
    color: var(--text-muted);
  }
  .drawer-cancel:hover:not(:disabled) { color: var(--text-primary); }
  .drawer-save {
    background: var(--accent-tint-08, rgba(196,87,10,0.08));
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 500;
  }
  .drawer-save:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
</style>
