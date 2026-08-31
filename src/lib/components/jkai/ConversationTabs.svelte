<script lang="ts">
  import type { TabActivity, TabView } from '$lib/jkai/open-tabs.svelte';

  let {
    tabs,
    activeId,
    canOpenMore,
    limitHit = false,
    onActivate,
    onClose,
    onNew,
    onCycle,
    onToggleRail,
    onToggleGraph,
    graphOpen = false,
  }: {
    tabs: TabView[];
    activeId: string | null;
    canOpenMore: boolean;
    limitHit?: boolean;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
    onCycle: (delta: 1 | -1) => void;
    /** Show/hide the thread rail. It is off-canvas at ≤1099px and this is the
     *  only way back to it — the thread header that used to carry the control
     *  is gone. */
    onToggleRail?: () => void;
    /** Show/hide the knowledge-graph rail for the open thread. */
    onToggleGraph?: () => void;
    graphOpen?: boolean;
  } = $props();

  const ACTIVITY_WORD: Record<TabActivity, string> = {
    idle: '',
    running: 'working',
    reply: 'replied',
    error: 'failed',
  };

  /**
   * Alt+Shift+arrow rather than ⌘1–⌘4 or Ctrl+Tab: browsers reserve those for
   * their own tabs, and Ctrl+Alt+arrow is a workspace switch on GNOME. The
   * binding is only advertised in cell tooltips — nothing on screen promises a
   * shortcut, which is the rule this hub already follows for the hub menu.
   */
  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onCycle(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onCycle(-1);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- A cell strip, the same idea as the site nav: one grid of hairline-divided
     cells, and the current one cut out of it — page ground behind it with a 2px
     accent seam on its bottom edge.
     The strip's own ground is --bg, the thread's ground, and the CELLS carry
     --surface-rail. It used to be the other way round, which put a band of rail
     colour identical to the hub header directly under it: header and strip
     merged into one 88px block, and the empty run between the last tab and `+`
     read as a background gap rather than as the top of the conversation. -->
<div class="tab-strip" role="tablist" aria-label="Open conversations">
  <div class="strip-row">
    {#if onToggleRail}
      <button
        type="button"
        class="strip-btn rail-btn"
        onclick={onToggleRail}
        aria-label="Threads"
        title="Show threads">≡</button
      >
    {/if}
    <div class="cells">
      {#each tabs as tab (tab.id)}
        <div class="cell" class:current={tab.id === activeId} title={tab.title}>
          <button
            type="button"
            class="cell-open"
            role="tab"
            aria-selected={tab.id === activeId}
            aria-label={ACTIVITY_WORD[tab.activity]
              ? `${tab.label} — ${ACTIVITY_WORD[tab.activity]}`
              : tab.label}
            onclick={() => onActivate(tab.id)}
          >
            <span class="dot" data-activity={tab.activity} aria-hidden="true"></span>
            <span class="tab-label">{tab.label}</span>
          </button>
          <button
            type="button"
            class="cell-close"
            aria-label={`Close ${tab.label}`}
            title="Close this tab. A reply already running carries on — the rail keeps its live dot."
            onclick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      {/each}
    </div>

    <!-- Outside `.cells`, so a full strip cannot scroll the way to a new thread
         out of reach. `.cells` is `flex: 0 1 auto`, so this sits immediately
         after the last tab while there is room and pins to the right edge once
         the tabs overflow. It is the only way to start a thread now — the two
         `+` buttons on the thread rail are gone. -->
    <button
      type="button"
      class="cell-new"
      disabled={!canOpenMore}
      aria-label="New conversation tab"
      title={canOpenMore
        ? 'New conversation in a new tab · Alt+Shift+← / → moves between tabs'
        : 'Five tabs is the limit — close one first'}
      onclick={onNew}
    >
      +
    </button>

    {#if onToggleGraph}
      <button
        type="button"
        class="strip-btn graph-btn"
        class:on={graphOpen}
        onclick={onToggleGraph}
        aria-label="Knowledge graph for this thread"
        title="Knowledge graph for this thread">◆</button
      >
    {/if}
  </div>

  <!-- Its own row, never a cell in the strip. As a `flex: none` sibling of the
       cells it stole their width, squeezing the tab you were looking at down to
       its dot and scrolling `+` out of sight. -->
  {#if limitHit}
    <p class="limit">Five tabs is the limit — close one to open another.</p>
  {/if}
</div>

<style>
  /* The rail under the masthead — the light band the /health and daydream
     shells put directly beneath their ink cover, closed with a 2px ink rule
     rather than a hairline. The current tab carries a 3px accent seam, which is
     the same mark those rails use for the section you are in. */
  .tab-strip {
    flex: none;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--surface-rail);
    border-bottom: 2px solid var(--text-primary);
  }
  .strip-row {
    display: flex;
    align-items: stretch;
    min-width: 0;
    height: 40px;
  }
  .cells {
    display: flex;
    align-items: stretch;
    min-width: 0;
    /* Shrink to the tabs rather than filling the row, so `+` abuts the last tab
       instead of floating at the far end of an empty band. Still shrinkable, so
       a full strip scrolls its cells and leaves `+` pinned right. */
    flex: 0 1 auto;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .cells::-webkit-scrollbar {
    display: none;
  }

  /* The two controls that used to sit in the thread header under this strip.
     That row also carried the model, the turn count and the thread cost — all
     of which the hub header and the ledger rail already say — so the row went
     and the controls that had no other home came up here. */
  .strip-btn {
    flex: none;
    width: 38px;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    color: var(--text-ghost);
    cursor: pointer;
    transition: color 0.2s var(--ease-out);
  }
  .strip-btn:hover {
    color: var(--accent);
  }
  .rail-btn {
    border-right: 1px solid var(--line-hair);
    /* Above 1099px the rail is docked and there is nothing to toggle. */
    display: none;
  }
  @media (max-width: 1099px) {
    .rail-btn {
      display: block;
    }
  }
  /* Pinned to the far edge rather than sitting against `+`: it acts on the rail
     on the other side of the pane, not on the tabs. */
  .graph-btn {
    margin-left: auto;
    border-left: 1px solid var(--line-hair);
  }
  .graph-btn.on {
    color: var(--accent);
  }
  /* Phone: the bottom tab bar already carries GRAPH, and there is no rail to
     open — it is a sheet. */
  @media (max-width: 799px) {
    .graph-btn {
      display: none;
    }
  }

  .cell {
    position: relative;
    display: flex;
    align-items: stretch;
    flex: none;
    background: transparent;
    /* Bounded, not `auto`: a long thread title in an auto track pushes every
       other tab off the strip, and `minmax(0, 1fr)` would collapse the short
       ones to nothing. */
    max-width: 220px;
    border-right: 1px solid var(--line-hair);
    transition: background 0.2s var(--ease-out);
  }
  .cell:first-child {
    border-left: 1px solid var(--line-hair);
  }
  .cell:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--surface-rail));
  }
  /* Cut out of the strip: page ground behind it, accent seam on the bottom —
     the current tab is continuous with the thread underneath it. */
  .cell.current {
    background: var(--bg);
    box-shadow: inset 0 -3px 0 var(--accent);
  }

  .cell-open {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 8px 0 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-align: left;
  }
  .cell.current .cell-open {
    color: var(--text-primary);
  }
  /* NOT `.label` — app.css has a global `.label` utility, and a scoped class of
     the same name silently inherits its uppercase and tracking. Thread titles are
     set the way the rail sets them (sentence case, mono, 12px): the strip names
     threads, and only the nav above it names destinations. */
  .tab-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  /* Drawn, not typed: a glyph small enough to read as a dot would be under the
     12px text floor. Same 5px pill and the same pulse as the rail's live dot, so
     "this thread is working" looks identical wherever you see it. Always
     rendered — idle is a dim mark, which keeps labels on one baseline as threads
     move between states. */
  .dot {
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--line-strong);
  }
  .dot[data-activity='running'] {
    background: var(--status-run);
    animation: tab-pulse 1.5s ease-in-out infinite;
  }
  .dot[data-activity='reply'] {
    background: var(--status-ok);
  }
  .dot[data-activity='error'] {
    background: var(--status-fail);
  }
  @keyframes tab-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot[data-activity='running'] {
      animation: none;
    }
  }

  .cell-close {
    flex: none;
    width: 24px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s var(--ease-out), color 0.15s var(--ease-out);
  }
  .cell:hover .cell-close,
  .cell.current .cell-close,
  .cell-close:focus-visible {
    opacity: 1;
  }
  .cell-close:hover {
    color: var(--status-fail);
  }

  /* The one way to start a thread, so it is the one filled control on the strip
     rather than another hairline cell. */
  .cell-new {
    flex: none;
    width: 40px;
    background: var(--accent);
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    line-height: 1;
    color: #fff;
    transition: background 0.2s var(--ease-out);
  }
  .cell-new:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .cell-new:disabled {
    background: var(--line-strong);
    color: var(--surface-rail);
    cursor: not-allowed;
  }

  /* A refusal, not a failure — the accent, not the fail colour. */
  .limit {
    flex: none;
    margin: 0;
    padding: 5px 12px 6px;
    border-top: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }

  @media (max-width: 799px) {
    .cell {
      max-width: 150px;
    }
    .cell-open {
      padding: 0 4px 0 10px;
    }
    /* Touch has no hover to reveal the ✕, so it stays out until a tab is the
       current one — closing the tab you are looking at is the only close a
       phone needs. */
    .cell:not(.current) .cell-close {
      display: none;
    }
    /* The notice stays on touch, where there is no tooltip on the disabled `+`
       to explain why nothing happened. It has its own row, so it costs the tabs
       no width. */
  }
</style>
