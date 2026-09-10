<script lang="ts">
  // THE ASSESSMENT AS A DASHBOARD.
  //
  // Extracted from the owner page so the SHARED, read-only copy renders the same
  // thing rather than a second implementation of it. That is not tidiness: the
  // audit that started this feature found the two sections it exists for — the
  // playbook and cross-policy exposure — had no tab at all, and two
  // hand-maintained copies of a report is exactly how that happens again.
  //
  // WHAT CHANGED, and why (the ten asks, 2026-09-10):
  //
  //  * A DEPTH GRADIENT, not a wall. Every workspace shows figures; a hover
  //    explains a figure; a click opens the drill. `PeekCard` and `Drill` are
  //    each mounted ONCE here — several hundred hoverable subjects would
  //    otherwise be several hundred idle popovers.
  //  * NOTHING SCROLLS THE PAGE ANY MORE (ask 10). The old inspector was pinned
  //    to the bottom of the viewport, so every clickthrough had to scroll to it.
  //    `open()` opens a drawer over the page and `close()` puts focus back on
  //    whatever was clicked. A trail remembers the route, so following a play to
  //    its actor to that actor's profile is reversible.
  //  * THE RAIL IS GROUPED FOR THE EYE ONLY. The tabs were flattened out of
  //    nested workspaces deliberately — the defect was two navigation systems,
  //    one buried in the other — and nothing here re-nests them. A group is a
  //    word and a hairline above a run of cells; every cell is still one click
  //    from anywhere, and each carries its own count so the shape of the
  //    assessment is visible without opening anything.
  //  * THE TONE ASSUMES THE READER DID NOT WRITE THE PAPER (ask 3). Every strap
  //    talks about "the paper" and "a body governed by it", never "your policy";
  //    and the standing frame below the rail says once, plainly, that this is an
  //    adversarial read that assumes no bad intent, because a reader who was
  //    sent a link has nobody to ask.
  //
  // Every panel stays in the DOM, hidden by a CLASS and never by the `hidden`
  // attribute — `[hidden] { display: none !important }` is a UA declaration and
  // outranks any author rule at any specificity, which is how exactly one of
  // four workspaces reached the printed PDF on 2026-09-10.
  import { onMount, type Snippet } from 'svelte';
  import { REPORT_SECTIONS, type Artefact } from '$lib/policy-analysis/contracts';
  import * as view from '$lib/policy-analysis/view';
  import { TABS, tabGroups } from '$lib/policy-analysis/view';
  import { atlas } from '$lib/policy-analysis/actors';
  import { network } from '$lib/policy-analysis/network';
  import { leverage } from '$lib/policy-analysis/stress';
  import { peekHandlers, policyPeek } from '$lib/policy-analysis/peek.svelte';
  import type { Band } from '$lib/policy-analysis/view';

  import DashHead from './DashHead.svelte';
  import PeekCard from './PeekCard.svelte';
  import Drill from './Drill.svelte';
  import Verdict from './Verdict.svelte';
  import ExposurePlot from './ExposurePlot.svelte';
  import PlayCard from './PlayCard.svelte';
  import CheckGrid from './CheckGrid.svelte';
  import ActorAtlas from './ActorAtlas.svelte';
  import ActorBoard from './ActorBoard.svelte';
  import RelationshipMap from './RelationshipMap.svelte';
  import EvidenceMix from './EvidenceMix.svelte';
  import CrossPolicy from './CrossPolicy.svelte';
  import ReportActs from './ReportActs.svelte';
  import StressLab from './StressLab.svelte';
  import InterplayMap from './InterplayMap.svelte';
  import ScenarioFlow from './ScenarioFlow.svelte';
  import PersonaPanel from './PersonaPanel.svelte';

  interface Props {
    artefacts: Artefact[];
    status: string;
    /** Bodies this reader has met before. Omitted on a shared copy: private. */
    personas?: { actorId: string | null; personaId: string; name: string; sightings: number }[];
    /** Cross-policy exposure, or null to leave the workspace out entirely. */
    cross?: {
      inbound: { id: string; label: string; statement: string; data: Record<string, unknown>; analysisId: string; analysisTitle: string }[];
      unavailable: boolean;
    } | null;
    /** Stage and timestamps for the drill. A shared copy passes none. */
    provenance?: { id: string; stage: number; updatedAt: string | Date }[];
    /** The owner's run log. A shared copy passes nothing and the workspace is absent. */
    runLog?: Snippet;
  }

  let { artefacts, status, personas = [], cross = null, provenance = [], runLog }: Props = $props();

  let tab = $state(0);
  let bandFilter = $state<Band | null>(null);
  /** Narrow the playbook to one body — set by the atlas, cleared by the reader. */
  let actorFilter = $state<string | null>(null);

  // ——— the drill —————————————————————————————————————————————————
  //
  // A TRAIL, not a single id. Following a play to its actor to that actor's
  // profile and back is the journey the inspector could not support, because a
  // hash was the only state it had. The opener is a plain `let`: nothing
  // reactive reads it, and a DOM node in reactive state is a proxy waiting to
  // happen.
  let trail = $state<string[]>([]);
  const drilled = $derived(trail.length ? trail[trail.length - 1] : null);
  let opener: HTMLElement | null = null;

  function open(id: string) {
    if (!trail.length && document.activeElement instanceof HTMLElement) opener = document.activeElement;
    policyPeek.close();
    trail = [...trail, id];
  }
  function back() {
    trail = trail.slice(0, -1);
    if (!trail.length) restoreFocus();
  }
  function closeDrill() {
    trail = [];
    restoreFocus();
  }
  /** Closing must hand focus back, or a keyboard reader lands at the top of the page. */
  function restoreFocus() {
    const target = opener;
    opener = null;
    queueMicrotask(() => target?.focus());
  }

  // ——— derivations, all from the artefact list ————————————————————
  const plays = $derived(view.plays(artefacts));
  const shownPlays = $derived(
    plays
      .filter((p) => !bandFilter || p.band === bandFilter)
      .filter((p) => !actorFilter || p.actor?.id === actorFilter),
  );
  const bands = $derived(view.bandCounts(plays));
  const actors = $derived(view.actorBoard(artefacts, plays));
  const atlasRows = $derived(atlas(artefacts, actors, personas));
  const net = $derived(network(artefacts));
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
  const personaGroups = $derived(view.personaBoard(actors, personas));
  const evidence = $derived(view.of(artefacts, 'evidence'));
  const questions = $derived(view.of(artefacts, 'research_question'));
  const sources = $derived(view.of(artefacts, 'research_source'));
  const filteredActor = $derived(actorFilter ? (actors.find((a) => a.actor.id === actorFilter) ?? null) : null);

  /** How many things cite each assumption — handed to the peek card. */
  const leverageIndex = $derived(new Map(leverage(artefacts).map((l) => [l.artefact.id, l.dependants])));

  /**
   * A figure per rail cell.
   *
   * The point of putting counts on the rail is that a reader can see the shape
   * of the assessment — twenty-six plays, eight bodies, one cross-policy
   * exposure — without opening anything. A cell with nothing behind it says so,
   * which is better than clicking to find out.
   */
  const counts = $derived<Record<string, number | null>>({
    verdict: null,
    playbook: plays.length,
    interplay: interplay.links.length,
    actors: actors.length,
    network: net.edges.length,
    personas: personaGroups.length,
    stress: leverageIndex.size,
    checks: checks.length,
    evidence: evidence.length,
    scenarios: scenarios.length,
    cross: crossFound.length + (cross?.inbound.length ?? 0),
    report: sections.reduce((n, s) => n + s.items.length, 0),
    provenance: null,
  });

  const tabId = (id: string) => `report-tab-${id}`;
  /** Index of a tab by its section id — the tabs ARE the sections. */
  const at = (id: string) => TABS.findIndex((t) => t.id === id);
  const groups = tabGroups();
  const visibleTabs = $derived(TABS.filter((t) => (t.id !== 'cross' || cross) && (t.id !== 'provenance' || runLog)));

  function onTabKey(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tab = (next + TABS.length) % TABS.length;
    document.getElementById(tabId(TABS[tab].id))?.focus();
  }

  function goto(id: string) {
    const index = at(id);
    if (index >= 0) tab = index;
  }

  // A deep link names a tab directly, because every tab IS a section anchor. A
  // hash that is not a tab is an artefact, and opens the drill.
  onMount(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const index = at(hash);
    if (index >= 0) tab = index;
    else if (artefacts.some((a) => a.id === hash)) trail = [hash];
  });
