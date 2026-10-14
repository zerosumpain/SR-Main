<script lang="ts">
  /**
   * The idea tray in a stage band: "Ask for an idea" goes and FINDS ideas for
   * that slot (POST /api/trips/:id/ideas — the planner looks things up, then
   * every idea is checked with the solver), instead of pasting a question
   * into the chat. Up to three cards: what, why, how it fits, the solver's
   * real times and the travel in and out, and what it looked up. "Add this"
   * adds the wish through the normal wishes route (a new plan version, logged
   * in the conversation); "Not this" just hides the card.
   */
  import { onMount } from 'svelte';
  import { postAsJob } from '$lib/trips/job-client';
  import { DAY_STAGE_LABEL, type DayStage, type ResearchStep, type TravelMode } from '$lib/trips/model';

  interface Verdict {
    fits: boolean;
    arriveMin: number | null;
    departMin: number | null;
    legInMin: number | null;
    legOutMin: number | null;
    legInMode: TravelMode | null;
    legOutMode: TravelMode | null;
    pushesOut: string[];
    moves: Array<{ title: string; from: string; to: string }>;
    reason: string | null;
  }
  interface Idea {
    title: string;
    why: string;
    fit: string;
    wish: Record<string, unknown> & { durationMin: number | null };
    verdict: Verdict;
    /** v6: from the planner, or a nearby place from OpenStreetMap. */
    source?: 'planner' | 'nearby';
  }
  interface Result {
    gap: { freeMin: number; before: { title: string }; after: { title: string } } | null;
    ideas: Idea[];
    rejected: Array<{ title: string; reason: string }>;
    note: string | null;
    research: ResearchStep[];
  }

  let {
    base,
    date,
    stage,
    dayName,
    afterStopId = null,
    beforeStopId = null,
    onAdded,
    onClose,
  }: {
    base: string;
    date: string;
    stage: DayStage;
    dayName: string;
    afterStopId?: string | null;
    beforeStopId?: string | null;
    onAdded: () => Promise<void>;
    onClose: () => void;
  } = $props();

  let phase = $state<'looking' | 'done' | 'failed'>('looking');
  let result = $state<Result | null>(null);
  let error = $state<string | null>(null);
  let hidden = $state<Set<string>>(new Set());
  let adding = $state<string | null>(null);
  let seconds = $state(0);

  const hhmm = (m: number | null) => (m === null ? '—' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`);
  const MODE: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', drive: 'drive', transit: 'public transport', taxi: 'taxi' };
  const dayShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  let timer: ReturnType<typeof setInterval> | undefined;
  /** v6: ask as a job and poll it, so a long search is never cut off. */
  async function look() {
    phase = 'looking';
    result = null;
    error = null;
    seconds = 0;
    clearInterval(timer);
    timer = setInterval(() => (seconds += 1), 1000);
    try {
      const { ok, body } = await postAsJob<Result & { message?: string }>(`${base}/ideas`, { date, stage, afterStopId, beforeStopId });
      if (!ok) throw new Error(body.error ?? body.message ?? 'The planner did not answer.');
      result = body;
      phase = 'done';
    } catch (err) {
      error = (err as Error).message || 'The site did not answer.';
      phase = 'failed';
    } finally {
      clearInterval(timer);
    }
  }
  onMount(() => {
    void look();
    return () => clearInterval(timer);
  });

  async function add(idea: Idea) {
    adding = idea.title;
    error = null;
    try {
      const res = await fetch(`${base}/wishes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(idea.wish) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not add it.');
      await onAdded();
      onClose();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      adding = null;
    }
  }
  const shown = $derived((result?.ideas ?? []).filter((i) => !hidden.has(i.title)));
</script>

