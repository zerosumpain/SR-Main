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
  import { KEY_SECTIONS, READING_CHAIN, STRUCTURE_TERMS } from '$lib/policy-analysis/glossary';
  import * as view from '$lib/policy-analysis/view';
  import { TABS, tabGroups } from '$lib/policy-analysis/view';
  import { atlas } from '$lib/policy-analysis/actors';
  import { adjacency, playGrid, traitGrid } from '$lib/policy-analysis/matrix';
  import { network } from '$lib/policy-analysis/network';
  import { leverage } from '$lib/policy-analysis/stress';
  import { peekHandlers, policyPeek } from '$lib/policy-analysis/peek.svelte';
  import type { Band } from '$lib/policy-analysis/view';

  import DashHead from './DashHead.svelte';
  import PeekCard from './PeekCard.svelte';
  import Drill from './Drill.svelte';
  import Verdict from './Verdict.svelte';
  import ExposurePlot from './ExposurePlot.svelte';
  import CheckGrid from './CheckGrid.svelte';
  import ActorAtlas from './ActorAtlas.svelte';
  import CastTable from './CastTable.svelte';
  import AdjacencyGrid from './AdjacencyGrid.svelte';
  import PlaybookTable from './PlaybookTable.svelte';
  import KeyPanel from './KeyPanel.svelte';
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
    /**
     * The owner's run log. A shared copy passes nothing and the workspace is
     * absent. It takes the drill opener as a parameter because the drill lives
     * in here: handing the snippet a no-op made every reference and every graph
     * node inside it a dead button.
     */
    runLog?: Snippet<[(id: string) => void]>;
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
  // The grids: three tables where three walls of cards stood. Each is a pure
  // derivation over artefacts the assessment already produced.
  const castRows = $derived(traitGrid(actors, personas));
  /**
   * RANKED OVER EVERY PLAY, THEN FILTERED.
   *
   * The rank column is the play's place in the whole playbook, so it has to be
   * computed before any filter and not after: ranking the filtered list instead
   * put "01, 02, 03" against the three MODERATE plays, which are ranks nine to
   * eleven. The old card wall got this right by asking `plays.indexOf`.
   */
  const playRows = $derived.by(() => {
    const shown = new Set(shownPlays.map((p) => p.artefact.id));
    return playGrid(plays).filter((row) => shown.has(row.id));
  });
  const net = $derived(network(artefacts));
  const adj = $derived(adjacency(net));
  const checks = $derived(view.checks(artefacts));
  const tiles = $derived(view.tiles(artefacts, plays));
  const headline = $derived(view.headline(artefacts));
  const sections = $derived(view.findingsBySection(artefacts));
  const acts = $derived(view.reportActs(artefacts));
  const unplaced = $derived(view.unplacedSections(artefacts));
  const recommendations = $derived(view.of(artefacts, 'recommendation'));
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
  /** The one assumption the most of the assessment rests on, for the verdict. */
  const topLever = $derived(leverage(artefacts)[0] ?? null);

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
    key: null,
  });

  const tabId = (id: string) => `report-tab-${id}`;
  /** Index of a tab by its section id — the tabs ARE the sections. */
  const at = (id: string) => TABS.findIndex((t) => t.id === id);
  const groups = tabGroups();
  const visibleTabs = $derived(TABS.filter((t) => (t.id !== 'cross' || cross) && (t.id !== 'provenance' || runLog)));

  function onTabKey(event: KeyboardEvent, index: number) {
    // Walk `visibleTabs`, never `TABS`. A panel that was not rendered is an
    // index nothing can select out of, and selecting it hides every panel at
    // once — the page goes blank with no cell lit and focus dropped.
    const live = visibleTabs.map((t) => at(t.id));
    const here = Math.max(0, live.indexOf(index));
    const moves: Record<string, number> = { ArrowRight: here + 1, ArrowLeft: here - 1, Home: 0, End: live.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tab = live[(next + live.length) % live.length];
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
    // Only a tab this copy actually rendered. A shared link ending `#cross` or
    // `#provenance` would otherwise open on a panel that is not there.
    if (index >= 0 && visibleTabs.some((t) => t.id === hash)) tab = index;
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
        {@const shown = group.tabs.filter((t) => visibleTabs.some((v) => v.id === t.id))}
        <div class="ab-group">
          <!--
            A CAP ONLY WHERE THERE IS SOMETHING TO GROUP. "The verdict" holds one
            cell, also called Verdict, and "VERDICT │ Verdict" reads as a
            mistake. Counted over the tabs that RENDERED — the shared copy is
            missing two of the assessment group's four.

            "The threat" → "THREAT": the article costs four characters of mono in
            five places, which is a third of a rail row.
          -->
          {#if shown.length > 1}
            <p class="ab-group-name">{group.group.replace(/^The /, '')}</p>
          {/if}
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

  <!-- The strap and the standing frame share one wrapper, because the measure
       has to sit on a container: both are `<p>`, both carry their own `margin`
       shorthand, and the layout's `.policy-page p { max-width: 75ch }` beats a
       `width` on the element itself — so at 1920 they hugged the left edge
       while every panel beside them sat on the 1400px measure. -->
  <div class="ab-head">
    <p class="ab-strap">{TABS[tab].strap}</p>

    <!--
      THE STANDING FRAME (ask 3). Said once, near the top, and never repeated: a
      reader who was sent a link has nobody to ask what this document is, and
      every sentence below reads differently depending on the answer.
    -->
    <p class="ab-frame" class:off={tab !== at('verdict')}>
      This reads the paper the way a body governed by it would — looking for what can be done, within the
      rules as written, by an actor serving itself. It is not an assurance review, it assumes nobody intends
      any of this, and where it says a body <em>would</em> act, that is a hypothesis about incentives rather
      than a finding about anyone. The stress test exists so you can fail one and see what moves.
    </p>
  </div>

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
      thin={checks.filter((c) => c.data.result !== 'low_risk')}
      lever={topLever}
      options={recommendations}
      onopen={open}
      ontab={goto}
      onband={(b) => {
        bandFilter = bandFilter === b ? null : b;
        goto('playbook');
      }}
    />
  </div>

  <!-- ————————————————————————————————————— PLAYBOOK ————— -->
  <div
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
          <div class="ab-filter pa-seg">
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
      {#if shownPlays.length}
        <!--
          The plot first, then the ranking as a TABLE. Eleven plays used to be
          eleven full-height cards — 5,321px, the tallest workspace here — so the
          ranking that is the whole point of the playbook could not be read: by
          rank 4 the top three were three screens behind the reader. Each row's
          own sentence, payoff, cost, counter-measure and provenance are in the
          drill, one click away.
        -->
        <ExposurePlot plays={shownPlays} inspect={open} />
        <PlaybookTable rows={playRows} total={plays.length} onopen={open} />
      {:else}
        <p class="ab-empty">No play matches that filter. Clear it above to see all {plays.length}.</p>
      {/if}
    {:else}
      <p class="ab-empty">
        No exploitation play has been produced yet. The playbook is the eleventh of thirteen stages, so it
        arrives late in a run.
      </p>
    {/if}
  </div>

  <!-- ————————————————————————————————————— INTERPLAY ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— ACTORS ————— -->
  <div
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
      <p class="ab-sub-label">Every body against the same six questions</p>
      <!--
        THE ASK: "the actors page remains too long where it could be a much
        neater x by y table." It was nine cards repeating the same six field
        labels — 2,600px of the panel's 3,541px — so the one thing a reader
        wants here, comparing two bodies on the same question, meant holding one
        in their head while scrolling to the other.
      -->
      <CastTable
        rows={castRows}
        onopen={open}
        onplays={(id) => {
          actorFilter = id;
          bandFilter = null;
          goto('playbook');
        }}
      />
    </div>
  </div>

  <!-- ————————————————————————————————————— NETWORK ————— -->
  <div
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
      <!--
        The grid leads, because it is the only thing on this page that shows the
        SHAPE of the policy: a full row is a body everything runs through, an
        empty column is a body nothing answers to, and a cell with no partner
        across the diagonal is a link the paper states one way only. The prose
        readings and the family breakdown follow it.
      -->
      <AdjacencyGrid grid={adj} onopen={open} />
      <RelationshipMap {net} onopen={open} />
    {:else}
      <p class="ab-empty">
        No relationship has been established yet. The knowledge graph is the fourth of thirteen stages.
      </p>
    {/if}
  </div>

  <!-- ————————————————————————————————————— PERSONAS ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— STRESS ————— -->
  <div
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
      figures={[]}
    />
    <!-- No figure row here: the stress lab's own consequence strip is a row of
         four figures that MOVE, and a static pair above it read as a second,
         broken version of the same thing. -->

    <!--
      One list of levers, not two. This panel used to print the five
      most load-bearing assumptions in full ABOVE the stress lab, which then
      offered the same five again as switches — so a reader met each assumption
      twice and the panel's first screen was a list they could not act on. The
      lab's own rail carries the figures that were here.
    -->
    <StressLab {artefacts} onopen={open} />
  </div>

  <!-- ————————————————————————————————————— CHECKS ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— EVIDENCE ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— SCENARIOS ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— CROSS-POLICY ————— -->
  {#if cross}
    <div
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
    </div>
  {/if}

  <!-- ————————————————————————————————————— THE REPORT ————— -->
  <div
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
  </div>

  <!-- ————————————————————————————————————— WORKING ————— -->
  {#if runLog}
    <div
      id="provenance"
      class="ab-panel"
      role="tabpanel"
      class:off={tab !== at('provenance')}
      aria-labelledby={tabId('provenance')}
    >
      {@render runLog(open)}
    </div>
  {/if}

  <!-- ————————————————————————————————————— THE KEY ————— -->
  <div id="key" class="ab-panel" role="tabpanel" class:off={tab !== at('key')} aria-labelledby={tabId('key')}>
    <h2 class="ab-print-title">How to read this</h2>
    <DashHead
      kicker="Definitions"
      title={['What every word here', 'actually means']}
      strap="This assessment reads a policy the way game theory would, and its vocabulary says so: bodies are scored on concealment, conclusions have standing, assumptions have leverage. None of that is guessable, and renaming it would make it wrong. So everything is defined here in one place — what each thing IS, why the assessment computes it, how to read a high number, and the arithmetic where there is any."
      figures={[
        { label: 'Things the assessment is made of', value: STRUCTURE_TERMS.length },
        { label: 'Measures defined', value: KEY_SECTIONS.reduce((n, s) => n + s.terms.length, 0) - STRUCTURE_TERMS.length },
        { label: 'Steps in the chain', value: READING_CHAIN.length },
      ]}
    />
    <KeyPanel />
  </div>
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
  /*
   * THE MEASURE LIVES HERE, NOT ON THE PAGE WRAPPER.
   *
   * `.policy-page` is full-bleed (see the layout's comment); every band inside
   * it holds its own content to `--pa-measure`. So the rail's rules run the full
   * width of the window — it is chrome, and chrome that stops 260px short of the
   * edge reads as a floating card — while its cells stay on the measure with
   * everything else.
   */
  .ab-head,
  .ab-panel,
  .ab-rail-inner {
    width: min(var(--pa-measure, 1400px), 100%);
    margin-inline: auto;
    padding-inline: clamp(20px, 3vw, 44px);
  }

  .ab-rail {
    position: sticky;
    top: var(--site-nav-height, 0);
    z-index: 4;
    background: var(--bg);
    border-top: 2px solid var(--text-primary);
    border-bottom: 2px solid var(--text-primary);
    margin: clamp(20px, 3vw, 34px) 0 0;
  }
  .ab-rail-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    /* A 1px row gap over a ruled ground is the rule BETWEEN wrapped rows. Three
       rows of cells with nothing between them read as one block of text, and
       flex gives no way to select a wrapped row directly. */
    row-gap: 1px;
    background: var(--line-strong);
    /* CONTENT BOX. The inner also carries the measure's side padding, and a
       ruled ground painted under that showed as two grey bars in the gutters at
       any width above the measure. */
    background-clip: content-box;
  }
  .ab-group {
    background: var(--bg);
  }
  /*
   * A GROUP IS A BLOCK, AND A BLOCK NEVER BREAKS.
   *
   * Three layouts, and the difference between them is worth recording. Stacked
   * two-storey boxes wrapped their vertical rules into arbitrary places. A
   * single flowing strip fixed that but put each group's label mid-row, so a
   * section could start halfway across the rail and continue on the next line —
   * "a little disorganised", and fairly. A label STRIP above its cells grouped
   * them properly and cost 198px of a sticky bar, which is a fifth of a laptop
   * viewport.
   *
   * So: the label is a CAP on the left of its own cells, inside a bordered
   * block. `min-width: max-content` means a block can never split across two
   * lines, and `flex: 1 1 auto` means every line fills the measure rather than
   * trailing off. One cell row tall — the height the flowing strip cost — and
   * every section visibly bounded.
   */
  .ab-group {
    display: flex;
    align-items: stretch;
    flex: 1 1 auto;
    /* Never narrower than its own label and cells: a block that wrapped
       internally would be taller than its neighbours and the row would stop
       tiling. */
    min-width: max-content;
    border-left: 1px solid var(--line-strong);
  }
  /* The rule belongs BETWEEN blocks; the rail's own edges are the band's. */
  .ab-group:first-child {
    border-left: 0;
  }
  .ab-group-name {
    display: flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    padding: 0 10px;
    white-space: nowrap;
    /* A ground, so the cap reads as the section's name rather than as another
       cell you could press. */
    background: var(--surface-sunken);
  }
  .ab-group-cells {
    display: flex;
    flex: 1;
    align-items: stretch;
  }
  /*
   * A CELL, not a word. Every cell used to be bare text on cream with no
   * boundary and no ground, so the rail read as a sentence rather than as a set
   * of controls — the "too subtle" half of the complaint. Each cell now has a
   * hairline between it and its neighbour, a filled hover, and a selected state
   * that is accent ink under a full-height bar.
   */
  .ab-tab {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    /* LEFT, not `space-between`. Cells stretch so that every wrapped row fills
       the measure, and pushing the count to the cell's far edge then opened a
       40-character gap between "What if we are wrong" and its 5. */
    justify-content: flex-start;
    gap: 9px;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 0;
    border-radius: 0;
    border-left: 1px solid var(--line-hair);
    padding: 8px 11px 9px;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s ease-out, color 0.12s ease-out;
  }
  .ab-group-cells .ab-tab:first-child {
    border-left: 0;
  }
  .ab-tab:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .ab-tab.on {
    background: var(--accent);
    color: var(--bg);
  }
  .ab-tab.on:hover {
    background: var(--accent-hover);
    color: var(--bg);
  }
  .ab-tab:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: -3px;
  }
  /* A count is a figure, so it sits apart from the name and keeps tabular
     digits — and it is readable now rather than a ghost. */
  .ab-tab-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .ab-tab.on .ab-tab-count {
    color: rgba(237, 228, 212, 0.78);
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
    margin: 12px 0 clamp(18px, 2vw, 26px);
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

  /* Layout, hover and selected states come from `.pa-seg` in the layout — one
     definition shared with the atlas and the network. */
  .ab-filter-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
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
    /* Paper has its own margin; the screen measure would inset every panel
       inside it. */
    .ab-panel,
    .ab-head {
      width: auto;
      padding-inline: 0;
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
    /* No rail on paper, so the frame is the only thing that says what this
       document is — and a forwarded PDF has nobody to ask. */
    .ab-frame.off {
      display: block;
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
