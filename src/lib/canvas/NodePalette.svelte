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
    /**
     * Optional allow-list of node `type`s. When provided, the palette only
     * offers these types (used by the Research Desk to scope to the research
     * node set). When omitted, all non-Annotation types are offered.
     */
    restrictTypes?: string[];
  };

  let { open, anchor, mode, canvasNodes, onPick, onClose, restrictTypes }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);
  let searchEl: HTMLInputElement | undefined = $state();

  const allCandidates: CandidateType[] = $derived(
    allTypes()
      // Annotation primitives (post-it, annotation box) live on the canvas
      // toolbar, not in the DAG palette — they're inert decoration, not nodes.
      .filter((t) => t.group !== 'Annotations')
      // With an allow-list (Research Desk) show exactly those types — including
      // desk-only ones. Without one (workflow canvas) exclude desk-only types:
      // they have no workflow executor, so the builder shouldn't offer them.
      .filter((t) => (restrictTypes ? restrictTypes.includes(t.type) : !t.deskOnly))
      .map((t) => ({
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
    const len = query
      ? visible.rest.length
      : visible.suggested.length + visible.rest.length;
    if (len === 0) {
      activeIndex = 0;
      return;
    }
    if (activeIndex >= len) activeIndex = len - 1;
  });

  $effect(() => {
    if (!open) return;
    query = '';
    activeIndex = 0;
    queueMicrotask(() => searchEl?.focus());
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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
    if (e.key === 'Tab') {
      // Trap focus between search input and row buttons
      const root = (e.currentTarget as HTMLElement);
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('input, button')
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  type GroupedEntry = { name: string; startIndex: number; items: CandidateType[] };

  function groupedRest(rest: CandidateType[]): GroupedEntry[] {
    const order: string[] = [];
    const buckets = new Map<string, CandidateType[]>();
    for (const c of rest) {
      const g = byType(c.type)?.group ?? 'Other';
      if (!buckets.has(g)) {
        buckets.set(g, []);
        order.push(g);
      }
      buckets.get(g)!.push(c);
    }
    const out: GroupedEntry[] = [];
    let startIndex = 0;
    for (const name of order) {
      const items = buckets.get(name)!;
      out.push({ name, startIndex, items });
      startIndex += items.length;
    }
    return out;
  }

  const PALETTE_WIDTH = 420;
  const style = $derived.by(() => {
    if (anchor === 'center') {
      return 'left:50%; top:40%; transform:translate(-50%, -40%);';
    }
    if (typeof window === 'undefined') return `left:${anchor.x}px; top:${anchor.y}px;`;
    const maxH = window.innerHeight * 0.6; // matches CSS max-height: 60vh
    const x = Math.max(8, Math.min(anchor.x, window.innerWidth - PALETTE_WIDTH - 8));
    const y = Math.max(8, Math.min(anchor.y, window.innerHeight - maxH - 8));
    return `left:${x}px; top:${y}px;`;
  });
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
    aria-modal="true"
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

    {#if query}
      <div class="palette-section">
        <div class="palette-section-label">Results · {visible.rest.length}</div>
        {#if visible.rest.length === 0}
          <div class="palette-empty">No matches for “{query}”</div>
        {/if}
        {#each visible.rest as c, i (c.type)}
          {@const meta = byType(c.type)}
          <button
            type="button"
            class="palette-row"
            class:active={i === activeIndex}
            onclick={() => pick(c.type)}
            onmouseenter={() => (activeIndex = i)}
          >
            <span class="palette-row-label">{meta?.label ?? c.type}</span>
            <span class="palette-row-group">{meta?.group ?? ''}</span>
            <span class="palette-row-desc">{meta?.description ?? ''}</span>
            {#if recents[c.type]}
              <span class="palette-row-recent" title="Recently used">↺</span>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      {@const offset = visible.suggested.length}
      {@const groups = groupedRest(visible.rest)}
      {#each groups as grp (grp.name)}
        <div class="palette-section palette-group">
          <div class="palette-group-label">
            <span class="palette-group-bar"></span>
            <span class="palette-group-name">{grp.name}</span>
            <span class="palette-group-count">{grp.items.length}</span>
          </div>
          {#each grp.items as c, j (c.type)}
            {@const idx = offset + grp.startIndex + j}
            {@const meta = byType(c.type)}
            <button
              type="button"
              class="palette-row"
              class:active={idx === activeIndex}
              onclick={() => pick(c.type)}
              onmouseenter={() => (activeIndex = idx)}
            >
              <span class="palette-row-label">{meta?.label ?? c.type}</span>
              <span class="palette-row-desc">{meta?.description ?? ''}</span>
              {#if recents[c.type]}
                <span class="palette-row-recent" title="Recently used">↺</span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .palette {
    position: fixed;
    width: 420px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--text-primary);
    border-radius: 2px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    font-family: var(--font-body);
    scrollbar-width: thin;
    scrollbar-color: var(--card-border) transparent;
  }
  .palette::-webkit-scrollbar {
    width: 8px;
  }
  .palette::-webkit-scrollbar-track {
    background: transparent;
  }
  .palette::-webkit-scrollbar-thumb {
    background: var(--card-border);
    border-radius: 4px;
  }
  .palette::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }
  .palette-scrim {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  }
  .palette-search {
    padding: 12px 14px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--card-border);
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.02em;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface-elevated);
  }
  .palette-search::placeholder {
    color: var(--text-ghost);
  }
  .palette-banner {
    padding: 6px 14px;
    background: var(--bg-section);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    border-bottom: 1px solid var(--card-border);
  }
  .palette-section-label {
    padding: 10px 14px 4px;
    text-transform: uppercase;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.15em;
  }
  .palette-group {
    border-top: 1px solid var(--divider);
  }
  .palette-group:first-of-type {
    border-top: none;
  }
  .palette-group-label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 6px;
    position: sticky;
    top: 41px;
    background: var(--surface-elevated);
    z-index: 1;
  }
  .palette-group-bar {
    width: 3px;
    height: 11px;
    background: var(--accent);
    display: inline-block;
  }
  .palette-group-name {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-primary);
    font-weight: 500;
    flex: 1;
  }
  .palette-group-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    letter-spacing: 0.05em;
  }
  .palette-row {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 8px 14px;
    text-align: left;
    background: transparent;
    border: none;
    border-left: 3px solid transparent;
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
    width: 100%;
    transition: background 0.08s ease, border-left-color 0.08s ease;
  }
  .palette-row:hover,
  .palette-row.active {
    background: var(--bg-section);
    border-left-color: var(--accent);
  }
  .palette-row-label {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .palette-row-group {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .palette-row-desc {
    color: var(--text-muted);
    font-size: 12px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .palette-row-recent {
    color: var(--accent);
    font-size: 12px;
  }
  .palette-empty {
    padding: 14px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: center;
    letter-spacing: 0.05em;
  }

  /* ——— Mobile (<=768px) ———
     The palette is a fixed 420px box anchored at the tap point — it overflows
     a phone viewport and clips half its width. On mobile it becomes a
     full-width bottom sheet (same pattern as the canvas node inspector), with
     a drag handle, a 16px search input (stops iOS zoom-on-focus), roomier tap
     rows, and safe-area padding. The inline left/top/transform set in the
     component script are overridden with !important. */
  @media (max-width: 768px) {
    .palette {
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      top: auto !important;
      transform: none !important;
      width: 100% !important;
      max-width: 100% !important;
      max-height: 75dvh !important;
      border-radius: var(--radius-round) var(--radius-round) 0 0;
      border-bottom: none;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      /* Fade (not slide): the !important transform above — needed to cancel the
         inline center-anchor translate — would override a transform keyframe. */
      animation: palette-fade-in 160ms ease-out;
    }
    .palette::before {
      content: '';
      display: block;
      flex: 0 0 auto;
      width: 40px;
      height: 4px;
      border-radius: 2px;
      background: var(--divider);
      margin: 8px auto 4px;
    }
    .palette-search {
      font-size: 16px;
      padding: 14px 16px;
    }
    .palette-row {
      padding: 12px 16px;
    }
  }
  @keyframes palette-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
