<svelte:head><title>Daydreams — JKAI</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import PlaceMap from '$lib/components/jkai/PlaceMap.svelte';

  let { data }: { data: PageData } = $props();

  type Thought = PageData['thoughts'][number];
  type Place = PageData['places'][number];

  // ── View state ────────────────────────────────────────────────────────────
  // `all` is the default rather than `new`, because on any normal day nothing
  // is new and a page that opens empty reads as broken. What the owner actually
  // wants to know first is what it has been noticing at all.
  type Filter = 'all' | 'said' | 'suppressed' | 'ruled';
  let filter = $state<Filter>('all');
  let expanded = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // Naming a place — the loop the whole feature is built around. Opening the
  // form shows a map and asks the geocoder what is there, so the question is
  // "is this right?" rather than "where were you on the 14th?".
  let namingPlace = $state<string | null>(null);
  let placeLabel = $state('');
  let placeKind = $state('other');
  let suggesting = $state(false);
  let suggestion = $state<{ name: string | null; kind: string | null; address: string | null } | null>(null);
  type Visit = { startedAt: string; dwellMins: number; dateLabel: string; dayName: string; timeLabel: string };
  let visits = $state<Visit[]>([]);

  async function openNaming(p: Place) {
    namingPlace = p.id;
    placeLabel = '';
    placeKind = 'other';
    suggestion = null;
    visits = [];
    suggesting = true;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_name', placeId: p.id }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        suggestion?: { name: string | null; kind: string | null; address: string | null };
        visits?: Visit[];
      };
      visits = out.visits ?? [];
      if (out.suggestion) {
        suggestion = out.suggestion;
        // Pre-fill, never auto-save. A geocoded guess is weaker evidence than
        // the owner's own answer, and only a confirmed name is ever quoted back
        // as fact.
        if (out.suggestion.name) placeLabel = out.suggestion.name;
        if (out.suggestion.kind) placeKind = out.suggestion.kind;
      }
    } catch {
      suggestion = null;
      visits = [];
    } finally {
      suggesting = false;
    }
  }

  // ── The naming session ────────────────────────────────────────────────────
  // Thirty places in ten minutes, rather than four notifications a day for a
  // week. The interruption budget in deliver.ts exists to protect attention the
  // owner has not offered; a page they chose to open is attention they have, so
  // the session spends none of it.
  //
  // Every row arrives pre-filled from `suggestedLabel`, which the background
  // geocoder wrote hours ago. That is the difference between a confirmation and
  // a memory test: "Costa Coffee, 12 High Row — yes?" is answerable on a phone,
  // and a lat/lon is not.
  type QueuePlace = {
    id: string;
    visitCount: number;
    medianDwellMins: number;
    rhythm: string;
    lastSeenAt: string | null;
    suggestedLabel: string | null;
    suggestedKind: string | null;
    suggestedAddress: string | null;
  };

  let sessionOpen = $state(false);
  let sessionLoading = $state(false);
  let sessionSaving = $state(false);
  let sessionError = $state<string | null>(null);
  let sessionQueue = $state<QueuePlace[]>([]);
  /** placeId → what the owner has typed. Absent means untouched, so a row the
   *  owner never looked at is never saved with a machine's guess in it. */
  let drafts = $state<Record<string, { label: string; kind: string }>>({});
  let sessionDone = $state<{ named: number; failed: number; thoughtsResolved: number } | null>(null);

  const draftCount = $derived(
    Object.values(drafts).filter((d) => d.label.trim().length > 0).length,
  );

  async function openSession() {
    sessionOpen = true;
    sessionDone = null;
    sessionError = null;
    sessionLoading = true;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'naming_queue', limit: 60 }),
      });
      const out = (await res.json().catch(() => ({}))) as { places?: QueuePlace[]; error?: string };
      if (out.error) throw new Error(out.error);
      sessionQueue = out.places ?? [];
      drafts = {};
    } catch (err) {
      sessionError = err instanceof Error ? err.message : String(err);
      sessionQueue = [];
    } finally {
      sessionLoading = false;
    }
  }

  /** Accept the suggestion as-is. The commonest action, so it is one tap and
   *  the row stays editable afterwards. */
  function acceptSuggestion(p: QueuePlace) {
    if (!p.suggestedLabel) return;
    drafts = { ...drafts, [p.id]: { label: p.suggestedLabel, kind: p.suggestedKind ?? 'other' } };
  }

  function editDraft(p: QueuePlace, field: 'label' | 'kind', value: string) {
    const current = drafts[p.id] ?? { label: '', kind: p.suggestedKind ?? 'other' };
    drafts = { ...drafts, [p.id]: { ...current, [field]: value } };
  }

  function clearDraft(id: string) {
    const { [id]: _dropped, ...rest } = drafts;
    drafts = rest;
  }

  async function saveSession() {
    const payload = Object.entries(drafts)
      .filter(([, d]) => d.label.trim().length > 0)
      .map(([placeId, d]) => ({ placeId, label: d.label.trim(), kind: d.kind }));
    if (payload.length === 0) return;

    sessionSaving = true;
    sessionError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'name_places', places: payload }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        named?: number;
        failed?: { placeId: string; error: string }[];
        thoughtsResolved?: number;
        error?: string;
      };
      if (out.error) throw new Error(out.error);
      sessionDone = {
        named: out.named ?? 0,
        failed: (out.failed ?? []).length,
        thoughtsResolved: out.thoughtsResolved ?? 0,
      };
      // Drop the rows that landed, so a partial failure leaves exactly the
      // unsaved answers on screen rather than making the owner retype them.
      const savedIds = new Set(payload.map((x) => x.placeId));
      for (const f of out.failed ?? []) savedIds.delete(f.placeId);
      sessionQueue = sessionQueue.filter((q) => !savedIds.has(q.id));
      const remaining: Record<string, { label: string; kind: string }> = {};
      for (const [k, v] of Object.entries(drafts)) if (!savedIds.has(k)) remaining[k] = v;
      drafts = remaining;
      await invalidateAll();
    } catch (err) {
      sessionError = err instanceof Error ? err.message : String(err);
    } finally {
      sessionSaving = false;
    }
  }

  // ── The sorting deck ──────────────────────────────────────────────────────
  // The cold start is otherwise unreachable: the threshold needs ~25 responses
  // to fall from 0.75 to its floor, the daily cap is 4, and with no push
  // subscriber almost nothing is delivered at all. One sitting here produces
  // more signal than six weeks of notifications, and costs no interruptions.
  type DeckCard = {
    id: string;
    kind: string;
    title: string;
    explanation: string;
    narrative: string | null;
    verified: boolean | null;
    score: number;
    recurrenceCount: number;
    suppressedReason: string | null;
  };
  type Verdict = 'useful' | 'not_useful' | 'never_kind';

  let deckOpen = $state(false);
  let deckLoading = $state(false);
  let deckSaving = $state(false);
  let deckError = $state<string | null>(null);
  let deck = $state<DeckCard[]>([]);
  let verdicts = $state<Record<string, Verdict>>({});
  let deckDone = $state<{ recorded: number; failed: number } | null>(null);

  const verdictCount = $derived(Object.keys(verdicts).length);

  async function openDeck() {
    deckOpen = true;
    deckDone = null;
    deckError = null;
    deckLoading = true;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'triage_deck', limit: 30 }),
      });
      const out = (await res.json().catch(() => ({}))) as { deck?: DeckCard[]; error?: string };
      if (out.error) throw new Error(out.error);
      deck = out.deck ?? [];
      verdicts = {};
    } catch (err) {
      deckError = err instanceof Error ? err.message : String(err);
      deck = [];
    } finally {
      deckLoading = false;
    }
  }

  /** Tapping the same verdict again clears it — a mis-tap costs one tap, not a
   *  wrong vote he cannot take back. */
  function setVerdict(id: string, v: Verdict) {
    if (verdicts[id] === v) {
      const { [id]: _dropped, ...rest } = verdicts;
      verdicts = rest;
    } else {
      verdicts = { ...verdicts, [id]: v };
    }
  }

  async function saveDeck() {
    const payload = Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict }));
    if (payload.length === 0) return;
    deckSaving = true;
    deckError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'triage_batch', verdicts: payload }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        recorded?: number;
        failed?: { id: string }[];
        error?: string;
      };
      if (out.error) throw new Error(out.error);
      deckDone = { recorded: out.recorded ?? 0, failed: (out.failed ?? []).length };
      const failedIds = new Set((out.failed ?? []).map((f) => f.id));
      deck = deck.filter((c) => failedIds.has(c.id) || !(c.id in verdicts));
      const remaining: Record<string, Verdict> = {};
      for (const [k, v] of Object.entries(verdicts)) if (failedIds.has(k)) remaining[k] = v;
      verdicts = remaining;
      await invalidateAll();
    } catch (err) {
      deckError = err instanceof Error ? err.message : String(err);
    } finally {
      deckSaving = false;
    }
  }

  // ── Steering, and the morning card ────────────────────────────────────────
  // The digest is what lets thinking volume rise without interruption volume
  // rising with it: somewhere quiet output can land. The steer box is the only
  // owner-authored text the engine has ever read beyond a place name — and it
  // reorders work without granting one byte of new access.
  const digest = $derived(data.digest);
  type Steer = { id: string; text: string; status: string; batchesInfluenced: number };
  let steers = $state<Steer[]>([]);
  let steerText = $state('');
  let steerBusy = $state(false);
  let steerError = $state<string | null>(null);

  $effect(() => {
    // Tracked read of the loaded prop only; the write is untracked, so this
    // cannot re-trigger on the array it just assigned.
    const incoming = data.steers;
    untrack(() => {
      steers = (incoming ?? []) as Steer[];
    });
  });

  async function steerPost(body: Record<string, unknown>) {
    steerError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => ({}))) as { steers?: Steer[]; error?: string };
      if (out.error) throw new Error(out.error);
      if (out.steers) steers = out.steers;
      return true;
    } catch (err) {
      steerError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async function submitSteer() {
    const text = steerText.trim();
    if (!text) return;
    steerBusy = true;
    const ok = await steerPost({ action: 'add_steer', text });
    if (ok) steerText = '';
    steerBusy = false;
  }

  // ── The propositions board ────────────────────────────────────────────────
  // Questions the assistant chose to ask, and what the data said back. Every
  // verdict is shown, not just the ones that held: a board of only its hits
  // looks clever and cannot be argued with.
  type BoardRow = {
    id: string;
    question: string;
    rationale: string;
    metricA: string;
    metricB: string;
    lagDays: number;
    direction: string;
    verdict: string | null;
    summary: string | null;
    r: number | null;
    qValue: number | null;
    pairs: number | null;
    familySize: number | null;
    retestCount: number;
    retestInDays: number | null;
    feedback: string | null;
    proposedAt: string;
    testedAt: string | null;
  };

  let boardOpen = $state(false);
  let boardLoading = $state(false);
  let boardError = $state<string | null>(null);
  let board = $state<BoardRow[]>([]);

  const VERDICT_LABEL: Record<string, string> = {
    supported: 'held up',
    refuted: 'nothing there',
    wrong_direction: 'backwards',
    underpowered: 'not enough data',
  };

  async function openBoard() {
    boardOpen = true;
    boardError = null;
    boardLoading = true;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'hypothesis_board', limit: 60 }),
      });
      const out = (await res.json().catch(() => ({}))) as { board?: BoardRow[]; error?: string };
      if (out.error) throw new Error(out.error);
      board = out.board ?? [];
    } catch (err) {
      boardError = err instanceof Error ? err.message : String(err);
      board = [];
    } finally {
      boardLoading = false;
    }
  }

  async function rateQ(row: BoardRow, verdict: 'useful' | 'not_useful') {
    const ok = await post({ action: 'rate_question', id: row.id, verdict }, `q:${row.id}`);
    if (ok) board = board.map((b) => (b.id === row.id ? { ...b, feedback: verdict } : b));
  }

  /**
   * What a thought should actually say, now.
   *
   * A stored title is frozen at detect time. Ten rows in production read "What
   * is this place you keep going to?" about places that had since been named,
   * and the two that were genuinely open named nothing at all — one of them
   * had "Hush Digital" sitting in its suggestion the whole time. Neither is
   * answerable as written, which is the entire complaint.
   *
   * So the headline is resolved from the place as it stands: its name if it has
   * one, the geocoder's guess if it does not, and only then the stored title.
   */
  function headline(t: Thought): string {
    if (t.placeLabel) return t.placeLabel;
    if (t.placeSuggested) return `Is this ${t.placeSuggested}?`;
    if (t.placeAddress) return `The place on ${t.placeAddress}`;
    return t.title;
  }

  /** A question about a place that now has a name has been answered, whatever
   *  the row's status says. Saying so stops it reading as still open. */
  function isAnswered(t: Thought): boolean {
    return Boolean(t.placeLabel) && t.kind.startsWith('unknown');
  }

  /** Statuses that mean "this reached him". Only these can be rated. */
  const SHOWN_STATUSES = ['delivered', 'seen', 'actioned'];

  /**
   * `?rate=<id>` — where a chat note's link lands.
   *
   * Derived rather than copied into state in an effect: the URL is already
   * reactive, and syncing it into `$state` is the prop-to-state pattern that
   * re-tracks its own proxy and hangs the page. Reading it directly has no such
   * failure mode and needs no untrack.
   */
  const rateId = $derived(page.url.searchParams.get('rate'));

  const PLACE_KINDS = ['home', 'school', 'work', 'shop', 'cafe', 'gym', 'other'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const thoughts = $derived(data.thoughts ?? []);
  const places = $derived(data.places ?? []);
  const detectors = $derived(data.detectors ?? []);
  const counts = $derived(data.counts);
  const engine = $derived(data.engine);

  const said = $derived(thoughts.filter((t) => t.status === 'delivered' || t.status === 'new'));
  const suppressed = $derived(thoughts.filter((t) => t.status === 'suppressed'));
  const ruled = $derived(
    thoughts.filter((t) => ['dismissed', 'actioned', 'snoozed'].includes(t.status)),
  );
  const visible = $derived(
    filter === 'said' ? said : filter === 'suppressed' ? suppressed : filter === 'ruled' ? ruled : thoughts,
  );

  /** Places worth asking about. The one- and two-visit ones still exist and
   *  still match offers and proximity — they are simply not questions.
   *  The threshold comes from the ledger (MIN_VISITS_TO_ASK), not a local
   *  copy that drifts; the fallback only covers the load-error path. */
  const delivery = $derived(data.delivery);
  const askAtVisits = $derived(delivery?.minVisitsToAsk ?? 3);
  const unnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.visitCount >= askAtVisits),
  );
  const quietUnnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.visitCount < askAtVisits).length,
  );
  const named = $derived(places.filter((p) => p.label && p.status === 'active'));

  const budget = $derived(data.budget);
  const rules = $derived(data.rules ?? []);
  const proposedRules = $derived(rules.filter((r) => r.status === 'proposed'));
  const activeRules = $derived(rules.filter((r) => r.status === 'active'));
  const readyCount = $derived(detectors.filter((d) => d.readiness?.ready).length);
  /** `counts.byStatus` is `{}` on the load-error path, so it is read through a
   *  lookup rather than a property access. */
  const suppressedCount = $derived(
    (counts.byStatus as Record<string, number>)?.suppressed ?? 0,
  );
  const mutedCount = $derived(detectors.filter((d) => d.muted).length);

  /** Has the engine ever actually run? Distinguishes "quiet" from "not wired". */
  const hasRun = $derived(engine.lastDetectAt != null);

  function ago(iso: string | null): string {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function pct(n: number | null | undefined): string {
    return n == null ? '—' : `${Math.round(n * 100)}%`;
  }

  function rhythm(p: Place): string {
    const parts = [`${p.visitCount} visit${p.visitCount === 1 ? '' : 's'}`];
    if (p.medianDwellMins > 0) parts.push(`~${p.medianDwellMins} min`);
    const total = p.dayHistogram.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const peak = p.dayHistogram.indexOf(Math.max(...p.dayHistogram));
      if (p.dayHistogram[peak] / total >= 0.5 && p.dayHistogram[peak] >= 2) {
        parts.push(`usually ${DAYS[peak]}`);
      }
    }
    return parts.join(' · ');
  }

  async function post(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        actionError = out.error ?? 'that did not work';
        return false;
      }
      await invalidateAll();
      return true;
    } catch {
      actionError = 'that did not work';
      return false;
    } finally {
      busy = null;
    }
  }

  async function vote(t: Thought, verdict: 'useful' | 'not_useful' | 'never_kind') {
    await post({ action: 'feedback', id: t.id, verdict }, `${t.id}:${verdict}`);
  }

  let backfilling = $state(false);
  let backfillNote = $state<string | null>(null);

  async function runBackfill() {
    backfilling = true;
    backfillNote = null;
    try {
      const res = await fetch('/api/daydream/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        error?: string;
        backfill?: { fixesKept: number; daysFetched: number; fixesSeen: number; entity: string | null };
        places?: { created: number } | null;
      };
      if (!res.ok || out.error) {
        backfillNote = out.error ?? 'backfill failed';
      } else {
        const b = out.backfill;
        backfillNote =
          `Pulled ${b?.daysFetched ?? 0} days from ${b?.entity ?? 'Home Assistant'}: ` +
          `${b?.fixesSeen ?? 0} fixes seen, ${b?.fixesKept ?? 0} kept` +
          (out.places ? `, ${out.places.created} new places` : '');
        await invalidateAll();
      }
    } catch {
      backfillNote = 'backfill failed';
    } finally {
      backfilling = false;
    }
  }

  async function submitName(placeId: string) {
    if (!placeLabel.trim()) return;
    const ok = await post(
      { action: 'name_place', placeId, label: placeLabel, kind: placeKind },
      `name:${placeId}`,
    );
    if (ok) {
      namingPlace = null;
      placeLabel = '';
      placeKind = 'other';
    }
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Daydreaming</div>
      <h1>Daydreams</h1>
      <p class="sub">
        Everything jkai has noticed on spare cycles — including what it decided
        <strong>not</strong> to say, and why. Rules do the noticing; a model only ever
        phrases a finding that a rule already confirmed.
      </p>
    </div>
    <div class="hdr-links">
      <a class="back-link" href="/jkai">JKAI</a>
    </div>
  </header>

  {#if data.loadError}
    <div class="nm-sec-error">Could not read the ledger: {data.loadError}</div>
  {/if}

  {#if !data.enabled}
    <div class="banner off">
      Daydreaming is switched off (<code>daydream.enabled</code>). Nothing is being
      observed or noticed.
    </div>
  {/if}

  <!-- ── ENGINE STATE ───────────────────────────────────────────────────
       Leads the page. Everything below is meaningless if the engine has not
       run, and "quiet" and "not wired up" have to be tellable apart. -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Engine</span>
      <span class="nm-sec-meta">
        {#if hasRun}last looked {ago(engine.lastDetectAt)}{:else}has not run yet{/if}
      </span>
    </div>

    <div class="stat-grid">
      <div class="stat-tile">
        <div class="stat-num">{engine.trailSpanDays ?? 0}</div>
        <div class="stat-label">days of trail</div>
        <div class="stat-sub">observed {ago(engine.lastObserveAt)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-num">{pct(engine.coverage?.last24h)}</div>
        <div class="stat-label">covered, 24h</div>
        <div class="stat-sub">7d {pct(engine.coverage?.last7d)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-num">{readyCount}<span class="of">/{detectors.length}</span></div>
        <div class="stat-label">detectors ready</div>
        <div class="stat-sub">{mutedCount} muted by you</div>
      </div>
      <div class="stat-tile">
        <div class="stat-num">{counts.namedPlaces}<span class="of">/{counts.places}</span></div>
        <div class="stat-label">places named</div>
        <div class="stat-sub">{counts.unnamedPlaces} still unnamed</div>
      </div>
    </div>

    {#if engine.summary}
      <p class="engine-summary">{engine.summary}</p>
    {/if}

    {#if engine.pausedActions.length}
      <p class="warn-line">
        Not running: {engine.pausedActions.join(', ')}
      </p>
    {/if}

    {#if engine.sources.some((s) => s.status === 'failed')}
      <p class="warn-line">
        Sources that failed last tick:
        {engine.sources.filter((s) => s.status === 'failed').map((s) => `${s.key} (${s.detail})`).join('; ')}
      </p>
    {/if}

    {#if delivery && !delivery.hasPushSubscriber}
      <!-- The documented root cause of the empty feedback ledger: with nowhere
           to push, every thought falls back to a chat note whose feedback link
           is rarely followed, so the learning loop never gets an input. -->
      <p class="warn-line">
        No device is subscribed to push — thoughts fall back to chat notes, and without
        feedback taps the confidence threshold never relaxes.
      </p>
    {/if}

    <div class="thought-actions">
      <button class="row-link" disabled={backfilling} onclick={runBackfill}>
        {backfilling ? 'Pulling history…' : 'Backfill from Home Assistant'}
      </button>
    </div>
    {#if backfillNote}
      <p class="sec-lede">{backfillNote}</p>
    {/if}
  </section>

  <!-- Yesterday, in one card. Quiet days are reported as clearly as busy ones —
       a digest that only appears when there is news cannot be trusted when it
       is silent. -->
  {#if digest}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Yesterday</span>
        <span class="nm-sec-meta">{digest.day}</span>
      </div>
      <p class="digest">{digest.summary}</p>
      {#if digest.narrative}
        <p class="narrative" class:unchecked={digest.verified === false}>
          {digest.narrative}
          <span class="narr-tag" class:ok={digest.verified === true}>
            {digest.verified === true ? 'model · checked' : 'model · UNCHECKED'}
          </span>
        </p>
      {/if}
    </section>
  {/if}

  <!-- What it has been wondering about. The model picks the questions; code
       answers them. Everything asked is shown, however it turned out. -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">What it wondered</span>
      <span class="nm-sec-meta">questions, and the answers</span>
    </div>
    <p class="sec-lede">
      The assistant chooses what to investigate before it sees any results, then
      deterministic statistics answer it. A question that came back empty is
      still worth reading — and is kept here exactly as long as one that held.
    </p>

    <!-- Reorders what gets asked. Grants no new access: the proposer still sees
         only the metric list, and a steer reaches it as quoted preference. -->
    <div class="steer-box">
      <label class="sr-label-tight" for="steer-input">Ask it to look into something</label>
      <div class="steer-row">
        <input
          id="steer-input"
          class="nm-text-input steer-input"
          bind:value={steerText}
          maxlength="280"
          placeholder="e.g. whether going out late costs me the next morning"
          onkeydown={(e) => { if (e.key === 'Enter') submitSteer(); }}
        />
        <button class="row-link" disabled={steerBusy || !steerText.trim()} onclick={submitSteer}>
          {steerBusy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {#if steerError}<p class="nm-sec-error">{steerError}</p>{/if}
      {#if steers.length}
        <ul class="steer-list">
          {#each steers as st (st.id)}
            <li class="steer" class:done={st.status !== 'active'}>
              <span class="steer-text">{st.text}</span>
              <span class="steer-meta mono">
                {st.status === 'active'
                  ? `${st.batchesInfluenced} batch${st.batchesInfluenced === 1 ? '' : 'es'}`
                  : st.status}
              </span>
              {#if st.status === 'active'}
                <button class="row-link" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'done' })}>Done</button>
                <button class="row-link danger" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'dropped' })}>Drop</button>
              {:else}
                <button class="row-link" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'active' })}>Reopen</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="session-bar">
      {#if !boardOpen}
        <button class="session-cta" onclick={openBoard}>Open the board</button>
      {:else}
        <button class="row-link" onclick={() => { boardOpen = false; }}>Close</button>
      {/if}
    </div>

    {#if boardError}<p class="nm-sec-error">{boardError}</p>{/if}

    {#if boardOpen}
      {#if boardLoading}
        <p class="sec-lede">Loading…</p>
      {:else if board.length === 0}
        <p class="sec-lede">Nothing asked yet. The first batch arrives on the next nightly cycle.</p>
      {:else}
        <div class="session-list">
          {#each board as q (q.id)}
            <div class="hyp" class:held={q.verdict === 'supported'}>
              <div class="hyp-q">{q.question}</div>
              <div class="hyp-meta">
                <span class="mono">{q.metricA}{q.lagDays ? ' → ' : ' ~ '}{q.metricB}</span>
                {#if q.lagDays}<span class="sep">·</span><span class="mono">next day</span>{/if}
                <span class="sep">·</span>
                <span class="mono">expected {q.direction}</span>
                {#if q.retestCount > 0}
                  <span class="sep">·</span><span class="mono">retested {q.retestCount}×</span>
                {/if}
              </div>
              {#if q.verdict}
                <div class="hyp-verdict v-{q.verdict}">
                  <span class="hyp-badge">{VERDICT_LABEL[q.verdict] ?? q.verdict}</span>
                  <span class="hyp-sum">{q.summary}</span>
                </div>
                <!-- Nothing is filtered by verdict when choosing what to
                     retest, so every answer here is provisional. Saying when it
                     is next checked is what stops "nothing there" reading as a
                     closed case. -->
                {#if q.retestInDays !== null}
                  <div class="hyp-family mono">
                    {q.retestInDays === 0 ? 'due to be checked again' : `checked again in ${q.retestInDays}d`}
                  </div>
                {/if}
                {#if q.familySize}
                  <!-- The family size is shown because a q-value cannot be read
                       without it: q over 4 tests and q over 400 are not the
                       same number. -->
                  <div class="hyp-family mono">corrected across {q.familySize} test{q.familySize === 1 ? '' : 's'}</div>
                {/if}
              {:else}
                <div class="hyp-verdict v-untested">
                  <span class="hyp-badge">not answered yet</span>
                </div>
              {/if}
              <div class="hyp-why">{q.rationale}</div>
              <div class="hyp-actions">
                {#if q.feedback}
                  <span class="voted">you said {q.feedback.replace('_', ' ')}</span>
                {:else}
                  <span class="hyp-ask">Worth asking?</span>
                  <button class="row-link" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'useful')}>Yes</button>
                  <button class="row-link" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'not_useful')}>No</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>

  <!-- The sorting deck. Everything about ranking is a random walk until the
       ledger has feedback in it, and at four interruptions a day the 25
       responses the threshold needs are never collected. One sitting closes
       that gap and costs no interruption budget at all. -->
  {#if suppressedCount}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">What it nearly said</span>
        <span class="nm-sec-meta">{suppressedCount} held back</span>
      </div>
      <p class="sec-lede">
        These scored below the bar, so nothing was sent. That bar was set with no
        evidence — rating a few here is what moves it. Nothing you do in this
        section interrupts you, and none of it counts as a notification.
      </p>

      <div class="session-bar">
        {#if !deckOpen}
          <button class="session-cta" onclick={openDeck}>Sort through them</button>
          <span class="session-hint">Thirty at a time, most-repeated first.</span>
        {:else}
          <button class="row-link" onclick={() => { deckOpen = false; }}>Close</button>
          {#if verdictCount}
            <button class="session-cta" disabled={deckSaving} onclick={saveDeck}>
              {deckSaving ? 'Saving…' : `Save ${verdictCount} verdict${verdictCount === 1 ? '' : 's'}`}
            </button>
          {/if}
        {/if}
      </div>

      {#if deckDone}
        <p class="session-done">
          Recorded {deckDone.recorded}{deckDone.failed ? `, ${deckDone.failed} failed` : ''}.
          Counted at 0.7 of a considered verdict.
        </p>
      {/if}
      {#if deckError}<p class="nm-sec-error">{deckError}</p>{/if}

      {#if deckOpen}
        {#if deckLoading}
          <p class="sec-lede">Loading…</p>
        {:else if deck.length === 0}
          <p class="sec-lede">Nothing left to sort.</p>
        {:else}
          <div class="session-list">
            {#each deck as c (c.id)}
              <div class="deck-card" class:ruled={verdicts[c.id]}>
                <div class="deck-body">
                  <div class="deck-hd">
                    <span class="mono deck-kind">{c.kind}</span>
                    <span class="sep">·</span>
                    <span class="mono">score {c.score}</span>
                    {#if c.recurrenceCount > 1}
                      <span class="sep">·</span>
                      <span class="mono deck-rec">proposed {c.recurrenceCount}×</span>
                    {/if}
                  </div>
                  <div class="deck-title">{c.title}</div>
                  <div class="deck-expl">{c.narrative || c.explanation}</div>
                </div>
                <div class="deck-actions">
                  <button
                    class="row-link"
                    class:picked={verdicts[c.id] === 'useful'}
                    onclick={() => setVerdict(c.id, 'useful')}
                  >Useful</button>
                  <button
                    class="row-link"
                    class:picked={verdicts[c.id] === 'not_useful'}
                    onclick={() => setVerdict(c.id, 'not_useful')}
                  >Not useful</button>
                  <button
                    class="row-link danger"
                    class:picked={verdicts[c.id] === 'never_kind'}
                    onclick={() => setVerdict(c.id, 'never_kind')}
                  >Never this kind</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Budget</span>
      <span class="nm-sec-meta">
        {#if budget}{budget.modelId}{:else}unavailable{/if}
      </span>
    </div>

    {#if !budget}
      <p class="sec-lede">Could not read the model or the usage meter.</p>
    {:else if !budget.applies}
      <p class="sec-lede">
        Running on <strong>{budget.provider}</strong>, so the subscription caps do not apply —
        this spend is cash, and nothing here limits it.
      </p>
    {:else}
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-num">{budget.spentTodayWeeklyPct}<span class="of">/{budget.dailyCapPct}%</span></div>
          <div class="stat-label">of weekly, today</div>
          <div class="stat-sub">paced target {budget.pacedTargetPct}%</div>
        </div>
        <div class="stat-tile">
          <div class="stat-num">{budget.spentThisWindowPct}<span class="of">/{budget.fiveHourCapPct}%</span></div>
          <div class="stat-label">of this 5h window</div>
          <div class="stat-sub">{budget.remainingWindowPct}% left</div>
        </div>
        <div class="stat-tile">
          <div class="stat-num">{budget.plan.depth}</div>
          <div class="stat-label">working depth</div>
          <div class="stat-sub">
            {budget.plan.maxCandidates} candidate{budget.plan.maxCandidates === 1 ? '' : 's'}{budget.plan.verify ? ', verified' : ''}
          </div>
        </div>
      </div>
      {#if budget.blocked}
        <p class="warn-line">Paused: {budget.blockedReason}</p>
      {:else if !budget.reachable}
        <p class="warn-line">
          Usage meter unreachable — working at minimum depth rather than stopping.
        </p>
      {/if}
      <p class="sec-lede budget-note">
        Spare budget buys more <strong>thinking</strong>, never more notifications: extra
        headroom adds a verification pass and more candidates considered. What reaches your
        phone is capped separately at {delivery?.maxPerDay ?? 4} a day.
      </p>
    {/if}

  </section>

  <!-- ── UNNAMED PLACES ─────────────────────────────────────────────────
       Placed above the thoughts on purpose. Several detectors are inert until
       a place has a name, so this is the highest-leverage thing on the page
       and answering one question here unlocks more than any amount of
       reading below. -->
  {#if unnamed.length || quietUnnamed}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">What is this place?</span>
        <span class="nm-sec-meta">{counts.unnamedPlaces} unnamed</span>
      </div>
      <p class="sec-lede">
        A named place turns a coordinate into a fact. Several of the detectors stay
        silent until one has a name, so this is the highest-leverage thing on the page.
        {#if quietUnnamed}
          <br />{quietUnnamed} of them {quietUnnamed === 1 ? 'has' : 'have'} fewer than
          {askAtVisits} visits, so {quietUnnamed === 1 ? 'it is' : 'they are'} never
          interrupted about — but {quietUnnamed === 1 ? 'it is' : 'they are'} in the session below.
        {/if}
      </p>

      <!-- The sit-down. A page the owner opened is attention they have offered,
           so naming thirty places here costs none of the interruption budget
           that four-a-day protects. -->
      <div class="session-bar">
        {#if !sessionOpen}
          <button class="session-cta" onclick={openSession}>
            Name them in one go — {counts.unnamedPlaces} waiting
          </button>
          <span class="session-hint">Each one arrives with a suggested name and address.</span>
        {:else}
          <button class="row-link" onclick={() => { sessionOpen = false; }}>Close the session</button>
          {#if draftCount}
            <button class="session-cta" disabled={sessionSaving} onclick={saveSession}>
              {sessionSaving ? 'Saving…' : `Save ${draftCount} name${draftCount === 1 ? '' : 's'}`}
            </button>
          {/if}
        {/if}
      </div>

      {#if sessionDone}
        <p class="session-done">
          Named {sessionDone.named}{sessionDone.failed ? `, ${sessionDone.failed} failed` : ''}.
          {#if sessionDone.thoughtsResolved}
            Closed {sessionDone.thoughtsResolved} open question{sessionDone.thoughtsResolved === 1 ? '' : 's'}.
          {/if}
        </p>
      {/if}
      {#if sessionError}
        <p class="nm-sec-error">{sessionError}</p>
      {/if}

      {#if sessionOpen}
        {#if sessionLoading}
          <p class="sec-lede">Loading the queue…</p>
        {:else if sessionQueue.length === 0}
          <p class="sec-lede">Nothing left unnamed.</p>
        {:else}
          <div class="session-list">
            {#each sessionQueue as q (q.id)}
              {@const draft = drafts[q.id]}
              <div class="session-row" class:filled={draft && draft.label.trim()}>
                <div class="session-meta">
                  <span class="session-rhythm">{q.rhythm}</span>
                  {#if q.suggestedAddress}
                    <span class="session-addr">{q.suggestedAddress}</span>
                  {:else}
                    <span class="session-addr none">no address found for this spot</span>
                  {/if}
                </div>
                <div class="session-controls">
                  {#if !draft && q.suggestedLabel}
                    <button class="suggest-chip" onclick={() => acceptSuggestion(q)}>
                      {q.suggestedLabel}{q.suggestedKind ? ` · ${q.suggestedKind}` : ''}
                    </button>
                    <button
                      class="row-link"
                      onclick={() => editDraft(q, 'label', '')}
                    >Something else</button>
                  {:else}
                    <input
                      class="nm-text-input session-input"
                      value={draft?.label ?? ''}
                      placeholder={q.suggestedLabel ?? 'What is it called?'}
                      oninput={(e) => editDraft(q, 'label', e.currentTarget.value)}
                    />
                    <select
                      class="nm-text-input kind-select"
                      value={draft?.kind ?? q.suggestedKind ?? 'other'}
                      onchange={(e) => editDraft(q, 'kind', e.currentTarget.value)}
                    >
                      {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
                    </select>
                    {#if draft}
                      <button class="row-link" onclick={() => clearDraft(q.id)}>Skip</button>
                    {/if}
                  {/if}
                  <button
                    class="row-link danger"
                    disabled={busy === `ignore:${q.id}`}
                    onclick={() => post({ action: 'ignore_place', placeId: q.id }, `ignore:${q.id}`)}
                  >Never ask</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <div class="rows" class:hidden={sessionOpen}>
        {#each unnamed as p (p.id)}
          <div class="place-row">
            <div class="place-id">
              <span class="place-rhythm">{rhythm(p)}</span>
            </div>
            {#if namingPlace === p.id}
              <div class="naming">
                <PlaceMap lat={p.lat} lon={p.lon} radiusM={p.radiusM} />
                <p class="geo-line">
                  {#if suggesting}
                    Looking up what is there…
                  {:else if suggestion?.address}
                    {suggestion.address}
                    {#if suggestion.name}<span class="geo-src">· suggested, check it</span>{/if}
                  {:else}
                    No address found for this spot — the map is the better guide.
                  {/if}
                </p>
                {#if visits.length}
                  <div class="visits">
                    <span class="sr-label-tight">When you were here</span>
                    <ul class="visit-list">
                      {#each visits as v (v.startedAt)}
                        <li>
                          <span class="v-day">{v.dayName}</span>
                          <span class="v-date">{v.dateLabel}</span>
                          <span class="v-time mono">{v.timeLabel}</span>
                          <span class="v-dwell mono">{v.dwellMins} min</span>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                <div class="name-form">
                  <input
                    class="nm-text-input"
                    bind:value={placeLabel}
                    placeholder="What is it called?"
                    onkeydown={(e) => { if (e.key === 'Enter') submitName(p.id); }}
                  />
                  <select class="nm-text-input kind-select" bind:value={placeKind}>
                    {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
                  </select>
                  <button
                    class="row-link"
                    disabled={busy === `name:${p.id}` || !placeLabel.trim()}
                    onclick={() => submitName(p.id)}
                  >Save</button>
                  <button class="row-link" onclick={() => { namingPlace = null; placeLabel = ''; suggestion = null; }}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="place-actions">
                <button class="row-link" onclick={() => openNaming(p)}>Name it</button>
                <button
                  class="row-link danger"
                  disabled={busy === `ignore:${p.id}`}
                  onclick={() => post({ action: 'ignore_place', placeId: p.id }, `ignore:${p.id}`)}
                >Stop asking</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── THOUGHTS ───────────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Thoughts</span>
      <span class="nm-sec-meta">
        threshold {data.threshold.value} · from {data.threshold.feedbackCount} response{data.threshold.feedbackCount === 1 ? '' : 's'}
      </span>
    </div>

    <div class="filters">
      <button class="filter" class:on={filter === 'all'} onclick={() => (filter = 'all')}>
        All <span class="n">{thoughts.length}</span>
      </button>
      <button class="filter" class:on={filter === 'said'} onclick={() => (filter = 'said')}>
        Above threshold <span class="n">{said.length}</span>
      </button>
      <button class="filter" class:on={filter === 'suppressed'} onclick={() => (filter = 'suppressed')}>
        Held back <span class="n">{suppressed.length}</span>
      </button>
      <button class="filter" class:on={filter === 'ruled'} onclick={() => (filter = 'ruled')}>
        You ruled on <span class="n">{ruled.length}</span>
      </button>
    </div>

    {#if actionError}
      <p class="warn-line err">{actionError}</p>
    {/if}

    {#if visible.length === 0}
      <div class="empty">
        {#if !hasRun}
          The detect pass has not run yet.
        {:else if thoughts.length === 0}
          Nothing noticed yet. {detectors.length - readyCount} of {detectors.length} detectors are
          still gathering the history they need — see below for what each is waiting for.
        {:else}
          Nothing in this view.
        {/if}
      </div>
    {:else}
      <div class="rows">
        {#each visible as t (t.id)}
          <article class="thought st-{t.status}">
            <div class="thought-hd">
              <button class="thought-title" onclick={() => (expanded = expanded === t.id ? null : t.id)}>
                {headline(t)}
              </button>
              {#if isAnswered(t)}
                <span class="thought-pill answered">answered</span>
              {:else}
                <span class="thought-pill">{t.status}</span>
              {/if}
            </div>

            <!-- A question about a place that now has a name is finished
                 business, and saying so stops it reading as still open. The
                 stored title is kept beneath, because it is what was actually
                 asked at the time. -->
            {#if isAnswered(t)}
              <p class="thought-answered">
                You named this <strong>{t.placeLabel}</strong>{t.placeVisits ? ` · ${t.placeVisits} visits` : ''}.
                It asked: “{t.title}”
              </p>
            {:else}
              <p class="thought-why">{t.explanation}</p>
            {/if}

            <div class="thought-meta">
              <span class="mono">{t.kind}</span>
              <span class="sep">·</span>
              <span class="mono">score {t.score}</span>
              <span class="sep">·</span>
              <span>{ago(t.createdAt)}</span>
              {#if !t.placeLabel && t.placeAddress}
                <span class="sep">·</span>
                <span class="place-tag">{t.placeAddress}</span>
              {/if}
              {#if !t.placeLabel && t.placeVisits}
                <span class="sep">·</span>
                <span class="mono">{t.placeVisits} visit{t.placeVisits === 1 ? '' : 's'}</span>
              {/if}
              {#if t.suppressedReason}
                <span class="sep">·</span>
                <span class="held">held back: {t.suppressedReason}</span>
              {/if}
              {#if t.promptTokens + t.completionTokens > 0}
                <span class="sep">·</span>
                <span class="mono tok">{t.promptTokens + t.completionTokens} tok</span>
              {/if}
              {#if t.feedback}
                <span class="sep">·</span>
                <span class="voted">you said {t.feedback.replace('_', ' ')}</span>
              {/if}
            </div>

            {#if t.id === rateId}
              <p class="rate-cue">Opened from a notification — your answer is below.</p>
            {/if}
            {#if t.narrative}
              <!-- The model's phrasing, always shown as the model's. The rule's
                   own explanation stays directly beneath it, so if this whole
                   path failed permanently the ledger would still read. -->
              <p class="narrative" class:unchecked={t.verified === false}>
                {t.narrative}
                <span class="narr-tag" class:ok={t.verified === true}>
                  {t.verified === true ? 'model · checked' : 'model · UNCHECKED'}
                </span>
              </p>
            {:else if t.narrativeDroppedReason}
              <!-- A composer that has quietly started refusing everything looks
                   exactly like a quiet week unless this is on the page. -->
              <p class="narr-dropped">phrasing dropped — {t.narrativeDroppedReason}</p>
            {/if}

            {#if expanded === t.id}
              <div class="thought-detail">
                <div class="detail-block">
                  <span class="sr-label-tight">Why that score</span>
                  <ul class="components">
                    {#each Object.entries(t.components) as [k, v] (k)}
                      <li><span class="ck">{k}</span><span class="cv">{v}</span></li>
                    {/each}
                  </ul>
                </div>
                {#if t.evidence.length}
                  <div class="detail-block">
                    <span class="sr-label-tight">Evidence</span>
                    <ul class="evidence">
                      {#each t.evidence as e, i (i)}
                        <li><span class="ck">{e.kind}</span><span class="cv">{e.note || e.id}</span></li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Rating is offered only on what actually reached him. Asking
                 "was this useful?" about a thought that was suppressed before
                 it was ever sent is a question with no answer, and the vote it
                 collects would train the weights on something he never saw.
                 Production had verdict buttons on eight such rows. -->
            {#if !t.feedback && SHOWN_STATUSES.includes(t.status)}
              <div class="thought-actions">
                <button class="row-link" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'useful')}>
                  Useful
                </button>
                <button class="row-link" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'not_useful')}>
                  Not useful
                </button>
                <button class="row-link danger" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'never_kind')}>
                  Never this kind
                </button>
                <button class="row-link" disabled={busy?.startsWith(t.id)} onclick={() => post({ action: 'snooze', id: t.id, days: 7 }, `${t.id}:snooze`)}>
                  Snooze a week
                </button>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── MODEL-AUTHORED RULES ───────────────────────────────────────────
       The mesh. The model writes the rule; deterministic code evaluates it;
       nothing fires until it is approved here. A proposal has already passed
       validation and a backtest by the time it appears. -->
  {#if proposedRules.length || activeRules.length}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Rules jkai wrote</span>
        <span class="nm-sec-meta">
          {proposedRules.length} awaiting you · {activeRules.length} live
        </span>
      </div>
      <p class="sec-lede">
        The model proposes rules as data — a condition over a fixed list of facts, never
        code. Each is validated and replayed against your history before it reaches you.
        <strong>Nothing fires until you approve it.</strong>
      </p>

      <div class="rows">
        {#each proposedRules as r (r.id)}
          <article class="thought st-new">
            <div class="thought-hd">
              <span class="thought-title as-text">{r.spec?.description ?? r.kind}</span>
              <span class="thought-pill">{r.proposalKind}</span>
            </div>
            <p class="thought-why">{r.rationale}</p>
            <div class="thought-meta">
              <span class="mono">{r.kind}</span>
              <span class="sep">·</span>
              <span class="mono">
                {#if r.backtestNote}{r.backtestNote}{:else}not backtested{/if}
              </span>
            </div>
            {#if r.backtestLowerBound}
              <p class="warn-line">
                Estimate is a floor, not a count — the replay could not rebuild every fact
                this rule uses, so it will fire more often than shown.
              </p>
            {/if}
            <div class="thought-actions">
              <button class="row-link" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'approve' }, `rule:${r.id}`)}>
                Approve
              </button>
              <button class="row-link danger" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'reject' }, `rule:${r.id}`)}>
                Reject
              </button>
            </div>
          </article>
        {/each}

        {#each activeRules as r (r.id)}
          <div class="det-row">
            <div class="det-main">
              <span class="det-kind mono">{r.kind}</span>
              <span class="det-desc">{r.spec?.description ?? ''}</span>
            </div>
            <div class="det-state">
              <span class="det-badge on">live</span>
              <span class="det-votes mono">{r.firedCount} fired · {r.usefulCount}↑ {r.notUsefulCount}↓</span>
              <button class="row-link danger" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'deprecate' }, `rule:${r.id}`)}>
                Retire
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── DETECTORS ──────────────────────────────────────────────────────
       Every detector appears, ready or not. One missing would be
       indistinguishable from one that is merely quiet — the same conflation
       the readiness gate exists to prevent. -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Detectors</span>
      <span class="nm-sec-meta">{readyCount} of {detectors.length} ready</span>
    </div>
    <p class="sec-lede">
      Each declares what it needs before it may speak, and returns nothing below that.
      A weight of 1.00 means the ledger has no opinion about it yet.
    </p>

    <div class="rows tight">
      {#each detectors as d (d.kind)}
        <div class="det-row" class:muted={d.muted}>
          <div class="det-main">
            <span class="det-kind mono">{d.kind}</span>
            <span class="det-desc">{d.description}</span>
          </div>
          <div class="det-state">
            {#if d.muted}
              <span class="det-badge off">muted</span>
              <button class="row-link" disabled={busy === `unmute:${d.kind}`} onclick={() => post({ action: 'unmute_kind', kind: d.kind }, `unmute:${d.kind}`)}>
                Un-mute
              </button>
            {:else if d.readiness?.ready}
              <span class="det-badge on">ready</span>
            {:else}
              <span class="det-badge wait">{d.readiness?.reason ?? 'not yet assessed'}</span>
            {/if}
            <span class="det-weight mono" title="Learned multiplier from your feedback">
              ×{d.weight.toFixed(2)}
            </span>
            {#if d.useful || d.notUseful}
              <span class="det-votes mono">{d.useful}↑ {d.notUseful}↓</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- ── NAMED PLACES ───────────────────────────────────────────────────── -->
  {#if named.length}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Places you have named</span>
        <span class="nm-sec-meta">{named.length}</span>
      </div>
      <div class="rows tight">
        {#each named as p (p.id)}
          <div class="place-row named">
            <div class="place-id">
              <span class="place-label">{p.label}</span>
              <span class="place-rhythm">{p.kind} · {rhythm(p)}</span>
            </div>
            <span class="det-badge" class:on={p.hasMemory}>
              {p.hasMemory ? 'in memory' : 'not in memory'}
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .hdr-links { display: flex; gap: 1rem; }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }

  .banner { padding: 0.7rem 0.9rem; margin-bottom: 1.25rem; border-left: 3px solid var(--warn, #b0892a); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }
  .banner code { font-family: var(--font-mono); color: var(--text-primary); }

  .sec-lede { margin: 0 0 0.9rem; font-size: var(--fs-label); line-height: 1.55; color: var(--text-muted); max-width: 68ch; }

  /* Engine */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; }
  .stat-tile { border: 1px solid var(--line-strong); padding: 0.85rem 0.95rem; background: var(--bg); }
  .stat-num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .stat-num .of { font-size: 1rem; color: var(--text-ghost); }
  .stat-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.4rem; }
  .stat-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.25rem; }
  .engine-summary { margin: 0.9rem 0 0; font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }
  .warn-line { margin: 0.6rem 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--warn, #b0892a); }
  .warn-line.err { color: var(--error, #c44); }

  /* Filters */
  .filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .filter { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.4rem 0.7rem; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-secondary); cursor: pointer; }
  .filter:hover { border-color: var(--accent); color: var(--accent); }
  .filter.on { border-color: var(--text-primary); color: var(--text-primary); background: var(--surface-sunken); }
  .filter .n { color: var(--text-ghost); margin-left: 0.35rem; }

  /* Thoughts */
  .rows { display: flex; flex-direction: column; gap: 0.5rem; }
  .rows.tight { gap: 0.3rem; }
  .thought { border: 1px solid var(--line-strong); border-left: 3px solid var(--text-muted); background: var(--surface-sunken); padding: 0.85rem 1rem 0.75rem; }
  .thought.st-new { border-left-color: var(--accent); }
  .thought.st-delivered { border-left-color: var(--success, #2d7a3a); }
  .thought.st-actioned { border-left-color: var(--success, #2d7a3a); }
  .thought.st-suppressed { border-left-color: var(--text-ghost); }
  .thought.st-dismissed { border-left-color: var(--error, #c44); }
  .thought.st-snoozed { border-left-color: var(--warn, #b0892a); }

  .thought-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }
  .thought-title { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 0; font: inherit; font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); cursor: pointer; overflow-wrap: anywhere; }
  .thought-title:hover { color: var(--accent); }
  .thought-title.as-text { cursor: default; }
  .thought-title.as-text:hover { color: var(--text-primary); }
  .thought-pill { flex: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.15rem 0.45rem; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  .thought-why { margin: 0 0 0.55rem; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .thought-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .mono { font-family: var(--font-mono); }
  .sep { color: var(--card-border); }
  .held { color: var(--text-muted); }
  .voted { color: var(--accent-ink); }

  .thought-detail { margin-top: 0.75rem; padding-top: 0.65rem; border-top: 1px solid var(--line-hair); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
  .detail-block { min-width: 0; }
  .components, .evidence { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .components li, .evidence li { display: flex; justify-content: space-between; gap: 0.75rem; font-size: var(--fs-label-xs); border-bottom: 1px solid var(--line-hair); padding-bottom: 0.15rem; }
  .ck { font-family: var(--font-mono); color: var(--text-muted); }
  .cv { font-family: var(--font-mono); color: var(--text-primary); text-align: right; overflow-wrap: anywhere; }

  .thought-actions, .place-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.7rem; }
  .row-link { background: none; border: none; padding: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); cursor: pointer; }
  .row-link:hover:not(:disabled) { text-decoration: underline; }
  .row-link:disabled { opacity: 0.45; cursor: default; }
  .row-link.danger { color: var(--error, #c44); }

  /* Places */
  .place-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.6rem 0.75rem; border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .naming { flex: 1 1 100%; display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
  .visits { display: flex; flex-direction: column; gap: 0.35rem; }
  .visit-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .visit-list li { display: grid; grid-template-columns: 5.5rem 1fr 3.5rem 4.5rem; gap: 0.5rem; font-size: var(--fs-label-xs); padding: 0.2rem 0; border-bottom: 1px solid var(--line-hair); }
  .v-day { color: var(--text-primary); }
  .v-date { color: var(--text-secondary); }
  .v-time, .v-dwell { color: var(--text-muted); font-variant-numeric: tabular-nums; text-align: right; }
  @media (max-width: 560px) {
    .visit-list li { grid-template-columns: 4.5rem 1fr 3.2rem; }
    .v-dwell { display: none; }
  }
  .geo-line { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); }
  .geo-src { color: var(--text-ghost); }
  .place-row.named { background: none; border-color: var(--line-hair); }
  .place-id { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .place-label { font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); }
  .place-rhythm { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .name-form { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .name-form .nm-text-input { width: auto; min-width: 12rem; }
  .kind-select { min-width: 7rem; }

  /* The naming session */
  .session-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin: 0.75rem 0 0.5rem; }
  .session-cta {
    font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: 0.02em;
    padding: 0.5rem 0.9rem; cursor: pointer;
    background: var(--accent); color: var(--accent-ink);
    border: 1px solid var(--accent);
  }
  .session-cta:hover:not(:disabled) { filter: brightness(1.08); }
  .session-cta:disabled { opacity: 0.55; cursor: default; }
  .session-hint { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .session-done { margin: 0 0 0.5rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .session-list { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; }
  .session-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 0.6rem 1rem; padding: 0.55rem 0.75rem;
    border: 1px solid var(--line-hair); background: var(--surface-sunken);
    border-left: 3px solid transparent;
  }
  /* An answered row reads as done at a glance, so a long session has a
     visible floor rising under it rather than looking untouched throughout. */
  .session-row.filled { border-left-color: var(--accent); }
  .session-meta { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
  .session-rhythm { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .session-addr { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .session-addr.none { color: var(--text-ghost); font-style: italic; }
  .session-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .session-input { width: auto; min-width: 11rem; }
  /* The suggestion IS the button — accepting it is the commonest action, so it
     costs one tap and does not require reading a separate control first. */
  .suggest-chip {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    padding: 0.35rem 0.65rem; cursor: pointer; text-align: left;
    background: none; color: var(--text-primary);
    border: 1px dashed var(--line-strong);
  }
  .suggest-chip:hover { border-style: solid; border-color: var(--accent); color: var(--accent); }
  .rows.hidden { display: none; }
  @media (max-width: 560px) {
    .session-row { flex-direction: column; align-items: stretch; }
    .session-input { min-width: 0; width: 100%; }
  }

  .rate-cue {
    margin: 0.4rem 0 0; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); color: var(--accent);
  }

  .thought-pill.answered { color: var(--accent); border-color: var(--accent); }
  .thought-answered {
    margin: 0.3rem 0 0; font-size: var(--fs-label-xs); line-height: 1.55;
    color: var(--text-secondary);
  }
  .thought-answered strong { color: var(--text-primary); }

  /* Yesterday, and steering */
  .digest {
    margin: 0; padding: 0.7rem 0.9rem;
    font-size: var(--fs-body-sm); line-height: 1.6; color: var(--text-primary);
    background: var(--surface-sunken); border-left: 3px solid var(--accent);
  }
  .steer-box { display: flex; flex-direction: column; gap: 0.45rem; margin: 0.6rem 0 0.9rem; }
  .steer-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .steer-input { flex: 1 1 22rem; min-width: 0; }
  .steer-list { list-style: none; margin: 0.2rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .steer {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem; border: 1px solid var(--line-hair);
    background: var(--surface-sunken); border-left: 2px solid var(--accent);
  }
  .steer.done { border-left-color: var(--line-hair); opacity: 0.6; }
  .steer-text { flex: 1 1 18rem; min-width: 0; font-size: var(--fs-label-xs); color: var(--text-primary); }
  .steer-meta { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  /* The propositions board */
  .hyp {
    display: flex; flex-direction: column; gap: 0.35rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--line-hair); background: var(--surface-sunken);
    border-left: 3px solid var(--line-strong);
  }
  .hyp.held { border-left-color: var(--accent); }
  .hyp-q { font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); max-width: 70ch; }
  .hyp-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .hyp-verdict { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
  .hyp-badge {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.06em; text-transform: uppercase;
    padding: 0.15rem 0.4rem; border: 1px solid currentColor; white-space: nowrap;
  }
  /* A refuted question is not a failure and is not styled as one. It is an
     answer, and reading it is the point of keeping it. */
  .v-supported .hyp-badge { color: var(--accent); }
  .v-refuted .hyp-badge, .v-underpowered .hyp-badge, .v-untested .hyp-badge { color: var(--text-ghost); }
  .v-wrong_direction .hyp-badge { color: var(--status-error, #c0392b); }
  .hyp-sum { font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .hyp-family { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .hyp-why { font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); max-width: 70ch; }
  .hyp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.15rem; }
  .hyp-ask { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  /* The sorting deck */
  .deck-card {
    display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
    gap: 0.6rem 1rem; padding: 0.6rem 0.75rem;
    border: 1px solid var(--line-hair); background: var(--surface-sunken);
    border-left: 3px solid transparent;
  }
  .deck-card.ruled { border-left-color: var(--accent); }
  .deck-body { min-width: 0; flex: 1 1 22rem; display: flex; flex-direction: column; gap: 0.2rem; }
  .deck-hd { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .deck-kind { color: var(--text-secondary); }
  /* Something proposed forty times and never said is a better question than
     something noticed once, so the count is the thing that stands out. */
  .deck-rec { color: var(--accent); }
  .deck-title { font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); }
  .deck-expl { font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); max-width: 68ch; }
  .deck-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .deck-actions .row-link.picked {
    background: var(--accent); color: var(--accent-ink); border-color: var(--accent);
  }

  /* Model phrasing, and how much of it to trust */
  .narrative {
    margin: 0.4rem 0 0; padding: 0.5rem 0.7rem;
    font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-primary);
    background: var(--surface-sunken); border-left: 2px solid var(--line-strong);
  }
  /* Unchecked prose does not get to look like checked prose. The minimal depth
     plan produces it routinely, and until now nothing on the page said so. */
  .narrative.unchecked { border-left-color: var(--status-error, #c0392b); }
  .narr-tag {
    display: inline-block; margin-left: 0.4rem;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.04em; color: var(--status-error, #c0392b); white-space: nowrap;
  }
  .narr-tag.ok { color: var(--text-ghost); }
  .narr-dropped {
    margin: 0.4rem 0 0; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); color: var(--text-ghost);
  }
  .place-tag { color: var(--text-secondary); }
  .tok { color: var(--text-ghost); }

  /* Detectors */
  .det-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.55rem 0; border-bottom: 1px solid var(--line-hair); }
  .det-row.muted { opacity: 0.6; }
  .det-main { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .det-kind { font-size: var(--fs-label); color: var(--text-primary); }
  .det-desc { font-size: var(--fs-label-xs); line-height: 1.45; color: var(--text-muted); max-width: 62ch; }
  .det-state { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; }
  .det-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .det-badge.on { color: var(--success, #2d7a3a); }
  .det-badge.wait { color: var(--text-muted); }
  .det-badge.off { color: var(--error, #c44); }
  .det-weight { font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .det-votes { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .budget-note { margin-top: 0.9rem; margin-bottom: 0; }
  .budget-note strong { color: var(--text-primary); font-weight: 700; }

  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--line-strong); line-height: 1.6; }

  @media (max-width: 640px) {
    .page-hdr { flex-direction: column; align-items: flex-start; }
    .det-row { flex-direction: column; }
    .thought-detail { grid-template-columns: 1fr; }
  }
</style>
