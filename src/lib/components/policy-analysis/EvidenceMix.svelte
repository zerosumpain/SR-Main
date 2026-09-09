<script lang="ts">
  // F — WHAT THE EVIDENCE SAYS, and how much of it there is.
  //
  // Four outcomes, so this one IS categorical and uses the site's four validated
  // categorical hues rather than a ramp. They sit in the 6–8 CVD band against
  // each other, which is legal only with a secondary encoding — hence the legend
  // with counts, mandatory here and not a nicety.
  //
  // "Insufficient" is the honest answer for most policy papers and is drawn the
  // same size as any other outcome. A bar that hid it would be flattering the
  // document.
  import type { Artefact } from '$lib/policy-analysis/contracts';

  interface Props {
    mix: { key: string; label: string; hue: string; count: number }[];
    questions: Artefact[];
    sources: Artefact[];
    inspect: (id: string) => void;
  }

  let { mix, questions, sources, inspect }: Props = $props();
  const total = $derived(mix.reduce((sum, m) => sum + m.count, 0));
  const rounds = $derived(new Set(questions.map((q) => q.id.split('_')[1])).size);
</script>

{#if total}
  <div class="bar" role="img" aria-label={mix.filter((m) => m.count).map((m) => `${m.count} ${m.label}`).join(', ')}>
    {#each mix.filter((m) => m.count) as m (m.key)}
      <span class="seg" style="flex-grow: {m.count}; background: {m.hue}"></span>
    {/each}
  </div>
  <ul class="legend">
    {#each mix as m (m.key)}
      <li class:none={!m.count}>
        <span class="swatch" style="background: {m.hue}"></span>
        <strong>{m.count}</strong> {m.label}
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted">No evidence links have been established yet.</p>
{/if}

<div class="enquiry">
  <p class="sr-label">
    Lines of enquiry — {questions.length} question{questions.length === 1 ? '' : 's'}, {sources.length} source{sources.length === 1 ? '' : 's'}{#if rounds > 1}, over {rounds} rounds{/if}
  </p>
  {#if questions.length}
    <ol class="questions">
      {#each questions as question (question.id)}
        {@const found = sources.filter((s) => s.data.questionId === question.id)}
        <li>
          <button class="q" onclick={() => inspect(question.id)}>{question.label}</button>
          <p>{question.statement}</p>
          {#if found.length}
            <ul class="sources">
              {#each found as source (source.id)}
                <li>
                  <a href={String(source.url)} target="_blank" rel="noopener noreferrer">{source.label}</a>
                  <span class="muted">{String(source.data.retrieval) === 'full_text' ? 'full text' : 'search excerpt only'} · {String(source.data.quality)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="gap">Nothing was retrieved for this question. It remains open.</p>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="muted">No external research was planned or retrieved, so every conclusion here rests on the document and on labelled inference.</p>
  {/if}
</div>

<style>
  .bar { display: flex; gap: 2px; height: 2rem; margin: 1.25rem 0 .75rem; }
  .seg { min-width: 3px; }
  .legend { list-style: none; padding: 0; margin: 0 0 1.75rem; display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; font-size: var(--fs-label); }
  .legend li { display: inline-flex; align-items: center; gap: .45rem; }
  .legend li.none { opacity: .45; }
  .swatch { width: .8rem; height: .8rem; border: 1px solid var(--line-strong); flex: none; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .75rem; }
  .questions { list-style: none; padding: 0; margin: 0; counter-reset: q; }
  .questions > li { border-top: 1px solid var(--line); padding: .9rem 0; }
  .q { font: inherit; font-weight: 700; font-size: var(--fs-body-lg); background: none; border: 0; padding: 0; text-align: left; color: var(--text-primary); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; cursor: pointer; }
  .questions p { margin: .35rem 0 0; }
  .sources { list-style: none; padding: 0; margin: .6rem 0 0; display: grid; gap: .35rem; }
  .sources li { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; font-size: var(--fs-label); }
  .gap { color: var(--accent); }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
</style>
