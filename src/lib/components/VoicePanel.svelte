<script lang="ts">
  // A strip under the editor saying whether the draft still sounds like John.
  //
  // Sits next to the readability readout, which is the precedent it copies:
  // same monospace label scale, same pill shape, same quiet colours. It scores
  // in the browser — scoreVoice is a pure function and the card arrives with the
  // page — so there is no request per keystroke.
  //
  // Findings are advisory. Nothing here blocks a save; John is allowed to write
  // whatever he likes, and the scorer is measuring his own habits back at him.

  import { scoreVoice } from '$lib/voice/score';
  import type { VoiceCard, Register } from '$lib/voice/types';

  type Props = {
    text: string;
    card: VoiceCard | null;
    register?: Register;
  };

  let { text, card, register = 'public-prose' }: Props = $props();

  let open = $state(false);

  const result = $derived(card ? scoreVoice(text, register, card) : null);
  const defects = $derived(result ? result.findings.filter((f) => f.severity !== 'note') : []);
  const notes = $derived(result ? result.findings.filter((f) => f.severity === 'note') : []);
</script>

{#if result && result.observed.words > 0}
  <div class="voice" data-verdict={result.verdict}>
    <span class="v-pill">Voice <strong>{result.score}</strong></span>
    <span class="v-verdict">{result.verdict}</span>

    {#if defects.length > 0}
      <button
        type="button"
        class="v-toggle"
        aria-expanded={open}
        onclick={() => (open = !open)}
      >
        {defects.length} thing{defects.length === 1 ? '' : 's'} to look at
      </button>
    {:else if notes.length > 0}
      <span class="v-good">{notes[0].message}</span>
    {/if}

    <span class="v-meta">
      {result.observed.sentenceMedian}w median sentence · {Math.round(result.observed.firstPerson)} first-person/1k
    </span>
  </div>

  {#if open && defects.length > 0}
    <ul class="v-list">
      {#each defects as f (f.code + (f.evidence ?? ''))}
        <li data-severity={f.severity}>
          <span class="v-sev">{f.severity}</span>
          {f.message}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .voice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .v-pill {
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .v-pill strong {
    margin-left: 4px;
    font-weight: 700;
    color: var(--accent);
  }
  /* Only the bad end is coloured. A green tick for "you wrote like yourself"
     would be noise on a page where that is the normal state. */
  .voice[data-verdict='not his voice'] .v-pill strong { color: #8a2d3a; }
  .v-verdict {
    color: var(--text-primary);
    font-style: italic;
  }
  .v-good { color: var(--text-ghost); }
  .v-toggle {
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
    font: inherit;
    color: var(--text-primary);
    cursor: pointer;
  }
  .v-toggle:hover { background: var(--accent-tint-08); }
  .v-meta {
    color: var(--text-ghost);
    margin-left: auto;
  }
  .v-list {
    margin: 0;
    padding: 4px 12px 10px 12px;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    border-top: 1px solid var(--line-strong);
  }
  .v-list li {
    display: flex;
    gap: 8px;
    padding: 3px 0;
    align-items: baseline;
  }
  .v-sev {
    flex: 0 0 auto;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    min-width: 3.2em;
  }
  .v-list li[data-severity='fail'] .v-sev { color: #8a2d3a; }
</style>
