<script lang="ts">
  // PartHub — the shell for the three part landing pages.
  //
  // Three bands. A paper hero with the part's claim in display type beside its explainer art,
  // an ink band for whatever the part can show live, and the chapters as a ranked list, each
  // led by the question it answers so a visitor can pick by curiosity rather than by jargon.
  import type { Snippet } from 'svelte';
  import { partById, href, PARTS, type PartId } from '../lib/nav';
  import { cascade } from '../lib/motion';
  import Band from './kit/Band.svelte';
  import Masthead from './kit/Masthead.svelte';

  interface Props {
    part: PartId;
    /** The hero illustration, beside the headline. */
    art?: Snippet;
    /** Live figures, set on the ink band under the hero. */
    children?: Snippet;
    /** Anything after the chapter list. */
    after?: Snippet;
  }
  let { part, art, children, after }: Props = $props();
  const p = $derived(partById(part));
  const index = $derived(PARTS.findIndex((x) => x.id === part));
</script>

<Band surface="paper" part={part} pad="hero">
  <div class="hero" class:has-art={!!art}>
    <Masthead level={1} size="xl" kicker={`Part ${p.no} of ${PARTS.length} · ${p.name}`} lines={p.headline} />
    {#if art}<div class="art">{@render art()}</div>{/if}
    <p class="lede er-lede">{p.lede}</p>
  </div>
</Band>

{#if children}
  <Band surface="ink" part={part}>{@render children()}</Band>
{/if}

<Band surface="paper" part={part}>
  <div class="ch-head">
    <span class="er-kicker">Inside {p.name}</span>
    <h2 class="er-display ch-title">{p.leaves.length} questions, one chapter each</h2>
  </div>
  <ol class="list" {@attach cascade()}>
    {#each p.leaves as l, i (l.slug)}
      <li>
        <a class="row" href={href(p.id, l.slug)}>
          <span class="r-no">{p.no}.{i + 1}</span>
          <span class="r-ask">
            <b>{l.ask}</b>
            <span class="r-lab">{l.label}</span>
          </span>
          <span class="r-blurb">{l.blurb}<span class="r-inst">{l.instrument}</span></span>
          <span class="r-go" aria-hidden="true">
            <svg viewBox="0 0 32 16" width="32" height="16"><path d="M0 8h29M22 1l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </span>
        </a>
      </li>
    {/each}
  </ol>
  {#if after}{@render after()}{/if}
  {#if index < PARTS.length - 1}
    {@const nxt = PARTS[index + 1]}
    <p class="onward">Then <a href={href(nxt.id)} data-part={nxt.id}>Part {nxt.no}, {nxt.name}</a>. {nxt.strap}.</p>
  {/if}
</Band>

<style>
  .hero { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 clamp(24px, 4vw, 64px); align-items: end; }
  .hero.has-art { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
  .hero :global(.mh) { margin-bottom: 28px; }
  .art { grid-row: span 2; align-self: center; min-width: 0; }
  .lede { max-width: 58ch; }
  @media (max-width: 900px) {
    .hero.has-art { grid-template-columns: minmax(0, 1fr); }
    .art { grid-row: auto; order: 3; margin-top: 28px; }
  }

  .ch-head { display: flex; flex-direction: column; margin-bottom: 26px; }
  .ch-title { font-size: clamp(26px, 3vw, 40px); }

  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; background: var(--rule); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .row { display: grid; grid-template-columns: 72px minmax(0, 1.3fr) minmax(0, 1fr) 48px; gap: 8px 24px; align-items: center;
    padding: clamp(18px, 2.2vw, 30px) 8px; text-decoration: none; color: inherit; background: var(--ground);
    position: relative; overflow: hidden; transition: background 0.3s; }
  .row::before { content: ''; position: absolute; inset: 0; background: var(--tone); opacity: 0.08; transform: scaleX(0); transform-origin: left;
    transition: transform 0.5s var(--er-ease); }
  .row:hover::before, .row:focus-visible::before { transform: scaleX(1); }
  .r-no { font-family: var(--er-display); font-size: clamp(26px, 2.6vw, 40px); color: var(--tone-text); line-height: 1; position: relative; }
  .r-ask { display: flex; flex-direction: column; gap: 6px; position: relative; }
  .r-ask b { font-family: var(--er-serif); font-weight: 500; font-size: clamp(20px, 2vw, 28px); line-height: 1.2; color: var(--fg); }
  .r-lab { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-3); }
  .r-blurb { display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-body-sm); line-height: 1.5; color: var(--fg-2); position: relative; }
  .r-inst { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); line-height: 1.5; }
  .r-go { color: var(--fg-3); transition: transform 0.4s var(--er-ease), color 0.3s; position: relative; justify-self: end; }
  .row:hover .r-go { transform: translateX(6px); color: var(--tone-text); }
  @media (max-width: 760px) {
    .row { grid-template-columns: 48px minmax(0, 1fr); }
    .r-blurb { grid-column: 2; }
    .r-go { display: none; }
  }
  .onward { margin: 26px 0 0; font-size: var(--fs-body-sm); color: var(--fg-3); }
  .onward a { color: var(--tone-text); font-weight: 600; text-decoration-thickness: 2px; text-underline-offset: 3px; }
</style>
