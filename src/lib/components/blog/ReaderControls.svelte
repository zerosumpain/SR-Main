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

  type Column = 'narrow' | 'default' | 'wide';

  let {
    scale = $bindable(1),
    column = $bindable<Column>('default'),
  }: {
    /** The chosen text size as a multiplier, written up to the page, which
     *  sets `--reader-scale` on the ARTICLE. (These used to be set on a
     *  `display: contents` wrapper round the controls alone, so the article
     *  never saw them and the size and column choices did nothing.) */
    scale?: number;
    /** The chosen column, written up to the page, which turns it into a
     *  measure for the post's own face (a monospaced face needs a wider
     *  column for the same number of characters). */
    column?: Column;
  } = $props();

  const STORAGE_KEY = 'sr-reading-prefs';

  type Theme = 'paper' | 'sepia' | 'night';

  const SIZES = [
    { key: 'sm', label: 'S', name: 'Small', scale: 0.9375 },
    { key: 'md', label: 'M', name: 'Medium', scale: 1 },
    { key: 'lg', label: 'L', name: 'Large', scale: 1.125 },
    { key: 'xl', label: 'XL', name: 'Extra large', scale: 1.25 },
  ] as const;

  const MEASURES = [
    { key: 'narrow', label: 'Narrow' },
    { key: 'default', label: 'Default' },
    { key: 'wide', label: 'Wide' },
  ] as const;

  const THEMES: { key: Theme; label: string }[] = [
    { key: 'paper', label: 'Paper' },
    { key: 'sepia', label: 'Sepia' },
    { key: 'night', label: 'Night' },
  ];

  let size = $state<(typeof SIZES)[number]['key']>('md');
  let measure = $state<Column>('default');
  let theme = $state<Theme>('paper');
  let open = $state(false);
  /** Nothing is applied until the stored value has been read, so the first
   *  paint cannot flash the default and then jump. */
  let ready = $state(false);

  const chosenScale = $derived(SIZES.find((s) => s.key === size)?.scale ?? 1);

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
    scale = chosenScale;
    column = measure;
    document.documentElement.setAttribute('data-reading-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preferences that cannot be saved still apply for this visit.
    }
  });

  // The panel closes as a popover does: Escape (focus goes back to the
  // toggle), or a click or tap anywhere outside it. On a phone the open card
  // lies over the contents slip, so a tap on the page has to put it away.
  let root = $state<HTMLElement | null>(null);
  let toggle = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      open = false;
      toggle?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (root && e.target instanceof Node && !root.contains(e.target)) open = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });

  function reset() {
    size = 'md';
    measure = 'default';
    theme = 'paper';
  }
</script>

<!-- The size and column go up to the page through `scale` and `column`; the
     page sets them on the article, the only thing they should reach. -->
<div class="reader-scope" data-ready={ready}>
  <div class="reader-controls" class:open bind:this={root}>
    <button
      class="rc-toggle"
      bind:this={toggle}
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-controls="reader-controls-panel"
      aria-label="Reading preferences"
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
              <button
                class="rc-opt"
                class:active={size === s.key}
                aria-pressed={size === s.key}
                aria-label={s.name}
                onclick={() => (size = s.key)}
              >
                {s.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="rc-group">
          <span class="rc-label">Column</span>
          <div class="rc-options" role="group" aria-label="Column width">
            {#each MEASURES as m (m.key)}
              <button
                class="rc-opt"
                class:active={measure === m.key}
                aria-pressed={measure === m.key}
                onclick={() => (measure = m.key)}
              >
                {m.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="rc-group">
          <span class="rc-label">Theme</span>
          <div class="rc-options" role="group" aria-label="Reading theme">
            {#each THEMES as t (t.key)}
              <button
                class="rc-opt"
                class:active={theme === t.key}
                aria-pressed={theme === t.key}
                onclick={() => (theme = t.key)}
              >
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
  /* Notes paper: a mono "Reading" tab one rule tall (its hit area grows to
     44px with a pseudo-element, so the rule it sits on is not disturbed), and
     the panel an index card laid over the page. Ink and petrol only: the
     orange is for marks, never for text on the cream (it reads at 3.5:1). */
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
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    height: var(--np-l, 32px);
    /* 44px wide even when a phone hides the label and leaves the icon; the
       hit area below makes it 44px tall without leaving its rule. */
    min-width: 44px;
    padding: 0 0.6rem;
    background: var(--np-card, var(--surface-card));
    border: none;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--np-pen-ink, var(--accent-ink));
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    cursor: pointer;
  }

  .rc-toggle::after {
    content: '';
    position: absolute;
    inset: calc((44px - 100%) / -2) 0;
    min-height: 44px;
  }

  .rc-toggle:hover,
  .reader-controls.open .rc-toggle {
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--np-pen-ink, var(--accent-ink));
  }

  .rc-panel {
    position: absolute;
    top: calc(100% + 0.75rem);
    right: 0;
    z-index: 40;
    min-width: 15rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem 1rem 0.9rem;
    /* An index card: opaque stock, a red head rule, a lift off the page. */
    background:
      linear-gradient(var(--np-margin-a, var(--accent)), var(--np-margin-a, var(--accent))) 0 2.6rem / 100% 1px no-repeat,
      var(--np-card, var(--surface-card));
    border: 1px solid var(--line-strong);
    box-shadow: 0 14px 28px -16px rgba(26, 16, 8, 0.45);
    text-align: left;
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
    letter-spacing: 0.14em;
    color: var(--np-pen-ink, var(--accent-ink));
  }

  .rc-options {
    display: flex;
    gap: 0.3rem;
  }

  .rc-opt {
    flex: 1;
    min-height: 44px;
    padding: 0 0.5rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 100px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }

  .rc-opt:hover {
    color: var(--text-primary);
    border-color: var(--line-strong);
  }

  /* The chosen option is ringed in the orange pen, as a choice is ringed on
     a form; the word itself stays ink. */
  .rc-opt.active {
    border: 1.5px solid var(--np-pen, var(--accent));
    color: var(--text-primary);
    font-weight: 500;
  }

  .rc-reset {
    align-self: flex-start;
    min-height: 44px;
    background: none;
    border: none;
    padding: 0;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    text-decoration: underline;
    text-underline-offset: 4px;
    cursor: pointer;
  }

  .rc-reset:hover {
    color: var(--np-pen-ink, var(--accent-ink));
  }

  .rc-toggle:focus-visible,
  .rc-reset:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }

  /* The options keep their pill outline shape when focused. */
  .rc-opt:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
  }

  @media (max-width: 640px) {
    .rc-toggle-label {
      display: none;
    }
  }

  @media print {
    .reader-controls {
      display: none;
    }
  }
</style>
