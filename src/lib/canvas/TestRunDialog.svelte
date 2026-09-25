<script lang="ts">
  // "Test run" from the canvas toolbar: edit the trigger payload, see which
  // steps will be stubbed (they send, write or book) and which use pinned data,
  // and let a stubbed step run for real this once. The run itself is started by
  // the page (runCanvas), so it streams onto the canvas like any other run.
  import { untrack } from 'svelte';
  import { getDefinition } from '$lib/workflows/registry-client';
  import { hasSideEffects } from '$lib/workflows/side-effects';

  type Node = { id: string; name: string; type: string; config?: Record<string, unknown> };
  type Props = {
    workflowId: string;
    nodes: Node[];
    onStart: (opts: { input: Record<string, unknown>; allowSideEffects: string[] }) => void;
    onClose: () => void;
  };
  let { workflowId, nodes, onStart, onClose }: Props = $props();

  let payloadText = $state('{}');
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pinned = $state<string[]>([]);
  let allowed = $state<Record<string, boolean>>({});

  const sideEffecting = $derived(
    nodes.filter((n) => hasSideEffects(getDefinition(n.type), (n.config ?? {}) as Record<string, unknown>)),
  );

  $effect(() => {
    const id = workflowId;
    untrack(() => void prefill(id));
  });

  async function prefill(id: string) {
    try {
      const res = await fetch(`/api/workflows/${id}/pins`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { pins?: Record<string, unknown>; samplePayload?: unknown };
      payloadText = JSON.stringify(body.samplePayload ?? {}, null, 2);
      pinned = Object.keys(body.pins ?? {});
    } catch (err) {
      error = `Could not load a sample payload (${err instanceof Error ? err.message : String(err)}) — starting from {}.`;
    } finally {
      loading = false;
    }
  }

  function start() {
    let input: unknown;
    try {
      input = JSON.parse(payloadText || '{}');
    } catch (err) {
      error = `The payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      error = 'The payload must be a JSON object.';
      return;
    }
    onStart({
      input: input as Record<string, unknown>,
      allowSideEffects: Object.entries(allowed).filter(([, v]) => v).map(([k]) => k),
    });
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ovl" use:portal onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="panel" role="dialog" aria-label="Test run" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="p-hd">
      <span class="sr-label-tight">Test run</span>
      <button class="x" onclick={onClose} aria-label="Close">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg>
      </button>
    </div>
    <p class="lede">
      Runs the workflow without touching the world: pinned steps use their saved output, and steps that
      send, write or book are stubbed. Nothing is announced and it is marked TEST in the run history.
    </p>

    <label class="sr-label-tight lbl" for="trd-payload">Trigger payload</label>
    <textarea
      id="trd-payload"
      class="payload"
      spellcheck="false"
      bind:value={payloadText}
      disabled={loading}
      rows="8"
    ></textarea>
    <span class="hint">Prefilled from the last real run's input, or the event's example payload.</span>

    <div class="sec">
      <span class="sr-label-tight">Stubbed — will not run</span>
      {#each sideEffecting as n (n.id)}
        <label class="row">
          <span class="name">{n.name}</span>
          <span class="type">{n.type}</span>
          <input type="checkbox" bind:checked={allowed[n.id]} />
          <span class="real">run for real</span>
        </label>
      {:else}
        <span class="none">No step here sends, writes or books.</span>
      {/each}
    </div>
    {#if pinned.length}
      <div class="sec">
        <span class="sr-label-tight">Pinned — saved output used</span>
        <span class="none">{nodes.filter((n) => pinned.includes(n.id)).map((n) => n.name).join(', ')}</span>
      </div>
    {/if}

    {#if error}<p class="err">{error}</p>{/if}
    <div class="actions">
      <button class="composer-btn" onclick={onClose}>Cancel</button>
      <button class="nm-save-btn" onclick={start} disabled={loading}>Start test run</button>
    </div>
  </div>
</div>

<style>
  .ovl {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 16px;
  }
  .panel {
    width: 100%;
    max-width: 520px;
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    padding: 16px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .p-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: none;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .x:hover { border-color: var(--line-strong); color: var(--text-primary); }
  .lede, .hint, .none {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm, 0.875rem);
  }
  .hint, .none { color: var(--text-muted); }
  .lbl { margin-top: 4px; }
  .payload {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--fs-label-sm, 0.8125rem);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    padding: 8px;
    resize: vertical;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--line-hair);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px dashed var(--line-strong);
  }
  .name { overflow-wrap: anywhere; color: var(--text-primary); }
  .type, .real {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .err { margin: 0; color: var(--error); overflow-wrap: anywhere; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .composer-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 6px 12px;
    background: var(--bg);
    color: var(--text-secondary);
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
</style>
