<script lang="ts">
  // LeafHead — the compact page header for a single-idea page.
  //
  // Replaces StoryMasthead on leaf pages. The old masthead spent about 120 words (a thesis
  // paragraph plus a three-item "what this section answers" list) before the reader saw
  // anything at all. Here it is a part label, a title and one sentence — then the instrument.
  import { app } from '../lib/appState.svelte';
  import { partById, href, type PartId } from '../lib/nav';

  interface Props {
    part: PartId;
    title: string;
    /** One sentence. Keep it under 30 words — the instrument makes the argument. */
    line: string;
    /** Same sentence without the jargon. */
    lineEli5?: string;
  }
  let { part, title, line, lineEli5 }: Props = $props();
  const p = $derived(partById(part));
  const eli = $derived(app.narrative === 'eli5');
</script>

<header class="lh" style="--tone:{p.tone}">
  <a class="lh-part" href={href(p.id)}>
    <span class="lp-no">Part {p.no}</span>
    <span class="lp-name">{p.name}</span>
  </a>
  <h1 class="pe-h1">{title}</h1>
  <p class="lh-line">{eli && lineEli5 ? lineEli5 : line}</p>
</header>

<style>
  .lh { margin: 0 0 16px; }
  .lh-part { display: inline-flex; align-items: baseline; gap: 7px; text-decoration: none; margin-bottom: 8px; }
  .lp-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--tone); }
  .lp-name { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .lh-part:hover .lp-name { color: rgba(28,22,17,0.75); }
  .lh :global(.pe-h1) { margin-bottom: 8px; }
  .lh-line { margin: 0; font-size: var(--fs-body); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 68ch; }
</style>
