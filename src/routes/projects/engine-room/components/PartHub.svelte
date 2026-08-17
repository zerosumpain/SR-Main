<script lang="ts">
  // PartHub — the shell for the four part landing pages.
  //
  // A hub is a menu, not a chapter. It says what the part is for in one line, then hands
  // over to its pages. Anything that wants a paragraph belongs on a leaf page with a
  // diagram next to it.
  import type { Snippet } from 'svelte';
  import { partById, href, type PartId } from '../lib/nav';

  interface Props {
    part: PartId;
    /** Optional visual that summarises the whole part, shown above the page list. */
    children?: Snippet;
  }
  let { part, children }: Props = $props();
  const p = $derived(partById(part));
</script>

<header class="ph" style="--tone:{p.tone}">
  <span class="ph-no">Part {p.no}</span>
  <h1 class="pe-h1">{p.name}</h1>
  <p class="ph-strap">{p.strap}</p>
  <p class="ph-lede">{p.lede}</p>
</header>

{#if children}
  <div class="ph-vis">{@render children()}</div>
{/if}

<nav class="ph-list" style="--tone:{p.tone}" aria-label="Pages in {p.name}">
  {#each p.leaves as l, i (l.slug)}
    <a class="leaf" href={href(p.id, l.slug)}>
      <span class="l-no">{p.no}.{i + 1}</span>
      <span class="l-main">
        <b class="l-lab">{l.label}</b>
        <span class="l-blurb">{l.blurb}</span>
        <span class="l-inst"><span class="li-mark" aria-hidden="true">◧</span>{l.instrument}</span>
      </span>
      <span class="l-go" aria-hidden="true">→</span>
    </a>
  {/each}
</nav>

<style>
  .ph { margin: 0 0 18px; }
  .ph-no { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--tone); margin-bottom: 6px; }
  .ph :global(.pe-h1) { margin-bottom: 4px; }
  .ph-strap { margin: 0 0 10px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.04em; color: rgba(28,22,17,0.55); }
  .ph-lede { margin: 0; font-size: 16.5px; line-height: 1.55; color: rgba(28,22,17,0.76); }

  .ph-vis { margin: 18px 0 22px; }

  .ph-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; margin-top: 8px; }
  .leaf { display: flex; align-items: flex-start; gap: 11px; text-decoration: none;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--tone);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: rgba(255,255,255,0.5); padding: 13px 14px; transition: background 0.13s, border-color 0.13s; }
  .leaf:hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.34); border-left-color: var(--tone); }
  .l-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--tone); padding-top: 3px; flex-shrink: 0; }
  .l-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .l-lab { font-family: var(--fs-serif); font-weight: 600; font-size: 16.5px; line-height: 1.22; color: var(--text-primary); }
  .l-blurb { font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.7); }
  .l-inst { display: flex; gap: 5px; margin-top: 3px; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.5); }
  .li-mark { color: var(--tone); flex-shrink: 0; }
  .l-go { margin-left: auto; align-self: center; color: rgba(28,22,17,0.3); font-size: var(--fs-body-sm); flex-shrink: 0; }
  .leaf:hover .l-go { color: var(--tone); }
</style>
