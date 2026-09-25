<script lang="ts">
  // The one feed (spec 2026-09-25, P2).
  //
  // What the think loop noticed, newest first, grouped by day: each note with
  // its outcome and channel, its own audited sentence, and the four things he
  // can say back — useful, not useful, never this kind, or a note in his own
  // words that becomes a memory. Above it, one line on the engine: the last
  // cycle and its question, cycles today, and how many of the day's four
  // interruptions are spent.
  //
  // `?note=<id>` (the link on every WhatsApp and phone notification) opens that
  // note and scrolls to it. Colour is priority (`noteTone`), never category;
  // category is the mark in the kicker.
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { invalidateAll } from '$app/navigation';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { noteTone } from '$lib/daydream/priority';
  import { postThought } from '$lib/daydream/feed-client';
  import { ago, clock, groupByDay, stamp } from '$lib/daydream/format';
  import type { FeedNote } from '$lib/daydream/think/notes';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const groups = $derived(groupByDay(data.notes));
  const unrated = $derived(data.notes.filter((n) => !n.verdict).length);

  // ── Open notes ────────────────────────────────────────────────────────────
  const open = new SvelteSet<string>();
  function toggle(id: string) {
    if (open.has(id)) open.delete(id);
    else open.add(id);
  }

  // `?note=` lands ON the note: open it, then bring it into view. The tracked
  // read is the server's `focus`; the writes are untracked so this cannot
  // re-run on what it assigned.
  $effect(() => {
    const id = data.focus;
    untrack(() => {
      if (!id || !data.notes.some((n) => n.id === id)) return;
      open.add(id);
      // After the open note has laid out, and instantly: a smooth scroll is
      // cancelled by the navigation's own scroll handling and lands short.
      void tick().then(() =>
        requestAnimationFrame(() => document.getElementById(`note-${id}`)?.scrollIntoView({ block: 'start' })),
      );
    });
  });

  // ── Saying something back ─────────────────────────────────────────────────
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  async function act(body: Record<string, unknown>, key: string): Promise<boolean> {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error;
    else await invalidateAll();
    busy = null;
    return r.ok;
  }
  const rate = (n: FeedNote, verdict: 'useful' | 'not_useful' | 'never_kind') =>
    act({ action: 'feedback', id: n.id, verdict }, `${n.id}:${verdict}`);

  let noting = $state<string | null>(null);
  let noteText = $state('');
  function startNote(n: FeedNote) {
    noting = n.id;
    noteText = n.ownerNote ?? '';
    open.add(n.id);
  }
  async function saveNote(n: FeedNote) {
    const text = noteText.trim();
    if (!text) return;
    if (await act({ action: 'add_note', thoughtId: n.id, text }, `${n.id}:note`)) {
      noting = null;
      noteText = '';
    }
  }

  function verdictWord(v: string): string {
    return v === 'useful' ? 'you said useful' : v === 'never_kind' ? 'you said never this kind' : 'you said not useful';
  }
  function paragraphs(body: string): string[] {
    return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  }
</script>

