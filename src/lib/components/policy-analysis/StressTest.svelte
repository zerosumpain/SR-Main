<script lang="ts">
  // THE STRESS TEST — the one thing on this page you can run rather than read.
  //
  // Every question a policy professional asks about a red-team assessment
  // eventually reduces to "and what if we're wrong about that?" — and until now
  // the only way to answer it was to read fifteen chapters holding one hypothesis
  // in your head. The assessment already states every link needed to answer it
  // properly: a model and a scenario name the assumptions they rest on, a play
  // names the preconditions it needs, a finding names its hypotheses and its
  // results, a recommendation names its findings.
  //
  // So this recomputes rather than re-asks. No model call, no fresh opinion, and
  // the same answer every time — which is the difference between a sensitivity
  // analysis and a second guess.
  //
  // The two directions are shown as OPPOSITES on purpose, because collapsing them
  // would be worse than not offering the tool. A conclusion resting on a false
  // hypothesis loses its footing. A play whose precondition fails is DISARMED —
  // the actor needed that to be true, so the same switch is bad news for the
  // report and good news for the policy, and a reader has to see both.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { leverage, stress, type StressRow } from '$lib/policy-analysis/stress';

  interface Props {
    artefacts: Artefact[];
    inspect: (id: string) => void;
  }

  let { artefacts, inspect }: Props = $props();

  let failed = $state<string[]>([]);

  const levers = $derived(leverage(artefacts));
  const result = $derived(stress(artefacts, failed));
  const hurt = (rows: StressRow[]) => rows.filter((r) => r.standing !== 'holds');
  const affectedFindings = $derived(hurt(result.findings));
  const affectedRecommendations = $derived(hurt(result.recommendations));
  const disarmed = $derived(hurt(result.plays));
  const affectedReasoning = $derived([...hurt(result.models), ...hurt(result.scenarios)]);

  const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}%`;

  function toggle(id: string) {
    failed = failed.includes(id) ? failed.filter((f) => f !== id) : [...failed, id];
  }
</script>

{#if levers.length}
  <div class="stress">
    <div class="levers">
      <p class="sr-label">Suppose these turn out to be wrong</p>
      <p class="muted intro">
        Only assumptions something actually cites are offered — a hypothesis nothing rests on cannot change
        an answer, and a switch that does nothing when you pull it is a worse answer than no switch.
      </p>
      <div class="lever-actions">
        <button class="link" onclick={() => (failed = levers.slice(0, 3).map((l) => l.artefact.id))}>Fail the three most load-bearing</button>
        {#if failed.length}<button class="link" onclick={() => (failed = [])}>Reset</button>{/if}
      </div>
      <ul>
        {#each levers.slice(0, 14) as lever (lever.artefact.id)}
          {@const on = failed.includes(lever.artefact.id)}
          <li class:on>
            <label>
              <input type="checkbox" checked={on} onchange={() => toggle(lever.artefact.id)} />
              <span class="lever-body">
                <span class="lever-label">{lever.artefact.label}</span>
                <span class="muted">
                  {lever.dependants} {lever.dependants === 1 ? 'thing rests on it' : 'things rest on it'}
                  {#if lever.priority} · the run rated it {pct(lever.priority)} on importance × uncertainty × consequence{/if}
                </span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
      {#if levers.length > 14}<p class="muted">{levers.length - 14} further cited assumptions are not listed; open one from the report to read it.</p>{/if}
    </div>

    <div class="outcome" aria-live="polite">
      {#if !failed.length}
        <p class="headline">The assessment as written.</p>
        <p>
          Switch an assumption off on the left and this recomputes: which conclusions lose their footing,
          which redesign options lose the findings behind them, and which plays stop being available at all.
        </p>
        <p class="muted">
          Nothing here is a prediction and nothing calls a model. It walks the citations the assessment
          already made, so the same switches always give the same answer.
        </p>
      {:else}
        <p class="headline">
          {result.counts.total === 0
            ? 'Nothing in the assessment moves.'
            : `${result.counts.total} ${result.counts.total === 1 ? 'part' : 'parts'} of the assessment move.`}
        </p>

        {#if affectedFindings.length}
          <section class="group">
            <h4>{affectedFindings.length} {affectedFindings.length === 1 ? 'conclusion loses' : 'conclusions lose'} footing</h4>
            <p class="muted">Not shown to be wrong — no longer supported by what was cited for them.</p>
            <ul>
              {#each affectedFindings.slice(0, 8) as row (row.artefact.id)}
                <li>
                  <span class="tag" class:gone={row.standing === 'unsupported'}>{row.standing === 'unsupported' ? 'unsupported' : 'weakened'}</span>
                  <button class="link" onclick={() => inspect(row.artefact.id)}>{row.artefact.label}</button>
                  <span class="muted why">{row.because[0]}</span>
                </li>
              {/each}
            </ul>
            {#if affectedFindings.length > 8}<p class="muted">and {affectedFindings.length - 8} more</p>{/if}
          </section>
        {/if}

        {#if affectedRecommendations.length}
          <section class="group">
            <h4>{affectedRecommendations.length} redesign {affectedRecommendations.length === 1 ? 'option loses' : 'options lose'} the finding behind it</h4>
            <ul>
              {#each affectedRecommendations as row (row.artefact.id)}
                <li>
                  <span class="tag" class:gone={row.standing === 'unsupported'}>{row.standing === 'unsupported' ? 'unsupported' : 'weakened'}</span>
                  <button class="link" onclick={() => inspect(row.artefact.id)}>{row.artefact.label}</button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if disarmed.length}
          <section class="group disarmed">
            <h4>{disarmed.length} {disarmed.length === 1 ? 'play is' : 'plays are'} disarmed</h4>
            <p class="muted">
              The actor needed that to be true to run it. This is the direction that helps the policy — and
              it is the same switch, which is why the two are never shown as one number.
            </p>
            <ul>
              {#each disarmed.slice(0, 8) as row (row.artefact.id)}
                <li>
                  <span class="tag off">off the table</span>
                  <button class="link" onclick={() => inspect(row.artefact.id)}>{row.artefact.label}</button>
                  <span class="muted why">{row.because[0]}</span>
                </li>
              {/each}
            </ul>
            {#if disarmed.length > 8}<p class="muted">and {disarmed.length - 8} more</p>{/if}
          </section>
        {/if}

        {#if affectedReasoning.length}
          <section class="group">
            <h4>{affectedReasoning.length} {affectedReasoning.length === 1 ? 'model or scenario stops' : 'models and scenarios stop'} standing</h4>
            <ul>
              {#each affectedReasoning.slice(0, 6) as row (row.artefact.id)}
                <li><button class="link" onclick={() => inspect(row.artefact.id)}>{row.artefact.label}</button></li>
              {/each}
            </ul>
          </section>
        {/if}

        <p class="muted holds">
          The {result.checksHeld} structural {result.checksHeld === 1 ? 'check is' : 'checks are'} untouched by any of this.
          They walk the relationships the policy itself states, so they are the part of the assessment that does
          not move when a hypothesis does.
        </p>
      {/if}
    </div>
  </div>
{:else}
  <p class="muted">No assumption in this assessment is cited by a model, scenario, play or finding, so there is nothing to stress yet.</p>
{/if}

<style>
  .stress { display: grid; grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr); gap: 1.75rem; align-items: start; margin-top: 1.25rem; }
  @media (max-width: 860px) { .stress { grid-template-columns: 1fr; } }
  .intro { margin: .35rem 0 .75rem; }
  .lever-actions { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: .5rem; }
  .levers ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); }
  .levers li { background: var(--bg); padding: .55rem .7rem; }
  .levers li.on { background: var(--accent-tint-04); border-left: 3px solid var(--accent); }
  label { display: flex; gap: .6rem; align-items: start; cursor: pointer; }
  input { margin-top: .2rem; accent-color: var(--accent); flex: none; }
  .lever-body { display: grid; gap: .15rem; min-width: 0; }
  .lever-label { font-weight: 600; }
  .outcome { border-left: 2px solid var(--accent); padding-left: 1.25rem; min-height: 12rem; }
  .headline { font-family: var(--font-display); font-size: var(--fs-display-xs); margin: 0 0 .6rem; }
  .group { border-top: 1px solid var(--line); padding-top: .9rem; margin-top: 1rem; }
  .group h4 { margin: 0 0 .3rem; font-size: var(--fs-body-lg); }
  .group ul { list-style: none; padding: 0; margin: .5rem 0 0; display: grid; gap: .45rem; }
  .group li { display: flex; gap: .5rem; flex-wrap: wrap; align-items: baseline; }
  .tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .1rem .4rem; background: var(--surface-sunken); color: var(--text-secondary); flex: none; }
  .tag.gone { background: var(--accent); color: var(--bg); }
  .tag.off { background: var(--good); color: var(--bg); }
  .disarmed { border-top-color: var(--good); }
  .why { flex-basis: 100%; }
  .holds { border-top: 1px solid var(--line); margin-top: 1.25rem; padding-top: .75rem; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .link { font: inherit; background: none; border: 0; padding: 0; text-align: left; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }

  /*
   * On paper the switches are inert, so they are dropped and the levers read as
   * what they are: the assumptions this assessment turns on, and how much rests
   * on each. Whatever the reader had switched on when they pressed print stays
   * in the outcome beside it.
   */
  @media print {
    .stress { grid-template-columns: 1fr; }
    .lever-actions, input[type='checkbox'] { display: none; }
    .levers li { break-inside: avoid; }
    .outcome { border-left: 2px solid #000; }
  }
</style>
