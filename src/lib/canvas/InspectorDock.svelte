<script lang="ts">
  // The canvas node inspector's HOST: a panel docked to the right of the
  // canvas on desktop (the canvas shrinks beside it and stays live), and the
  // existing bottom sheet on a phone. It owns the chrome — name field, save,
  // warnings, close, the type/status/upstream/downstream header — and renders
  // the page's kind-specific body through `children`, so the panels
  // themselves are untouched. Opened by a single click on a node (double-click
  // still works); Escape or a click on empty canvas closes it.
  import type { Snippet, ComponentProps } from 'svelte';
  import NodeTestData from './NodeTestData.svelte';

  type PinNode = { id: string; name: string; kind: string };

  type Props = {
    node: { id: string; name: string; kind: string; type: string; status?: string };
    kindColor: string;
    typeLabel: string;
    typeDescription?: string;
    labelDraft: string;
    labelInputEl?: HTMLInputElement;
    configDirty: boolean;
    saving: boolean;
    saveError: string | null;
    requiredMissing: string[];
    collisions: Array<{ key: string; labels: string[] }>;
    upstream: PinNode[];
    downstream: PinNode[];
    isMobile: boolean;
    onLabelInput: (value: string) => void;
    onSave: () => void;
    onClose: () => void;
    /** Pinned test data + run-from-here for this node (absent: not shown). */
    test?: Omit<ComponentProps<typeof NodeTestData>, 'nodeId'>;
    children: Snippet;
  };
  let {
    node,
    kindColor,
    typeLabel,
    typeDescription = '',
    labelDraft,
    labelInputEl = $bindable(),
    configDirty,
    saving,
    saveError,
    requiredMissing,
    collisions,
    upstream,
    downstream,
    isMobile,
    onLabelInput,
    onSave,
    onClose,
    test,
    children,
  }: Props = $props();

  // Plain handle — only the backdrop's own handlers read it.
  let backdropPressed = false;
</script>

