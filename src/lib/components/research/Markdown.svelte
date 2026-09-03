<script lang="ts">
  /**
   * Research prose, rendered.
   *
   * Every synthesis comes back as markdown — headings, bold, inline `[N]`
   * citations, occasional tables — and the run page was printing it into a
   * `white-space: pre-wrap` block, so readers saw the raw `###` and `**`.
   *
   * Same pipeline as chat (`ChatMessage.svelte`): `marked` with GFM, then
   * `sanitizeChatHtml`. The sanitiser is not optional — this text is written by
   * a model from arbitrary web pages, so it is untrusted input on the way to
   * `{@html}`.
   */
  import { Marked } from 'marked';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';

  let { text = '' }: { text?: string } = $props();

  const marked = new Marked({ gfm: true, breaks: true });

  const html = $derived(text ? sanitizeChatHtml(marked.parse(text) as string) : '');
</script>

{#if html}
  <div class="md">{@html html}</div>
{/if}

<style>
  .md {
    color: var(--text-primary);
    font-size: var(--fs-body-lg);
    line-height: 1.72;
  }

  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    font-family: var(--font-display);
    font-weight: 900;
    line-height: 1.02;
    letter-spacing: -0.02em;
    margin: 2.2rem 0 0.75rem;
  }
  .md :global(h1) { font-size: var(--fs-display-sm); }
  .md :global(h2) { font-size: var(--fs-display-xs); }
  .md :global(h3) { font-size: var(--fs-body-lg); }
  .md :global(h4) { font-size: var(--fs-body-sm); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .md :global(> :first-child) { margin-top: 0; }

  .md :global(p) { margin: 0 0 1.05rem; }
  .md :global(> p:first-child) { font-size: clamp(1.2rem, 2vw, 1.5rem); line-height: 1.5; color: var(--text-secondary); }
  .md :global(ul),
  .md :global(ol) { margin: 0 0 1.05rem; padding-left: 1.35rem; }
  .md :global(li) { margin-bottom: 0.45rem; }
  .md :global(li::marker) { color: var(--accent); }

  .md :global(strong) { font-weight: 700; }
  .md :global(a) { color: var(--accent); text-underline-offset: 2px; }

  .md :global(blockquote) {
    margin: 1.4rem 0;
    padding: 0.55rem 0 0.55rem 1rem;
    border-left: 3px solid var(--accent);
    color: var(--text-secondary);
  }

  .md :global(code) {
    font-family: var(--font-code);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--accent-tint-08);
    padding: 1px 4px;
  }
  .md :global(pre) {
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    padding: 0.7rem 0.8rem;
    overflow-x: auto;
    margin: 0 0 1.05rem;
  }
  .md :global(pre code) { background: none; padding: 0; }

  /* A wide table scrolls inside its own box; the page never scrolls sideways. */
  .md :global(table) { width: 100%; border-collapse: collapse; margin: 0 0 1.05rem; font-size: var(--fs-body-sm); }
  .md :global(th),
  .md :global(td) { border: 1px solid var(--line-strong); padding: 0.35rem 0.5rem; text-align: left; }
  .md :global(th) { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); background: var(--surface-elevated); }

  .md :global(hr) { border: none; border-top: 1px solid var(--line-hair); margin: 1.2rem 0; }
</style>
