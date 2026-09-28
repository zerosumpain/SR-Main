<script lang="ts">
  // The Inbox (spec 2026-09-28, daydream UX).
  //
  // The page teaches one process — Spotted → Your call → In motion → Result —
  // and every part of it uses those four words: the guide at the top (open on
  // a first visit), the filter, and the small track on each card. The default
  // view is what is waiting on you; a note you answer stays in view with your
  // answer on it until you change the filter, so the list never jumps under
  // your cursor.
  //
  // `?note=<id>` (every WhatsApp and phone notification) and
  // `?commission=<id>` (every double-check notification) open the whole list
  // and scroll to that card.
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { invalidateAll, goto } from '$app/navigation';
  import HowItWorks from '$lib/components/jkai/daydream/flow/HowItWorks.svelte';
  import OpportunityCard from '$lib/components/jkai/daydream/flow/OpportunityCard.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { postThought } from '$lib/daydream/feed-client';
  import { ago, clock, groupByDay, stamp } from '$lib/daydream/format';
  import type { FeedNote } from '$lib/daydream/think/notes';
  import type { Bucket, Stage } from '$lib/daydream/think/explain';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Filter = Bucket | 'all';
  // Deliberately the ARRIVAL value: a deep link opens the whole list once;
  // later navigations (preparing a check) keep whatever filter he chose.
  const deepLinked = untrack(() => !!(data.focus || data.commissionFocus));
  let filter = $state<Filter>(deepLinked ? 'all' : 'decide');
  /** Answered on this visit: kept in the view they were answered in. */
  const recent = new SvelteSet<string>();

  const byBucket = $derived({
    decide: data.notes.filter((n) => n.bucket === 'decide').length,
    motion: data.notes.filter((n) => n.bucket === 'motion').length,
    done: data.notes.filter((n) => n.bucket === 'done').length,
  });
  const guideCounts = $derived<Record<Stage, number>>({
    spotted: data.notes.length,
    decide: byBucket.decide,
    motion: byBucket.motion,
    result: byBucket.done,
  });
  const visible = $derived(data.notes.filter((n) => filter === 'all' || n.bucket === filter || recent.has(n.id)));
  const groups = $derived(groupByDay(visible));
  const commissionFor = (n: FeedNote) => (n.commission ? (data.commissions.find((c) => c.id === n.commission!.id) ?? null) : null);

  const FILTERS: Array<{ id: Filter; label: string; hint: string }> = [
    { id: 'decide', label: 'To decide', hint: 'Waiting on you' },
    { id: 'motion', label: 'In motion', hint: 'Running without you' },
    { id: 'done', label: 'Done', hint: 'Answered or finished' },
    { id: 'all', label: 'All', hint: 'The last 30 days' },
  ];
  function pick(f: Filter) {
    filter = f;
    recent.clear();
  }

  // Deep links land ON the card. The tracked reads are the server's focus
  // ids; the scroll runs untracked so this cannot re-run on what it caused.
  $effect(() => {
    const id = data.focus;
    const cid = data.commissionFocus;
    untrack(() => {
      const target = cid ? `commission-${cid}` : id && data.notes.some((n) => n.id === id) ? `note-${id}` : null;
      if (!target) return;
      // Instantly: a smooth scroll is cancelled by the navigation's own
      // scroll handling and lands short.
      void tick().then(() => requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' })));
    });
  });

  // ── Answers ───────────────────────────────────────────────────────────────
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function say(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3500);
  }

  async function act(body: Record<string, unknown>, key: string): Promise<boolean> {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error;
    else await invalidateAll();
    busy = null;
    return r.ok;
  }
  async function rate(n: FeedNote, verdict: 'useful' | 'not_useful' | 'never_kind') {
    recent.add(n.id);
    if (await act({ action: 'feedback', id: n.id, verdict }, `${n.id}:${verdict}`)) {
      say(verdict === 'useful' ? 'Kept — it will look for more like this.' : verdict === 'not_useful' ? 'Noted — fewer like this.' : `Muted — no more “${n.outcomeLabel.toLowerCase()}” notes.`);
    }
  }
  async function prepare(n: FeedNote) {
    busy = `${n.id}:prepare`;
    actionError = null;
    try {
      const response = await fetch('/api/daydream/commissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', thoughtId: n.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The double-check could not be prepared.');
      recent.add(n.id);
      await goto(result.commission.url, { invalidateAll: true, noScroll: true, keepFocus: true });
      say('Double-check prepared — read it and approve when ready.');
    } catch (e) {
      actionError = e instanceof Error ? e.message : 'The double-check could not be prepared.';
    } finally {
      busy = null;
    }
  }
</script>

<!-- ── The engine, in one line ────────────────────────────────────────────── -->
<section class="band flush strip-band" aria-label="What jkai is doing">
  <div class="inner">
    <p class="strip">
      {#if data.strip}
        {#if data.strip.last}
          <span class="strip-item" title={data.strip.last.summary}>
            <span class="strip-k">Last look</span>
            <span class="stamp" title={stamp(data.strip.last.at)}>{clock(data.strip.last.at)} · {ago(data.strip.last.at)}</span>
            {#if data.strip.last.question}<span class="strip-q">{data.strip.last.question}</span>{/if}
            {#if !data.strip.last.ok}<span class="strip-warn">did not finish</span>{/if}
          </span>
        {:else}
          <span class="strip-item"><span class="strip-k">Last look</span> none yet</span>
        {/if}
        <span class="strip-item"><span class="strip-k">Today</span> {data.strip.cyclesToday} look{data.strip.cyclesToday === 1 ? '' : 's'}</span>
        <span class="strip-item" class:strip-warn={data.strip.raisedToday >= data.cap}>
          <span class="strip-k">Messaged you</span> {data.strip.raisedToday} of {data.cap} today
        </span>
        <span class="strip-item"><span class="strip-k">Next look</span> <span class="strip-q">{data.strip.next.question}</span></span>
      {:else}
        <span class="strip-item"><span class="strip-k">Engine</span> its state could not be read just now</span>
      {/if}
    </p>
  </div>
</section>

<section class="band guide-band">
  <div class="inner">
    <HowItWorks
      counts={guideCounts}
      captions={{ spotted: 'in the last 30 days', decide: 'waiting on you', motion: 'running without you', result: 'answered or finished' }}
    />
  </div>
</section>

{#if data.loadError}
  <section class="band"><div class="inner"><LoadErrorCard kicker="The notes did not load" message={data.loadError} /></div></section>
{/if}

<section class="band list-band">
  <div class="inner">
    <div class="list-head">
      <h2 class="list-title">{FILTERS.find((f) => f.id === filter)?.label ?? 'All'}</h2>
      <div class="seg" role="tablist" aria-label="Show">
        {#each FILTERS as f (f.id)}
          <button type="button" role="tab" class="seg-btn" aria-selected={filter === f.id} title={f.hint} onclick={() => pick(f.id)}>
            {f.label}
            <span class="seg-n">{f.id === 'all' ? data.notes.length : byBucket[f.id]}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if data.commissionError}<p class="err" role="alert">{data.commissionError}</p>{/if}
    {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}

    {#if visible.length === 0}
      <div class="empty">
        {#if filter === 'decide'}
          <p class="empty-t">You are all caught up.</p>
          <p class="empty-s">
            Nothing is waiting on you.
            {#if data.strip}The next look is {data.strip.next.question.toLowerCase()} — anything worth saying lands here.{/if}
          </p>
        {:else if filter === 'motion'}
          <p class="empty-t">Nothing running.</p>
          <p class="empty-s">When you approve a double-check, or accept a build idea in the backlog, it shows here until it reports back.</p>
        {:else}
          <p class="empty-t">Nothing here yet.</p>
          <p class="empty-s">jkai looks every 45 minutes in waking hours when nothing else is going on. Most looks rightly find nothing worth saying.</p>
        {/if}
      </div>
    {:else}
      {#each groups as g (g.day)}
        <h3 class="day">{g.heading}</h3>
        <ol class="cards">
          {#each g.items as n (n.id)}
            <li>
              <OpportunityCard
                {n}
                commission={commissionFor(n)}
                checksOn={data.commissionEnabled}
                focused={data.focus === n.id}
                focusCommission={!!n.commission && n.commission.id === data.commissionFocus}
                {busy}
                onrate={(v) => rate(n, v)}
                onprepare={() => prepare(n)}
                onsavenote={(text) => act({ action: 'add_note', thoughtId: n.id, text }, `${n.id}:note`)}
                onunmute={() => act({ action: 'unmute_kind', kind: n.kind }, `${n.id}:unmute`)}
              />
            </li>
          {/each}
        </ol>
      {/each}
    {/if}
  </div>
</section>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  /* ── The strip ── one mono line, wrapping at a phone's width rather than
     scrolling. */
  .strip-band {
    padding-top: 18px;
    padding-bottom: 0;
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    margin: 0;
    padding: 12px 0;
    border-top: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .strip-item {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
    min-width: 0;
  }
  .strip-k {
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .strip-q {
    color: var(--text-primary);
  }
  .stamp {
    font-variant-numeric: tabular-nums;
  }
  .strip-warn {
    color: var(--warn);
  }
  .guide-band {
    border-top: 0;
    padding-bottom: 8px;
  }
  .list-band {
    border-top: 0;
    padding-top: 12px;
  }

  /* ── The filter ── */
  .list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 20px;
    padding-bottom: 12px;
    border-bottom: var(--line-title, 2px) solid var(--text-primary);
  }
  .list-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--fs-display-sm);
    line-height: 1;
    text-transform: uppercase;
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--text-primary);
  }
  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    background: transparent;
    border: 0;
    border-right: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
    min-height: 40px;
  }
  .seg-btn:last-child {
    border-right: 0;
  }
  .seg-btn[aria-selected='true'] {
    background: var(--text-primary);
    color: var(--bg);
  }
  .seg-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .seg-n {
    font-variant-numeric: tabular-nums;
    padding: 1px 7px;
    border-radius: 100px;
    background: var(--accent-tint-14);
    color: var(--text-primary);
  }
  .seg-btn[aria-selected='true'] .seg-n {
    background: var(--accent);
    color: var(--bg);
  }

  /* ── The list ── */
  .day {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 26px 0 10px;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .empty {
    margin-top: 22px;
    padding: 28px 24px;
    border: 1px dashed var(--line-strong);
    text-align: center;
  }
  .empty-t {
    margin: 0 0 6px;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    text-transform: uppercase;
  }
  .empty-s {
    margin: 0 auto;
    max-width: 56ch;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 50;
    max-width: min(92vw, 520px);
    padding: 12px 18px;
    background: var(--text-primary);
    color: var(--bg);
    font-size: var(--fs-body-sm);
  }
  @media (max-width: 640px) {
    .seg {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .seg-btn {
      flex-direction: column;
      justify-content: center;
      gap: 4px;
      padding: 8px 4px;
      letter-spacing: 0.04em;
    }
  }
</style>
