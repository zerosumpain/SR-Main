<script lang="ts">
  // The Mail room (2026-11-15): what his mail, calendar and documents say, as
  // the facts SR-Jkai-Core's reader extracted — what needs doing, what
  // daydream made of it, and how far the reading has got. The messages
  // themselves are never shown here; each row links out to the original.
  import { enhance } from '$app/forms';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import { ago } from '$lib/daydream/format';
  import { money } from '$lib/daydream/mail-room';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let asking = $state(false);

  const deck = $derived(data.room?.deck ?? null);
  const overdue = $derived(data.room?.due.filter((d) => d.overdue).length ?? 0);

  const tiles = $derived<DeckTile[]>(
    deck
      ? [
          {
            key: 'due',
            label: 'Needs doing',
            value: String(data.room?.due.length ?? 0),
            sub: overdue ? `${overdue} past the date` : 'in the next 60 days',
            tone: overdue ? 'action' : data.room?.due.length ? 'steady' : 'good',
            lit: overdue > 0,
          },
          { key: 'read', label: 'Read', value: deck.read.toLocaleString('en-GB'), sub: deck.sources.map((s) => `${s.total.toLocaleString('en-GB')} ${s.label.toLowerCase()}`).join(' · '), tone: 'steady' },
          { key: 'wait', label: 'Waiting to be read', value: deck.waiting.toLocaleString('en-GB'), sub: deck.failed ? `${deck.failed} could not be read` : 'newest and known senders first', tone: deck.waiting ? 'steady' : 'good' },
          {
            key: 'today',
            label: 'Read today',
            value: deck.today ? deck.today.items.toLocaleString('en-GB') : '0',
            sub: deck.today ? `${deck.today.calls} calls · $${deck.today.usd.toFixed(2)} measured` : 'nothing yet today',
            tone: 'quiet',
          },
        ]
      : [],
  );

  const STOPPED: Record<string, string> = {
    'daily-items': 'stopped at the daily item limit',
    'daily-usd': 'stopped at the daily spend limit',
    'model-down': 'stopped: the reading model was not answering',
  };

  function day(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }
</script>

<svelte:head><title>Mail room — Daydream</title></svelte:head>

