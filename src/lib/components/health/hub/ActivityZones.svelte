<script lang="ts">
  // 05 — HEART-RATE ZONES. One 30px stacked bar and the six bands under it.
  //
  // The header carries HRmax AND WHERE IT CAME FROM. Every edge below is a
  // fraction of that one number, so a reader who does not know whether it was
  // measured off a real effort or estimated from an age formula cannot tell
  // whether "19:42 in Z4" is a fact or an inference. That is what the evidence
  // chip beside it opens.
  //
  // Six segments, always six: a zone with no time in it is a zero in the table
  // rather than a missing column, so the bands do not silently renumber.
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import { formatDuration } from '$lib/trails/format';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import { zoneRows, zonesNote } from '$lib/health/activity-detail';

  interface Props {
    physio: ActivityPhysio;
    onevidence: (id: string) => void;
  }

  let { physio, onevidence }: Props = $props();

  const rows = $derived(physio.zones ? zoneRows(physio.zones, physio.zoneEdges) : []);
  const note = $derived(zonesNote(rows));
</script>

{#if rows.length}
  <section class="az">
    <div class="az-inner">
      <div class="az-head">
        <p class="az-kicker">Heart-rate zones</p>
        <p class="az-meta">
          HRmax {physio.hrMax} · {physio.hrMaxSource}
          <EvidenceChip id="hr-zones" onopen={onevidence} />
        </p>
      </div>

      <div class="az-bar" role="img" aria-label="Time in heart-rate zones">
        {#each rows as row (row.key)}
          {#if row.pct > 0}
            <div class="az-seg {row.key}" style:width="{row.pct}%"></div>
          {/if}
        {/each}
      </div>

      <div class="az-grid">
        {#each rows as row (row.key)}
          <div class="az-cell">
            <p class="az-band" class:lead={row.lead}>{row.label} {row.range}</p>
            <p class="az-time" class:lead={row.lead}>{formatDuration(row.seconds)}</p>
          </div>
        {/each}
      </div>

      {#if note}<p class="az-note">{note}</p>{/if}
    </div>
  </section>
{/if}

<style>
  .az {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid var(--line);
  }
  .az-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .az-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .az-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .az-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .az-bar {
    display: flex;
    height: 30px;
    margin-bottom: 3px;
  }
  .az-seg {
    height: 100%;
    min-width: 2px;
  }
  /* A sequential single-hue ramp: intensity is a magnitude, not five
     identities. Z0 stays neutral ink and Z5 goes to full ink, which is the
     only step that leaves the hue — it is the top of the scale, not a sixth
     colour. */
  .az-seg.z0 {
    background: color-mix(in srgb, var(--text-primary) 12%, transparent);
  }
  .az-seg.z1 {
    background: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }
  .az-seg.z2 {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .az-seg.z3 {
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .az-seg.z4 {
    background: var(--accent);
  }
  .az-seg.z5 {
    background: var(--text-primary);
  }

  .az-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    margin-top: 16px;
  }
  .az-cell {
    min-width: 0;
  }
  .az-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  .az-band.lead {
    color: var(--accent);
  }
  .az-time {
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    font-weight: 500;
    margin: 0;
  }
  .az-time.lead {
    font-weight: 700;
    color: var(--accent);
  }

  .az-note {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 84ch;
    text-wrap: pretty;
    margin: 22px 0 0;
  }

  @media (max-width: 700px) {
    .az-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px 10px;
    }
  }
</style>
