<script lang="ts">
  // What actually reached him, against what was allowed to.
  //
  // The held-reason breakdown has been in the ledger since the reviewer
  // shipped and was drawn nowhere, so "why is it quiet" had no answer on the
  // page that asks it. Four facts about the budget for interruptions — sent
  // today against the cap, sent this week, when the next slot opens and why,
  // and the hours outside which nothing goes — then one cell per reason a
  // thought was held today, with the week's tally as a line underneath.
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import type { Tone } from '$lib/daydream/priority';
  import { ago, when } from './engine-format';

  /** The shape of `loadDeliveryStats()`. Declared here rather than imported
   *  from `rooms/engine.server.ts` for the reason the panel beside it declares
   *  `Schedule`: a component may not reach into a `.server` module even for a
   *  type, and the import that only carries a type today is the one somebody
   *  adds a value to tomorrow. */
  interface DeliveryStats {
    sentToday: number;
    cap: number;
    sent7d: number;
    heldToday: Array<{ reason: string; n: number }>;
    held7d: Array<{ reason: string; n: number }>;
    lastSentAt: string | null;
    nextSlot: { at: string | null; why: string };
    quietHours: { start: number; end: number };
  }

  interface Props {
    stats: DeliveryStats;
  }

  let { stats }: Props = $props();

  const words = (reason: string) => reason.replace(/_/g, ' ');
  const hh = (h: number) => String(h).padStart(2, '0');

  /** A hold is not a fault. Two reasons mean the engine doubted itself and are
   *  worth a look; two mean a route said "not this way" and are the system
   *  working. Everything else is ordinary. */
  function heldTone(reason: string): Tone {
    if (reason === 'uncertain_after_review' || reason === 'needs_source') return 'watch';
    if (reason === 'feed_only' || reason === 'briefing_only') return 'quiet';
    return 'steady';
  }

  /** The server writes `at` as "now" when the slot is open, so by the time it
   *  renders it is a moment in the past — `when` says "due", which reads wrong
   *  for a thing that is simply available. */
  const nextWord = $derived.by(() => {
    if (!stats.nextSlot.at) return 'closed';
    const w = when(stats.nextSlot.at);
    return w === 'due' || w === '—' ? 'open now' : w;
  });
  const slotOpen = $derived(nextWord === 'open now');

  const cells = $derived.by((): RollupCell[] => {
    const out: RollupCell[] = [
      {
        key: 'today',
        label: 'Sent today',
        value: String(stats.sentToday),
        suffix: `/${stats.cap}`,
        tone: stats.sentToday > 0 ? 'action' : 'quiet',
        sub: stats.lastSentAt ? `last ${ago(stats.lastSentAt)}` : 'nothing has interrupted you today',
      },
      {
        key: 'week',
        label: 'Sent, 7 days',
        value: String(stats.sent7d),
        tone: 'steady',
        sub: `against a ceiling of ${stats.cap * 7}`,
      },
      {
        key: 'slot',
        label: 'Next slot',
        value: nextWord,
        tone: slotOpen ? 'good' : 'watch',
        sub: stats.nextSlot.why,
      },
      {
        key: 'quiet',
        label: 'Quiet hours',
        value: `${hh(stats.quietHours.start)}–${hh(stats.quietHours.end)}`,
        tone: 'quiet',
        sub: 'nothing interrupts outside these hours',
      },
    ];
    for (const h of stats.heldToday.slice(0, 6)) {
      out.push({
        key: `held-${h.reason}`,
        label: words(h.reason),
        value: String(h.n),
        tone: heldTone(h.reason),
        corner: 'held',
        sub: 'today',
      });
    }
    return out;
  });

  const weekLine = $derived(
    stats.held7d.length
      ? stats.held7d.map((h) => `${words(h.reason)} ${h.n}`).join(' · ')
      : null,
  );
</script>

<RollupGrid {cells} min={170} />

<p class="note">
  {#if weekLine}
    Held in the last seven days — {weekLine}. A hold is a thought that was made and then not
    sent; the reason is the rule that stopped it, not a fault in the thought.
  {:else}
    Nothing has been held in the last seven days.
  {/if}
</p>
