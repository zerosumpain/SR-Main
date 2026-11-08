<script lang="ts">
  // PageFoot — the end of every page: the real routes this chapter accounts for, then the
  // way on. Reading order lives in lib/nav.ts, so the next stop is always derived.
  //
  // "Next" is the big target, an ink band in the colour of the part it leads into, carrying
  // that chapter's question, because a question is a better reason to keep reading than a
  // title. Native API lists every endpoint itself, so it doesn't repeat them here.
  import { page } from '$app/state';
  import { B, neighbours, PARTS } from '../lib/nav';
  import OnTheSite from './OnTheSite.svelte';
  import Band from './kit/Band.svelte';

  const nav = $derived(neighbours(page.url.pathname));
  const leaf = $derived(page.url.pathname.replace(/\/$/, '').slice(B.length + 1));
  const routes = $derived(
    leaf === 'app/api' ? [] : ((page.data.facts?.routes ?? []) as Array<{ leaf: string; path: string; kind: 'api' | 'page'; methods: string[]; who: 'owner' | 'members' | 'phone' | 'service'; what: string }>).filter((r) => r.leaf === leaf),
  );

  // What to say about the next stop: a leaf's question, or a part's claim.
  const nextInfo = $derived.by(() => {
    const n = nav.next;
    if (!n) return null;
    const p = n.part ? PARTS.find((x) => x.id === n.part) : null;
    const l = p?.leaves.find((x) => n.href.endsWith(`/${x.slug}`));
    const i = p && l ? p.leaves.indexOf(l) : -1;
    return {
      part: p?.id,
      kicker: p ? (l ? `Next · ${p.no}.${i + 1} · ${p.name}` : `Next · Part ${p.no}`) : 'Next',
      title: l ? l.label : p ? p.name : n.label,
      ask: l ? l.ask : p?.strap ?? '',
    };
  });
</script>

{#if routes.length}
  <Band surface="deep" pad="normal">
    <div class="ots-wrap"><OnTheSite {routes} /></div>
  </Band>
{/if}

{#if nav.next && nextInfo}
  <Band surface="ink" part={nextInfo.part} pad="none">
    <a class="next" href={nav.next.href}>
      <span class="n-kick">{nextInfo.kicker}</span>
      <span class="n-title">{nextInfo.title}</span>
      <span class="n-ask">{nextInfo.ask}</span>
      <span class="n-arrow" aria-hidden="true">
        <svg viewBox="0 0 64 32"><path d="M0 16h58M44 2l14 14-14 14" fill="none" stroke="currentColor" stroke-width="3" /></svg>
      </span>
    </a>
  </Band>
{/if}
{#if nav.prev}
  <Band surface="ink" pad="none">
    <a class="prev" href={nav.prev.href}><span aria-hidden="true">←</span> Back to {nav.prev.label}</a>
  </Band>
{/if}

<style>
  .ots-wrap { border-top: 3px solid var(--fg); padding-top: 26px; }
  .next { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'k a' 't a' 'q a'; gap: 8px 32px; align-items: center;
    padding: clamp(40px, 5vw, 72px) 0; text-decoration: none; color: var(--fg); position: relative; }
  .n-kick { grid-area: k; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em; text-transform: uppercase; color: var(--tone-text); }
  .n-title { grid-area: t; font-family: var(--er-display); text-transform: uppercase; font-size: clamp(40px, 7vw, 104px); line-height: 0.92;
    transition: color 0.3s; }
  .n-ask { grid-area: q; font-family: var(--er-serif); font-style: italic; font-size: clamp(18px, 1.8vw, 24px); color: var(--fg-2); }
  .n-arrow { grid-area: a; width: clamp(56px, 7vw, 110px); color: var(--tone-text); transition: transform 0.5s var(--er-ease); }
  .n-arrow svg { width: 100%; height: auto; display: block; }
  .next:hover .n-title { color: var(--tone-text); }
  .next:hover .n-arrow { transform: translateX(12px); }
  .prev { display: block; padding: 16px 0 18px; border-top: 1px solid var(--rule); font-family: var(--er-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); text-decoration: none; }
  .prev:hover { color: var(--fg); }
  @media (max-width: 640px) {
    .next { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'k' 't' 'q' 'a'; }
  }
</style>
