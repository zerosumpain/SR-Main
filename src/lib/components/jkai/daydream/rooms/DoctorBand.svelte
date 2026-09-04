<script lang="ts">
  // What broke, and who fixed it.
  //
  // The doctor already had four rollup cells in this room; what it did not have
  // was the distinction the band draws. Two of these are the loop repairing
  // itself inside a narrow whitelist — nobody was asked — and the third is the
  // one that could not be, because it needed repo code and became an ordinary
  // fault in the same queue stage two counts. Reading them as one number hides
  // exactly that difference.
  import type { DoctorRollup } from '$lib/workflowdoctor/rollup';
  import { ago } from '$lib/daydream/format';

  interface Props {
    doctor: DoctorRollup;
    /** The heartbeat's live window, read from the row — never a constant. */
    window?: string | null;
    active?: boolean;
    kicker?: string;
  }

  let { doctor, window = null, active = true, kicker = 'The doctor' }: Props = $props();

  interface Strip {
    key: string;
    word: string;
    n: number;
    body: string;
    /** `good` is the loop fixing itself; `action` is work handed back to a person. */
    tone: 'good' | 'action';
  }

  const strips = $derived<Strip[]>([
    {
      key: 'stopped',
      word: 'Stopped',
      n: doctor.quarantinedLastNight,
      body: 'A runaway schedule the breaker stopped on its own. It stops the one that is writing and leaves the rest running.',
      tone: 'good',
    },
    {
      key: 'fixed',
      word: 'Fixed',
      n: doctor.fixedLastNight,
      body: 'Node config repaired inside the whitelist. Inside it, nobody was asked; outside it, nothing was touched.',
      tone: 'good',
    },
    {
      key: 'handed',
      word: 'Handed over',
      n: doctor.escalatedLastNight,
      body: 'Needed repo code, so the doctor could not touch it. Queued as an ordinary fault for you to look at.',
      tone: 'action',
    },
  ]);

  const quiet = $derived(strips.every((s) => !s.n));

  /* Assembled here rather than as nested `{#if}`s: Svelte trims the leading
     whitespace of a block, so the template version ran words together
     ("nightlyat 05:00"). Joining parts is also the only way the separators
     stay right when the middle part is the one that is missing. */
  const note = $derived.by(() => {
    const parts: string[] = [];
    if (quiet) parts.push('Nothing needed repairing in the last window');
    parts.push(`Triaged nightly${window ? ` at ${window}` : ''}${active ? '' : ' — the activity is paused'}`);
    parts.push(
      doctor.lastRunAt
        ? `last run ${ago(doctor.lastRunAt)}${doctor.lastRunStatus ? `, ${doctor.lastRunStatus}` : ''}`
        : 'no run recorded yet',
    );
    if (doctor.openFindings) parts.push(`${doctor.openFindings} still open`);
    return parts.join(' · ');
  });
</script>

<div class="db">
  <p class="db-kicker">{kicker}</p>
  <h3 class="db-title">What broke,<br />and who fixed it</h3>

  {#if doctor.error}
    <p class="db-note">The doctor rollup could not be read: {doctor.error}</p>
  {:else}
    <div class="db-grid">
      {#each strips as s (s.key)}
        <div class="db-strip t-{s.tone}" class:none={!s.n}>
          <p class="db-word">{s.word} <span class="db-n">{s.n}</span></p>
          <p class="db-body">{s.body}</p>
        </div>
      {/each}
    </div>

    <p class="db-note">
      {note} ·
      <a href="/jkai/daydreams/doctor">Open the full report →</a>
    </p>
  {/if}
</div>

<style>
  .db-kicker {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .db-title {
    margin: 0 0 22px;
    font-family: var(--font-display);
    font-size: clamp(28px, 3.4vw, 46px);
    line-height: 0.9;
    letter-spacing: -0.025em;
    text-transform: uppercase;
    color: var(--bg);
  }

  .db-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  .db-strip {
    --tone: var(--good-on-dark);
    --wash: rgba(138, 154, 91, 0.08);
    padding: 14px 16px;
    border-left: 3px solid var(--tone);
    background: var(--wash);
  }
  .db-strip.t-action {
    --tone: var(--accent-on-dark);
    --wash: rgba(232, 134, 58, 0.09);
  }
  /* A strip with nothing in it is still a fact — it keeps its place and reads
     as zero rather than disappearing and making the night look busier. */
  .db-strip.none {
    --wash: transparent;
    --tone: rgba(237, 228, 212, 0.2);
  }
  .db-strip.none .db-word,
  .db-strip.none .db-body {
    color: rgba(237, 228, 212, 0.4);
  }

  .db-word {
    margin: 0 0 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .db-n {
    font-family: var(--font-display);
    font-size: 18px;
    letter-spacing: 0;
    margin-left: 4px;
  }
  .db-body {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.7);
    text-wrap: pretty;
  }

  .db-note {
    margin: 18px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: rgba(237, 228, 212, 0.45);
  }
  .db-note a {
    color: var(--accent-on-dark);
  }
</style>