</script>

<!-- One set of delegated handlers for the whole dashboard. Every `data-pa-peek`
     inside it is covered by these four listeners rather than by four of its
     own. The drill mounts its own, because it portals above this. -->
<div class="ab" {...peekHandlers()}>
  <nav class="ab-rail" aria-label="The assessment">
    <div class="ab-rail-inner" role="tablist" aria-label="Workspaces">
      {#each groups as group (group.group)}
        <div class="ab-group">
          <p class="ab-group-name">{group.group}</p>
          <div class="ab-group-cells">
            {#each group.tabs as t (t.id)}
              {#if visibleTabs.some((v) => v.id === t.id)}
                <button
                  type="button"
                  role="tab"
                  id={tabId(t.id)}
                  class="ab-tab"
                  class:on={t.index === tab}
                  aria-selected={t.index === tab}
                  aria-controls={t.id}
                  tabindex={t.index === tab ? 0 : -1}
                  onclick={() => (tab = t.index)}
                  onkeydown={(e) => onTabKey(e, t.index)}
                >
                  <span class="ab-tab-name">{t.name}</span>
                  {#if counts[t.id] !== null && counts[t.id] !== undefined}
                    <span class="ab-tab-count">{counts[t.id]}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </nav>

  <p class="ab-strap">{TABS[tab].strap}</p>

  <!--
    THE STANDING FRAME (ask 3). Said once, near the top, and never repeated: a
    reader who was sent a link has nobody to ask what this document is, and
    every sentence below reads differently depending on the answer.
  -->
  <p class="ab-frame">
    This reads the paper the way a body governed by it would — looking for what can be done, within the rules
    as written, by an actor serving itself. It is not an assurance review, it assumes nobody intends any of
    this, and where it says a body <em>would</em> act, that is a hypothesis about incentives rather than a
    finding about anyone. The stress test exists so you can fail one and see what moves.
  </p>

  <!-- ————————————————————————————————————— VERDICT ————— -->
  <div
    role="tabpanel"
    id="verdict"
    class="ab-panel"
    class:off={tab !== at('verdict')}
    aria-labelledby={tabId('verdict')}
  >
    <h2 class="ab-print-title">The verdict</h2>
    <Verdict
      {headline}
      {tiles}
      {bands}
      {plays}
      {status}
      onopen={open}
      onband={(b) => {
        bandFilter = bandFilter === b ? null : b;
        goto('playbook');
      }}
    />
  </div>

  <!-- ————————————————————————————————————— PLAYBOOK ————— -->
  <section
    id="playbook"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('playbook')}
    aria-labelledby={tabId('playbook')}
  >
    <h2 class="ab-print-title">The threat</h2>
    <DashHead
      kicker="How the paper can be beaten"
      title={['The exploitation', 'playbook']}
      strap="Each play is something a body named in the policy could do to serve itself at the policy's expense. They are ranked by one figure: the even blend of what the actor gains, how easily it can be done, how much of the objective it defeats, and how poorly the policy would notice."
      figures={[
        { label: 'Plays', value: plays.length, term: 'exposure' },
        { label: 'Severe', value: bands.find((b) => b.band === 'severe')?.count ?? 0, term: 'severe' },
        { label: 'Compliant', value: plays.filter((p) => p.artefact.data.legality === 'compliant').length, term: 'legality' },
        { label: 'Bodies involved', value: new Set(plays.map((p) => p.actor?.id).filter(Boolean)).size },
      ]}
    >
      {#snippet controls()}
        {#if plays.length}
          <div class="ab-filter">
            <span class="ab-filter-label">Showing</span>
            <button type="button" class:on={bandFilter === null && !actorFilter} onclick={() => { bandFilter = null; actorFilter = null; }}>
              All {plays.length}
            </button>
            {#each bands.filter((b) => b.count) as b (b.band)}
              <button
                type="button"
                class:on={bandFilter === b.band}
                data-pa-peek={`term:${b.band}`}
                onclick={() => (bandFilter = bandFilter === b.band ? null : b.band)}
              >{b.count} {b.band}</button>
            {/each}
            {#if filteredActor}
              <button type="button" class="on ab-filter-actor" onclick={() => (actorFilter = null)}>
                {filteredActor.actor.label} ✕
              </button>
            {/if}
          </div>
        {/if}
      {/snippet}
    </DashHead>

    {#if plays.length}
      <ExposurePlot plays={shownPlays.length ? shownPlays : plays} inspect={open} />
      {#if shownPlays.length}
        <div class="ab-plays">
          {#each shownPlays as play (play.artefact.id)}
            <PlayCard {play} rank={plays.indexOf(play) + 1} onopen={open} />
          {/each}
        </div>
      {:else}
        <p class="ab-empty">No play matches that filter. Clear it above to see all {plays.length}.</p>
      {/if}
    {:else}
      <p class="ab-empty">
        No exploitation play has been produced yet. The playbook is the eleventh of thirteen stages, so it
        arrives late in a run.
      </p>
    {/if}
  </section>

  <!-- ————————————————————————————————————— INTERPLAY ————— -->
  <section
    id="interplay"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('interplay')}
    aria-labelledby={tabId('interplay')}
  >
    <DashHead
      kicker="Who is coming for what"
      title={['The interplay', 'map']}
      strap="Every play, drawn from the body that would run it to the part of the policy it defeats. A measure with several arcs into it is a single point nothing has defended twice over — the reading a ranked list cannot give you."
      figures={[
        { label: 'Bodies', value: interplay.actors.length },
        { label: 'Targets', value: interplay.targets.length },
        { label: 'Lines of attack', value: interplay.links.length },
      ]}
    />
    <InterplayMap map={interplay} inspect={open} />
  </section>

  <!-- ————————————————————————————————————— ACTORS ————— -->
  <section
    id="actors"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('actors')}
    aria-labelledby={tabId('actors')}
  >
    <h2 class="ab-print-title">The cast</h2>
    <DashHead
      kicker="Who is in the room"
      title={['Actors, and what', 'actually moves them']}
      strap="What each body says it wants, what its position rewards, who it answers to, and — the question an assurance review never asks — who is better off if this policy fails."
      figures={[
        { label: 'Profiled', value: actors.length },
        { label: 'With a play', value: atlasRows.filter((r) => r.measures.plays > 0).length },
        { label: 'In your library', value: atlasRows.filter((r) => r.known).length },
      ]}
    />
    <ActorAtlas
      rows={atlasRows}
      onopen={open}
      onplays={(id) => {
        actorFilter = id;
        bandFilter = null;
        goto('playbook');
      }}
    />
    <div class="ab-sub">
      <p class="ab-sub-label">Every body, and what moves it</p>
      <ActorBoard {actors} {personas} inspect={open} />
    </div>
  </section>

  <!-- ————————————————————————————————————— NETWORK ————— -->
  <section
    id="network"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('network')}
    aria-labelledby={tabId('network')}
  >
    <DashHead
      kicker="The policy as a network"
      title={['What the paper', 'wires together']}
      strap="Every relationship the document states, grouped by what it does rather than by the twenty-six names the vocabulary uses. The readings that lead are the counterparts the paper leaves out."
      figures={[
        { label: 'Bodies', value: net.nodes.length },
        { label: 'Relationships', value: net.edges.length },
        { label: 'Families', value: net.families.length },
        { label: 'Readings', value: net.insights.length },
      ]}
    />
    {#if net.edges.length}
      <RelationshipMap {net} onopen={open} />
    {:else}
      <p class="ab-empty">
        No relationship has been established yet. The knowledge graph is the fourth of thirteen stages.
      </p>
    {/if}
  </section>

  <!-- ————————————————————————————————————— PERSONAS ————— -->
  <section
    id="personas"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('personas')}
    aria-labelledby={tabId('personas')}
  >
    <DashHead
      kicker="Bodies you have met before"
      title={['The persona', 'library']}
      strap="What the library holds is kept apart from what this run found, and a body the library has split into several records is shown once with the split named. A prior is context, never evidence — nothing in the findings rests on it."
      figures={[{ label: 'Bodies', value: personaGroups.length }]}
    />
    <PersonaPanel groups={personaGroups} inspect={open} onplay={() => goto('playbook')} />
  </section>

  <!-- ————————————————————————————————————— STRESS ————— -->
  <section
    id="stress"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('stress')}
    aria-labelledby={tabId('stress')}
  >
    <h2 class="ab-print-title">The ground it stands on</h2>
    <DashHead
      kicker="What if we are wrong?"
      title={['The stress', 'test']}
      strap="Switch an assumption off and the assessment recomputes in front of you. It walks the citations the assessment already made — no model runs, and the same switches always give the same answer."
      figures={[
        { label: 'Cited assumptions', value: leverageIndex.size, term: 'dependants' },
        { label: 'Most load-bearing', value: Math.max(0, ...leverageIndex.values()), term: 'dependants' },
      ]}
    />

    {#if fragile.length}
      <div class="ab-fragile">
        <p class="ab-sub-label">The assumptions most likely to change the conclusion</p>
        <ol>
          {#each fragile.slice(0, 5) as a (a.id)}
            <li>
              <button type="button" class="ab-link" data-pa-peek={`assumption:${a.id}`} onclick={() => open(a.id)}>{a.label}</button>
              <span class="ab-muted">
                importance {Math.round(Number(a.data.importance) * 100)}% · uncertainty
                {Math.round(Number(a.data.uncertainty) * 100)}% · consequence
                {Math.round(Number(a.data.consequence) * 100)}%
              </span>
              <p>{a.statement}</p>
            </li>
          {/each}
        </ol>
      </div>
    {/if}

    <StressLab {artefacts} onopen={open} />
  </section>

  <!-- ————————————————————————————————————— CHECKS ————— -->
  <section
    id="checks"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('checks')}
    aria-labelledby={tabId('checks')}
  >
    <DashHead
      kicker="Where the paper is thin"
      title={['Twelve structural', 'checks']}
      strap="The only figures on this page no model produced. Each walks the relationships the policy states and asks whether the counterpart it depends on is there — responsibility with authority, accountability with resources, a measure with someone who owns its data."
      figures={[
        { label: 'High risk', value: checks.filter((c) => c.data.result === 'high_risk').length, term: 'high_risk' },
        { label: 'Moderate', value: checks.filter((c) => c.data.result === 'moderate_risk').length, term: 'moderate_risk' },
        { label: 'Covered', value: checks.filter((c) => c.data.result === 'low_risk').length, term: 'low_risk' },
        { label: 'Nothing to read', value: checks.filter((c) => c.data.result === 'indeterminate').length, term: 'indeterminate' },
      ]}
    />
    <p class="ab-note">
      A check with nothing to look at is <strong>not</strong> a pass. Where the paper does not say enough for
      a check to run, it is recorded as an open question rather than coloured green.
    </p>
    <CheckGrid {checks} inspect={open} />
  </section>

  <!-- ————————————————————————————————————— EVIDENCE ————— -->
  <section
    id="evidence"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('evidence')}
    aria-labelledby={tabId('evidence')}
  >
    <DashHead
      kicker="Evidence and enquiry"
      title={['What is actually', 'supported']}
      strap="Every claim in the paper linked to something outside it, or explicitly not. A search excerpt is weak evidence and is labelled as one; a retrieval date is not a publication date."
      figures={[
        { label: 'Evidence links', value: evidence.length },
        { label: 'Questions asked', value: questions.length },
        { label: 'Sources retrieved', value: sources.length },
        { label: 'Insufficient', value: evidence.filter((e) => e.data.result === 'insufficient').length, term: 'insufficient' },
      ]}
    />
    <EvidenceMix mix={view.evidenceMix(artefacts)} {questions} {sources} inspect={open} />
  </section>

  <!-- ————————————————————————————————————— SCENARIOS ————— -->
  <section
    id="scenarios"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('scenarios')}
    aria-labelledby={tabId('scenarios')}
  >
    <DashHead
      kicker="What breaks it"
      title={['Conditions the policy', 'has to survive']}
      strap="Standing conditions stepped through one beat at a time: what changes, who moves first, what follows, and whether anyone would notice. These are semi-formal hypotheses about behaviour rather than a numerical simulation, and each says so in its own sensitivity notes."
      figures={[
        { label: 'Conditions', value: scenarios.length },
        { label: 'Interaction models', value: models.length },
      ]}
    />
    <ScenarioFlow {scenarios} {artefacts} onopen={open} />

    {#if models.length}
      <details class="ab-models">
        <summary>{models.length} interaction models assessed</summary>
        <ul>
          {#each models as m (m.id)}
            <li>
              <button type="button" class="ab-link" data-pa-peek={`artefact:${m.id}`} onclick={() => open(m.id)}>
                {String(m.data.pattern).replaceAll('_', ' ')}
              </button>
              <span class="ab-muted">{String(m.data.applicability ?? '')}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>

  <!-- ————————————————————————————————————— CROSS-POLICY ————— -->
  {#if cross}
    <section
      id="cross"
      class="ab-panel"
      role="tabpanel"
      class:off={tab !== at('cross')}
      aria-labelledby={tabId('cross')}
    >
      <h2 class="ab-print-title">The assessment</h2>
      <DashHead
        kicker="Across policies"
        title={['Weaknesses that span', 'more than one policy']}
        strap="Some failures do not exist in any single document: one body told two incompatible things, a burden that is bearable once and not three times, an assumption several policies all rest on."
        figures={[
          { label: 'Found here', value: crossFound.length },
          { label: 'Named from elsewhere', value: cross.inbound.length },
        ]}
      />
      <CrossPolicy found={crossFound} inbound={cross.inbound} unavailable={cross.unavailable} inspect={open} />
    </section>
  {/if}

  <!-- ————————————————————————————————————— THE REPORT ————— -->
  <section
    id="report"
    class="ab-panel"
    role="tabpanel"
    class:off={tab !== at('report')}
    aria-labelledby={tabId('report')}
  >
    {#if !cross}<h2 class="ab-print-title">The assessment</h2>{/if}
    <DashHead
      kicker="The written assessment"
      title={['Chapter', 'and verse']}
      strap="Five movements, in the order the argument runs: what the assessment concludes, what the policy is trying to do, what that rests on, where it breaks, and what to do about it. Every chapter keeps its own heading; the acts are there so it can be read a movement at a time."
      figures={[
        { label: 'Findings', value: sections.reduce((n, s) => n + s.items.length, 0) },
        { label: 'Chapters', value: sections.length },
        { label: 'Redesign options', value: recommendations.length },
      ]}
    />
    {#if acts.length}
      <ReportActs {acts} {recommendations} inspect={open} />
      {#if unplaced.length}
        <p class="ab-note">
          {unplaced.length} chapter{unplaced.length === 1 ? '' : 's'} sit outside these acts and are listed under
          the working: {unplaced.join(', ').replaceAll('_', ' ')}.
        </p>
      {/if}
      {#if sections.length < REPORT_SECTIONS.length}
        <p class="ab-note">
          {REPORT_SECTIONS.length - sections.length} of the {REPORT_SECTIONS.length} chapters are missing from this
          assessment.
        </p>
      {/if}
    {:else}
      <p class="ab-empty">The written assessment is produced by the final stage and is not available yet.</p>
    {/if}
  </section>

  <!-- ————————————————————————————————————— WORKING ————— -->
  {#if runLog}
    <div
      id="provenance"
      class="ab-panel"
      role="tabpanel"
      class:off={tab !== at('provenance')}
      aria-labelledby={tabId('provenance')}
    >
      {@render runLog()}
    </div>
  {/if}
</div>

<!-- ONE of each, for the whole page. -->
<PeekCard {artefacts} {plays} {actors} leverage={leverageIndex} onopen={open} ontab={goto} />
<Drill
  id={drilled}
  {artefacts}
  {plays}
  {provenance}
  onclose={closeDrill}
  onopen={open}
  onback={back}
  depth={trail.length - 1}
/>

<style>
  /*
   * THE RAIL. Grouped for the eye, flat for navigation. It scrolls sideways
   * inside itself rather than wrapping to three rows and eating 40vh, which is
   * what the previous strip did on a laptop.
   */
  .ab-rail {
    position: sticky;
    top: var(--site-nav-height, 0);
    z-index: 4;
    background: var(--bg);
    border-top: 2px solid var(--text-primary);
    border-bottom: 2px solid var(--text-primary);
    margin: clamp(20px, 3vw, 34px) 0 0;
    overflow-x: auto;
  }
  .ab-rail-inner {
    display: flex;
    align-items: stretch;
    min-width: min-content;
  }
  .ab-group {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line-strong);
    min-width: 0;
  }
  .ab-group:last-child {
    border-right: 0;
  }
  .ab-group-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
    padding: 6px 11px 4px;
    white-space: nowrap;
  }
  .ab-group-cells {
    display: flex;
    flex: 1;
  }
  .ab-tab {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 0;
    border-radius: 0;
    border-top: 2px solid transparent;
    padding: 8px 11px 10px;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .ab-tab:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .ab-tab.on {
    background: var(--accent);
    border-top-color: var(--accent);
    color: var(--bg);
  }
  .ab-tab:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: -3px;
  }
  .ab-tab-count {
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .ab-tab.on .ab-tab-count {
    color: rgba(237, 228, 212, 0.75);
  }

  .ab-strap {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 14px 0 0;
    max-width: 70ch;
  }
  .ab-frame {
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-muted);
    margin: 12px 0 0;
    padding-left: 14px;
    border-left: 2px solid var(--accent-ink);
    max-width: 82ch;
    text-wrap: pretty;
  }

  /*
   * An inactive panel is hidden by a CLASS, never by the `hidden` attribute.
   *
   * `[hidden] { display: none !important }` lives in the browser's OWN
   * stylesheet, and a UA !important declaration outranks an author one — so
   * `.ab-panel[hidden] { display: block !important }` can never win, at any
   * specificity. Measured 2026-09-10: with `hidden`, exactly ONE of four
   * workspaces reached the printed PDF and the other three were silently
   * absent, while the rule that was supposed to unhide them sat in the
   * stylesheet looking correct.
   */
  .ab-panel {
    min-width: 0;
  }
  .off {
    display: none;
  }
  .ab-print-title {
    display: none;
  }

  .ab-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    align-items: center;
  }
  .ab-filter-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ab-filter button {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 10px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ab-filter button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ab-filter button.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .ab-filter-actor {
    text-transform: none;
    letter-spacing: 0.04em;
  }

  .ab-plays {
    display: grid;
    gap: 15px;
    margin-top: 22px;
  }

  .ab-sub {
    margin-top: clamp(28px, 3.5vw, 44px);
    padding-top: 18px;
    border-top: 1px solid var(--line-strong);
  }
  .ab-sub-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }

  .ab-fragile {
    margin-top: 22px;
    border-left: 3px solid var(--accent);
    padding-left: 16px;
  }
  .ab-fragile ol {
    margin: 0;
    padding-left: 18px;
  }
  .ab-fragile li {
    padding: 8px 0;
  }
  .ab-fragile p {
    margin: 5px 0 0;
    line-height: 1.55;
    max-width: 70ch;
  }

  .ab-models {
    margin-top: 24px;
  }
  .ab-models summary {
    cursor: pointer;
    padding: 11px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ab-models ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .ab-models li {
    border-bottom: 1px solid var(--line);
    padding: 8px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: baseline;
    text-transform: capitalize;
  }

  .ab-note,
  .ab-muted {
    color: var(--text-muted);
    font-size: var(--fs-label);
    line-height: 1.55;
    margin: 14px 0 0;
    max-width: 76ch;
  }
  .ab-muted {
    margin: 0;
  }
  .ab-empty {
    border-left: 2px solid var(--line-strong);
    padding-left: 16px;
    color: var(--text-secondary);
    margin-top: 22px;
    max-width: 68ch;
  }
  .ab-link {
    font: inherit;
    font-size: var(--fs-label);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .ab-link:hover {
    color: var(--accent);
  }

  @media print {
    .ab-rail,
    .ab-strap,
    .ab-filter {
      display: none !important;
    }
    /* Every panel is already in the DOM; a printed pack wants all of them. */
    .off {
      display: block;
    }
    /* Nothing names the workspaces once the rail is gone. */
    .ab-print-title {
      display: block;
      font-family: var(--font-display);
      font-size: 1.6rem;
      margin: 2rem 0 0;
      padding-top: 1rem;
      border-top: 3px solid #000;
      break-before: page;
    }
    .ab-panel:first-of-type .ab-print-title {
      break-before: auto;
    }
    .ab-frame {
      border-left-color: #000;
      color: #000;
    }
    .ab-link {
      text-decoration: none;
      color: inherit;
    }
    .ab-models summary {
      display: none;
    }
  }
</style>
