<script lang="ts">
  // The key figures at the top of a chapter.
  //
  // ONE tile treatment for the whole page. The hub used to carry two — a
  // "Signals" grid of its own and a second one inside the nested dashboard —
  // and having both on screen is most of why it read as two documents.
  //
  // Styles come from .h-statrow / .h-stat in app.css rather than a scoped block
  // here, so a chapter that lays these out itself gets the identical thing.
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  export interface Stat {
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    tone?: 'good' | 'warn' | 'bad' | 'neutral';
    /** Methodology entry id, when there is one worth citing. */
    evidence?: string;
  }

  let {
    stats,
    onevidence,
  }: { stats: Stat[]; onevidence?: (id: string) => void } = $props();
</script>

{#if stats.length > 0}
  <div class="h-statrow">
    {#each stats as s (s.label)}
      <div class="h-stat">
        <span
          class="h-stat-value"
          class:good={s.tone === 'good'}
          class:warn={s.tone === 'warn'}
          class:bad={s.tone === 'bad'}
        >
          {s.value}{#if s.unit}<span class="h-stat-unit">{s.unit}</span>{/if}
        </span>
        <span class="h-stat-label">{s.label}</span>
        {#if s.sub}<span class="h-stat-sub">{s.sub}</span>{/if}
        {#if s.evidence}<EvidenceChip id={s.evidence} onopen={onevidence} />{/if}
      </div>
    {/each}
  </div>
{/if}
