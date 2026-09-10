<script lang="ts">
  // THE ASSESSMENT ITSELF — four workspaces over one artefact list.
  //
  // Extracted from the owner dashboard so the SHARED, read-only copy renders the
  // same report rather than a second implementation of it. That is not tidiness:
  // the audit that started this feature found the two sections it exists for —
  // the playbook and cross-policy exposure — had no tab at all on the page, and
  // two hand-maintained copies of a nine-section report is exactly how that
  // happens again.
  //
  // The component derives everything from `artefacts`, so a caller hands it a
  // list and nothing else. What differs between the two callers is what they
  // pass, not what this renders: a shared copy supplies no `cross` (it would
  // name the reader's other assessments) and no `runLog` (prompts, model output
  // and the uploaded paper are the owner's).
  //
  // Nine chapters end to end was an inventory of what the pipeline produced. A
  // reader arrives with one of four questions — what does it say, who can beat
  // it, what is it standing on, show me the working — and each workspace is a
  // place to sit and do a piece of work. Every panel stays in the DOM, so
  // find-in-page reaches a workspace nobody selected and printing unhides all
  // four.
  import { onMount, type Snippet } from 'svelte';
  import { REPORT_SECTIONS, type Artefact } from '$lib/policy-analysis/contracts';
  import * as view from '$lib/policy-analysis/view';
  import { TABS } from '$lib/policy-analysis/view';
  import PersonaPanel from './PersonaPanel.svelte';
  import type { Band } from '$lib/policy-analysis/view';
  import PolicyGraph from './PolicyGraph.svelte';
  import Verdict from './Verdict.svelte';
  import ExposurePlot from './ExposurePlot.svelte';
  import PlayCard from './PlayCard.svelte';
  import CheckGrid from './CheckGrid.svelte';
  import ActorBoard from './ActorBoard.svelte';
  import EvidenceMix from './EvidenceMix.svelte';
  import CrossPolicy from './CrossPolicy.svelte';
  import ReportActs from './ReportActs.svelte';
  import StressTest from './StressTest.svelte';
  import InterplayMap from './InterplayMap.svelte';
  import ScenarioWalk from './ScenarioWalk.svelte';

  interface Props {
    artefacts: Artefact[];
    status: string;
    inspect: (id: string) => void;
    /** Bodies this reader has met before. Omitted on a shared copy: the library is private. */
    personas?: { actorId: string | null; personaId: string; name: string; sightings: number }[];
    /** Cross-policy exposure, or null to leave the chapter out entirely. */
    cross?: { inbound: { id: string; label: string; statement: string; data: Record<string, unknown>; analysisId: string; analysisTitle: string }[]; unavailable: boolean } | null;
    /** The owner's run log. A shared copy passes nothing and the section is absent. */
    runLog?: Snippet;
  }

  let { artefacts, status, inspect, personas = [], cross = null, runLog }: Props = $props();

  let tab = $state(0);
  let bandFilter = $state<Band | null>(null);

  const plays = $derived(view.plays(artefacts));
  const shownPlays = $derived(bandFilter ? plays.filter((p) => p.band === bandFilter) : plays);
  const bands = $derived(view.bandCounts(plays));
  const actors = $derived(view.actorBoard(artefacts, plays));
  const checks = $derived(view.checks(artefacts));
  const tiles = $derived(view.tiles(artefacts, plays));
  const headline = $derived(view.headline(artefacts));
  const sections = $derived(view.findingsBySection(artefacts));
  const acts = $derived(view.reportActs(artefacts));
  const unplaced = $derived(view.unplacedSections(artefacts));
  const recommendations = $derived(view.of(artefacts, 'recommendation'));
  const fragile = $derived(view.fragileAssumptions(artefacts));
  const scenarios = $derived(view.of(artefacts, 'scenario'));
  const models = $derived(view.of(artefacts, 'model'));
  const crossFound = $derived(view.of(artefacts, 'cross_policy'));
  const interplay = $derived(view.interplay(artefacts, plays));

  const pct = (v: number | null) => (v === null ? 'unknown' : `${Math.round(v * 100)}%`);
  const tabId = (id: string) => `report-tab-${id}`;
  /** Index of a tab by its section id — the tabs ARE the sections now. */
  const at = (id: string) => TABS.findIndex((t) => t.id === id);
  const personaGroups = $derived(view.personaBoard(actors, personas));

  function onTabKey(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tab = (next + TABS.length) % TABS.length;
    document.getElementById(tabId(TABS[tab].id))?.focus();
  }

  // A deep link names a tab directly now, because every tab IS a section anchor.
  onMount(() => {
    const index = at(decodeURIComponent(window.location.hash.slice(1)));
    if (index >= 0) tab = index;
  });
