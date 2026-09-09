<script lang="ts">
  // G — WHAT ONLY SHOWS UP ACROSS POLICIES. A weakness that needs two documents
  // to see: one body told two incompatible things, a burden bearable once and
  // not three times, an assumption several policies all rest on.
  //
  // Both directions are shown. An exposure is written onto whichever assessment
  // FOUND it, so a policy can be half of a pair without a word of it on its own
  // page — `inbound` is that other half, pulled in from the assessment that
  // named this one.
  import type { Artefact } from '$lib/policy-analysis/contracts';

  type Inbound = { id: string; label: string; statement: string; data: Record<string, unknown>; analysisId: string; analysisTitle: string };

  interface Props {
    found: Artefact[];
    inbound: Inbound[];
    /** Named when the stage ran and had nothing to compare against. */
    unavailable: boolean;
    inspect: (id: string) => void;
  }

  let { found, inbound, unavailable, inspect }: Props = $props();

  const PATTERN_LABEL: Record<string, string> = {
    conflicting_demand: 'Conflicting demands on one body',
    cumulative_burden: 'Burden that only bites when stacked',
    shared_assumption: 'One assumption holding up several policies',
    regime_arbitrage: 'A gap between two regimes to exploit',
    common_actor_overload: 'One actor carrying too much of the programme',
    contradictory_measure: 'Two measures rewarding opposite behaviour',
    duplicated_authority: 'The same authority claimed twice',
  };
  const label = (p: unknown) => PATTERN_LABEL[String(p)] ?? String(p).replaceAll('_', ' ');
  const severity = (v: unknown) => Math.round(Number(v ?? 0) * 100);
</script>

{#if found.length}
  <ol class="exposures">
    {#each found as item (item.id)}
      <li>
        <p class="pattern">{label(item.data.pattern)} · severity {severity(item.data.severity)}</p>
        <h3>{item.label}</h3>
        <p>{item.statement}</p>
        <p class="against">
          Against
          <a href={`/policy-analysis/${item.data.otherAnalysisId}`}>{String(item.data.otherAnalysisTitle)}</a>
        </p>
        {#if item.data.consequence}<p><strong>Consequence.</strong> {String(item.data.consequence)}</p>{/if}
        {#if item.data.action}<p class="action"><strong>What to do.</strong> {String(item.data.action)}</p>{/if}
        {#if item.data.evidenceLimits}<p class="muted"><strong>Limits.</strong> {String(item.data.evidenceLimits)}</p>{/if}
        <button class="trace" onclick={() => inspect(item.id)}>Evidence in this assessment ({item.refs.length}) →</button>
      </li>
    {/each}
  </ol>
{/if}

{#if inbound.length}
  <div class="inbound">
    <p class="sr-label">Named by another assessment</p>
    <ol class="exposures">
      {#each inbound as item (item.id)}
        <li>
          <p class="pattern">{label(item.data.pattern)} · severity {severity(item.data.severity)}</p>
          <h3>{item.label}</h3>
          <p>{item.statement}</p>
          <p class="against">Found while assessing <a href={`/policy-analysis/${item.analysisId}`}>{item.analysisTitle}</a></p>
        </li>
      {/each}
    </ol>
  </div>
{/if}

{#if !found.length && !inbound.length}
  <p class="empty">
    {#if unavailable}
      This is the only completed assessment on this account, so nothing could be compared against it. Weaknesses that appear only when two policies land on the same people are outside what has been examined here — submit a second policy and this section fills in.
    {:else}
      Nothing was found that spans this policy and another. That is a result of a bounded comparison against completed assessments, not a guarantee that no interaction exists.
    {/if}
  </p>
{/if}

<style>
  .exposures { list-style: none; padding: 0; margin: 1.25rem 0 0; }
  .exposures > li { border-top: 1px solid var(--line-strong); padding: 1.1rem 0; }
  .pattern { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); margin: 0 0 .4rem; }
  h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: 0 0 .4rem; }
  .exposures p { margin: 0 0 .45rem; }
  .against { font-size: var(--fs-label); }
  .action { background: var(--surface-sunken); border-left: 2px solid var(--accent-ink); padding: .7rem .9rem; }
  .inbound { margin-top: 2rem; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0; }
  .empty { border-left: 2px solid var(--line-strong); padding-left: 1rem; color: var(--text-secondary); margin-top: 1.25rem; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .trace { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
</style>
