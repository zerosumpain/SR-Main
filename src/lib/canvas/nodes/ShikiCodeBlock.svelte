<script module lang="ts">
  /**
   * Shared shiki highlighter — created once per page, reused across all
   * ShikiCodeBlock instances. Two themes (light + dark) are loaded so the
   * rendered HTML auto-switches via the css-variables-theme feature.
   *
   * `codeToHtml` lazy-loads grammars on first use, so we don't preload langs.
   */
  import type { Highlighter } from 'shiki';

  let highlighterPromise: Promise<Highlighter> | null = null;

  function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
      highlighterPromise = (async () => {
        const { createHighlighter } = await import('shiki');
        return createHighlighter({
          themes: ['vitesse-light', 'vitesse-dark'],
          langs: ['javascript', 'typescript', 'svelte', 'html', 'css', 'json', 'bash', 'shell', 'markdown'],
        });
      })();
    }
    return highlighterPromise;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let {
    content,
    lang,
    collapsedLines = 6,
  }: {
    content: string;
    lang?: string;
    /** Lines shown when collapsed. 0 = always show full. */
    collapsedLines?: number;
  } = $props();

  let html = $state<string | null>(null);
  let highlightError = $state<string | null>(null);
  let expanded = $state(false);
  let copied = $state(false);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  const totalLines = $derived(content.split('\n').length);
  const collapsible = $derived(collapsedLines > 0 && totalLines > collapsedLines);

  // Re-highlight whenever content or lang changes. We swallow shiki errors
  // gracefully — invalid lang or unparseable mid-stream code falls back to
  // plain pre rendering rather than empty space.
  $effect(() => {
    const c = content;
    const l = (lang ?? '').toLowerCase().trim();
    let cancelled = false;
    (async () => {
      try {
        const h = await getHighlighter();
        // Resolve grammar — fall back to 'text' if the lang isn't loadable.
        const resolvedLang = l && h.getLoadedLanguages().includes(l)
          ? l
          : (await h.loadLanguage(l as never).then(() => l).catch(() => 'text'));
        if (cancelled) return;
        const next = h.codeToHtml(c, {
          lang: resolvedLang,
          themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
          defaultColor: false, // emit CSS vars; we map them in styles below
        });
        if (cancelled) return;
        html = next;
        highlightError = null;
      } catch (err) {
        if (cancelled) return;
        highlightError = err instanceof Error ? err.message : String(err);
        html = null;
      }
    })();
    return () => { cancelled = true; };
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => { copied = false; }, 1400);
    } catch { /* swallow */ }
  }

  onMount(() => () => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  // CSS clamping uses CSS line-clamp-ish via max-height with --collapsed-lines
  // multiplied against the line-height. Computed in JS so the cap follows the
  // mono font size and lh.
  const PX_PER_LINE = 17; // 11px font * 1.55 line-height ≈ 17px
  const COLLAPSED_PX = $derived(collapsedLines * PX_PER_LINE + 12); // + padding
</script>

<div class="scb">
  <header class="scb-hdr">
    <span class="scb-lang">{lang ?? 'code'}</span>
    {#if collapsible}
      <span class="scb-meta">{totalLines} lines</span>
    {/if}
    <span class="scb-spacer"></span>
    {#if collapsible}
      <button
        type="button"
        class="scb-btn"
        onclick={() => expanded = !expanded}
        title={expanded ? 'Collapse' : `Expand (${totalLines} lines)`}
      >{expanded ? '▴ collapse' : `▾ expand (${totalLines})`}</button>
    {/if}
    <button
      type="button"
      class="scb-btn"
      onclick={copy}
      title="Copy"
    >{copied ? '✓ copied' : 'copy'}</button>
  </header>
  <div
    class="scb-body"
    class:scb-collapsed={collapsible && !expanded}
    style:--collapsed-px="{COLLAPSED_PX}px"
  >
    {#if html}
      {@html html}
    {:else if highlightError}
      <pre class="scb-fallback"><code>{content}</code></pre>
    {:else}
      <!-- highlighter still loading on first paint — show plain pre so layout
           is stable and code is readable while shiki streams in. -->
      <pre class="scb-fallback"><code>{content}</code></pre>
    {/if}
    {#if collapsible && !expanded}
      <button
        type="button"
        class="scb-fade-cta"
        onclick={() => expanded = true}
        title={`Show all ${totalLines} lines`}
      >show all {totalLines}</button>
    {/if}
  </div>
</div>

<style>
  .scb {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--card-border);
    background: var(--bg);
    margin: 0.1rem 0;
    overflow: hidden;
    min-width: 0;
  }
  .scb-hdr {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 4px 8px;
    border-bottom: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--text-primary) 4%, transparent);
  }
  .scb-lang {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .scb-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
  }
  .scb-spacer { flex: 1; }
  .scb-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
  }
  .scb-btn:hover { color: var(--accent); border-color: var(--accent); }

  .scb-body {
    position: relative;
    overflow-x: auto;
    overflow-y: hidden;
    transition: max-height 180ms ease;
  }
  .scb-collapsed {
    max-height: var(--collapsed-px);
    overflow-y: hidden;
  }
  .scb-collapsed::after {
    /* Soft fade at the bottom so it's clear there's more code below. */
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 36px;
    background: linear-gradient(to bottom, transparent, var(--bg));
    pointer-events: none;
  }

  /* shiki output: reset its inline styles so our padding/sizing wins,
     keep the highlight colours via CSS variables. */
  .scb-body :global(pre.shiki) {
    margin: 0 !important;
    padding: 8px 10px !important;
    font-family: var(--font-mono), 'Menlo', 'Monaco', monospace !important;
    font-size: 11px !important;
    line-height: 1.55 !important;
    background: var(--bg) !important;
    color: var(--text-primary);
    overflow-x: auto;
  }
  .scb-body :global(pre.shiki code) {
    font-family: inherit !important;
    font-size: inherit !important;
    background: transparent !important;
  }
  /* Default-color is off so shiki emits style="color: var(--shiki-light); ..."
     which we toggle by CSS prefers-color-scheme below. */
  .scb-body :global(pre.shiki) {
    color: var(--shiki-light, var(--text-primary));
    background-color: var(--shiki-light-bg, var(--bg)) !important;
  }
  .scb-body :global(pre.shiki span) {
    color: var(--shiki-light, inherit);
  }
  @media (prefers-color-scheme: dark) {
    .scb-body :global(pre.shiki) {
      color: var(--shiki-dark, var(--text-primary));
      background-color: var(--shiki-dark-bg, var(--bg)) !important;
    }
    .scb-body :global(pre.shiki span) {
      color: var(--shiki-dark, inherit);
    }
  }

  .scb-fallback {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono), 'Menlo', 'Monaco', monospace;
    font-size: 11px;
    line-height: 1.55;
    overflow-x: auto;
    white-space: pre;
  }
  .scb-fallback code {
    font-family: inherit;
    font-size: inherit;
    background: transparent;
    padding: 0;
  }

  .scb-fade-cta {
    position: absolute;
    inset: auto 0 4px 0;
    margin: 0 auto;
    width: fit-content;
    padding: 3px 12px;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--text-primary);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
    z-index: 1;
  }
  .scb-fade-cta:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }
</style>
