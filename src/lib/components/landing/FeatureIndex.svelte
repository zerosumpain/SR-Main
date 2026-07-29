<script lang="ts">
  import { onMount } from 'svelte';

  let { isOwner = false }: { isOwner?: boolean } = $props();

  // The non-live "everything else" — Field Studies, tools and writing that
  // don't surface a live number. A terminal-style directory listing that extends
  // the brand `>` prompt. Real routes only.
  //
  // `ownerOnly` marks a row an anonymous visitor cannot actually reach: either
  // the project is toggled private in project_visibility, or the route is behind
  // the auth gate. Those rows stay for a signed-in owner (they are useful
  // shortcuts) and are dropped for everyone else rather than shown as dead ends.
  const ITEMS: { name: string; hook: string; href: string; ownerOnly?: boolean }[] = [
    { name: 'Shipped', hook: 'Every deploy since March, and what each one put live', href: '/releases' },
    { name: 'Policy Engine', hook: 'Pull 39 levers, watch England’s schools respond', href: '/projects/policy-engine', ownerOnly: true },
    { name: 'Deep Dive', hook: 'Fan out across sources, red-team the claims, cite it', href: '/deepdive', ownerOnly: true },
    { name: 'Data Standard Designer', hook: 'Design & publish an adoptable data standard', href: '/projects/data-standard-designer' },
    { name: 'The Spine', hook: 'Separate data streams converging into one source of truth', href: '/projects/data-convergence', ownerOnly: true },
    { name: 'Quick Answer', hook: 'A fast, fact-checked answer with citations', href: '/quickanswer', ownerOnly: true },
    { name: 'Broads Pilot', hook: 'Plan a Norfolk Broads passage — tides, bridges, moorings', href: '/projects/broads-pilot' },
    { name: 'Heart', hook: '9,000 particles pumped through an SDF heart, valves per beat', href: '/heart' },
    { name: 'Writing', hook: 'Essays on code, design, and building things', href: '/blog' },
  ];

  let items = $derived(ITEMS.filter((i) => isOwner || !i.ownerOnly));

  let visible = $state(false);
  let sectionEl: HTMLElement;

  onMount(() => {
    // Reduced motion: reveal immediately, no stagger.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      visible = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            visible = true;
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    );
    io.observe(sectionEl);
    return () => io.disconnect();
  });
</script>

<section
  bind:this={sectionEl}
  class="index-sec"
  class:visible
  style="--n: {items.length}"
>
  <header class="index-hd">
    <span class="index-eyebrow">More</span>
    <span class="index-rule"></span>
    <span class="index-meta">Field studies · tools · writing</span>
  </header>

  <ul class="index-list">
    {#each items as item, i (item.href)}
      <li style="--i: {i}">
        <a class="row" href={item.href}>
          <span class="row-idx">{String(i + 1).padStart(2, '0')}</span>
          <span class="row-name">{item.name}</span>
          <span class="row-hook">{item.hook}</span>
          <span class="row-arrow" aria-hidden="true">→</span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .index-sec {
    padding: 56px 24px 64px;
    max-width: 1120px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  @media (min-width: 640px) {
    .index-sec {
      padding-left: 40px;
      padding-right: 40px;
    }
  }
  @media (min-width: 768px) {
    .index-sec {
      padding-left: 64px;
      padding-right: 64px;
    }
  }

  .index-hd {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
  }
  .index-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }
  .index-rule {
    flex: 1;
    height: 1px;
    background: var(--divider);
  }
  .index-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .index-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--divider);
  }
  .index-list li {
    border-bottom: 1px solid var(--divider);
  }

  .row {
    display: grid;
    grid-template-columns: 2.4rem minmax(8.5rem, max-content) 1fr 1.2rem;
    align-items: baseline;
    gap: 14px;
    padding: 14px 10px 14px 0;
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    transition:
      background var(--t-base) var(--ease-out),
      padding-left var(--t-base) var(--ease-out);
  }
  .row::before {
    content: '>';
    position: absolute;
    left: 0;
    color: var(--accent);
    font-family: var(--font-brand);
    opacity: 0;
    transform: translateX(-6px);
    transition:
      opacity var(--t-base) var(--ease-out),
      transform var(--t-base) var(--ease-out);
  }
  .row:hover {
    background: var(--accent-tint-04);
    padding-left: 20px;
  }
  .row:hover::before {
    opacity: 0.8;
    transform: translateX(6px);
  }

  .row-idx {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }
  .row-name {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-primary);
    transition: color var(--t-base) var(--ease-out);
  }
  .row:hover .row-name {
    color: var(--accent);
  }
  .row-hook {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-arrow {
    font-family: var(--font-mono);
    color: var(--accent);
    opacity: 0;
    transform: translateX(-4px);
    transition:
      opacity var(--t-base) var(--ease-out),
      transform var(--t-base) var(--ease-out);
    text-align: right;
  }
  .row:hover .row-arrow {
    opacity: 0.7;
    transform: translateX(0);
  }

  @media (max-width: 600px) {
    .row {
      grid-template-columns: 2rem 1fr;
      gap: 4px 12px;
    }
    .row-hook {
      grid-column: 2;
      white-space: normal;
      font-size: 12px;
    }
    .row-arrow {
      display: none;
    }
  }

  /* Staggered fade-up reveal on scroll-in. Rows start lifted + transparent;
     `.visible` releases them one after another. */
  .index-list li {
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 0.45s var(--ease-out),
      transform 0.45s var(--ease-out);
    transition-delay: calc(var(--i) * 45ms);
  }
  .index-sec.visible .index-list li {
    opacity: 1;
    transform: translateY(0);
  }
  .index-hd {
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 0.45s var(--ease-out),
      transform 0.45s var(--ease-out);
  }
  .index-sec.visible .index-hd {
    opacity: 1;
    transform: translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .index-list li,
    .index-hd {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
