<script lang="ts">
  // Chapter — the editorial unit of the index.
  //
  // The index used to be a stack of instruments with a small heading over each: five
  // things in a row, no rhythm, no argument running through them. It read as a contents
  // page pretending to be an essay. This gives every section the same three-beat shape —
  // a number, a title big enough to stop on, and one sentence saying what you are about to
  // look at — and then gets out of the way of the visual.
  //
  // Reveal-on-scroll is an action rather than an effect: an action receives the node after
  // mount, which avoids binding a DOM handle into $state and then reading it from an
  // effect that also writes it (svelte5-pitfalls §1–2).
  import type { Snippet } from 'svelte';

  let {
    no,
    title,
    sub,
    tone = 'var(--accent-ink)',
    lead = false,
    children,
  }: {
    no: string;
    title: string;
    sub: string;
    tone?: string;
    /** A lead chapter gets the larger title size. */
    lead?: boolean;
    children: Snippet;
  } = $props();

  function reveal(node: HTMLElement) {
    if (typeof IntersectionObserver !== 'function') {
      node.classList.add('in');
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            node.classList.add('in');
            io.unobserve(node);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

<section class="ch" class:lead style="--tone:{tone}" use:reveal>
  <header class="ch-head">
    <span class="ch-no">{no}</span>
    <h2 class="ch-title">{title}</h2>
    <p class="ch-sub">{sub}</p>
  </header>
  <div class="ch-body">
    {@render children()}
  </div>
</section>

<style>
  .ch {
    margin: 0 0 clamp(56px, 9vw, 116px);
    opacity: 0;
    transform: translateY(18px);
    transition: opacity 0.7s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.7s cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .ch:global(.in) { opacity: 1; transform: none; }

  .ch-head { max-width: 74ch; margin: 0 0 clamp(18px, 2.4vw, 30px); }

  .ch-no {
    display: inline-block; margin-bottom: 10px;
    font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--tone);
    padding-bottom: 5px; border-bottom: 2px solid var(--tone);
  }

  .ch-title {
    margin: 0 0 12px;
    font-family: 'Fraunces', serif; font-weight: 600;
    font-size: clamp(30px, 4.6vw, 52px);
    line-height: 1.04; letter-spacing: -0.015em;
    color: var(--text-primary);
    text-wrap: balance;
  }
  .lead .ch-title { font-size: clamp(34px, 5.6vw, 64px); }

  .ch-sub {
    margin: 0;
    font-size: clamp(15.5px, 1.5vw, 18.5px);
    line-height: 1.55; color: rgba(28, 22, 17, 0.66);
    max-width: 62ch; text-wrap: pretty;
  }

  @media (max-width: 620px) {
    .ch { margin-bottom: 54px; }
  }
</style>
