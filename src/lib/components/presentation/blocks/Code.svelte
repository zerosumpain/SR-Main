<script module lang="ts">
  /**
   * Shared shiki highlighter — one instance per page, reused across all code
   * blocks; grammars lazy-load per language (same pattern as
   * $lib/canvas/nodes/ShikiCodeBlock.svelte). Decks are always paper-light,
   * so only the light theme loads.
   */
  import type { Highlighter } from 'shiki';

  let highlighterPromise: Promise<Highlighter> | null = null;

  function getHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
      highlighterPromise = (async () => {
        const { createHighlighter } = await import('shiki');
        return createHighlighter({ themes: ['vitesse-light'], langs: [] });
      })();
    }
    return highlighterPromise;
  }
</script>

<script lang="ts">
  import type { CodeBlock } from '$lib/presentation/types';

  let { block }: { block: CodeBlock } = $props();

  let html = $state<string | null>(null);

  // Re-highlight on content/lang changes; any shiki failure (unknown lang,
  // SSR, load error) falls back to the plain <pre> below — never blank space.
  $effect(() => {
    const code = block.code;
    const want = (block.lang ?? '').toLowerCase().trim() || 'text';
    let cancelled = false;
    (async () => {
      try {
        const h = await getHighlighter();
        let lang = want;
        if (!h.getLoadedLanguages().includes(lang)) {
          try {
            await h.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0]);
          } catch {
            lang = 'text';
          }
        }
        const out = h.codeToHtml(code, { lang, theme: 'vitesse-light' });
        if (!cancelled) html = out;
      } catch {
        if (!cancelled) html = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="codeblk">
  {#if block.title || block.lang}
    <figcaption class="code-hd">
      <span class="code-title">{block.title ?? ''}</span>
      {#if block.lang}<span class="code-lang">{block.lang}</span>{/if}
    </figcaption>
  {/if}
  <div class="code-body">
    {#if html}
      {@html html}
    {:else}
      <pre class="code-plain">{block.code}</pre>
    {/if}
  </div>
  {#if block.caption}<div class="code-cap">{block.caption}</div>{/if}
</figure>

<style>
  .codeblk {
    margin: 0;
    width: 100%;
    max-width: 880px;
    border: 1px solid rgba(28, 22, 17, 0.22);
    border-radius: var(--radius-round);
    background: var(--paper-deep, var(--paper));
    overflow: hidden;
  }
  .code-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 14px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.14);
  }
  .code-title,
  .code-lang,
  .code-cap {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .code-lang { color: var(--accent-ink); }
  .code-body {
    max-height: 480px;
    overflow: auto;
  }
  /* shiki emits <pre class="shiki"> with its own theme background — decks
     supply the paper, shiki supplies the ink. */
  .code-body :global(pre) {
    margin: 0;
    padding: 16px 18px;
    background: transparent !important;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    line-height: 1.6;
    tab-size: 2;
  }
  .code-body :global(code) { font-family: inherit; }
  .code-cap { padding: 8px 14px 10px; }
</style>
