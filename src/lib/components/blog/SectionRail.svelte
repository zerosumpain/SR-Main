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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Update the URL without a navigation, so the section is linkable and the
    // back button still leaves the article.
    history.replaceState(null, '', `#${id}`);
    activeId = id;
    open = false;
  }
</script>

{#if toc.length > 1}
  <nav class="section-rail" class:open aria-label="Article sections">
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
  .section-rail {
    align-self: start;
    position: sticky;
    top: 4.5rem;
    max-height: calc(100vh - 7rem);
    overflow-y: auto;
    /* The rail scrolls independently on a long outline; a horizontal scrollbar
       here would clip the text, so wrapping is on and overflow-x is never set.
       (An overflow-x:auto on a container clips BOTH axes.) */
  }

  .rail-toggle {
    display: none;
  }

  .rail-heading {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin: 0 0 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--card-border);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    margin-bottom: 0.15rem;
  }

  li.sub a {
    padding-left: 0.85rem;
    font-size: var(--fs-label-xs);
  }

  a {
    display: block;
    padding: 0.3rem 0 0.3rem 0.6rem;
    border-left: 2px solid transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.15s ease-out, border-color 0.15s ease-out;
  }

  a:hover {
    color: var(--text-primary);
    border-left-color: var(--card-border);
  }

  a.active {
    color: var(--accent);
    border-left-color: var(--accent);
  }

  /* Below the grid's rail breakpoint the outline becomes a disclosure above the
     body. Sticky is dropped with it — a sticky panel on a phone eats the
     screen the article is supposed to be using. */
  @media (max-width: 1180px) {
    .section-rail {
      position: static;
      max-height: none;
      overflow: visible;
      margin-bottom: 2rem;
      border: 1px solid var(--card-border);
    }

    .rail-toggle {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.6rem 0.85rem;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: var(--fs-label-xs);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      cursor: pointer;
    }

    .rail-count {
      color: var(--text-muted);
    }

    .rail-list {
      display: none;
      padding: 0 0.85rem 0.85rem;
    }

    .section-rail.open .rail-list {
      display: block;
    }

    .rail-heading {
      display: none;
    }
  }

  @media print {
    .section-rail {
      display: none;
    }
  }
</style>