</script>

<div class="rail" role="tablist" aria-label="The assessment">
  {#each TABS as t, index (t.id)}
    <button
      role="tab" id={tabId(t.id)} class="wtab" class:on={index === tab}
      aria-selected={index === tab} aria-controls={t.id}
      tabindex={index === tab ? 0 : -1}
      onclick={() => (tab = index)}
      onkeydown={(e) => onTabKey(e, index)}
    >
      <span class="wtab-name">{t.name}</span>
    </button>
  {/each}
</div>
<p class="muted rail-strap">{TABS[tab].strap}</p>

<div role="tabpanel" id="verdict" class="workspace" class:off={tab !== at('verdict')} aria-labelledby={tabId('verdict')}>
<h2 class="print-title">The verdict</h2>
<Verdict {headline} {tiles} {bands} {status} {inspect} onband={(b) => { bandFilter = bandFilter === b ? null : b; tab = at('playbook'); }} />
</div>

<h2 class="print-title">The threat</h2>

<section id="playbook" class="section workspace" role="tabpanel" class:off={tab !== at('playbook')} aria-labelledby={tabId('playbook')}>
  <p class="kicker">How it can be beaten</p>
  <h2>The exploitation playbook</h2>
  <p class="strap">
    Each play is something an actor named in the policy could do to serve itself at the policy's expense.
    They are ranked by a single figure — the even blend of how much the actor gains, how easily it can be
    done, how much of the objective it destroys, and how poorly the policy would notice.
  </p>

  {#if plays.length}
    <ExposurePlot {plays} {inspect} />
    <div class="filter">
      <span class="sr-label">Showing</span>
      <button class:on={bandFilter === null} onclick={() => (bandFilter = null)}>All {plays.length}</button>
      {#each bands.filter((b) => b.count) as b (b.band)}
        <button class:on={bandFilter === b.band} onclick={() => (bandFilter = bandFilter === b.band ? null : b.band)}>{b.count} {b.band}</button>
      {/each}
    </div>
    <div class="plays">
      {#each shownPlays as play, i (play.artefact.id)}<PlayCard {play} rank={plays.indexOf(play) + 1} {inspect} />{/each}
    </div>
  {:else}
    <p class="empty">No exploitation play has been produced yet. This is the tenth of thirteen stages, so it arrives late in a run.</p>
  {/if}
</section>

<section id="interplay" class="section workspace" role="tabpanel" class:off={tab !== at('interplay')} aria-labelledby={tabId('interplay')}>
  <p class="kicker">Who is coming for what</p>
  <h2>The interplay map</h2>
  <p class="strap">
    Every play, drawn from the actor that would run it to the part of the policy it defeats. A measure with
    several arcs into it is a single point the policy has not defended twice over — the reading a ranked
    list cannot give you.
  </p>
  <InterplayMap map={interplay} {inspect} />
</section>

<section id="actors" class="section workspace" role="tabpanel" class:off={tab !== at('actors')} aria-labelledby={tabId('actors')}>
  <p class="kicker">Who is in the room</p>
  <h2>Actors, and what actually moves them</h2>
  <p class="strap">
    What each body says it wants, what its position rewards, who it answers to, and — the question an
    assurance review never asks — who is better off if this policy fails.
  </p>
  <ActorBoard {actors} {personas} {inspect} />
</section>

<section id="personas" class="section workspace" role="tabpanel" class:off={tab !== at('personas')} aria-labelledby={tabId('personas')}>
  <h2>Personas</h2>
  <p class="muted">
    Bodies this assessment met that you have met before. What the library holds is kept
    apart from what this run found, and a body the library has split into several records
    is shown once, with the split named.
  </p>
  <PersonaPanel groups={personaGroups} {inspect} onplay={() => (tab = at('playbook'))} />
</section>

<h2 class="print-title">What it rests on</h2>
<section id="stress" class="section workspace" role="tabpanel" class:off={tab !== at('stress')} aria-labelledby={tabId('stress')}>
  <p class="kicker">What if we are wrong?</p>
  <h2>The stress test</h2>
  <p class="strap">
    Switch an assumption off and the assessment recomputes in front of you: which conclusions lose their
    footing, which redesign options lose the findings behind them, and which plays stop being available at
    all. It walks the citations the assessment already made — no model runs, and the same switches always
    give the same answer.
  </p>
  {#if fragile.length}
    <div class="fragile">
      <p class="sr-label">The assumptions most likely to change the conclusion</p>
      <ol>
        {#each fragile.slice(0, 5) as a (a.id)}
          <li>
            <button class="link" onclick={() => inspect(a.id)}>{a.label}</button>
            <span class="muted">importance {pct(Number(a.data.importance))} · uncertainty {pct(Number(a.data.uncertainty))} · consequence {pct(Number(a.data.consequence))}</span>
            <p>{a.statement}</p>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  <StressTest {artefacts} {inspect} />
</section>

<section id="checks" class="section workspace" role="tabpanel" class:off={tab !== at('checks')} aria-labelledby={tabId('checks')}>
  <p class="kicker">Where it is thin</p>
  <h2>Twelve structural checks</h2>
  <p class="strap">
    These are the only figures on this page no model produced. Each walks the relationships the policy
    states and asks whether the counterpart it depends on is there — responsibility with authority,
    accountability with resources, a measure with someone who owns its data. A check with nothing to look
    at is <em>not</em> a pass.
  </p>
  <CheckGrid {checks} {inspect} />
</section>

<section id="scenarios" class="section workspace" role="tabpanel" class:off={tab !== at('scenarios')} aria-labelledby={tabId('scenarios')}>
  <p class="kicker">What breaks it</p>
  <h2>Conditions, models and sensitivity</h2>
  <p class="strap">
    Eight standing conditions the policy has to survive, stepped through one beat at a time: what changes,
    who moves first, what follows, and whether anyone would notice. These are semi-formal hypotheses about
    behaviour rather than a numerical simulation, and each one says so in its own sensitivity notes.
  </p>

  <ScenarioWalk {scenarios} {artefacts} {inspect} />

  {#if models.length}
    <details class="models">
      <summary>{models.length} interaction models assessed</summary>
      <ul>
        {#each models as m (m.id)}
          <li>
            <button class="link" onclick={() => inspect(m.id)}>{String(m.data.pattern).replaceAll('_', ' ')}</button>
            <span class="muted">{String(m.data.applicability ?? '')}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<section id="evidence" class="section workspace" role="tabpanel" class:off={tab !== at('evidence')} aria-labelledby={tabId('evidence')}>
  <p class="kicker">Evidence and enquiry</p>
  <h2>What is actually supported</h2>
  <p class="strap">
    Every claim in the paper linked to something outside it, or explicitly not. A search excerpt is weak
    evidence and is labelled as one; a retrieval date is not a publication date.
  </p>
  <EvidenceMix
    mix={view.evidenceMix(artefacts)}
    questions={view.of(artefacts, 'research_question')}
    sources={view.of(artefacts, 'research_source')}
    {inspect}
  />
</section>

<h2 class="print-title">The assessment</h2>
{#if cross}
<section id="cross" class="section workspace" role="tabpanel" class:off={tab !== at('cross')} aria-labelledby={tabId('cross')}>
  <p class="kicker">Across policies</p>
  <h2>Weaknesses that span more than one policy</h2>
  <p class="strap">
    Some failures do not exist in any single document: one body told two incompatible things, a burden that
    is bearable once and not three times, an assumption several policies all rest on.
  </p>
  <CrossPolicy found={crossFound} inbound={cross?.inbound ?? []} unavailable={cross?.unavailable ?? false} {inspect} />
</section>
{/if}

<section id="report" class="section workspace" role="tabpanel" class:off={tab !== at('report')} aria-labelledby={tabId('report')}>
  <p class="kicker">The written assessment</p>
  <h2>Chapter and verse</h2>
  {#if acts.length}
    <p class="strap">
      Five movements, in the order the argument runs: what the assessment concludes, what the policy is
      trying to do, what that rests on, where it breaks, and what to do about it. Every chapter keeps its
      own heading; the acts are there so it can be read a movement at a time.
    </p>
    <ReportActs {acts} {recommendations} {inspect} />
    {#if unplaced.length}
      <p class="muted">{unplaced.length} chapter{unplaced.length === 1 ? '' : 's'} sit outside these acts and are listed under the run log: {unplaced.join(', ').replaceAll('_', ' ')}.</p>
    {/if}
    {#if sections.length < REPORT_SECTIONS.length}
      <p class="muted">{REPORT_SECTIONS.length - sections.length} of the {REPORT_SECTIONS.length} chapters are missing from this assessment.</p>
    {/if}
  {:else}
    <p class="empty">The written assessment is produced by the final stage and is not available yet.</p>
  {/if}
</section>

<div id="provenance" class="workspace" role="tabpanel" class:off={tab !== at('provenance')} aria-labelledby={tabId('provenance')}>
  {@render runLog?.()}
</div>

<style>
  .rail { display: flex; flex-wrap: wrap; gap: 1px; max-height: 40vh; overflow-y: auto; background: var(--line-strong); border: 1px solid var(--line-strong); margin: 1.5rem 0 0; position: sticky; top: var(--site-nav-height, 0); z-index: 4; }
  .wtab { flex: 1 1 auto; display: flex; align-items: baseline; gap: .5rem; background: var(--bg); border: 0; padding: .7rem .9rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-secondary); cursor: pointer; white-space: nowrap; text-align: left; }
  .wtab:hover { background: var(--surface-sunken); color: var(--text-primary); }
  .wtab.on { background: var(--accent); color: var(--bg); }
  .wtab:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -3px; }
  .rail-strap { margin: .5rem 0 0; color: var(--text-muted); font-size: var(--fs-label); }
  .workspace { min-width: 0; }
  /*
   * An inactive panel is hidden by a CLASS, never by the `hidden` attribute.
   *
   * `[hidden] { display: none !important }` lives in the browser's OWN
   * stylesheet, and a UA !important declaration outranks an author one — so
   * `.workspace[hidden] { display: block !important }` can never win, at any
   * specificity. Measured 2026-09-10: with `hidden`, exactly ONE of the four
   * workspaces reached the printed PDF and the other three were silently
   * absent, while the rule that was supposed to unhide them sat in the
   * stylesheet looking correct.
   */
  .off { display: none; }
  .print-title { display: none; }

  .section { border-top: 2px solid var(--text-primary); margin-top: 3rem; padding-top: 1.5rem; scroll-margin-top: 4rem; }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); margin: 0 0 .5rem; }
  .strap { color: var(--text-secondary); max-width: 62ch; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .5rem; }

  .filter { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: 1.5rem 0 1rem; }
  .filter button { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: var(--surface-sunken); border: 1px solid var(--line-strong); padding: .35rem .7rem; cursor: pointer; text-transform: capitalize; }
  .filter button.on { background: var(--text-primary); color: var(--bg); }
  .plays { display: grid; gap: 1rem; }

  .fragile { margin-top: 1.5rem; border-left: 3px solid var(--accent); padding-left: 1rem; }
  .fragile ol { margin: 0; padding-left: 1.1rem; }
  .fragile li { padding: .5rem 0; }
  .models { margin-top: 1.5rem; }
  .models ul { list-style: none; padding: 0; margin: 0; }
  .models li { border-bottom: 1px solid var(--line); padding: .5rem 0; display: flex; flex-wrap: wrap; gap: .6rem; align-items: baseline; text-transform: capitalize; }

  .empty { border-left: 2px solid var(--line-strong); padding-left: 1rem; color: var(--text-secondary); }
  .link { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  summary { cursor: pointer; padding: .7rem 0; font-weight: 600; }

  @media print {
    .rail, .rail-strap, .filter { display: none !important; }
    /* Every panel is already in the DOM; a printed pack wants all of them. */
    .off { display: block; }
    /* Nothing names the workspaces once the tabs are gone. */
    .print-title { display: block; font-family: var(--font-display); font-size: 1.6rem; margin: 2rem 0 0; padding-top: 1rem; border-top: 3px solid #000; break-before: page; }
    .workspace:first-of-type .print-title { break-before: auto; }
    .section { break-inside: avoid; }
    .link { text-decoration: none; color: inherit; }
    summary { display: none; }
  }
</style>
