<script lang="ts">
  // LeafHead — the opening band of a chapter.
  //
  // The feature's own name is the H1, set huge, because that is the word a reader will meet
  // on the real site. Beside it, the question the chapter answers and one sentence of answer.
  // An optional art snippet sits under the headline at full width: the chapter's explainer,
  // seen before any instrument.
  import type { Snippet } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { partById, href, type PartId } from '../lib/nav';
  import { reveal } from '../lib/motion';
  import Band from './kit/Band.svelte';
  import Masthead from './kit/Masthead.svelte';

  interface Props {
    part: PartId;
    title: string;
    /** One sentence. Keep it under thirty words — the instruments make the argument. */
    line: string;
    /** Same sentence without the jargon. */
    lineEli5?: string;
    art?: Snippet;
  }
  let { part, title, line, lineEli5, art }: Props = $props();
  const p = $derived(partById(part));
  const i = $derived(p.leaves.findIndex((l) => l.label === title));
  const leaf = $derived(i >= 0 ? p.leaves[i] : null);
  const eli = $derived(app.narrative === 'eli5');
</script>

<Band surface="paper" part={part} pad="hero">
  <Masthead level={1} size="xl"
    kicker={`Part ${p.no} · ${p.name}${i >= 0 ? ` — chapter ${i + 1} of ${p.leaves.length}` : ''}`}
    lines={[title]}>
    {#snippet aside()}
      {#if leaf}<p class="er-pull ask">{leaf.ask}</p>{/if}
      <p class="line">{eli && lineEli5 ? lineEli5 : line}</p>
      <a class="up" href={href(p.id)}>← All of {p.name}</a>
    {/snippet}
  </Masthead>
  {#if art}<div class="art" {@attach reveal({ y: 30, delay: 0.15 })}>{@render art()}</div>{/if}
</Band>

<style>
  .ask { margin: 0 0 14px; }
  .line { margin: 0 0 14px; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); }
  .up { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tone-text); text-decoration: none; }
  .up:hover { text-decoration: underline; }
  .art { margin-top: clamp(8px, 2vw, 24px); }
</style>