{#if data.error || !data.room || !deck}
  <section class="band"><div class="inner"><LoadErrorCard kicker="The Mail room did not load" message={data.error ?? 'no data'} /></div></section>
{:else}
  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / What your mail says"
        title={['The mail', 'room']}
        strap="Every thread, calendar entry and document of yours is read once and kept as facts: what it is, what it costs, what it wants and by when. Daydream thinks over those facts, never the messages. Only what cannot wait reaches your phone; the rest is here."
      />
      <StatDeck {tiles} min={170} />
      <div class="status">
        <p class="meta">
          {#if deck.lastRun?.at}Last read {ago(deck.lastRun.at)}{:else}Not read yet{/if}{#if deck.lastRun?.stopped} · {STOPPED[deck.lastRun.stopped] ?? deck.lastRun.stopped}{/if}{#if deck.lastRun?.error} · {deck.lastRun.error}{/if}
        </p>
        {#each deck.backfill as b (b.email)}
          <p class="meta">{b.email}: {b.done ? 'twelve months listed' : b.reached ? `listed back to ${day(b.reached)}` : 'history not started'}</p>
        {/each}
        {#if deck.lastRun?.notGranted.length}
          <p class="meta warn">Not granted yet: {deck.lastRun.notGranted.join(', ')}. <a href="/admin/connections/gmail">Reconnect Google</a> to add them.</p>
        {/if}
        <form
          method="POST"
          action="?/run"
          use:enhance={() => {
            asking = true;
            return async ({ update }) => {
              await update();
              asking = false;
            };
          }}
        >
          <button type="submit" class="link-btn" disabled={asking}>{asking ? 'Asking…' : 'Read now'}</button>
          {#if form?.requested}<span class="meta">Asked. It starts within half a minute.</span>{/if}
          {#if form?.error}<span class="meta warn">{form.error}</span>{/if}
        </form>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="B / Needs something from you"
        title={['To do,', 'soonest first']}
        strap="Anything a message asked of you, with its date where it gave one. Past dates stay for a fortnight."
      />
      {#if !data.room.due.length}
        <p class="none">Nothing is waiting on you.</p>
      {:else}
        <ol class="reg">
          {#each data.room.due as d (d.id)}
            <li class="row" class:overdue={d.overdue}>
              <span class="r-when">{d.by ? day(d.by) : 'no date'}</span>
              <span class="r-kind">{d.category}</span>
              <span class="r-what">
                <span class="r-todo">{d.todo ?? d.summary}</span>
                <span class="r-note">{d.from} · {d.sourceLabel.toLowerCase()} of {day(d.day)}{#if d.amount} · {money(d.amount.minor, d.amount.currency)}{/if}{#if d.todo} · {d.summary}{/if}</span>
              </span>
              <span class="r-state">
                {#if d.overdue}Past{/if}
                {#if d.href}<a href={d.href} target="_blank" rel="noopener noreferrer">Open</a>{/if}
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="C / What daydream made of it"
        title={['Notes from', 'the backlog']}
        strap="The last thirty days. A note that could not wait went to your Inbox as well; the others are only here and in Sunday's digest."
      />
      {#if !data.room.notes.length}
        <p class="none">No notes yet. Daydream works through a dozen items every half hour of quiet.</p>
      {:else}
        <ul class="notes">
          {#each data.room.notes as n (n.id)}
            <li class="note">
              <div class="n-head">
                <span class="n-title">{n.title}</span>
                <span class="meta">{day(n.day)} · {n.items} item{n.items === 1 ? '' : 's'}{n.status === 'delivered' ? ' · sent to you' : ''}</span>
              </div>
              {#each n.body.split(/\n{2,}/) as para, i (i)}
                <p class="n-body">{para}</p>
              {/each}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="D / Lately"
        title={['Read,', 'newest first']}
        strap="The forty most recent things read, marketing left out."
      />
      {#if !data.room.recent.length}
        <p class="none">Nothing read yet.</p>
      {:else}
        <ol class="reg">
          {#each data.room.recent as r (r.id)}
            <li class="row">
              <span class="r-when">{day(r.day)}</span>
              <span class="r-kind">{r.category}</span>
              <span class="r-what">
                <span>{r.summary}</span>
                <span class="r-note">{r.from} · {r.sourceLabel.toLowerCase()}{#if r.amount} · {money(r.amount.minor, r.amount.currency)}{/if}{#if r.todo} · to do: {r.todo}{/if}</span>
              </span>
              <span class="r-state">
                {#if r.href}<a href={r.href} target="_blank" rel="noopener noreferrer">Open</a>{/if}
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </section>
{/if}

<style>
  .none {
    color: var(--text-muted);
  }
  .status {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .meta,
  .r-when,
  .r-kind,
  .r-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .meta {
    margin: 0;
  }
  .warn {
    color: var(--accent);
  }
  .reg,
  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .notes {
    gap: 14px;
  }
  .note {
    border: 1px solid var(--line-hair);
    padding: 12px 14px;
    background: var(--surface-raised, transparent);
  }
  .n-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .n-title {
    font-weight: 600;
  }
  .n-body {
    margin: 8px 0 0;
    font-size: var(--fs-body-sm);
    overflow-wrap: anywhere;
  }
  .row {
    display: grid;
    grid-template-columns: 64px 110px minmax(0, 1fr) 80px;
    gap: 4px 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line-hair);
    align-items: baseline;
  }
  .row.overdue .r-when {
    color: var(--accent);
  }
  .r-what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .r-todo {
    font-weight: 600;
  }
  .r-note {
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .r-state {
    text-align: right;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .link-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .r-kind {
      grid-column: 2;
      grid-row: 1;
    }
    .r-what {
      grid-column: 1 / -1;
    }
    .r-state {
      grid-column: 1 / -1;
      text-align: left;
      flex-direction: row;
      gap: 12px;
    }
  }
</style>
