<script lang="ts">
  /**
   * The frame both welcome pages share: the site bar, one phone-width column,
   * the compact footer. It carries the page's shared type — the kicker, the
   * display headline, the lede, the numbered step card — so /welcome and an
   * invite link read as one place.
   *
   * The styles are `:global` under `.welcome` on purpose: the cards are written
   * in the pages, and Svelte would prune a scoped selector with no match here.
   */
  import type { Snippet } from 'svelte';
  import SiteHeader from '$lib/components/SiteHeader.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let {
    isOwner = false,
    reach = [],
    children,
  }: { isOwner?: boolean; reach?: readonly string[]; children: Snippet } = $props();
</script>

<SiteHeader title="Welcome" {isOwner} {reach} showBack={false} />

<main class="welcome">
  {@render children()}
</main>

<SiteFooter variant="compact" />

<style>
  .welcome {
    max-width: 36rem;
    margin: 0 auto;
    padding: 2.5rem 16px 3.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  /* ── Hero ─────────────────────────────────────────────────────────────── */
  .welcome :global(.w-kicker) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin: 0;
  }
  .welcome :global(.w-title) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 0.95;
    font-size: clamp(2.25rem, 9vw, 3.25rem);
    margin: 0.35rem 0 0;
  }
  .welcome :global(.w-lede) {
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0.75rem 0 0;
  }
  .welcome :global(.w-hero) { padding-bottom: 1.25rem; border-bottom: 2px solid var(--text-primary); }

  /* ── Cards ────────────────────────────────────────────────────────────── */
  .welcome :global(.w-card) {
    border: 1px solid var(--card-border);
    background: var(--surface-elevated);
    border-radius: var(--radius-sharp);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .welcome :global(.w-card.is-locked) { background: var(--bg); border-style: dashed; }
  .welcome :global(.w-card-hd) { display: flex; align-items: baseline; gap: 0.75rem; }
  .welcome :global(.w-num) {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    color: var(--accent);
    line-height: 1;
    min-width: 2ch;
  }
  .welcome :global(.w-card h2) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    font-size: var(--fs-display-xs);
    line-height: 1.05;
    margin: 0;
  }
  .welcome :global(.w-card p:not(.w-note):not(.w-error)) { margin: 0; font-size: var(--fs-body); line-height: 1.55; color: var(--text-secondary); }
  .welcome :global(.w-note) {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .welcome :global(.w-done) { color: var(--success); }
  .welcome :global(.w-error) { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0; }

  /* ── Controls ─────────────────────────────────────────────────────────── */
  .welcome :global(.w-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.8rem 1.1rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s;
  }
  .welcome :global(.w-btn:hover:not(:disabled)) { background: var(--accent-hover); border-color: var(--accent-hover); }
  .welcome :global(.w-btn:disabled) { opacity: 0.6; cursor: default; }
  .welcome :global(.w-btn.ghost) { background: transparent; color: var(--text-primary); border-color: var(--line-strong); }
  .welcome :global(.w-btn.ghost:hover:not(:disabled)) { background: var(--accent-tint-08); border-color: var(--text-primary); }
  .welcome :global(.w-row) { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .welcome :global(.w-field) { display: flex; flex-direction: column; gap: 0.35rem; }
  .welcome :global(.w-field > span) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .welcome :global(.w-input) {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    padding: 0.7rem 0.8rem;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    width: 100%;
    box-sizing: border-box;
  }
  .welcome :global(.w-input:focus) { outline: 2px solid var(--accent-ink); outline-offset: -1px; }
  .welcome :global(.w-input[aria-invalid='true']) { border-color: var(--error); }
  .welcome :global(textarea.w-input) { min-height: 5rem; resize: vertical; }
  .welcome :global(.w-check) { display: flex; align-items: center; gap: 0.6rem; font-size: var(--fs-body-sm); color: var(--text-secondary); }
  .welcome :global(.w-check input) { width: 1.1rem; height: 1.1rem; accent-color: var(--accent); }
</style>
