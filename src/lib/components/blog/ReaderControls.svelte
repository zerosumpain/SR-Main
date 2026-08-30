<script lang="ts">
  /**
   * Reader comfort controls — type size, measure width, and reading theme.
   *
   * The author picks the face the article is set in; the reader keeps control
   * of everything that decides whether it is comfortable to read for twenty
   * minutes. Both halves matter and they are different jobs.
   *
   * Persistence is deliberately localStorage and deliberately per-browser.
   * These are preferences about one person's eyes on one screen — there is
   * nothing to sync, nothing worth a round trip, and nobody to attribute them
   * to. `blog-assistant-auto` in the editor sets the same precedent.
   *
   * The theme attribute goes on <html> rather than on the article, because the
   * page background is painted by <body> and a night theme that leaves a cream
   * page around a dark column is worse than no night theme at all. It is
   * removed on destroy so it can never follow the reader off /blog.
   */
  import { onMount } from 'svelte';

  const STORAGE_KEY = 'sr-reading-prefs';

  type Theme = 'paper' | 'sepia' | 'night';

  const SIZES = [
    { key: 'sm', label: 'S', scale: 0.9375 },
    { key: 'md', label: 'M', scale: 1 },
    { key: 'lg', label: 'L', scale: 1.125 },
    { key: 'xl', label: 'XL', scale: 1.25 },
  ] as const;

  const MEASURES = [
    { key: 'narrow', label: 'Narrow', rem: 34 },
    { key: 'default', label: 'Default', rem: 39 },
    { key: 'wide', label: 'Wide', rem: 46 },
  ] as const;

  const THEMES: { key: Theme; label: string }[] = [
    { key: 'paper', label: 'Paper' },
    { key: 'sepia', label: 'Sepia' },
    { key: 'night', label: 'Night' },
  ];

  let size = $state<(typeof SIZES)[number]['key']>('md');
  let measure = $state<(typeof MEASURES)[number]['key']>('default');
  let theme = $state<Theme>('paper');
  let open = $state(false);
  /** Nothing is applied until the stored value has been read, so the first
   *  paint cannot flash the default and then jump. */
  let ready = $state(false);

  const scale = $derived(SIZES.find((s) => s.key === size)?.scale ?? 1);
  const measureRem = $derived(MEASURES.find((m) => m.key === measure)?.rem ?? 39);

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{ size: string; measure: string; theme: string }>;
        if (SIZES.some((s) => s.key === saved.size)) size = saved.size as typeof size;
        if (MEASURES.some((m) => m.key === saved.measure)) measure = saved.measure as typeof measure;
        if (THEMES.some((t) => t.key === saved.theme)) theme = saved.theme as Theme;
      }
    } catch {
      // A private window, cleared site data, or storage disabled entirely.
      // Defaults are correct in every one of those cases.
    }
    ready = true;

    return () => {
      // Never let a night theme follow the reader onto the rest of the site.
      document.documentElement.removeAttribute('data-reading-theme');
    };
  });

  // Reads only the three preference signals and writes to the DOM and to
  // storage — never reads back what it wrote, so there is no cycle here.
  $effect(() => {
    if (!ready) return;
    const next = { size, measure, theme };
    document.documentElement.setAttribute('data-reading-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preferences that cannot be saved still apply for this visit.
    }
  });

  function reset() {
    size = 'md';
    measure = 'default';
    theme = 'paper';
  }
</script>

<!-- The custom properties the article grid reads. Set on a wrapper rather than
     on :root so the controls cannot affect anything outside the article. -->
<div
  class="reader-scope"
  style="--reader-scale: {scale}; --reader-measure: {measureRem}rem;"
  data-ready={ready}
>
  <div class="reader-controls" class:open>
    <button
      class="rc-toggle"
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-controls="reader-controls-panel"
      title="Reading preferences"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M2 4h12M2 8h9M2 12h6"
          stroke="currentColor"
          stroke-width="1.6"
          fill="none"
          stroke-linecap="square"
        />
      </svg>
      <span class="rc-toggle-label">Reading</span>
    </button>

    {#if open}
      <div class="rc-panel" id="reader-controls-panel">
        <div class="rc-group">
          <span class="rc-label">Text size</span>
          <div class="rc-options" role="group" aria-label="Text size">
            {#each SIZES as s (s.key)}
              <button class="rc-opt" class:active={size === s.key} onclick={() => (size = s.key)}>
                {s.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="rc-group">
          <span class="rc-label">Column</span>
          <div class="rc-options" role="group" aria-label="Column width">
            {#each MEASURES as m (m.key)}
              <button class="rc-opt" class:active={measure === m.key} onclick={() => (measure = m.key)}>
                {m.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="rc-group">
          <span class="rc-label">Theme</span>
          <div class="rc-options" role="group" aria-label="Reading theme">
            {#each THEMES as t (t.key)}
              <button class="rc-opt" class:active={theme === t.key} onclick={() => (theme = t.key)}>
                {t.label}
              </button>
            {/each}
          </div>
        </div>

        <button class="rc-reset" onclick={reset}>Reset</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .reader-scope {
    display: contents;
  }

  .reader-controls {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .rc-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.6rem;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    cursor: pointer;
    transition: color 0.15s ease-out, border-color 0.15s ease-out;
  }

  .rc-toggle:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .rc-panel {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    z-index: 40;
    min-width: 15rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.9rem;
    /* Opaque, not a tint — --card-bg is 7% ink and would show the article
       through the panel. */
    background: var(--surface-elevated, var(--bg));
    border: 2px solid var(--line-strong);
  }

  .rc-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .rc-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .rc-options {
    display: flex;
    gap: 0.3rem;
  }

  .rc-opt {
    flex: 1;
    padding: 0.35rem 0.5rem;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
    transition: all 0.15s ease-out;
  }

  .rc-opt:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .rc-opt.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .rc-reset {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .rc-reset:hover {
    color: var(--accent);
  }

  @media (max-width: 640px) {
    .rc-toggle-label {
      display: none;
    }
  }
</style>
