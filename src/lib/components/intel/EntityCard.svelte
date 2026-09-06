<script lang="ts">
  // What the graph knows about one entity, in a card.
  //
  // Used in two places with the same data: hovering an entity mention in a jkai
  // reply, and clicking a node on the Intel network graph. Fetches lazily and
  // caches per entity id, so hovering the same name repeatedly is free.

  import { fetchEntityCard, type EntityCardData } from '$lib/jkai/intel/entity-card-store';
  import EvidenceList from './EvidenceList.svelte';
  import EvidenceTimeline from './EvidenceTimeline.svelte';
  import {
    ageInDays,
    bestGrade,
    computeConfidence,
    credibilityFromCorroboration,
    explainConfidence,
    orderedComponents,
    CREDIBILITY_LABEL,
    CREDIBILITY_RATINGS,
    SOURCE_GRADES,
    SOURCE_GRADE_LABEL,
    type CredibilityRating,
    type SourceGrade,
    type TrustPayload,
  } from '$lib/jkai/intel/trust';

  let {
    entityId,
    compact = false,
    onCommission,
    onFocus,
  }: {
    entityId: string;
    /** Hover cards are compact; the dashboard panel is not. */
    compact?: boolean;
    onCommission?: (kind: string, payload: string, entityIds: string[]) => void;
    onFocus?: (id: string) => void;
  } = $props();

  let data = $state<EntityCardData | null>(null);
  let loading = $state(true);
  let failed = $state(false);

  // Keyed on entityId so the card reloads when the hovered mention changes.
  $effect(() => {
    const id = entityId;
    loading = true;
    failed = false;
    data = null;
    let cancelled = false;

    fetchEntityCard(id)
      .then((result) => {
        if (cancelled) return;
        data = result;
        loading = false;
      })
      .catch(() => {
        if (cancelled) return;
        failed = true;
        loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  // ── Trust ────────────────────────────────────────────────────────────────
  // Two sources, deliberately. The card payload already carries everything the
  // score needs (sources, dates, note count, confirmed), so the bar renders on
  // the first paint with no second request — which matters for hover cards,
  // where a burst of extra fetches would be paid for on every mouse-over.
  // The server copy is fetched only for the full panel, because only it knows
  // about manual grade overrides.

  let serverTrust = $state<TrustPayload | null>(null);
  let saving = $state(false);
  let showBreakdown = $state(false);
  /** Null means "unchanged" — avoids a prop→state sync effect for the selects. */
  let draftGrade = $state<SourceGrade | null>(null);
  let draftCredibility = $state<CredibilityRating | null>(null);

  $effect(() => {
    const id = entityId;
    const wantsServerCopy = !compact;
    serverTrust = null;
    draftGrade = null;
    draftCredibility = null;
    if (!wantsServerCopy) return;

    let cancelled = false;
    fetch(`/api/jkai/intel/trust?id=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? (res.json() as Promise<TrustPayload>) : null))
      .then((payload) => {
        if (!cancelled) serverTrust = payload;
      })
      .catch(() => {
        // The card is still useful without the graded copy — the locally
        // computed score below stands in.
      });

    return () => {
      cancelled = true;
    };
  });

  const localTrust = $derived.by(() => {
    if (!data) return null;
    const corroboration = data.metrics.noteCount;
    return computeConfidence({
      corroboration,
      sourceGrade: bestGrade(data.notes.map((n) => n.source)),
      credibility: credibilityFromCorroboration(corroboration),
      // ONE age anchor for this card, and it is an observation clock.
      //
      // This used to read notes[0].createdAt, which is when the sweep WROTE the
      // note — every email note carries the same day — so an eleven-week-old
      // thread aged the same as this morning's. `metrics.evidenceAt` is when the
      // entity was last actually seen. (/api/jkai/intel/trust and trust-refresh
      // still anchor on lastCorroboratedAt and disagree with each other; that is
      // worth unifying, but it is a scoring change, not a display one.)
      ageDays: data.metrics.evidenceAt
        ? ageInDays(new Date(data.metrics.evidenceAt).getTime())
        : ageInDays(data.entity.updatedAt),
      confirmed: data.entity.confirmed,
    });
  });

  const trust = $derived(serverTrust?.trust ?? localTrust);

  // ── Pin to a dossier ─────────────────────────────────────────────────────
  // The hand-off that was missing: the graph could find a thing and commission
  // work about it, but there was no way to say "this belongs to the enquiry I
  // am running" without leaving for the dossiers page and searching for it
  // again. Dossiers load lazily on first open, not with the card — a hover card
  // must not cost an extra request.
  type DossierOption = { id: string; title: string; status: string };

  let pinOpen = $state(false);
  let dossiers = $state<DossierOption[]>([]);
  let dossiersLoaded = $state(false);
  let pinBusy = $state(false);
  let pinResult = $state<string | null>(null);

  async function openPin() {
    pinOpen = !pinOpen;
    if (!pinOpen || dossiersLoaded) return;
    try {
      const res = await fetch('/api/jkai/intel/dossiers?status=open');
      if (res.ok) dossiers = (await res.json()).dossiers ?? [];
    } catch {
      // The rest of the card is unaffected; the list just stays empty.
    } finally {
      dossiersLoaded = true;
    }
  }

  async function pinTo(dossier: DossierOption) {
    if (pinBusy) return;
    pinBusy = true;
    try {
      const res = await fetch(`/api/jkai/intel/dossiers/${dossier.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', kind: 'entity', refId: entityId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
      pinResult = body.duplicate ? `Already in ${dossier.title}` : `Pinned to ${dossier.title}`;
      pinOpen = false;
    } catch (err) {
      pinResult = err instanceof Error ? err.message : 'Could not pin that';
    } finally {
      pinBusy = false;
    }
  }
  const breakdown = $derived(trust ? orderedComponents(trust.components) : []);
  const explanation = $derived(trust ? explainConfidence(trust) : []);
  const selectedGrade = $derived(draftGrade ?? trust?.resolved.sourceGrade ?? 'F');
  const selectedCredibility = $derived(draftCredibility ?? trust?.resolved.credibility ?? 6);
  const dirty = $derived(
    (draftGrade != null && draftGrade !== trust?.resolved.sourceGrade) ||
      (draftCredibility != null && draftCredibility !== trust?.resolved.credibility),
  );

  async function saveGrades() {
    if (saving) return;
    saving = true;
    try {
      const res = await fetch('/api/jkai/intel/trust', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId,
          sourceGrade: selectedGrade,
          credibility: selectedCredibility,
        }),
      });
      if (res.ok) {
        serverTrust = (await res.json()) as TrustPayload;
        draftGrade = null;
        draftCredibility = null;
      }
    } catch {
      // Leave the draft in place so the edit is not silently lost.
    } finally {
      saving = false;
    }
  }

  // Not named `props` — that shadows the `$props` rune.
  const entityProps = $derived(
    data ? Object.entries(data.entity.properties ?? {}).filter(([, v]) => v != null && v !== '') : [],
  );

  function pct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }

  /** Components are shown as points out of 100, signed — never a bare total. */
  function points(n: number): string {
    const r = Math.round(n * 100);
    return `${r < 0 ? '−' : '+'}${Math.abs(r)}`;
  }
</script>

<div class="entity-card" class:compact>
  {#if loading}
    <div class="state">Loading…</div>
  {:else if failed || !data}
    <div class="state">Could not load this entity.</div>
  {:else}
    <header>
      <span class="icon" style="color: {data.entity.type.color};">{data.entity.type.icon}</span>
      <div class="head-text">
        <h3>{data.entity.name}</h3>
        <div class="identity-meta">
          <span class="type">{data.entity.type.name}</span>
          {#if !data.entity.confirmed}
            <span class="chip unconfirmed" title="Awaiting review">unconfirmed</span>
          {/if}
        </div>
      </div>
    </header>

    {#if data.entity.summary}
      <p class="summary">{data.entity.summary}</p>
    {/if}

    <!-- Actions sit here, directly under the name, not at the foot of the
         card. The card is long — confidence, its breakdown, the evidence
         timeline and then the evidence itself — so a footer put "research
         this" and "add to dossier" below a scroll on every entity worth
         reading about. They are what you came to do; they should not be the
         last thing you can reach. -->
    {#if onCommission}
      <footer>
        <button
          type="button"
          onclick={() => onCommission('research', `Deep dive on ${data!.entity.name} — profile, affiliations, recent developments`, [entityId])}
        >Research</button>
        <button
          type="button"
          onclick={() => onCommission('ask', `Tell me everything my intel graph knows about ${data!.entity.name}, and what it implies.`, [entityId])}
        >Ask jkai</button>
        <button
          type="button"
          onclick={() => onCommission('monitor', `Watch for news and changes about ${data!.entity.name}`, [entityId])}
        >Monitor</button>
        <button type="button" class:on={pinOpen} onclick={openPin}>Add to dossier</button>
        <a class="btn-link" href="/jkai/intel/entities/{entityId}">Open</a>
      </footer>

      {#if pinOpen}
        <div class="pin-list">
          {#if !dossiersLoaded}
            <p class="pin-note">Loading case files…</p>
          {:else if dossiers.length === 0}
            <p class="pin-note">No open dossiers. <a href="/jkai/intel/dossiers">Start one →</a></p>
          {:else}
            {#each dossiers as d (d.id)}
              <button type="button" class="pin-item" disabled={pinBusy} onclick={() => pinTo(d)}>
                {d.title}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
      {#if pinResult}
        <p class="pin-note done">{pinResult}</p>
      {/if}
    {/if}

    <div class="metrics">
      <span title="Direct connections"><b>{data.metrics.degree}</b> links</span>
      <span title="Share of graph importance"><b>{pct(data.metrics.importance)}</b> importance</span>
      <span title="Source notes"><b>{data.metrics.noteCount}</b> sources</span>
      {#if data.metrics.brokerage > 0.01}
        <span class="broker" title="Connects otherwise separate clusters">broker</span>
      {/if}
    </div>

    {#if trust}
      <div class="trust">
        <div class="t-head">
          <span class="t-name">confidence</span>
          <span class="chip grade {trust.label}">{trust.label}</span>
          <span class="t-score">{pct(trust.score)}</span>
          <button
            type="button"
            class="why"
            aria-expanded={showBreakdown}
            onclick={() => (showBreakdown = !showBreakdown)}>why</button
          >
        </div>

        <div
          class="t-bar"
          role="img"
          aria-label="Confidence {pct(trust.score)} — {trust.label}"
        >
          <span class="t-fill {trust.label}" style="width: {pct(trust.score)}"></span>
        </div>

        <div class="t-meta">
          <span title="Distinct notes independently asserting this">
            <b>{trust.resolved.corroboration}</b> corroborating
          </span>
          <span
            class="admiralty"
            class:manual={serverTrust?.origin.sourceGrade === 'manual' ||
              serverTrust?.origin.credibility === 'manual'}
            title="{SOURCE_GRADE_LABEL[trust.resolved.sourceGrade]} / {CREDIBILITY_LABEL[
              trust.resolved.credibility
            ]}"
          >
            {trust.resolved.sourceGrade}{trust.resolved.credibility}
          </span>
        </div>

        <!-- How old this entity is, what that costs it, and the shape of the
             evidence behind it. Replaces the bare recency chip that used to sit
             in the row above: same number, but you can see where it came from
             and click through to any of it. -->
        <EvidenceTimeline
          notes={data.notes}
          histogram={data.histogram ?? []}
          evidenceAt={data.metrics.evidenceAt}
          relevance={data.metrics.relevance}
          {compact}
        />

        {#if showBreakdown}
          <!-- The prose comes first because "why" is a question about evidence,
               not arithmetic. The points stay underneath for anyone who wants to
               reconcile the number. -->
          <ul class="why-prose">
            {#each explanation as sentence, i (i)}
              <li>{sentence}</li>
            {/each}
          </ul>
          <ul class="bd">
            {#each breakdown as c (c.key)}
              <li>
                <span class="bd-label">{c.label}</span>
                <span class="bd-value" class:neg={c.value < 0}>{points(c.value)}</span>
              </li>
            {/each}
            <li class="bd-total">
              <span class="bd-label">total</span>
              <span class="bd-value">{Math.round(trust.score * 100)}</span>
            </li>
          </ul>

          {#if !compact && serverTrust}
            <div class="grader">
              <label>
                <span>source</span>
                <select
                  value={selectedGrade}
                  onchange={(e) => (draftGrade = e.currentTarget.value as SourceGrade)}
                >
                  {#each SOURCE_GRADES as g}
                    <option value={g}>{g} — {SOURCE_GRADE_LABEL[g]}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>info</span>
                <select
                  value={String(selectedCredibility)}
                  onchange={(e) =>
                    (draftCredibility = Number(e.currentTarget.value) as CredibilityRating)}
                >
                  {#each CREDIBILITY_RATINGS as c}
                    <option value={String(c)}>{c} — {CREDIBILITY_LABEL[c]}</option>
                  {/each}
                </select>
              </label>
              <button type="button" onclick={saveGrades} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save grade'}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    {#if entityProps.length && !compact}
      <dl class="props">
        {#each entityProps.slice(0, 6) as [key, value]}
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        {/each}
      </dl>
    {/if}

    <!-- "Connected to" was here. Removed deliberately: it listed the same
         neighbours the graph is already drawing around the node you clicked,
         so it re-answered the one question the surface behind it answers
         better, and it did so at fourteen rows — pushing the evidence, which
         the graph CANNOT show, below the fold. `onFocus` is still honoured
         from the graph itself. -->

    {#if data.timeline.length && !compact}
      <section>
        <h4>Timeline</h4>
        <ul class="timeline">
          {#each data.timeline.slice(0, 5) as e}
            <li><time>{e.date}</time> {e.title}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.notes.length}
      {#if compact}
        <section>
          <h4>Sources</h4>
          <ul class="notes">
            {#each data.notes.slice(0, 3) as n}
              <li><a href={n.href}>{n.title}</a> <span class="src">{n.source}</span></li>
            {/each}
          </ul>
        </section>
      {:else}
        <!-- Replaces the bare source list: same notes, but quoting the sentence
             each claim came from, so the card can be argued with. -->
        <EvidenceList
          evidence={data.notes}
          term={data.entity.name}
          total={data.metrics.noteCount}
        />
      {/if}
    {/if}

  {/if}
</div>

<style>
  /* No max-height, no overflow. The card is itself inside a scroller (see
     EntityHoverCard), and a scroll region nested in a scroll region means the
     wheel does something different depending on which few pixels the pointer
     happens to be over. One scroller per surface. */
  .pin-list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 4px;
  }
  .pin-item {
    text-align: left;
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: none;
    border: none;
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pin-item:hover:not(:disabled) {
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .pin-note {
    margin: 6px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .pin-note.done {
    color: var(--success);
  }
  .pin-note a {
    color: var(--accent);
  }

  .entity-card {
    /* Opaque — this floats over content and must never show it through. */
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 10px 12px;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    overflow-wrap: anywhere;
    color: var(--text-primary);
    max-width: 420px;
  }
  .entity-card.compact {
    max-width: 340px;
    padding: 12px;
    font-size: var(--fs-nav);
  }

  .state {
    color: var(--text-muted);
    font-size: var(--fs-label);
    padding: 6px 0;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--line-strong);
  }
  .identity-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-top: 4px;
  }
  .icon {
    font-size: var(--fs-body-lg);
    line-height: 1.2;
  }
  .head-text {
    min-width: 0;
    flex: 1;
  }
  h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    font-weight: 400;
    line-height: 1.2;
    word-break: break-word;
  }
  .type {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .unconfirmed {
    background: var(--warn-bg);
    color: var(--warn);
    border: 1px solid var(--warn-border);
  }

  .summary {
    margin: 0 0 10px;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
    margin-bottom: 6px;
  }
  .metrics b {
    color: var(--accent-ink);
    font-weight: 600;
  }
  .broker {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* ── Trust ─────────────────────────────────────────────────────────── */
  .trust {
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
    margin-bottom: 6px;
  }

  .t-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
  }
  .t-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    flex: 1;
  }
  .t-score {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }

  .grade {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid transparent;
  }
  .grade.high {
    background: var(--success-bg);
    color: var(--success);
    border-color: var(--success-border);
  }
  .grade.moderate {
    background: var(--accent-tint-08);
    color: var(--accent-ink);
    border-color: var(--accent-tint-35);
  }
  .grade.low {
    background: var(--warn-bg);
    color: var(--warn);
    border-color: var(--warn-border);
  }
  .grade.unverified {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--line-strong);
  }

  .why {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: color var(--t-fast) var(--ease-out);
  }
  .why:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  .t-bar {
    height: 4px;
    background: var(--line);
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .t-fill {
    display: block;
    height: 100%;
    background: var(--text-ghost);
    transition: width var(--t-fast) var(--ease-out);
  }
  .t-fill.high {
    background: var(--success);
  }
  .t-fill.moderate {
    background: var(--accent-ink);
  }
  .t-fill.low {
    background: var(--warn);
  }

  .t-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .t-meta b {
    color: var(--accent-ink);
    font-weight: 600;
  }
  .admiralty {
    padding: 0 4px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: help;
  }
  .admiralty.manual {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  .why-prose {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 0;
    list-style: none;
  }
  .why-prose li {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-muted);
    padding-left: 9px;
    border-left: 2px solid var(--accent-tint-20);
  }

  .bd {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .bd li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .bd-label {
    color: var(--text-muted);
  }
  .bd-value {
    color: var(--text-secondary);
  }
  .bd-value.neg {
    color: var(--warn);
  }
  .bd-total {
    margin-top: 3px;
    padding-top: 3px;
    border-top: 1px solid var(--line-hair);
  }
  .bd-total .bd-value {
    color: var(--accent-ink);
  }

  .grader {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px;
    margin-top: 8px;
  }
  .grader label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .grader label span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .grader select {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    padding: 3px 4px;
    max-width: 100%;
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .grader button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--t-fast) var(--ease-out);
  }
  .grader button:hover:not(:disabled) {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .grader button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  section {
    margin-bottom: 10px;
  }
  h4 {
    margin: 0 0 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .props {
    margin: 0 0 10px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 0 10px;
    font-size: var(--fs-label);
  }
  dt, dd {
    padding: 4px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  dt {
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-transform: lowercase;
  }
  dd {
    margin: 0;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .timeline li {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    padding: 2px 0;
  }
  .timeline time {
    font-family: var(--font-mono);
    color: var(--accent-ink);
    margin-right: 6px;
  }

  .notes li {
    font-size: var(--fs-label);
    padding: 2px 0;
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .notes a {
    color: var(--accent-ink);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .notes a:hover {
    text-decoration: underline;
  }
  .src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* Still the `footer` element — it is the card's action set, wherever it sits
     — but it now sits under the name, so the rule that separated it from the
     content above is now the rule that separates it from the content BELOW. */
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line-hair);
  }
  footer button,
  .btn-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 5px 7px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--t-fast) var(--ease-out);
  }
  footer button:hover,
  footer button.on,
  .btn-link:hover {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  footer button:first-child {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  footer button:first-child:hover { background: var(--accent-hover); }
  .entity-card :is(button, a, select):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .metrics b, .t-score, .bd-value { font-family: var(--font-code); }
  @media (pointer: coarse) {
    footer button, .btn-link, .why { min-height: 36px; }
  }
  /* The floating shell owns scrolling; evidence stays in the same reading flow. */
  .entity-card :global(.evidence ul) { max-height: none; overflow: visible; gap: 0; }
  .entity-card :global(.evidence li) {
    padding: 6px 0;
    border-left: 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .entity-card :global(.evidence .head) { flex-wrap: wrap; gap: 3px 6px; }
  .entity-card :global(.evidence .title) { flex-basis: 100%; white-space: normal; }
</style>
