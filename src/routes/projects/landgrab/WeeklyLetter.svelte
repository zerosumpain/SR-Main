<script lang="ts">
  /**
   * Last week, in the words the household already got over WhatsApp.
   *
   * The narrative is only printed when the verifier passed it. An unverified
   * draft is dropped whole rather than hedged — a letter that invents a take
   * is worse than no letter, because the whole point of it is that nobody has
   * to open the page to know what happened. The deterministic summary is
   * always there underneath, so the section is never empty when a letter
   * exists.
   */
  import type { WeeklyLetter } from './types';

  let { letter }: { letter: WeeklyLetter | null } = $props();

  /** Sundays, in UTC. The week-ending date is a local day string with no time
   *  in it, so parsing it as anything but UTC midnight moves it a day west. */
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  const weekEndingLabel = $derived.by(() => {
    if (!letter) return '';
    const at = new Date(`${letter.weekEnding}T00:00:00Z`);
    return Number.isNaN(at.getTime()) ? letter.weekEnding : dateFmt.format(at);
  });
</script>

{#if letter}
  <section class="lg-letter" aria-label="Last week's letter">
    <p class="lg-letter-kicker metric-label">Week ending {weekEndingLabel}</p>
    {#if letter.verified === true && letter.narrative}
      <p class="lg-letter-narrative">{letter.narrative}</p>
    {/if}
    <p class="lg-letter-summary">{letter.summary}</p>
  </section>
{:else}
  <p class="lg-letter-none">
    The first letter goes out on Sunday evening — movers and shakers, over WhatsApp.
  </p>
{/if}

<style>
  .lg-letter {
    border: 1px solid var(--line-strong);
    border-left: 4px solid var(--accent);
    background: var(--accent-tint-04);
    padding: 16px 18px 18px;
  }
  .lg-letter-kicker {
    margin: 0 0 10px;
  }
  .lg-letter-narrative {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 1.55;
    color: var(--text-primary);
    max-width: 62ch;
  }
  .lg-letter-summary {
    margin: 12px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 68ch;
  }
  .lg-letter-none {
    margin: 0;
    padding: 16px 18px;
    border: 1px solid var(--line-strong);
    border-left: 4px solid var(--accent-tint-35);
    background: var(--surface-sunken);
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 62ch;
  }
  @media (max-width: 700px) {
    .lg-letter,
    .lg-letter-none {
      padding-left: 14px;
      padding-right: 14px;
    }
  }
</style>
