<script lang="ts">
  import type { Snippet } from 'svelte';

  // Page title bar for the non-chat /jkai surfaces — the thread-header
  // treatment from the redesign (DM Mono title behind an accent `>`, hairline
  // rule, mono metadata to the right).
  //
  // It says WHERE YOU ARE. It no longer says how to leave: the hub header
  // carries the back chip on every /jkai surface now, computed from
  // $lib/nav/site-nav, so a bare `←` here as well put two back arrows a
  // centimetre apart on nineteen pages. `titleHref` is still accepted — every
  // caller passes it, and each value it passes is exactly what parentHref()
  // now computes — but it is no longer rendered.
  let {
    title,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    titleHref: _titleHref,
    meta,
    actions,
  }: {
    title: string;
    /** @deprecated the hub header owns the back link — see $lib/nav/site-nav. */
    titleHref?: string;
    /** Mono metadata beside the title. */
    meta?: Snippet;
    /** Right-aligned controls. */
    actions?: Snippet;
  } = $props();
</script>

<div class="page-title">
  <div class="pt-left">
    <h1 class="pt-title"><span class="pt-mark" aria-hidden="true">&gt;</span>{title}</h1>
    {#if meta}
      <div class="pt-meta">{@render meta()}</div>
    {/if}
  </div>
  {#if actions}
    <div class="pt-actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .page-title {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 20px;
    border-bottom: 1px solid var(--line-hair);
  }
  .pt-left {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .pt-title {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45ch;
    margin: 0;
    font-family: var(--font-brand);
    font-size: var(--fs-body);
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    text-transform: lowercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pt-mark {
    color: var(--accent);
    opacity: 0.7;
  }
  .pt-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .pt-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  @media (max-width: 799px) {
    .page-title {
      padding: 10px 16px;
    }
    .pt-meta {
      display: none;
    }
  }
</style>
