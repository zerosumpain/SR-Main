<script lang="ts">
  import { onMount } from 'svelte';

  type Section = { id: string; label: string };
  const SECTIONS: Section[] = [
    { id: 'readiness', label: 'Readiness' },
    { id: 'autonomic', label: 'Autonomic' },
    { id: 'sleep', label: 'Sleep' },
    { id: 'training', label: 'Training' },
    { id: 'body', label: 'Body' },
    { id: 'activities', label: 'Activities' },
  ];

  let active = $state<string>('readiness');

  onMount(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) active = e.target.id;
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  });

  function scrollTo(id: string, ev: Event) {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    active = id;
  }
</script>

<nav class="hsn">
  <ul class="hsn-list">
    {#each SECTIONS as s (s.id)}
      <li>
        <a
          href={`#${s.id}`}
          class="hsn-link"
          class:active={active === s.id}
          onclick={(e) => scrollTo(s.id, e)}
        >
          {s.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .hsn {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--bg);
    border-bottom: 1px solid var(--card-border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hsn::-webkit-scrollbar { display: none; }
  .hsn-list {
    display: flex;
    gap: 1.5rem;
    list-style: none;
    margin: 0;
    padding: 0.5rem 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  .hsn-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    text-decoration: none;
    padding: 0.25rem 0;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .hsn-link:hover { color: var(--text-secondary); }
  .hsn-link.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
</style>
