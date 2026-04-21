<script lang="ts" module>
  import type { HandleSpec } from './handles';

  export type Mode =
    | { kind: 'workflow-ranked' }
    | { kind: 'strict-downstream'; sourceType: string; sourceOutputs: HandleSpec[] };
</script>

<script lang="ts">
  import type { NodeHandles, CandidateType } from './handles';
  import { rankForWorkflow, filterDownstream } from './handles';
  import { getRecentCounts, recordPick } from './recents';
  import { allTypes, byType } from './adapter';

  type Props = {
    open: boolean;
    anchor: { x: number; y: number } | 'center';
    mode: Mode;
    canvasNodes: { type: string }[];
    onPick: (type: string) => void;
    onClose: () => void;
  };

  let { open, anchor, mode, canvasNodes, onPick, onClose }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);
  let searchEl: HTMLInputElement | undefined = $state();

  const allCandidates: CandidateType[] = $derived(
    allTypes().map((t) => ({
      type: t.type,
      handles: t.handles,
      defaultWeight: t.defaultWeight ?? 0,
    }))
  );

  const canvasHandles: NodeHandles[] = $derived(
    canvasNodes
      .map((n) => byType(n.type)?.handles)
      .filter((h): h is NodeHandles => !!h)
  );

  const recents = $derived(open ? getRecentCounts() : {});

  const visible = $derived.by(() => {
    let candidates = allCandidates;
    let degraded = false;
    if (mode.kind === 'strict-downstream') {
      const filtered = filterDownstream(candidates, mode.sourceOutputs);
      if (filtered.length === 0) {
        degraded = true;
      } else {
        candidates = filtered;
      }
    }
    const suggested = rankForWorkflow(candidates, canvasHandles, recents, 6);
    const q = query.trim().toLowerCase();
    const rest = q
      ? candidates.filter((c) => {
          const meta = byType(c.type);
          if (!meta) return false;
          return (
            meta.label.toLowerCase().includes(q) ||
            meta.description.toLowerCase().includes(q) ||
            meta.type.toLowerCase().includes(q)
          );
        })
      : candidates;
    return { suggested, rest, degraded };
  });

  $effect(() => {
    if (open) {
      query = '';
      activeIndex = 0;
      // focus the input on next tick
      queueMicrotask(() => searchEl?.focus());
    }
  });

  function pick(type: string) {
    recordPick(type);
    onPick(type);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const flat = query ? visible.rest : [...visible.suggested, ...visible.rest];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(flat.length - 1, activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[activeIndex]) pick(flat[activeIndex].type);
    }
  }

  const style = $derived(
    anchor === 'center'
      ? 'left:50%; top:40%; transform:translate(-50%, -40%);'
      : `left:${(anchor as { x: number; y: number }).x}px; top:${(anchor as { x: number; y: number }).y}px;`
  );
</script>

{#if open}
  <div
    class="palette-scrim"
    role="presentation"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  ></div>
  <div
    class="palette"
    style={style}
    role="dialog"
    aria-label="Node palette"
    tabindex="-1"
    onkeydown={onKey}
  >
    <input
      type="text"
      class="palette-search"
      placeholder="Search nodes…"
      bind:value={query}
      bind:this={searchEl}
    />

    {#if visible.degraded}
      <div class="palette-banner">No strict matches — showing all</div>
    {/if}

    {#if visible.suggested.length > 0 && !query}
      <div class="palette-section">
        <div class="palette-section-label">Suggested</div>
        {#each visible.suggested as c, i (c.type)}
          {@const meta = byType(c.type)}
          <button
            type="button"
            class="palette-row"
            class:active={i === activeIndex}
            onclick={() => pick(c.type)}
            onmouseenter={() => (activeIndex = i)}
          >
            <span class="palette-row-label">{meta?.label ?? c.type}</span>
            <span class="palette-row-desc">{meta?.description ?? ''}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="palette-section">
      <div class="palette-section-label">{query ? 'Results' : 'All nodes'}</div>
      {#if visible.rest.length === 0}
        <div class="palette-empty">No matches</div>
      {/if}
      {#each visible.rest as c, i (c.type)}
        {@const meta = byType(c.type)}
        {@const offset = query ? 0 : visible.suggested.length}
        <button
          type="button"
          class="palette-row"
          class:active={i + offset === activeIndex}
          onclick={() => pick(c.type)}
          onmouseenter={() => (activeIndex = i + offset)}
        >
          <span class="palette-row-label">{meta?.label ?? c.type}</span>
          <span class="palette-row-desc">{meta?.description ?? ''}</span>
          {#if recents[c.type]}
            <span class="palette-row-recent" title="Recently used">↺</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .palette {
    position: fixed;
    width: 420px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-2, #1a1a1a);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    flex-direction: column;
  }
  .palette-scrim {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: transparent;
  }
  .palette-search {
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border, #2a2a2a);
    color: var(--fg, #e0e0e0);
    outline: none;
    font: inherit;
  }
  .palette-banner {
    padding: 6px 12px;
    background: var(--bg-3, #252525);
    color: var(--fg-2, #a0a0a0);
    font-size: 12px;
  }
  .palette-section-label {
    padding: 8px 12px 4px;
    text-transform: uppercase;
    font-size: 11px;
    color: var(--fg-2, #a0a0a0);
    letter-spacing: 0.05em;
  }
  .palette-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--fg, #e0e0e0);
    cursor: pointer;
    font: inherit;
    width: 100%;
  }
  .palette-row:hover,
  .palette-row.active {
    background: var(--bg-3, #252525);
  }
  .palette-row-label {
    font-weight: 500;
    white-space: nowrap;
  }
  .palette-row-desc {
    color: var(--fg-2, #a0a0a0);
    font-size: 12px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .palette-row-recent {
    color: var(--accent, #7aa2f7);
    font-size: 12px;
  }
  .palette-empty {
    padding: 12px;
    color: var(--fg-2, #a0a0a0);
    font-size: 12px;
    text-align: center;
  }
</style>
