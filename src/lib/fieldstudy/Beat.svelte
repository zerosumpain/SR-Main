<script lang="ts">
  /**
   * One beat, rendered by its template.
   *
   * Every template shares the same frame — header, question/claim, body, close
   * — and differs only in what fills the body. Dispatching here rather than in
   * each route is what stops a beat growing a bespoke layout: a route asks for
   * a beat, and gets whatever the template says a beat of that kind looks like.
   */
  import BeatHeader from './BeatHeader.svelte';
  import ClaimTable from './ClaimTable.svelte';
  import BeatClose from './BeatClose.svelte';
  import MarginNote from './MarginNote.svelte';
  import T1Argument from './templates/T1Argument.svelte';
  import T2Survey from './templates/T2Survey.svelte';
  import T3Position from './templates/T3Position.svelte';
  import T4Ledger from './templates/T4Ledger.svelte';
  import Sections from './templates/Sections.svelte';
  import { arcBeats, beatHref, neighbours, type Beat, type Study } from './study';

  let {
    study,
    beat,
    depth = 'research',
  }: { study: Study; beat: Beat; depth?: 'plain' | 'research' | 'technical' } = $props();

  const arc = $derived(arcBeats(study));
  const total = $derived(arc.length);
  const { prev, next } = $derived(neighbours(study, beat.no));
</script>

<article class="fs-beat" data-beat={beat.no} data-template={beat.template}>
  <BeatHeader
    no={beat.no}
    name={beat.name}
    {total}
    remaining={total - Number(beat.no) + 1}
    minutes={beat.minutes}
  />

  <div class="fs-spread">
    <!-- The margin column. Asides live here in italic serif, not as grey sans
         inside the body. Below 900px .fs-spread collapses and they fall
         inline, which is why they are authored as notes rather than floats. -->
    <aside class="fs-margin">
      {#each beat.marginNotes ?? [] as note, ni (ni)}
        <MarginNote label={note.label}>{note.text}</MarginNote>
      {/each}
    </aside>

    <div class="fs-beat-body">
      {#if beat.question && beat.claim}
        <ClaimTable question={beat.question} claim={beat.claim.text} confidence={beat.claim.confidence} />
      {/if}

      {#if beat.standfirst}
        <p class="fs-standfirst">{beat.standfirst}</p>
      {/if}

      {#if beat.template === 'T1'}
        <T1Argument {beat} {depth} />
      {:else if beat.template === 'T2'}
        <T2Survey {beat} {depth} />
      {:else if beat.template === 'T3'}
        <T3Position {beat} />
      {:else if beat.template === 'T4'}
        <T4Ledger {beat} />
      {/if}

      {#if beat.sections?.length}
        <Sections sections={beat.sections} />
      {/if}

      {#if beat.soWhat && beat.openQuestion}
        <BeatClose
          soWhat={beat.soWhat}
          openQuestion={beat.openQuestion.text}
          falsifier={beat.openQuestion.falsifier}
          next={next ? beatHref(study, next) : undefined}
          nextLabel={next ? `Beat ${next.no} · ${next.name}` : undefined}
          prev={prev ? beatHref(study, prev) : undefined}
          prevLabel={prev ? `Beat ${prev.no}` : undefined}
        />
      {/if}
    </div>
  </div>
</article>

<style>
  .fs-beat {
    display: block;
  }
  .fs-beat-body {
    min-width: 0;
  }
  .fs-standfirst {
    font-family: var(--fs-serif);
    font-size: var(--fs-body-lg);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 18px 0 0;
    max-width: 100%;
  }
</style>