<div class="tray" role="region" aria-label="Ideas for {dayName}, {DAY_STAGE_LABEL[stage]}" aria-busy={phase === 'looking'}>
  <div class="tray-hd">
    <span class="tray-title">Ideas for this {afterStopId || beforeStopId ? 'gap' : 'stage'}</span>
    {#if result?.gap}<span class="tray-meta">{result.gap.freeMin} min between {result.gap.before.title} and {result.gap.after.title}</span>{/if}
    <button class="close" type="button" onclick={onClose} aria-label="Close the ideas">Close</button>
  </div>

  {#if phase === 'looking'}
    <p class="looking" role="status"><span class="pulse" aria-hidden="true"></span> Looking for something that fits — checking places, opening times and the walk there and back ({seconds}s)…</p>
  {:else if phase === 'failed'}
    <p class="err" role="alert">{error}</p>
    <button class="not" type="button" onclick={() => void look()}>Try again</button>
  {:else if result}
    {#if result.note}<p class="note">{result.note}</p>{/if}
    <ul class="cards">
      {#each shown as idea (idea.title)}
        {@const v = idea.verdict}
        <li class="card" class:warn={!v.fits}>
          <strong class="name">{idea.title}</strong>
          {#if idea.source === 'nearby'}<span class="small">Nearby, from OpenStreetMap</span>{/if}
          {#if idea.why}<p class="why">{idea.why}</p>{/if}
          <p class="fit mono">
            {#if v.arriveMin !== null}{hhmm(v.arriveMin)}–{hhmm(v.departMin)} ·{/if}
            {#if v.legInMin !== null}{v.legInMin} min {MODE[v.legInMode ?? 'walk']} in{/if}{#if v.legOutMin !== null} · {v.legOutMin} min on{/if}
          </p>
          {#if idea.fit}<p class="small">{idea.fit}</p>{/if}
          {#if !v.fits && v.reason}<p class="flag">{v.reason}</p>{/if}
          {#if v.moves.length}<p class="small">Adding it re-plans: {v.moves.map((m) => `${m.title} ${dayShort(m.from)} → ${dayShort(m.to)}`).join('; ')}.</p>{/if}
          <div class="acts">
            <button class="add" type="button" disabled={!!adding} onclick={() => add(idea)}>{adding === idea.title ? 'Adding…' : 'Add this'}</button>
            <button class="not" type="button" disabled={!!adding} onclick={() => (hidden = new Set([...hidden, idea.title]))}>Not this</button>
          </div>
        </li>
      {/each}
    </ul>
    {#if result.rejected.length}
      <p class="small">Checked and turned down: {result.rejected.map((r) => `${r.title} (${r.reason})`).join('; ')}</p>
    {/if}
    {#if !shown.length}<button class="not" type="button" onclick={() => void look()}>Try again</button>{/if}
    {#if result.research.length}
      <details class="looked">
        <summary>What I looked up ({result.research.length})</summary>
        <ul>
          {#each result.research as r, ri (ri)}
            <li>{r.summary}{#each r.sources as src, si (src.url)}{si ? ', ' : ' — '}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? new URL(src.url).hostname}</a>{/each}</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .tray {
    margin: 8px 0 10px;
    padding: 10px 12px;
    border: 1px dashed var(--band-rule, var(--line-strong));
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
  }
  .tray-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin-bottom: 6px;
  }
  .tray-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-ink);
  }
  .tray-meta,
  .small {
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    margin: 2px 0;
  }
  .close {
    margin-left: auto;
    background: none;
    border: 0;
    color: var(--accent-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
    text-decoration: underline;
  }
  .looking {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 100px;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
    gap: 8px;
  }
  .card {
    padding: 8px 10px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--success);
    border-radius: 2px;
    background: var(--surface-card);
  }
  .card.warn {
    border-left-color: var(--warn);
  }
  .name {
    display: block;
  }
  .why {
    margin: 2px 0;
    font-size: var(--fs-label);
  }
  .fit {
    margin: 2px 0;
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .flag {
    margin: 2px 0;
    font-size: var(--fs-label-xs);
    color: var(--warn);
  }
  .acts {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .add,
  .not {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    padding: 3px 10px;
    border-radius: 100px;
    cursor: pointer;
  }
  .add {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  .not {
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text-secondary);
  }
  .note,
  .err {
    margin: 4px 0;
    font-size: var(--fs-label);
  }
  .err {
    color: var(--error);
  }
  .looked {
    margin-top: 6px;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .looked summary {
    cursor: pointer;
  }
  .looked ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .looked a {
    color: var(--accent-ink);
  }
</style>
