<script lang="ts">
  /**
   * Article body typography and layout.
   *
   * Two modes. `editorial` (the /blog reading surface) lays the body out on a
   * named grid so figures can bleed, sidenotes can sit in the margin and pull
   * quotes can break the measure. Plain mode is the old single-column
   * behaviour, kept for any surface that just wants styled prose.
   *
   * WHY THE RULES LIVE HERE AND NOT IN app.css: every selector below is
   * `.prose :global(tag)`, which Svelte compiles to `.prose.svelte-<hash> tag`
   * — specificity (0,2,1). A `.prose p` rule written in app.css is (0,1,1) and
   * loses silently. New article typography therefore belongs in this file, or
   * as an explicit `:global()` from the route.
   *
   * The grid is declared on this element rather than on the page wrapper
   * because the elements that need placing — figures, asides, tables — are
   * children of THIS div. Grid placement follows the DOM, so a grid one level
   * up cannot reach them.
   */
  let {
    class: className = '',
    editorial = false,
    /** A `--font-*` reference from $lib/blog/fonts. */
    bodyFont = 'var(--font-read)',
    children,
  }: {
    class?: string;
    editorial?: boolean;
    bodyFont?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<div class="prose {className}" class:editorial style="--prose-font: {bodyFont};">
  {@render children()}
</div>

<style>
  /* ---------------------------------------------------------------------
     The editorial grid.

     Column names, outside in: `bleed` is the full width of the container,
     `wide` breaks the measure without reaching the edges, `main` is the
     reading column, and `note` is the right margin where sidenotes land.

     Every child defaults to `main`. Opting out is a class on the element,
     and the sanitiser's allowedClasses is what decides which of those class
     names an author may actually use.
     --------------------------------------------------------------------- */
  .prose.editorial {
    --measure: var(--reader-measure, 39rem);
    --note-col: 15rem;
    --rail-col: 13rem;
    --col-gap: 2.75rem;

    display: grid;
    grid-template-columns:
      [bleed-start] minmax(1.25rem, 1fr)
      [rail-start] minmax(0, var(--rail-col))
      [rail-end] var(--col-gap)
      [wide-start main-start] minmax(0, var(--measure))
      [main-end] var(--col-gap)
      [note-start] minmax(0, var(--note-col))
      [note-end wide-end] minmax(1.25rem, 1fr)
      [bleed-end];
  }

  .prose.editorial > :global(*) {
    grid-column: main;
    min-width: 0;
  }

  /* Full-bleed: edge to edge of the container. The grain overlay in app.css
     paints at z-index 100 over everything, so a bleed image is textured like
     the rest of the page rather than looking pasted on. */
  .prose.editorial > :global(figure.bleed) {
    grid-column: bleed;
    margin: 3.5rem 0;
  }

  .prose.editorial > :global(figure.bleed img),
  .prose.editorial > :global(figure.bleed video) {
    width: 100%;
    max-height: 78vh;
    object-fit: cover;
    border: none;
  }

  .prose.editorial > :global(figure.bleed figcaption) {
    max-width: var(--measure);
    margin-left: auto;
    margin-right: auto;
    padding: 0 1.25rem;
  }

  /* Wide: breaks the measure, keeps the page margins. For diagrams, tables
     and code that a 39rem column strangles. */
  .prose.editorial > :global(figure.wide),
  .prose.editorial > :global(section.interactive),
  .prose.editorial > :global(pre),
  .prose.editorial > :global(table) {
    grid-column: wide;
  }

  /* Floated figures sit inside the measure and let text run beside them. */
  .prose.editorial > :global(figure.align-left),
  .prose.editorial > :global(figure.align-right) {
    grid-column: main;
    width: 55%;
    margin-top: 0.4em;
  }

  .prose.editorial > :global(figure.align-left) {
    float: left;
    margin-right: 1.75rem;
  }

  .prose.editorial > :global(figure.align-right) {
    float: right;
    margin-left: 1.75rem;
  }

  /* ---------------------------------------------------------------------
     Body copy
     --------------------------------------------------------------------- */
  .prose {
    font-family: var(--prose-font, var(--font-body));
  }

  .prose :global(p) {
    margin-bottom: 1.4em;
    line-height: 1.75;
    font-size: 1.0625rem;
    color: var(--text-secondary);
  }

  .prose.editorial :global(p),
  .prose.editorial :global(li) {
    /* Scaled by the reader's own type-size control. The unscaled value is
       18px — a genuine long-form reading size rather than UI copy. */
    font-size: calc(var(--fs-body-lg) * var(--reader-scale, 1));
    line-height: 1.72;
    color: var(--text-primary);
    /* Hyphenation earns its keep at this measure: without it a 39rem column
       of Selawik opens visible rivers on long technical words. */
    hyphens: auto;
    -webkit-hyphens: auto;
  }

  .prose.editorial :global(p) {
    margin-bottom: 1.35em;
  }

  /* ---------------------------------------------------------------------
     Headings. h4-h6 were admitted by the sanitiser and styled by nothing,
     so the deepest level in a long feature rendered as body copy.
     --------------------------------------------------------------------- */
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin-top: 2em;
    margin-bottom: 0.5em;
  }

  .prose :global(h2) {
    font-size: 1.5rem;
  }

  .prose :global(h3) {
    font-size: 1.25rem;
  }

  .prose.editorial :global(h2) {
    font-size: calc(1.75rem * var(--reader-scale, 1));
    margin-top: 2.4em;
    padding-top: 1.1rem;
    border-top: 2px solid var(--line-strong);
    /* The rail's scroll-spy scrolls headings to the top of the viewport; the
       sticky article bar would otherwise cover them. */
    scroll-margin-top: calc(var(--site-nav-height, 48px) + 3.5rem);
  }

  .prose.editorial :global(h3) {
    font-size: calc(1.3125rem * var(--reader-scale, 1));
    margin-top: 2em;
    scroll-margin-top: calc(var(--site-nav-height, 48px) + 3.5rem);
  }

  .prose :global(h4) {
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-top: 2em;
    margin-bottom: 0.4em;
  }

  .prose :global(h5),
  .prose :global(h6) {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-top: 1.6em;
    margin-bottom: 0.35em;
  }

  /* ---------------------------------------------------------------------
     Links, code, quotes
     --------------------------------------------------------------------- */
  .prose :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }

  .prose :global(a:hover) {
    color: var(--accent-hover);
  }

  .prose :global(code) {
    font-family: var(--font-code);
    font-size: max(0.875em, var(--fs-label-xs));
    padding: 0.2em 0.5em;
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
  }

  .prose :global(pre) {
    padding: 1.25em 1.5em;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    line-height: 1.6;
    background: var(--card-bg);
    border: 2px solid var(--line-strong);
  }

  .prose :global(pre code) {
    padding: 0;
    background: none;
    border: none;
  }

  .prose :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1.25em;
    margin: 1.5em 0;
    font-style: italic;
    color: var(--text-muted);
  }

  /* ---------------------------------------------------------------------
     Editorial furniture
     --------------------------------------------------------------------- */

  /* Pull quote — a line lifted out of the body, set large. It is decorative
     repetition, so it is hidden from assistive tech by the author writing it
     as an <aside>; screen readers still meet the original sentence in place. */
  .prose.editorial > :global(aside.pull-quote) {
    grid-column: main;
    margin: 2.5rem 0;
    padding: 1.25rem 0;
    border-top: 2px solid var(--accent);
    border-bottom: 2px solid var(--accent);
    font-family: var(--font-display);
    font-size: calc(1.5rem * var(--reader-scale, 1));
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-transform: none;
    color: var(--text-primary);
  }

  .prose.editorial > :global(aside.callout),
  .prose.editorial > :global(aside.callout-note),
  .prose.editorial > :global(aside.callout-warn),
  .prose.editorial > :global(aside.callout-aside),
  .prose.editorial > :global(aside.callout-key) {
    grid-column: main;
    margin: 2rem 0;
    padding: 1.1rem 1.3rem;
    background: var(--card-bg);
    border-left: 3px solid var(--accent-ink);
    font-size: calc(var(--fs-body) * var(--reader-scale, 1));
    line-height: 1.6;
    color: var(--text-primary);
  }

  .prose.editorial > :global(aside.callout-warn) {
    border-left-color: var(--warn);
  }

  /* Key point — the one thing to take away. Reads as EMPHASIS rather than as
     an interruption, which is what separates it from a note: the accent rule is
     the full height and the type is the reading face at body size, so the eye
     lands on it without being stopped by it. */
  .prose.editorial > :global(aside.callout-key) {
    border-left-width: 4px;
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--card-bg));
    font-size: calc(var(--fs-body) * 1.05 * var(--reader-scale, 1));
  }

  .prose.editorial > :global(aside.callout-aside) {
    border-left-color: var(--card-border);
    color: var(--text-muted);
  }

  .prose.editorial > :global(aside p:last-child),
  .prose.editorial > :global(aside p:only-child) {
    margin-bottom: 0;
  }

  /* Sidenotes.
     The body floats into the right margin using a negative margin equal to
     the note column plus the gap, which is the classic margin-note trick and
     the only one that works for an element sitting inline inside a <p>: a
     grid column cannot be addressed from three levels down. */
  .prose.editorial :global(.sidenote) {
    counter-increment: sidenote;
  }

  .prose.editorial :global(.sidenote::before) {
    content: counter(sidenote);
    font-family: var(--font-mono);
    font-size: max(0.7em, var(--fs-label-xs));
    vertical-align: super;
    line-height: 0;
    color: var(--accent);
    padding-left: 0.1em;
  }

  .prose.editorial {
    counter-reset: sidenote;
  }

  .prose.editorial :global(.sidenote-body) {
    float: right;
    clear: right;
    width: var(--note-col);
    margin-right: calc(-1 * (var(--note-col) + var(--col-gap)));
    margin-bottom: 1rem;
    padding-left: 0.75rem;
    border-left: 1px solid var(--card-border);
    font-size: max(0.8125rem, var(--fs-label));
    line-height: 1.5;
    color: var(--text-muted);
    text-align: left;
    hyphens: none;
  }

  .prose.editorial :global(.sidenote-body::before) {
    content: counter(sidenote) '  ';
    font-family: var(--font-mono);
    color: var(--accent);
  }

  /* Standfirst — the intro that sets the piece up, before the piece starts.
     Larger than the body and set in the reading face, not the display one: it
     is still prose being read, not a headline being scanned. */
  .prose.editorial > :global(aside.standfirst) {
    grid-column: main;
    margin: 0 0 2rem;
    padding-left: 1rem;
    border-left: 3px solid var(--accent);
    font-size: calc(1.15rem * var(--reader-scale, 1));
    line-height: 1.55;
    color: var(--text-secondary);
  }

  /* Highlight — a marker pen for a phrase. Transparent-tinted rather than a
     flat block colour so it works over the cream ground and the two reading
     themes without a per-theme override, and so overlapping it with a link
     leaves the link readable. */
  .prose :global(mark),
  .prose :global(mark.hl) {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: inherit;
    padding: 0.05em 0.15em;
    border-radius: 2px;
  }

  .prose :global(mark.hl-warm) {
    background: color-mix(in srgb, var(--warn, #b4632e) 22%, transparent);
  }

  .prose :global(mark.hl-cool) {
    background: color-mix(in srgb, var(--accent-ink) 18%, transparent);
  }

  /* The inline citation marker. One superscript numeral, muted — the whole
     point of moving sources to the footer is that the prose stops carrying a
     bibliography, so this must not become a second one. */
  .prose :global(sup.ref-mark) {
    font-family: var(--font-mono);
    font-size: max(0.7em, var(--fs-label-xs));
    line-height: 1;
    margin-left: 0.1em;
  }

  .prose :global(sup.ref-mark a) {
    color: var(--text-muted);
    text-decoration: none;
    border: none;
  }

  .prose :global(sup.ref-mark a:hover) {
    color: var(--accent);
  }

  .prose :global(.small-caps) {
    font-variant-caps: all-small-caps;
    letter-spacing: 0.06em;
  }

  /* Interactive sections and <details> — the "interactive" ask, done with
     elements the sanitiser can actually admit. */
  .prose :global(details) {
    margin: 1.75rem 0;
    border: 2px solid var(--line-strong);
    background: var(--card-bg);
  }

  .prose :global(details summary) {
    padding: 0.7rem 1rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-primary);
    list-style: none;
  }

  .prose :global(details summary::-webkit-details-marker) {
    display: none;
  }

  .prose :global(details summary::before) {
    content: '+';
    display: inline-block;
    width: 1.1em;
    color: var(--accent);
  }

  .prose :global(details[open] summary::before) {
    content: '−';
  }

  .prose :global(details > *:not(summary)) {
    padding: 0 1rem;
  }

  .prose :global(details > *:last-child) {
    padding-bottom: 0.9rem;
  }

  .prose.editorial > :global(section.interactive) {
    margin: 2.5rem 0;
    padding: 1.5rem;
    border: 2px solid var(--line-strong);
    background: var(--bg-section);
  }

  /* ---------------------------------------------------------------------
     Tables. Admitted by the sanitiser defaults and styled by nothing, so a
     table rendered as Tailwind-preflight-reset text with no rules at all.
     --------------------------------------------------------------------- */
  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 2rem 0;
    font-size: max(0.9375rem, var(--fs-body-sm));
  }

  .prose :global(th) {
    text-align: left;
    padding: 0.55rem 0.75rem;
    border-bottom: 2px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .prose :global(td) {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--card-border);
    color: var(--text-secondary);
    vertical-align: top;
  }

  .prose :global(tr:last-child td) {
    border-bottom: none;
  }

  /* ---------------------------------------------------------------------
     Lists. Tailwind's preflight strips markers globally — restore them here.
     --------------------------------------------------------------------- */
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1.25em;
  }

  .prose :global(ul) {
    list-style: disc;
  }

  .prose :global(ul ul) {
    list-style: circle;
    margin-top: 0.5em;
    margin-bottom: 0;
  }

  .prose :global(ol) {
    list-style: decimal;
  }

  .prose :global(ol ol) {
    margin-top: 0.5em;
    margin-bottom: 0;
  }

  .prose :global(li) {
    margin-bottom: 0.5em;
    line-height: 1.75;
    font-size: 1.0625rem;
    color: var(--text-secondary);
  }

  .prose :global(li::marker) {
    color: var(--accent);
  }

  .prose :global(ol > li::marker) {
    font-family: var(--font-mono);
  }

  /* ---------------------------------------------------------------------
     Figures and media
     --------------------------------------------------------------------- */
  .prose :global(img) {
    max-width: 100%;
    margin: 1.5em 0;
    border: 1px solid var(--card-border);
  }

  .prose :global(video) {
    max-width: 100%;
    width: 100%;
    margin: 1.5em 0;
    border: 1px solid var(--card-border);
    background: var(--text-primary);
  }

  .prose :global(figure) {
    margin: 2em 0;
  }

  .prose :global(figure img),
  .prose :global(figure video) {
    margin: 0;
  }

  .prose :global(figcaption) {
    margin-top: 0.6em;
    font-family: var(--font-mono);
    font-size: max(0.8125rem, var(--fs-label-xs));
    color: var(--text-muted);
  }

  /* A gallery of images side by side, wrapping on narrow screens. */
  .prose :global(figure.gallery) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
  }

  .prose :global(figure.gallery img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .prose :global(figure.gallery figcaption) {
    grid-column: 1 / -1;
  }

  .prose :global(figure.project-embed) {
    border: 2px solid var(--line-strong);
    background: var(--card-bg);
  }

  .prose :global(figure.project-embed iframe) {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    border: 0;
  }

  .prose :global(figure.project-embed figcaption) {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-top: 2px solid var(--line-strong);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .prose :global(figure.project-embed figcaption a) {
    color: var(--accent);
    text-decoration: none;
  }

  .prose :global(figure.project-embed figcaption a:hover) {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .prose :global(hr) {
    border: none;
    height: 2px;
    background: var(--text-primary);
    opacity: 0.08;
    margin: 2em 0;
  }

  .prose.editorial > :global(hr) {
    /* An asterism rather than a rule — a section break inside a feature is a
       pause, not a divider. */
    height: auto;
    background: none;
    opacity: 1;
    margin: 2.75rem 0;
    text-align: center;
  }

  .prose.editorial > :global(hr::before) {
    content: '❋';
    font-size: var(--fs-body);
    color: var(--accent);
  }

  /* ---------------------------------------------------------------------
     Narrow screens: the grid collapses to one column and the margin notes
     become inset blocks. A floated note in a 22rem viewport is unreadable.
     --------------------------------------------------------------------- */
  @media (max-width: 1180px) {
    .prose.editorial {
      grid-template-columns:
        [bleed-start] minmax(1.25rem, 1fr)
        [wide-start main-start] minmax(0, var(--measure))
        [main-end wide-end] minmax(1.25rem, 1fr)
        [bleed-end];
    }

    .prose.editorial :global(.sidenote-body) {
      float: none;
      width: auto;
      margin-right: 0;
      margin: 0.75rem 0 1.25rem;
      padding: 0.6rem 0 0.6rem 0.9rem;
      background: var(--card-bg);
      display: block;
    }

    .prose.editorial > :global(figure.align-left),
    .prose.editorial > :global(figure.align-right) {
      float: none;
      width: 100%;
      margin-left: 0;
      margin-right: 0;
    }
  }

  @media print {
    .prose.editorial {
      display: block;
    }

    .prose :global(details) {
      border: none;
    }
  }
</style>
