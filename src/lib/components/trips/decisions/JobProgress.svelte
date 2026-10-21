<script lang="ts">
  // A research job's progress card: one ticked line per stage (label, its
  // state in words, and what it found — "Found 38 places"), never a seconds
  // counter. The summary line is a polite live region, so a screen reader
  // hears each stage finish without hearing the whole list again.
  import type { JobStage } from '$lib/trips/decisions';
  import { progressOf, STAGE_STATE_LABEL } from '$lib/trips/decisions-view';

  let { stages, title = 'Reading up on the trip', note = null }: { stages: JobStage[]; title?: string; note?: string | null } = $props();
  const progress = $derived(progressOf(stages));
</script>

<div class="jp">
  <p class="jp-h">{title}</p>
  <p class="dx-vh" role="status" aria-live="polite">{progress.summary}</p>
  {#if !stages.length}
    <p class="dx-note"><span class="dx-pulse" aria-hidden="true"></span> Starting…</p>
  {:else}
    <ol class="jp-lines" role="list">
      {#each stages as s (s.key)}
        <li class="jp-line state-{s.state}">
          <span class="dx-box" aria-hidden="true">
            {#if s.state === 'done'}
              <svg viewBox="0 0 20 20"><path class="tick" d="M4 10.5 L8.5 15 L16.5 4.5" /></svg>
            {:else if s.state === 'failed'}
              <svg viewBox="0 0 20 20"><path class="cross" d="M5 5 L15 15 M15 5 L5 15" /></svg>
            {:else if s.state === 'skipped'}
              <svg viewBox="0 0 20 20"><path class="cross" d="M5 10 L15 10" /></svg>
            {:else if s.state === 'running'}
              <span class="jp-dot"><span class="dx-pulse"></span></span>
            {/if}
          </span>
          <span class="jp-body">
            <span class="jp-label">{s.label}</span>
            <span class="jp-state">{STAGE_STATE_LABEL[s.state]}</span>
            {#if s.detail}<span class="jp-detail">{s.detail}</span>{/if}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
  {#if note}<p class="dx-aside jp-note">{note}</p>{/if}
</div>

<style>
  .jp-h {
    margin: 0 0 6px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
  }
  .jp-lines {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .jp-line {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 0;
    border-top: 1px dashed var(--line-strong);
  }
  .jp-line:first-child {
    border-top: 0;
  }
  .jp-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-width: 0;
  }
  .jp-label {
    font-weight: 600;
  }
  .state-waiting .jp-label {
    color: var(--np-ink-soft);
    font-weight: 400;
  }
  .jp-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .state-running .jp-state {
    color: var(--np-pen-text);
  }
  .state-failed .jp-state {
    color: var(--error);
  }
  .jp-detail {
    flex-basis: 100%;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft);
  }
  .jp-dot {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
  }
  .jp-note {
    margin-top: 8px;
  }
</style>
