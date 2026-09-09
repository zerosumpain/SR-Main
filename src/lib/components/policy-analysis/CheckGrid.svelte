<script lang="ts">
  // D — WHERE THE POLICY IS THIN. The twelve deterministic checks, worst first.
  //
  // These are the only figures on the page no model produced: each one walks the
  // provenance graph and asks whether a relationship the policy relies on has
  // its counterpart. That makes the wording matter more than usual — a check
  // with nothing to look at is NOT a pass, and the row says so in those words
  // rather than colouring itself green.
  //
  // Status colour here is the site's reserved good/warn/error, and every row
  // carries its verdict in words as well, so nothing is encoded by colour alone.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { TEST_RESULTS } from '$lib/policy-analysis/view';

  interface Props {
    checks: Artefact[];
    inspect: (id: string) => void;
  }

  let { checks, inspect }: Props = $props();
  const meta = (result: string) => TEST_RESULTS.find((r) => r.key === result) ?? TEST_RESULTS[3];
  const counts = $derived(TEST_RESULTS.map((r) => ({ ...r, count: checks.filter((c) => c.data.result === r.key).length })));
</script>

{#if checks.length}
  <div class="summary" role="img" aria-label={counts.filter((c) => c.count).map((c) => `${c.count} ${c.label}`).join(', ')}>
    {#each counts.filter((c) => c.count) as c (c.key)}
      <span class="chip"><span class="dot" style="background: {c.hue}"></span>{c.count} {c.label}</span>
    {/each}
  </div>

  <ol class="checks">
    {#each checks as check (check.id)}
      {@const m = meta(String(check.data.result))}
      <li>
        <div class="verdict">
          <span class="dot" style="background: {m.hue}"></span>
          <span class="verdict-word">{m.label}</span>
        </div>
        <div class="body">
          <h3>{check.label}</h3>
          <p>{check.statement}</p>
          {#if check.data.mitigation}<p class="mitigation">{check.data.mitigation}</p>{/if}
          <button class="trace" onclick={() => inspect(check.id)}>The relationships this read ({check.refs.length}) →</button>
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .summary { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin: 1rem 0 1.25rem; }
  .chip { display: inline-flex; align-items: center; gap: .45rem; font-family: var(--font-mono); font-size: var(--fs-label); }
  .dot { width: .7rem; height: .7rem; border-radius: 100px; flex: none; border: 1px solid var(--line-strong); }
  .checks { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line-strong); }
  .checks li { display: grid; grid-template-columns: minmax(8rem, 10rem) minmax(0, 1fr); gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--line); }
  @media (max-width: 620px) { .checks li { grid-template-columns: 1fr; gap: .4rem; } }
  .verdict { display: flex; align-items: center; gap: .5rem; align-self: start; }
  .verdict-word { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; }
  h3 { font-size: var(--fs-body); font-weight: 700; margin: 0 0 .35rem; }
  .body p { margin: 0 0 .4rem; }
  .mitigation { color: var(--text-secondary); border-left: 2px solid var(--line-strong); padding-left: .75rem; }
  .trace { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
</style>
