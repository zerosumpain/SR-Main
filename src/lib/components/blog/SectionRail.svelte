<script lang="ts">
  /**
   * The section outline, with scroll-spy.
   *
   * Sits in the article grid's left rail on wide screens and collapses to a
   * disclosure above the body on narrow ones. Entries come from
   * `renderArticle`, which assigns the heading ids server-side — the rail never
   * writes to the document, it only observes it.
   *
   * The IntersectionObserver is a plain `let`. It is created and disconnected
   * by the same lifecycle function; making it `$state` would put a read and a
   * write of the same reactive value inside one function and loop the effect.
   */
  import { onMount } from 'svelte';
  import type { TocEntry } from '$lib/blog/renderer';
  import { snapToRule } from '$lib/components/notes-paper/snap';

  let { toc }: { toc: TocEntry[] } = $props();

  let activeId = $state<string | null>(null);
  let open = $state(false);

  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (!toc.length) return;

    // Track which headings are on screen and treat the topmost as current.
    // A plain "last one crossed" test picks the wrong heading when the reader
    // scrolls up, and a midpoint test flickers between two adjacent headings.
    const visible = new Set<string>();

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // Document order is the toc order, so the first toc entry still in the
        // visible set is the topmost one on screen.
        const first = toc.find((t) => visible.has(t.id));
        if (first) {
          activeId = first.id;
        } else if (!activeId) {
          activeId = toc[0].id;
        }
      },
      {
        // A band across the upper third: a heading is "current" from the moment
        // it reaches the top area until the next one displaces it.
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0,
      },
    );

    for (const entry of toc) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }

    return () => {
      observer?.disconnect();
      observer = null;
    };
  });

  function go(event: MouseEvent, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    // No glide for a reader who has asked the page to keep still.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    // Update the URL without a navigation, so the section is linkable and the
    // back button still leaves the article.
    history.replaceState(null, '', `#${id}`);
    activeId = id;
    open = false;
  }
</script>

{#if toc.length > 1}
  <nav class="section-rail" class:open aria-label="Article sections" use:snapToRule>
    <button class="rail-toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <span>Contents</span>
      <span class="rail-count">{toc.length}</span>
    </button>

    <div class="rail-list">
      <p class="rail-heading">Contents</p>
      <ul>
        {#each toc as entry (entry.id)}
          <li class:sub={entry.level === 3}>
            <a
              href="#{entry.id}"
              class:active={activeId === entry.id}
              onclick={(e) => go(e, entry.id)}
            >
              {entry.text}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </nav>
{/if}

<style>
  /* Notes paper. On a wide screen the outline is an index card clipped into
     the margin: opaque card stock (so it may stick while the page's rules
     scroll under it), a red head rule under "Contents", the entries in mono,
     the current one in petrol with an orange pencil tick. The card stops short
     of the margin rule, leaving the strip beside the rule to the section
     numbers the headings set there. Below the grid's rail breakpoint it is a
     slip above the body, folded until opened: opaque card, so its inside
     need not follow the page's lines, with every entry a 44px target and the
     whole slip rounded up to whole rules by snapToRule, so the page's ruling
     runs on in step after it. The type follows the reader's text size. */
  .section-rail {
    align-self: start;
    position: sticky;
    top: 4.5rem;
    max-width: calc(100% - 3rem);
    max-height: calc(100vh - 7rem);
    overflow-y: auto;
    padding: 12px 14px 10px;
    background: var(--np-card, var(--surface-card));
    --rail-fs: max(var(--fs-label-xs), calc(var(--fs-label-xs) * var(--np-scale, 1)));
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 12px 24px -18px rgba(26, 16, 8, 0.4);
    /* The rail scrolls independently on a long outline; a horizontal scrollbar
       here would clip the text, so wrapping is on and overflow-x is never set.
       (An overflow-x:auto on a container clips BOTH axes.) */
  }

  .rail-toggle {
    display: none;
  }

  .rail-heading {
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-margin-a, var(--accent));
    font-family: var(--font-mono);
    font-size: var(--rail-fs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--np-pen-ink, var(--accent-ink));
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li.sub a {
    padding-left: 1.45rem;
  }

  /* Each entry a 44px target, however short. */
  a {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0.3rem 0 0.3rem 0.85rem;
    font-family: var(--font-mono);
    font-size: var(--rail-fs);
    line-height: 1.4;
    color: var(--text-secondary);
    text-decoration: none;
  }

  a:hover {
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 4px;
  }

  a.active {
    color: var(--np-pen-ink, var(--accent-ink));
  }

  /* The pencil tick against the current entry. */
  a.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: calc(50% - 6px);
    width: 4px;
    height: 8px;
    border-right: 2px solid var(--np-pen, var(--accent));
    border-bottom: 2px solid var(--np-pen, var(--accent));
    transform: rotate(40deg);
  }

  li.sub a.active::before {
    left: 0.6rem;
  }

  a:focus-visible,
  .rail-toggle:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }

  @media (max-width: 1180px) {
    .section-rail {
      position: static;
      max-width: none;
      max-height: none;
      overflow: visible;
      margin-bottom: var(--np-l, 32px);
      padding: 0 0 var(--np-snap, 0px);
      box-shadow: 0 0 0 1px var(--line-strong);
      background: var(--np-card, var(--surface-card));
    }

    .rail-toggle {
      position: relative;
      display: flex;
      width: 100%;
      height: var(--np-l, 32px);
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0 0.85rem;
      background: transparent;
      border: none;
      color: var(--np-pen-ink, var(--accent-ink));
      font-family: var(--font-mono);
      font-size: var(--rail-fs);
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      cursor: pointer;
    }

    .rail-toggle::after {
      content: '';
      position: absolute;
      inset: -6px 0;
    }

    .rail-count {
      color: var(--text-secondary);
    }

    .rail-list {
      display: none;
      padding: 0 0.85rem;
    }

    .section-rail.open .rail-list {
      display: block;
    }

    .rail-heading {
      display: none;
    }

    .section-rail.open .rail-list {
      padding-bottom: 6px;
    }
  }

  @media print {
    .section-rail {
      display: none;
    }
  }
</style>
