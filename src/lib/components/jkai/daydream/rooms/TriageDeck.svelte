<script lang="ts">
  // The sorting deck — thirty held-back thoughts at a time, most-repeated
  // first, rated in one sitting. Everything about ranking is a random walk
  // until the ledger has feedback in it, and at four interruptions a day the
  // responses the threshold needs are never collected. This costs no
  // interruption budget at all.
  import { invalidateAll } from '$app/navigation';
  import { postThought } from '$lib/daydream/feed-client';
  import { familyMark } from '$lib/daydream/thought-groups';

  interface Props {
    /** How many are held, for the button. */
    held: number;
  }
  let { held }: Props = $props();

  type DeckCard = {
    id: string;
    kind: string;
    title: string;
    explanation: string;
    narrative: string | null;
    verified: boolean | null;
    score: number;
    recurrenceCount: number;
    suppressedReason: string | null;
  };
  type Verdict = 'useful' | 'not_useful' | 'never_kind';

  let open = $state(false);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let deck = $state<DeckCard[]>([]);
  let verdicts = $state<Record<string, Verdict>>({});
  let done = $state<{ recorded: number; failed: number } | null>(null);
  const verdictCount = $derived(Object.keys(verdicts).length);

  async function openDeck() {
    open = true;
    done = null;
    error = null;
    loading = true;
    const r = await postThought<{ deck?: DeckCard[] }>({ action: 'triage_deck', limit: 30 });
    if (!r.ok) {
      error = r.error;
      deck = [];
    } else {
      deck = r.out.deck ?? [];
      verdicts = {};
    }
    loading = false;
  }

  /** Tapping the same verdict again clears it — a mis-tap costs one tap. */
  function setVerdict(id: string, v: Verdict) {
    if (verdicts[id] === v) {
      const { [id]: _dropped, ...rest } = verdicts;
      verdicts = rest;
    } else {
      verdicts = { ...verdicts, [id]: v };
    }
  }

  async function save() {
    const payload = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));
    if (payload.length === 0) return;
    saving = true;
    error = null;
    const r = await postThought<{ recorded?: number; failed?: { id: string }[] }>({ action: 'triage_batch', verdicts: payload });
    if (!r.ok) error = r.error;
    else {
      done = { recorded: r.out.recorded ?? 0, failed: (r.out.failed ?? []).length };
      const failedIds = new Set((r.out.failed ?? []).map((f) => f.id));
      deck = deck.filter((c) => failedIds.has(c.id) || !(c.id in verdicts));
      const remaining: Record<string, Verdict> = {};
      for (const [k, v] of Object.entries(verdicts)) if (failedIds.has(k)) remaining[k] = v;
      verdicts = remaining;
      await invalidateAll();
    }
    saving = false;
  }
</script>

<div class="deck-hd">
  <div>
    <p class="field-label">What it nearly said</p>
    <p class="lede">
      {held} held back below the bar, so nothing was sent. That bar was set with no evidence at all — rating a few here is the only thing that moves it. None of this counts as a notification.
    </p>
  </div>
  <div class="actions">
    {#if !open}
      <button type="button" class="cta" onclick={openDeck}>Sort through {held}</button>
    {:else}
      {#if verdictCount}
        <button type="button" class="cta" disabled={saving} onclick={save}>
          {saving ? 'Saving…' : `Save ${verdictCount} verdict${verdictCount === 1 ? '' : 's'}`}
        </button>
      {/if}
      <button type="button" class="btn" onclick={() => { open = false; }}>Close</button>
    {/if}
  </div>
</div>

{#if done}
  <p class="note good">Recorded {done.recorded}{done.failed ? `, ${done.failed} failed` : ''}. Counted at 0.7 of a considered verdict.</p>
{/if}
{#if error}<p class="err">{error}</p>{/if}

{#if open}
  {#if loading}
    <p class="lede">Loading…</p>
  {:else if deck.length === 0}
    <p class="lede">Nothing left to sort.</p>
  {:else}
    <div class="grid">
      {#each deck as c (c.id)}
        <div class="card t-{verdicts[c.id] ? 'good' : 'watch'}" class:ruled={verdicts[c.id]}>
          <p class="card-kicker"><span class="mark">{familyMark(c.kind)}</span> · score {c.score}{c.recurrenceCount > 1 ? ` · proposed ${c.recurrenceCount}×` : ''}</p>
          <p class="card-title as-text">{c.title}</p>
          <p class="card-body">{c.narrative || c.explanation}</p>
          <div class="card-actions">
            <button type="button" class="btn" class:picked={verdicts[c.id] === 'useful'} onclick={() => setVerdict(c.id, 'useful')}>Useful</button>
            <button type="button" class="btn" class:picked={verdicts[c.id] === 'not_useful'} onclick={() => setVerdict(c.id, 'not_useful')}>Not useful</button>
            <button type="button" class="btn danger" class:picked={verdicts[c.id] === 'never_kind'} onclick={() => setVerdict(c.id, 'never_kind')}>Never this kind</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .deck-hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .deck-hd .lede {
    margin: 0;
    max-width: 70ch;
  }
</style>