<!-- ── The engine, in one line ────────────────────────────────────────────── -->
<section class="band flush strip-band" aria-label="The engine">
  <div class="inner">
    <p class="strip">
      {#if data.strip}
        {#if data.strip.last}
          <span class="strip-item" title={data.strip.last.summary}>
            <span class="strip-k">Last cycle</span>
            <span class="stamp" title={stamp(data.strip.last.at)}>{clock(data.strip.last.at)} · {ago(data.strip.last.at)}</span>
            {#if data.strip.last.question}<span class="strip-q">{data.strip.last.question}</span>{/if}
            {#if !data.strip.last.ok}<span class="strip-warn">failed</span>{/if}
          </span>
        {:else}
          <span class="strip-item"><span class="strip-k">Last cycle</span> none yet</span>
        {/if}
        <span class="strip-item"><span class="strip-k">Today</span> {data.strip.cyclesToday} cycle{data.strip.cyclesToday === 1 ? '' : 's'}</span>
        <span class="strip-item" class:strip-warn={data.strip.raisedToday >= data.cap}>
          <span class="strip-k">Raised</span> {data.strip.raisedToday} of {data.cap} today
        </span>
        <span class="strip-item"><span class="strip-k">Next</span> <span class="strip-q">{data.strip.next.question}</span></span>
      {:else}
        <span class="strip-item"><span class="strip-k">Engine</span> its state could not be read just now</span>
      {/if}
    </p>
  </div>
</section>

{#if data.loadError}
  <section class="band"><div class="inner"><LoadErrorCard kicker="The feed did not load" message={data.loadError} /></div></section>
{/if}

<!-- ── The notes ──────────────────────────────────────────────────────────── -->
<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Noticed"
      title={['What it noticed,', 'newest first']}
      strap="Each note answers one question about one part of your life, and cites what it read. Tell it which were worth having: that is how it learns what to look for."
    />

    {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}

    {#if data.notes.length === 0}
      <div class="card t-quiet">
        <p class="card-body">
          Nothing noticed in the last 30 days. The think loop runs every 45 minutes in waking hours when
          nothing else is going on; most cycles rightly find nothing worth saying.
        </p>
      </div>
    {:else}
      <p class="note count-line">
        {data.notes.length} note{data.notes.length === 1 ? '' : 's'} in 30 days · {unrated} waiting on a verdict
      </p>
      {#each groups as g (g.day)}
        <h3 class="day">{g.heading}</h3>
        <ol class="notes">
          {#each g.items as n (n.id)}
            {@const isOpen = open.has(n.id)}
            {@const paras = paragraphs(n.body)}
            <li class="card t-{noteTone(n)}" class:open={isOpen} class:ruled={n.turnedDown} id="note-{n.id}">
              <p class="card-kicker">
                <span class="mark">{n.outcomeLabel}</span>
                {#if n.channelLabel !== n.outcomeLabel}
                  <span class="kicker-sep" aria-hidden="true">·</span>
                  <span>{n.channelLabel}</span>
                {/if}
              </p>
              <button type="button" class="card-title" aria-expanded={isOpen} onclick={() => toggle(n.id)}>{n.title}</button>

              {#if isOpen}
                {#each paras as p, i (i)}
                  <p class="card-body" class:lead={i === 0}>{p}</p>
                {/each}
                <p class="detail-line read"><span class="read-k">What it read</span> {n.read}</p>
              {:else}
                <p class="card-body clamp">{paras[0] ?? ''}</p>
              {/if}

              {#if n.ownerNote}
                <p class="detail-line said">You said: {n.ownerNote}</p>
              {/if}

              <div class="card-meta">
                <span class="meta-item stamp" title={stamp(n.createdAt)}>{clock(n.createdAt)}</span>
                <span class="meta-item">{n.raised ? 'sent to you' : 'kept to the feed'}</span>
                {#if n.verdict}
                  <span class="meta-item" class:good={n.verdict === 'useful'}>{verdictWord(n.verdict)}</span>
                {/if}
                {#if n.kindMuted}<span class="meta-item warn">this kind is muted</span>{/if}
              </div>

              <div class="card-actions">
                {#if !n.verdict}
                  <button type="button" class="btn sm" disabled={busy?.startsWith(n.id)} onclick={() => rate(n, 'useful')}>Useful</button>
                  <button type="button" class="btn sm" disabled={busy?.startsWith(n.id)} onclick={() => rate(n, 'not_useful')}>Not useful</button>
                  <button
                    type="button"
                    class="btn sm danger"
                    disabled={busy?.startsWith(n.id)}
                    title="Mute every note of this kind ({n.outcomeLabel.toLowerCase()}). Reversible here."
                    onclick={() => rate(n, 'never_kind')}>Never this kind</button
                  >
                {/if}
                {#if n.kindMuted}
                  <button type="button" class="btn sm" disabled={busy?.startsWith(n.id)} onclick={() => act({ action: 'unmute_kind', kind: n.kind }, `${n.id}:unmute`)}>Unmute this kind</button>
                {/if}
                {#if noting !== n.id}
                  <button type="button" class="btn sm" onclick={() => startNote(n)}>{n.ownerNote ? 'Change your note' : 'Add a note'}</button>
                {/if}
                <button type="button" class="cta sm" aria-expanded={isOpen} onclick={() => toggle(n.id)}>{isOpen ? 'Close' : 'Open'}</button>
              </div>

              {#if noting === n.id}
                <div class="note-form">
                  <label class="field-label" for="note-text-{n.id}">In your own words — it becomes a memory</label>
                  <textarea
                    id="note-text-{n.id}"
                    class="text-input area"
                    rows="3"
                    maxlength="1000"
                    bind:value={noteText}
                    placeholder="e.g. right about the heating, but the spare room is always cold"
                  ></textarea>
                  <div class="actions">
                    <button type="button" class="cta sm" disabled={busy === `${n.id}:note` || !noteText.trim()} onclick={() => saveNote(n)}>
                      {busy === `${n.id}:note` ? 'Saving…' : 'Save the note'}
                    </button>
                    <button type="button" class="btn sm" onclick={() => (noting = null)}>Cancel</button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      {/each}
    {/if}
  </div>
</section>

<style>
  /* ── The strip ── one mono line, wrapping at a phone's width rather than
     scrolling. Same register as the vocabulary's `.note`. */
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

  /* ── The notes ── */
  .count-line {
    margin: 0 0 8px;
  }
  .day {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 28px 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-hair);
  }
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Clear the sticky tab rail, with a little air, when `?note=` scrolls here. */
  .notes > li {
    scroll-margin-top: 80px;
  }
  .notes .card-kicker {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
  }
  .kicker-sep {
    color: var(--text-ghost);
  }
  .notes .card-title {
    display: block;
    width: 100%;
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .notes .card-body {
    overflow-wrap: anywhere;
    max-width: 88ch;
  }
  .notes .read {
    margin: 14px 0 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-label-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .read-k {
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-right: 6px;
  }
  .notes .said {
    margin: 14px 0 0;
    overflow-wrap: anywhere;
  }
  .note-form {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
