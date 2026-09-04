<script lang="ts">
  // The drill-through overlay, extracted from the feed page so every room can
  // open one thing in full without the rest of the room moving.
  //
  // Portalled to <body> so the hub's sticky rail cannot sit on top of it;
  // backdrop click and Escape close; the header WRAPS (at 390px a kicker, a
  // pill, a chip and the close button do not fit on one line, and a
  // non-wrapping header once pushed the ✕ 21px off a panel with no horizontal
  // scrollbar). The panel wears `ds-vocab` so the shared vocabulary — .tag,
  // .pill, .tbl — is styled inside it even though it is outside the layout.
  //
  // The shell is `RelationshipModal`'s, so the two jkai overlays read as one
  // object. The panel MUST be `--surface-elevated`: `--card-bg` is a 7% tint
  // and the board shows through it.
  import type { Snippet } from 'svelte';
  import type { Tone } from '$lib/daydream/priority';

  interface Props {
    /** The accessible name — the headline of the thing opened. */
    label: string;
    /** Mono kicker at the top-left — the family mark, the kind. */
    kicker?: string | null;
    tone?: Tone;
    onclose: () => void;
    /** Chips after the kicker (a status pill) and before the close button. */
    head?: Snippet;
    children: Snippet;
    /** A footer strip — the actions. */
    foot?: Snippet;
    /** More room for editor journeys with a side-by-side review. */
    wide?: boolean;
  }

  let { label, kicker = null, tone = 'steady', onclose, head = undefined, children, foot = undefined, wide = false }: Props = $props();

  /** Move the node to <body>. Same action the feed used. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  let panel: HTMLDivElement | undefined = $state();
  $effect(() => {
    panel?.focus();
  });
</script>

<svelte:window onkeydown={key} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="dp-backdrop" use:portal onclick={onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="dp-panel ds-vocab t-{tone}"
    class:wide
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={label}
    bind:this={panel}
    onclick={(e) => e.stopPropagation()}
  >
    <header class="dp-hd">
      <div class="dp-hd-left">
        {#if kicker}<span class="dp-kicker">{kicker}</span>{/if}
        {#if head}{@render head()}{/if}
      </div>
      <div class="dp-hd-right">
        <button type="button" class="dp-chip" onclick={onclose} aria-label="Close">✕</button>
      </div>
    </header>
    <div class="dp-body">
      {@render children()}
    </div>
    {#if foot}
      <footer class="dp-ft">{@render foot()}</footer>
    {/if}
  </div>
</div>

<style>
  .dp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(12px, 3vw, 32px);
    background: rgba(26, 16, 8, 0.45);
  }
  .dp-panel {
    --tone: var(--accent-ink);
    display: flex;
    flex-direction: column;
    width: min(860px, 100%);
    max-height: 100%;
    background: var(--surface-elevated);
    border: 2px solid rgba(26, 16, 8, 0.22);
    border-left: 4px solid var(--tone);
    border-radius: 0;
    outline: none;
  }
  /* The editor journey is a DOCUMENT, and 1120px was not enough page for one:
     its review step put a paragraph of problem statement in a four-row box that
     clipped mid-word, beside a 350px gutter of wrapped monospace. 1400 is the
     measure every /health section is set to, and the register borrowed from
     there needs the same room. Only `BacklogEditor` passes `wide`, so the two
     narrow drills do not move. */
  .dp-panel.wide {
    width: min(1400px, 100%);
  }
  /* Chrome padding follows the body's, so the header rule, the content and the
     footer buttons share one left edge rather than stepping in twice. */
  .dp-panel.wide .dp-body {
    padding: clamp(20px, 2.4vw, 34px);
  }
  .dp-panel.wide .dp-hd,
  .dp-panel.wide .dp-ft {
    padding: 13px clamp(20px, 2.4vw, 34px);
  }
  .dp-panel.t-urgent {
    --tone: var(--error);
  }
  .dp-panel.t-action {
    --tone: var(--accent);
  }
  .dp-panel.t-watch {
    --tone: var(--warn);
  }
  .dp-panel.t-good {
    --tone: var(--good);
  }
  .dp-panel.t-quiet {
    --tone: var(--text-ghost);
  }

  .dp-hd,
  .dp-ft {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 16px;
  }
  .dp-hd {
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-hair);
  }
  .dp-hd-left,
  .dp-hd-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dp-hd-left {
    min-width: 0;
    flex: 1 1 auto;
  }
  .dp-hd-right {
    flex: 0 0 auto;
    margin-left: auto;
  }
  .dp-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--tone);
  }
  .dp-chip {
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    cursor: pointer;
    transition:
      color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out);
  }
  .dp-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .dp-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .dp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
  }
  .dp-ft {
    flex-wrap: wrap;
    border-top: 2px solid var(--text-primary);
    background: var(--bg-section);
  }
  @media (max-width: 640px) {
    .dp-backdrop {
      padding: 0;
    }
    .dp-panel {
      width: 100%;
      height: 100%;
      max-height: 100%;
    }
  }
</style>