{#if isMobile}
  <!-- Closes only on a press that STARTED here: the tap that opened the sheet
       ends in a synthesised click that lands on this backdrop, and must not
       shut it again. -->
  <button
    class="dock-backdrop"
    type="button"
    aria-label="Close inspector"
    onpointerdown={() => (backdropPressed = true)}
    onclick={(e) => {
      // detail 0 = keyboard activation, which has no ghost-click problem.
      if (backdropPressed || e.detail === 0) onClose();
      backdropPressed = false;
    }}
  ></button>
{/if}
<div
  class="nm-inline dock"
  class:dock--mobile={isMobile}
  role="dialog"
  tabindex="-1"
  aria-label="Node inspector"
>
  <div class="nm-inline-hdr">
    <span class="bar" style:background={kindColor}></span>
    <input
      class="nm-label-input"
      type="text"
      value={labelDraft}
      bind:this={labelInputEl}
      oninput={(e) => onLabelInput((e.target as HTMLInputElement).value)}
      onkeydown={(e) => {
        if (e.key === 'Enter' && configDirty && !saving) {
          e.preventDefault();
          onSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      placeholder="Node name"
      title="Press Enter to save, Esc to close"
      aria-label="Node name"
    />
    <span class="hdr-kind">{node.kind}</span>
    {#if configDirty}
      <button class="nm-save-btn" onclick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/if}
    {#if saveError}
      <span class="save-err" title={saveError}>⚠</span>
    {/if}
    {#if requiredMissing.length}
      <span
        class="warn"
        title={`Required field${requiredMissing.length === 1 ? '' : 's'} still empty: ${requiredMissing.join(', ')}`}
      >⚠ {requiredMissing.length} required</span>
    {/if}
    {#if collisions.length}
      <span
        class="warn"
        title={`Field name clash — ${collisions.map((c) => `"${c.key}" arrives from ${c.labels.join(' & ')}`).join('; ')}. They silently overwrite each other in {{input}} (last upstream wins).`}
      >⚠ {collisions.length} clash</span>
    {/if}
    <button class="close-btn" onclick={onClose} aria-label="Close inspector" title="Close (Esc)">✕</button>
  </div>
  <div class="nm-inline-body dock-body">
    <div class="hdr">
      <div class="hdr-row">
        <span class="bar" style:background={kindColor}></span>
        <span class="hdr-type" title={typeDescription}>{typeLabel}</span>
        <span class="hdr-typecode">{node.type}</span>
        <span class="hdr-id">#{node.id.slice(0, 8)}</span>
        {#if node.status === 'running' || node.status === 'failed' || node.status === 'ok'}
          <span class="status push" data-s={node.status}>{node.status === 'ok' ? 'OK' : node.status.toUpperCase()}</span>
        {/if}
      </div>
      <div class="hdr-name">{node.name}</div>
      <div class="ctx">
        <div class="ctx-row">
          <span class="ctx-lbl">↑ UPSTREAM</span>
          {#each upstream as u (u.id)}
            <span class="pin" data-kind={u.kind}>{u.name}</span>
          {:else}
            <span class="ctx-empty">none</span>
          {/each}
        </div>
        <div class="ctx-row">
          <span class="ctx-lbl">↓ DOWNSTREAM</span>
          {#each downstream as d (d.id)}
            <span class="pin" data-kind={d.kind}>{d.name}</span>
          {:else}
            <span class="ctx-empty">none</span>
          {/each}
        </div>
      </div>
    </div>
    {@render children()}
    {#if test}<NodeTestData {...test} nodeId={node.id} />{/if}
  </div>
</div>

<style>
  /* Desktop: a column beside the viewport, full height of the canvas area.
     `.nm-inline` (nm-tokens.css) still supplies the header band, the flush
     section density and the input sizing the panels expect. */
  .dock {
    position: relative;
    flex: 0 0 420px;
    width: 420px;
    max-width: 46vw;
    min-height: 0;
    height: 100%;
    border: 0;
    border-left: 1.5px solid var(--accent);
    z-index: 30;
  }
  .dock-body {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
  }
  .bar {
    display: inline-block;
    width: 3px;
    height: 14px;
    flex-shrink: 0;
  }
  .hdr-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .save-err {
    color: var(--error);
    font-size: var(--fs-body-sm);
  }
  .warn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--error);
    white-space: nowrap;
    cursor: default;
    align-self: center;
  }
  .hdr {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
    position: relative;
    flex-shrink: 0;
  }
  .hdr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .hdr-type {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    font-weight: 600;
  }
  .hdr-typecode {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: var(--radius-sharp);
    margin-left: 4px;
  }
  .hdr-id {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin-left: 4px;
  }
  .hdr-name {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .push {
    margin-left: auto;
  }
  .status {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .status[data-s='running'] {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .status[data-s='failed'] {
    background: var(--error);
    color: var(--bg);
    border-color: var(--error);
  }
  .close-btn {
    margin-left: auto;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 2px 7px;
    cursor: pointer;
    line-height: 1;
  }
  .close-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .ctx {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed var(--line-hair);
  }
  .ctx-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ctx-lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    min-width: 7.5rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ctx-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-style: italic;
  }
  .pin {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    padding: 2px 7px;
    color: var(--text-primary);
  }
  .pin::before {
    content: '';
    display: inline-block;
    width: 2px;
    height: 10px;
    background: var(--text-ghost);
    margin-right: 6px;
  }
  .pin[data-kind='llm']::before,
  .pin[data-kind='intel']::before {
    background: var(--accent);
  }
  .pin[data-kind='parse']::before {
    background: var(--error);
  }
  .pin[data-kind='output']::before,
  .pin[data-kind='agent']::before {
    background: var(--text-primary);
  }
  .pin[data-kind='input']::before {
    background: var(--text-muted);
  }

  /* Phone: the bottom sheet the canvas has always used, unchanged. */
  .dock--mobile {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: 100%;
    max-width: 100%;
    height: auto;
    max-height: 85dvh;
    border: 0;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-round) var(--radius-round) 0 0;
    overflow: hidden;
    animation: dock-slide-up 200ms ease-out;
    z-index: 2147483646;
  }
  .dock--mobile::before {
    content: '';
    display: block;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    margin: 8px auto 4px;
    flex: 0 0 auto;
  }
  .dock--mobile .dock-body {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .dock-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    background: rgba(0, 0, 0, 0.4);
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    animation: dock-fade-in 200ms ease-out;
  }
  @keyframes dock-slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  @keyframes dock-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
