<svelte:head><title>Daydreams — JKAI</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import PlaceMap from '$lib/components/jkai/PlaceMap.svelte';
  import FamilyMap, { type FamilyPosition } from '$lib/components/jkai/daydream/FamilyMap.svelte';
  import Sparkline from '$lib/components/jkai/daydream/Sparkline.svelte';
  import CalendarBoard from '$lib/components/jkai/daydream/CalendarBoard.svelte';
  import EvidenceList from '$lib/components/jkai/daydream/EvidenceList.svelte';
  import LoopScoreboard from '$lib/components/jkai/daydream/LoopScoreboard.svelte';
  import {
    familyOf,
    groupByFamily,
    groupByLikelihood,
    kindLabel,
    likelihoodBand,
    type GroupStats,
  } from '$lib/daydream/thought-groups';
  import { hasMap, thoughtDestination } from '$lib/daydream/destination';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { DeckTile, Facet, ShellTab } from '$lib/components/jkai/daydream/hub/types';
  // Colour is priority, and priority is decided in ONE place — see the module
  // header. Every `t-*` class on this page comes out of one of these.
  import {
    TONE_RANK,
    bandTone,
    detectorTone,
    jobTone,
    leadTone,
    placeTone,
    provenanceTone,
    thoughtRank,
    thoughtTone,
    verdictTone,
    type Tone,
  } from '$lib/daydream/priority';

  let { data }: { data: PageData } = $props();

  type Thought = PageData['thoughts'][number];
  type Place = PageData['places'][number];

  // ── Tabs ──────────────────────────────────────────────────────────────────
  // One hub, seven rooms. The tab rides the URL (?tab=) so a room can be linked
  // to, and a notification's ?rate= deep-link lands in the Feed with the
  // thought already open — the review found the old cue pointed at a row that
  // might not even render its buttons.
  const TABS = [
    { id: 'feed', label: 'Feed' },
    { id: 'family', label: 'Family' },
    { id: 'discoveries', label: 'Discoveries' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'places', label: 'Places' },
    { id: 'money', label: 'Money' },
    { id: 'engine', label: 'Engine' },
    { id: 'improvement', label: 'Improvement' },
  ] as const;
  type TabId = (typeof TABS)[number]['id'];
  const initialTab = ((): TabId => {
    const q = page.url.searchParams.get('tab');
    return (TABS.some((t) => t.id === q) ? q : 'feed') as TabId;
  })();
  let tab = $state<TabId>(initialTab);

  function setTab(next: TabId) {
    tab = next;
    const url = new URL(page.url);
    url.searchParams.set('tab', next);
    try {
      replaceState(url, {});
    } catch {
      // replaceState throws before hydration settles; the tab still switched.
    }
    if (next === 'family' && famPositions == null && !famLoading) void loadFamilyMap();
  }

  // ── Family map (positions fetched on demand, never in the page payload) ──
  let famPositions = $state<FamilyPosition[] | null>(null);
  let famLoading = $state(false);
  let famError = $state<string | null>(null);
  async function loadFamilyMap() {
    famLoading = true;
    famError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'family_now' }),
      });
      const out = (await res.json().catch(() => ({}))) as { positions?: FamilyPosition[]; error?: string };
      if (out.error) throw new Error(out.error);
      famPositions = out.positions ?? [];
    } catch (err) {
      famError = err instanceof Error ? err.message : String(err);
      famPositions = null;
    } finally {
      famLoading = false;
    }
  }

  // ── Kill switch, as a control rather than a banner naming a settings key ──
  let togglingEnabled = $state(false);
  async function toggleEnabled() {
    togglingEnabled = true;
    try {
      await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_enabled', enabled: !data.enabled }),
      });
      await invalidateAll();
    } finally {
      togglingEnabled = false;
    }
  }

  // ── Arming the bank rails ────────────────────────────────────────────────
  // It was a settings key you had to write by hand, which is why it stayed off
  // for a fortnight after the job shipped. Arming also brings the next run
  // forward, so a stale token shows up now rather than at 05:00 tomorrow.
  let bankBusy = $state(false);
  let bankError = $state<string | null>(null);
  async function toggleBank() {
    bankBusy = true;
    bankError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_bank_enabled', enabled: !data.money?.bank.enabled }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (out.error) throw new Error(out.error);
      await invalidateAll();
    } catch (err) {
      bankError = err instanceof Error ? err.message : String(err);
    } finally {
      bankBusy = false;
    }
  }

  // ── Formatting helpers for the new rooms ──
  const money = $derived(data.money);
  const discoveries = $derived(data.discoveries);
  const telemetry = $derived(data.telemetry);
  const provenance = $derived(
    data.provenance ?? { sources: [], minPairs: 0, registered: 0, sweepable: 0 },
  );
  const familyMembers = $derived(data.family?.members ?? []);
  const familyDetail = $derived((data.family?.detail ?? {}) as Record<string, {
    hypotheses: Array<{ id: string; question: string; verdict: string | null; summary: string | null; r: number | null; qValue: number | null; pairs: number | null }>;
    sweep: { testsRun: number; naiveHits: number; findings: unknown[]; errors: string[] } | null;
    thoughts: Array<{ id: string; kind: string; title: string; score: number; status: string; createdAt: string }>;
  }>);
  let openPerson = $state<string | null>(null);
  function togglePerson(subject: string) {
    openPerson = openPerson === subject ? null : subject;
  }

  function pounds(minor: number): string {
    return `£${(minor / 100).toFixed(2)}`;
  }
  function clock(mins: number | null): string {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function cap(sub: string): string {
    return sub.charAt(0).toUpperCase() + sub.slice(1);
  }
  function cadence(secs: number | null): string {
    if (!secs) return '—';
    if (secs % 3600 === 0) return `${secs / 3600}h`;
    if (secs % 60 === 0) return `${secs / 60}m`;
    return `${secs}s`;
  }

  // ── How the feed is arranged ──────────────────────────────────────────────
  // It was one flat reverse-chronological list wearing raw kind slugs. Three
  // arrangements now, because the three questions are different: "what is it
  // noticing" (type), "how sure was it" (likelihood), "what happened lately"
  // (day). Type is the default — it is the one that says where the engine
  // spends its attention.
  type GroupBy = 'type' | 'likelihood' | 'day';
  let groupBy = $state<GroupBy>('type');

  /** Timeline grouping: Today / Yesterday / weekday-date. */
  function groupByDay(items: Thought[]): Array<{ key: string; label: string; blurb: string | null; items: Thought[]; stats: GroupStats | null }> {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    });
    const dayKey = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const groups: Array<{ key: string; label: string; blurb: string | null; items: Thought[]; stats: GroupStats | null }> = [];
    for (const t of items) {
      const d = new Date(t.createdAt);
      const key = dayKey(d);
      const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : fmt.format(d);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(t);
      else groups.push({ key, label, blurb: null, items: [t], stats: null });
    }
    return groups;
  }

  const grouped = $derived.by(() => {
    if (groupBy === 'day') return groupByDay(arranged);
    if (groupBy === 'likelihood') {
      return groupByLikelihood(arranged, data.threshold.value).map((g) => ({ ...g, stats: g.stats as GroupStats | null }));
    }
    return groupByFamily(arranged).map((g) => ({ ...g, stats: g.stats as GroupStats | null }));
  });

  /** Which group headers are collapsed. Keyed by group key. */
  let collapsed = $state<Record<string, boolean>>({});
  function toggleGroup(key: string) {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  /**
   * The root cause, in words.
   *
   * `components` is a bag of named numbers the detector wrote, and the page
   * printed it as a key/value dump. This turns the ones that decide the
   * outcome into sentences: what produced it, what the raw score was, what the
   * ledger's opinion of that kind did to it, and whether the result cleared
   * the bar. Anything not named here still shows in the raw list below, so
   * nothing is hidden — it is just no longer the only rendering.
   */
  function rootCause(t: Thought): string[] {
    const c = t.components ?? {};
    const lines: string[] = [];
    const fam = familyOf(t.kind);
    lines.push(`${fam.label} · ${kindLabel(t.kind)} — ${fam.blurb}`);

    const raw = typeof c.raw === 'number' ? c.raw : null;
    const weight = typeof c.kindWeight === 'number' ? c.kindWeight : null;
    if (raw != null && weight != null) {
      lines.push(
        `The detector scored it ${raw.toFixed(2)}. The ledger's opinion of "${kindLabel(t.kind)}" ` +
        `multiplies that by ${weight.toFixed(2)}` +
        (weight === 1 ? ' — exactly neutral, meaning no feedback has been collected on this kind yet' : '') +
        `, giving ${t.score.toFixed(2)}.`,
      );
    } else if (raw != null) {
      lines.push(`The detector scored it ${raw.toFixed(2)}, giving ${t.score.toFixed(2)} after weighting.`);
    }

    const band = likelihoodBand(t.score, data.threshold.value);
    lines.push(
      band.id === 'held'
        ? `Held back: ${band.meaning}. The bar falls as you rate things — ${data.threshold.feedbackCount} response${data.threshold.feedbackCount === 1 ? '' : 's'} so far.`
        : `Cleared the bar: ${band.meaning}.`,
    );

    if (t.suppressedReason === 'feed_only') {
      lines.push('This kind never pushes by design — it lands here and waits for you, rather than interrupting.');
    } else if (t.suppressedReason && t.suppressedReason !== 'below_threshold') {
      lines.push(`Not delivered because of ${t.suppressedReason.replace(/_/g, ' ')}.`);
    }
    return lines;
  }

  /** Components not already narrated above, so the raw bag stays available
   *  without repeating what the sentences said. */
  const NARRATED = new Set(['raw', 'kindWeight']);
  function extraComponents(t: Thought): Array<[string, number]> {
    return Object.entries(t.components ?? {}).filter(([k]) => !NARRATED.has(k)) as Array<[string, number]>;
  }

  /** A musing wears its theme as a chip; everything else wears its kind. */
  function kindChip(t: Thought): { text: string; musing: boolean } {
    if (t.kind.startsWith('musing_')) return { text: t.kind.slice(7), musing: true };
    if (t.kind.startsWith('intel_')) return { text: `graph · ${t.kind.slice(6)}`, musing: false };
    return { text: t.kind, musing: false };
  }

  // ── View state ────────────────────────────────────────────────────────────
  // `all` is the default rather than `new`, because on any normal day nothing
  // is new and a page that opens empty reads as broken. What the owner actually
  // wants to know first is what it has been noticing at all.
  type Filter = 'all' | 'said' | 'suppressed' | 'ruled' | 'archived';
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
  type Visit = { startedAt: string; dwellMins: number; subject: string; dateLabel: string; dayName: string; timeLabel: string };
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
  // ── Drill-through from a verdict to the days behind it ──────────────────
  // Fetched on expand: the series is up to 120 rows per question and no card
  // is opened more than a handful of times.
  type HypDetail = {
    metricA: string; metricB: string; lagDays: number; unusedCount: number;
    days: Array<{ day: string; a: number | null; b: number | null; used: boolean }>;
  };
  let hypOpen = $state<string | null>(null);
  let hypDetail = $state<Record<string, HypDetail>>({});
  let hypDetailError = $state<Record<string, string>>({});

  async function toggleHypDetail(id: string) {
    if (hypOpen === id) {
      hypOpen = null;
      return;
    }
    hypOpen = id;
    if (hypDetail[id]) return;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'hypothesis_detail', id }),
      });
      const out = (await res.json().catch(() => ({}))) as { detail?: HypDetail; error?: string };
      if (out.error) throw new Error(out.error);
      if (out.detail) hypDetail = { ...hypDetail, [id]: out.detail };
    } catch (err) {
      hypDetailError = {
        ...hypDetailError,
        [id]: err instanceof Error ? err.message : String(err),
      };
    }
  }

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
    subject: string;
  };

  let boardOpen = $state(false);
  let boardLoading = $state(false);
  let boardError = $state<string | null>(null);
  let board = $state<BoardRow[]>([]);

  /** Whose questions to show. The board spans the household now that every
   *  person gets their own; `all` is the default because the interesting thing
   *  is usually the comparison. */
  let boardWho = $state<string>('all');

  /** The people who actually have questions, in household order, so the filter
   *  never offers a name with nothing behind it. */
  const boardPeople = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const q of board) counts.set(q.subject, (counts.get(q.subject) ?? 0) + 1);
    const order = familyMembers.map((m) => m.subject);
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([subject, n]) => ({ subject, n }));
  });

  /**
   * The board, filtered by whose it is AND by how it came out, then ordered.
   *
   * `unanswered` is a filter value rather than a missing one: a question that
   * has not been tested yet is a state the board should be readable in, and
   * `verdict === null` is not something a chip can name without it.
   */
  const boardFiltered = $derived(
    board.filter(
      (q) =>
        (boardWho === 'all' || q.subject === boardWho) &&
        (boardVerdict === 'all' ||
          (boardVerdict === 'unanswered' ? q.verdict == null : q.verdict === boardVerdict)),
    ),
  );

  const boardVisible = $derived.by(() => {
    const rows = [...boardFiltered];
    if (boardOrder === 'newest') {
      return rows.sort(
        (a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime(),
      );
    }
    if (boardOrder === 'strength') {
      return rows.sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0));
    }
    return rows.sort(
      (a, b) =>
        TONE_RANK[verdictTone(a.verdict)] - TONE_RANK[verdictTone(b.verdict)] ||
        Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0),
    );
  });

  const VERDICT_LABEL: Record<string, string> = {
    supported: 'held up',
    refuted: 'nothing there',
    wrong_direction: 'backwards',
    underpowered: 'not enough data',
  };

  /** Jump from a person's card to their questions on the board. One home for
   *  questions; this is a route to it, not a second copy. */
  async function openBoardFor(subject: string) {
    boardWho = subject;
    setTab('discoveries');
    if (!boardOpen) await openBoard();
  }

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

  // A notification deep-link should land ON the thought, expanded, not near a
  // cue line that points at nothing.
  $effect(() => {
    const id = rateId;
    untrack(() => {
      if (id && expanded !== id) expanded = id;
    });
  });

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
  /** Filed with no opinion attached. Kept OUT of `ruled`, because "you ruled on
   *  it" is a claim about the ledger having a verdict, and an archived card
   *  deliberately has none. Conflating them would make the count on the chip a
   *  lie about how much feedback the threshold has actually collected. */
  const archived = $derived(thoughts.filter((t) => t.status === 'archived'));
  const visible = $derived(
    filter === 'said'
      ? said
      : filter === 'suppressed'
        ? suppressed
        : filter === 'ruled'
          ? ruled
          : filter === 'archived'
            ? archived
            : thoughts,
  );

  /** Places worth asking about. The one- and two-visit ones still exist and
   *  still match offers and proximity — they are simply not questions.
   *  The threshold comes from the ledger (MIN_VISITS_TO_ASK), not a local
   *  copy that drifts; the fallback only covers the load-error path. */
  const delivery = $derived(data.delivery);
  const askAtVisits = $derived(delivery?.minVisitsToAsk ?? 3);
  // DAYS, not person-visits: five people in one car on one afternoon is one
  // day, and asking "what is this place you keep going to?" about it is wrong.
  const unnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.distinctDays >= askAtVisits),
  );
  const quietUnnamed = $derived(
    places.filter((p) => !p.label && p.status === 'active' && p.distinctDays < askAtVisits).length,
  );
  const named = $derived(places.filter((p) => p.label && p.status === 'active'));
  /** Clusters the trail passes THROUGH. Reported rather than hidden: half the
   *  place table was road before the stillness rule, and a count that silently
   *  drops from 160 to 82 looks like data loss unless the page says why. */
  const transitPlaces = $derived(places.filter((p) => p.status === 'transit').length);

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

  /** Coordinates for a thought's place, fetched on demand and held only for
   *  this render — the ledger payload still never carries a lat/lon. */
  type ThoughtPlace = {
    lat: number;
    lon: number;
    radiusM: number;
    label: string | null;
    suggestedLabel: string | null;
    suggestedAddress: string | null;
  };
  let thoughtPlace = $state<Record<string, ThoughtPlace>>({});
  let noteDraft = $state<Record<string, string>>({});
  const MAX_NOTE_CHARS = 1000;

  async function showOnMap(thoughtId: string) {
    busy = `${thoughtId}:map`;
    actionError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'thought_map', thoughtId }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? 'could not load that map');
      // A thought about nowhere is a normal answer, not a failure.
      if (out.place) thoughtPlace = { ...thoughtPlace, [thoughtId]: out.place };
      else actionError = 'That one is not about a place.';
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'could not load that map';
    } finally {
      busy = null;
    }
  }

  /** Open the map, or fold it away again. Reassigned rather than mutated —
   *  `thoughtPlace` is a `$state` record and a `delete` on it is a write the
   *  markup reading it would not see. */
  function toggleMap(id: string) {
    if (!thoughtPlace[id]) {
      void showOnMap(id);
      return;
    }
    const { [id]: _folded, ...rest } = thoughtPlace;
    thoughtPlace = rest;
  }

  async function saveNote(t: { id: string }) {
    const text = (noteDraft[t.id] ?? '').trim();
    if (!text) return;
    busy = `${t.id}:note`;
    actionError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add_note', thoughtId: t.id, text }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? 'could not save that note');
      delete noteDraft[t.id];
      noteDraft = { ...noteDraft };
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'could not save that note';
    } finally {
      busy = null;
    }
  }

  function rhythm(p: Place): string {
    // Days first — that is what "keeps going there" means. Person-visits follow
    // only when they differ, because "5 visits across 1 day" is the whole
    // household in one car and reads as a habit if you show only the 5.
    const days = p.distinctDays ?? 0;
    const parts = days
      ? [`${days} day${days === 1 ? '' : 's'}`]
      : [`${p.visitCount} visit${p.visitCount === 1 ? '' : 's'}`];
    if (days && p.visitCount > days) parts.push(`${p.visitCount} visits`);
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
    const ok = await post({ action: 'feedback', id: t.id, verdict }, `${t.id}:${verdict}`);
    // "Where a user says it's useful, weave that intelligence into the /intel
    // graph." Fired from HERE rather than from inside `recordFeedback`, which
    // is also reached by the WhatsApp reply handler and by the triage deck
    // thirty rows at a time — an LLM extraction in that path would put a model
    // call behind an inbound message and behind a bulk sorting pass. The vote
    // is the input this whole loop is starved of and must never wait on the
    // graph, so the weave runs after it and its failure is reported, not
    // thrown.
    if (ok && verdict === 'useful') await weave(t, { quiet: true });
  }

  // ── Filed, with no opinion ────────────────────────────────────────────────
  // The third answer. Neither verdict moves, so no kind weight shifts and the
  // cold-start threshold does not count it — see `archiveThought`.
  async function archiveThought(t: Thought) {
    await post({ action: 'archive', id: t.id }, `${t.id}:archive`);
  }

  // ── Into the graph ────────────────────────────────────────────────────────
  // `quiet` is for the automatic call behind a useful vote: a thought too thin
  // to extract is an ordinary outcome there and should not put an error on the
  // page, whereas pressing the button and being told nothing happened is
  // exactly the silence this hub exists to stop.
  let weaveNote = $state<Record<string, string>>({});
  async function weave(t: Thought, opts: { quiet?: boolean } = {}) {
    busy = `${t.id}:weave`;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'weave', id: t.id }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        weave?: { status: string; entityCount?: number; chars?: number; reason?: string; error?: string };
        error?: string;
      };
      const w = out.weave;
      const line =
        out.error
          ? `Intel refused it: ${out.error}`
          : w?.status === 'woven'
            ? `Into the graph — ${w.entityCount ?? 0} entit${w.entityCount === 1 ? 'y' : 'ies'}.`
            : w?.status === 'unchanged'
              ? 'Already in the graph, unchanged.'
              : w?.status === 'too-thin'
                ? `Too thin to extract (${w.chars ?? 0} characters). Add a note and try again.`
                : w?.status === 'failed'
                  ? `Intel could not read it: ${w.error}`
                  : `Not woven: ${w?.reason ?? w?.status ?? 'unknown'}`;
      const succeeded = w?.status === 'woven' || w?.status === 'unchanged';
      if (!opts.quiet || succeeded) weaveNote = { ...weaveNote, [t.id]: line };
      if (succeeded) await invalidateAll();
    } catch {
      if (!opts.quiet) weaveNote = { ...weaveNote, [t.id]: 'Could not reach the graph.' };
    } finally {
      busy = null;
    }
  }

  // ── Queue to model ────────────────────────────────────────────────────────
  //
  // The reviewer, asked for by hand. The heartbeat already runs it over what is
  // pending, but only over UNREVIEWED `new`/`suppressed` rows — so a held-back
  // card the sweep has already looked at, or one it never reached, has no way
  // to be checked at all. This is that way, and it works on any card in the
  // feed.
  //
  // The ruling is written to memory server-side. That is the half that makes it
  // stick: a verdict in a column stops one message going out, a memory stops
  // the claim being made again.
  type ReviewOut = {
    verdict: string;
    likelihood: number;
    reasoning: string;
    sources: string[];
    toolCalls: number;
    memory: string;
  };
  let reviewOut = $state<Record<string, ReviewOut>>({});
  let reviewErr = $state<Record<string, string>>({});

  async function queueToModel(t: Thought) {
    busy = `${t.id}:review`;
    reviewErr = { ...reviewErr, [t.id]: '' };
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'review_now', id: t.id }),
      });
      const out = (await res.json().catch(() => ({}))) as Partial<ReviewOut> & { error?: string };
      if (!res.ok || out.error) throw new Error(out.error ?? 'the reviewer could not run');
      reviewOut = {
        ...reviewOut,
        [t.id]: {
          verdict: out.verdict ?? 'uncertain',
          likelihood: out.likelihood ?? 0,
          reasoning: out.reasoning ?? '',
          sources: out.sources ?? [],
          toolCalls: out.toolCalls ?? 0,
          memory: out.memory ?? '',
        },
      };
      // The card is opened on the verdict, because a ruling that lands below
      // the fold on a three-column board is one nobody reads.
      expanded = t.id;
      await invalidateAll();
      if (rulingsOpen) await loadRulings();
    } catch (err) {
      reviewErr = { ...reviewErr, [t.id]: err instanceof Error ? err.message : String(err) };
    } finally {
      busy = null;
    }
  }

  // ── What it has ruled on ──────────────────────────────────────────────────
  // "That list of memories should be accessible somewhere." Here, under the
  // feed the rulings are about, fetched on demand rather than riding the page
  // payload — the ledger load is already the heaviest thing on this hub.
  type Ruling = {
    id: string;
    kind: string;
    title: string;
    verdict: string | null;
    likelihood: number | null;
    reasoning: string | null;
    sources: string[];
    model: string | null;
    memoryId: string | null;
    ruledAt: string | null;
  };
  let rulingsOpen = $state(false);
  let rulingsLoading = $state(false);
  let rulingsError = $state<string | null>(null);
  let rulings = $state<Ruling[]>([]);
  let rulingWho = $state<'all' | 'refuted' | 'verified' | 'uncertain'>('all');

  const rulingsVisible = $derived(
    rulingWho === 'all' ? rulings : rulings.filter((r) => r.verdict === rulingWho),
  );

  async function loadRulings() {
    rulingsOpen = true;
    rulingsLoading = true;
    rulingsError = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rulings', limit: 80 }),
      });
      const out = (await res.json().catch(() => ({}))) as { rulings?: Ruling[]; error?: string };
      if (out.error) throw new Error(out.error);
      rulings = out.rulings ?? [];
    } catch (err) {
      rulingsError = err instanceof Error ? err.message : String(err);
      rulings = [];
    } finally {
      rulingsLoading = false;
    }
  }

  const rulingFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: rulings.length },
    { id: 'refuted', label: 'Did not hold', count: rulings.filter((r) => r.verdict === 'refuted').length },
    { id: 'verified', label: 'Held up', count: rulings.filter((r) => r.verdict === 'verified').length },
    { id: 'uncertain', label: 'Could not tell', count: rulings.filter((r) => r.verdict === 'uncertain').length },
  ]);

  // One-tap execution of an action a musing proposed. The server re-validates
  // the stored action before anything runs.
  async function runAction(t: Thought, index: number) {
    await post({ action: 'run_action', id: t.id, index }, `${t.id}:act${index}`);
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

  // ══ THE EDITORIAL CHROME ═══════════════════════════════════════════════
  //
  // Everything below is presentation: what the masthead reads, what the
  // action queue contains, and how each list is grouped, filtered and
  // ordered. No fetch, no payload and no derived FIGURE lives here — the
  // numbers all come from the ledger above.

  // ── Ordering ──────────────────────────────────────────────────────────────
  // Every list on the hub can be read three ways, and `priority` is the
  // default everywhere: the shared tone rank in $lib/daydream/priority puts
  // what is broken first, what is waiting on you second, and what is merely
  // true last. The old page had one ordering — insertion — on every list.

  type FeedOrder = 'priority' | 'newest' | 'score';
  let feedOrder = $state<FeedOrder>('priority');

  type BoardOrder = 'priority' | 'newest' | 'strength';
  let boardOrder = $state<BoardOrder>('priority');
  let boardVerdict = $state<string>('all');

  type PlaceOrder = 'priority' | 'days' | 'recent';
  let placeOrder = $state<PlaceOrder>('priority');

  type DetState = 'all' | 'ready' | 'waiting' | 'muted';
  let detState = $state<DetState>('all');
  type DetOrder = 'priority' | 'name' | 'weight' | 'votes';
  let detOrder = $state<DetOrder>('priority');

  type MoneyOrder = 'newest' | 'largest';
  let moneyOrder = $state<MoneyOrder>('newest');

  const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  /**
   * The feed, in the order it will be grouped.
   *
   * Day grouping merges CONSECUTIVE rows carrying the same date label, so it
   * can only ever be read in date order: reorder by score and it emits one
   * group per row with duplicate keys, and `each_key_duplicate` does not
   * degrade a list — it kills the component, which is how the Discoveries tab
   * went dark on the first Sunday the weekly letter ran. So `day` pins the
   * order rather than trusting the chip.
   */
  const arranged = $derived.by(() => {
    const rows = [...visible];
    if (groupBy === 'day' || feedOrder === 'newest') return rows.sort(byNewest);
    if (feedOrder === 'score') return rows.sort((a, b) => b.score - a.score || byNewest(a, b));
    return rows.sort((a, b) => thoughtRank(a) - thoughtRank(b) || b.score - a.score);
  });

  // ── Facets ────────────────────────────────────────────────────────────────
  // Counts on every chip, always — including the zeroes. A filter that returns
  // nothing looks broken unless the chip already said it would.

  const arrangeFacets = $derived<Facet[]>([
    { id: 'type', label: 'Type' },
    { id: 'likelihood', label: 'Likelihood' },
    { id: 'day', label: 'Day' },
  ]);

  const showFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: thoughts.length },
    { id: 'said', label: 'Above threshold', count: said.length },
    { id: 'suppressed', label: 'Held back', count: suppressed.length },
    { id: 'ruled', label: 'You ruled on', count: ruled.length },
    { id: 'archived', label: 'Filed', count: archived.length },
  ]);

  const feedOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'newest', label: 'Newest' },
    { id: 'score', label: 'Score' },
  ]);

  const boardWhoFacets = $derived<Facet[]>([
    { id: 'all', label: 'Everyone', count: board.length },
    ...boardPeople.map((p) => ({ id: p.subject, label: cap(p.subject), count: p.n })),
  ]);

  const boardVerdictFacets = $derived.by((): Facet[] => {
    const scope = board.filter((q) => boardWho === 'all' || q.subject === boardWho);
    const n = (pred: (q: BoardRow) => boolean) => scope.filter(pred).length;
    return [
      { id: 'all', label: 'All', count: scope.length },
      { id: 'supported', label: 'Held up', count: n((q) => q.verdict === 'supported') },
      { id: 'refuted', label: 'Nothing there', count: n((q) => q.verdict === 'refuted') },
      { id: 'wrong_direction', label: 'Backwards', count: n((q) => q.verdict === 'wrong_direction') },
      { id: 'underpowered', label: 'Thin data', count: n((q) => q.verdict === 'underpowered') },
      { id: 'unanswered', label: 'Unanswered', count: n((q) => q.verdict == null) },
    ];
  });

  const boardOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'newest', label: 'Newest' },
    { id: 'strength', label: 'Strength' },
  ]);

  const placeOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'days', label: 'Most days' },
    { id: 'recent', label: 'Most recent' },
  ]);

  const detStateFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: detectors.length },
    { id: 'ready', label: 'Ready', count: detectors.filter((d) => !d.muted && d.readiness?.ready).length },
    { id: 'waiting', label: 'Gathering', count: detectors.filter((d) => !d.muted && !d.readiness?.ready).length },
    { id: 'muted', label: 'Muted', count: mutedCount },
  ]);

  const detOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'name', label: 'Name' },
    { id: 'weight', label: 'Weight' },
    { id: 'votes', label: 'Votes' },
  ]);

  const moneyOrderFacets = $derived<Facet[]>([
    { id: 'newest', label: 'Newest' },
    { id: 'largest', label: 'Largest' },
  ]);

  // ── Ordered lists ─────────────────────────────────────────────────────────

  function orderPlaces(list: Place[]): Place[] {
    const rows = [...list];
    if (placeOrder === 'days') {
      return rows.sort((a, b) => (b.distinctDays ?? 0) - (a.distinctDays ?? 0) || b.visitCount - a.visitCount);
    }
    if (placeOrder === 'recent') {
      return rows.sort(
        (a, b) => new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime(),
      );
    }
    return rows.sort(
      (a, b) =>
        TONE_RANK[placeTone(a, askAtVisits)] - TONE_RANK[placeTone(b, askAtVisits)] ||
        (b.distinctDays ?? 0) - (a.distinctDays ?? 0),
    );
  }
  const unnamedOrdered = $derived(orderPlaces(unnamed));
  const namedOrdered = $derived(orderPlaces(named));

  const detectorRows = $derived.by(() => {
    const rows = detectors.filter((d) => {
      if (detState === 'all') return true;
      if (detState === 'muted') return Boolean(d.muted);
      if (detState === 'ready') return !d.muted && Boolean(d.readiness?.ready);
      return !d.muted && !d.readiness?.ready;
    });
    const sorted = [...rows];
    if (detOrder === 'name') return sorted.sort((a, b) => a.kind.localeCompare(b.kind));
    if (detOrder === 'weight') return sorted.sort((a, b) => b.weight - a.weight);
    if (detOrder === 'votes') {
      return sorted.sort((a, b) => b.useful + b.notUseful - (a.useful + a.notUseful));
    }
    return sorted.sort(
      (a, b) =>
        TONE_RANK[detectorTone(a)] - TONE_RANK[detectorTone(b)] || a.kind.localeCompare(b.kind),
    );
  });

  /** Jobs, worst first — a failing pass is the loudest thing on the Engine tab. */
  const jobRows = $derived(
    [...(telemetry?.jobs ?? [])].sort(
      (a, b) => TONE_RANK[jobTone(a)] - TONE_RANK[jobTone(b)] || a.name.localeCompare(b.name),
    ),
  );

  const moneyRows = $derived.by(() => {
    const rows = [...(money?.rows ?? [])];
    if (moneyOrder === 'largest') return rows.sort((a, b) => b.amountMinor - a.amountMinor);
    return rows.sort((a, b) => b.day.localeCompare(a.day));
  });

  // ── The masthead ──────────────────────────────────────────────────────────

  const allTimeThoughts = $derived(
    Object.values(counts.byStatus as Record<string, number>).reduce((a, b) => a + b, 0),
  );

  /** Thoughts that reached him and have never been rated — the starved input. */
  const needsRating = $derived(
    thoughts.filter((t) => !t.feedback && SHOWN_STATUSES.includes(t.status)).length,
  );
  const needsNaming = $derived(unnamed.length);
  const needsRuling = $derived(proposedRules.length);
  const needsTotal = $derived(needsRating + needsNaming + needsRuling);
  const failingJobs = $derived((telemetry?.jobs ?? []).filter((j) => jobTone(j) === 'urgent'));

  const shellTabs = $derived<ShellTab[]>([
    { id: 'feed', label: 'Feed', count: needsRating, tone: 'action' },
    { id: 'family', label: 'Family' },
    { id: 'discoveries', label: 'Discoveries' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'places', label: 'Places', count: needsNaming, tone: 'action' },
    { id: 'money', label: 'Money' },
    { id: 'engine', label: 'Engine', count: needsRuling || failingJobs.length, tone: failingJobs.length ? 'watch' : 'action' },
    { id: 'improvement', label: 'Improvement' },
  ]);

  const coverReadout = $derived([
    { label: 'Last looked', value: hasRun ? ago(engine.lastDetectAt) : 'never' },
    { label: 'Trail', value: `${engine.trailSpanDays ?? 0} days` },
    { label: 'Covered 24h', value: pct(engine.coverage?.last24h) },
  ]);

  const coverTiles = $derived<DeckTile[]>([
    {
      key: 'needs',
      label: 'Waiting on you',
      value: String(needsTotal),
      tone: needsTotal ? 'action' : 'good',
      lit: needsTotal > 0,
      sub: `${needsNaming} to name · ${needsRuling} to approve · ${needsRating} to rate`,
    },
    {
      key: 'noticed',
      label: 'Noticed, 7 days',
      value: String(counts.thoughts7d),
      tone: 'steady',
      sub: `${allTimeThoughts} all time · ${suppressedCount} held back`,
    },
    {
      key: 'places',
      label: 'Places named',
      value: String(counts.namedPlaces),
      suffix: `/${counts.places}`,
      tone: counts.unnamedPlaces ? 'watch' : 'good',
      sub: `${counts.unnamedPlaces} still unnamed`,
    },
    {
      key: 'detectors',
      label: 'Detectors ready',
      value: String(readyCount),
      suffix: `/${detectors.length}`,
      tone: readyCount === detectors.length ? 'good' : 'watch',
      sub: `${mutedCount} muted by you`,
    },
  ]);

  // ── The action queue ──────────────────────────────────────────────────────
  //
  // The hub's answer to the only question a reader arrives with. Each card
  // names ONE thing and carries the button that does it; the old page made you
  // find the tab, then the section, then the row. Ordered by the shared tone
  // rank, so a failing job outranks a verdict that is merely waiting.

  /**
   * What an action-queue button actually does.
   *
   * Switching tab is not the action — it is the first third of it. A button
   * that says "sort through them" and leaves you at the top of a 3,000px page
   * with a closed panel somewhere below is the shape the old page had, and it
   * is why nothing on it ever got sorted. So: switch, OPEN the panel the card
   * is about, then put it on screen.
   */
  async function jumpTo(next: TabId, anchor: string, open?: () => void | Promise<void>) {
    setTab(next);
    if (open) void open();
    await tick();
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  interface AttentionCard {
    key: string;
    tone: Tone;
    kicker: string;
    figure: string;
    detail: string;
    cta: string;
    act: () => void;
  }

  const attention = $derived.by((): AttentionCard[] => {
    const out: AttentionCard[] = [];

    if (failingJobs.length) {
      out.push({
        key: 'jobs',
        tone: 'urgent',
        kicker: 'Scheduled passes failing',
        figure: String(failingJobs.length),
        detail:
          `${failingJobs.map((j) => j.name.replace('daydream-', '')).join(', ')} — while one of these is red, ` +
          'the tab that reads its output is reporting the day before it broke.',
        cta: 'Open the jobs table',
        act: () => jumpTo('engine', 'dd-jobs'),
      });
    }

    if (!hasRun) {
      out.push({
        key: 'never',
        tone: 'urgent',
        kicker: 'It has never run',
        figure: '0',
        detail:
          'The detect pass has not completed once, so every zero on this page is about the engine ' +
          'rather than about your life. The Engine tab says which source is missing.',
        cta: 'See what is wired up',
        act: () => jumpTo('engine', 'dd-provenance'),
      });
    }

    if (needsNaming) {
      out.push({
        key: 'places',
        tone: 'action',
        kicker: 'Places with no name',
        figure: String(needsNaming),
        detail:
          'Several detectors stay silent until a place has a name, so this is the highest-leverage ' +
          'thing on the hub. Each arrives pre-filled with the geocoder’s guess and an address.',
        cta: 'Name them in one sitting',
        act: () => jumpTo('places', 'dd-unnamed', () => { if (!sessionOpen) return openSession(); }),
      });
    }

    if (needsRuling) {
      out.push({
        key: 'rules',
        tone: 'action',
        kicker: 'Rules awaiting approval',
        figure: String(needsRuling),
        detail:
          'The model proposed these as data — a condition over a fixed list of facts, never code. ' +
          'Each has already passed validation and a replay against your history. Nothing fires until you say so.',
        cta: 'Approve or reject',
        act: () => jumpTo('engine', 'dd-rules'),
      });
    }

    if (needsRating) {
      out.push({
        key: 'rate',
        tone: 'action',
        kicker: 'Reached you, never rated',
        figure: String(needsRating),
        detail:
          `The confidence bar opened at 0.75 with no evidence behind it and only falls as you answer. ` +
          `${data.threshold.feedbackCount} response${data.threshold.feedbackCount === 1 ? '' : 's'} so far — ` +
          'until that number moves, the ranking is a guess.',
        cta: 'Rate them in the feed',
        act: () => jumpTo('feed', 'dd-thefeed'),
      });
    }

    if (suppressedCount) {
      out.push({
        key: 'deck',
        tone: 'watch',
        kicker: 'Held back below the bar',
        figure: String(suppressedCount),
        detail:
          'Nothing was sent, so nothing here interrupted you. Sorting a batch is the cheapest way to ' +
          'move the threshold, and it costs none of the four-a-day notification budget.',
        cta: 'Sort through them',
        act: () => jumpTo('feed', 'dd-deck', () => { if (!deckOpen) return openDeck(); }),
      });
    }

    if (money?.bank.willSkip) {
      out.push({
        key: 'bank',
        tone: 'watch',
        kicker: 'Bank pull will skip',
        figure: '1',
        detail:
          'The next run lands outside its own window, so it will skip rather than fail — which reads ' +
          'exactly like a night that found nothing. It sat in that state for three days once.',
        cta: 'Look at the rails',
        act: () => jumpTo('money', 'dd-bank'),
      });
    }

    return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  });

  const attentionHeadline = $derived(
    attention.some((a) => a.tone === 'urgent')
      ? 'Something has stopped'
      : 'Only you can do these',
  );

  // ── Decks for the Money and Engine tabs ───────────────────────────────────

  const moneyTiles = $derived<DeckTile[]>([
    {
      key: 'spend',
      label: 'Last 30 days',
      value: pounds(money?.totalMinor30d ?? 0),
      tone: 'steady',
      lit: true,
      sub: `${(money?.rows ?? []).length} verified rows · understates cash`,
    },
    {
      key: 'offers',
      label: 'Live offers',
      value: String((money?.offers ?? []).length),
      tone: (money?.offers ?? []).length ? 'action' : 'quiet',
      sub: 'found in your email',
    },
    {
      key: 'renewals',
      label: 'Dated events, 60d',
      value: String((money?.renewals ?? []).length),
      tone: (money?.renewals ?? []).length ? 'watch' : 'quiet',
      sub: 'renewals · appointments',
    },
    {
      key: 'bank',
      label: 'Bank rails',
      value: money?.bank.enabled ? 'Armed' : 'Off',
      tone: money?.bank.enabled ? (money.bank.willSkip ? 'watch' : 'good') : 'quiet',
      sub: money?.bank.window ? `window ${money.bank.window}` : 'debits only, deduped on the id',
    },
  ]);

  const engineTiles = $derived<DeckTile[]>([
    {
      key: 'trail',
      label: 'Days of trail',
      value: String(engine.trailSpanDays ?? 0),
      tone: hasRun ? 'steady' : 'urgent',
      sub: `observed ${ago(engine.lastObserveAt)}`,
    },
    {
      key: 'coverage',
      label: 'Covered, 24h',
      value: pct(engine.coverage?.last24h),
      tone: (engine.coverage?.last24h ?? 0) >= 0.5 ? 'good' : 'watch',
      sub: `7d ${pct(engine.coverage?.last7d)}`,
    },
    {
      key: 'detectors',
      label: 'Detectors ready',
      value: String(readyCount),
      suffix: `/${detectors.length}`,
      tone: readyCount === detectors.length ? 'good' : 'watch',
      sub: `${mutedCount} muted by you`,
    },
    {
      key: 'places',
      label: 'Places named',
      value: String(counts.namedPlaces),
      suffix: `/${counts.places}`,
      tone: counts.unnamedPlaces ? 'action' : 'good',
      sub: `${counts.unnamedPlaces} still unnamed`,
    },
  ]);

  const budgetTiles = $derived.by((): DeckTile[] => {
    if (!budget || !budget.applies) return [];
    return [
      {
        key: 'today',
        label: 'Of weekly, today',
        value: String(budget.spentTodayWeeklyPct),
        suffix: `/${budget.dailyCapPct}%`,
        tone: budget.spentTodayWeeklyPct > budget.dailyCapPct ? 'urgent' : 'steady',
        sub: `paced target ${budget.pacedTargetPct}%`,
      },
      {
        key: 'window',
        label: 'Of this 5h window',
        value: String(budget.spentThisWindowPct),
        suffix: `/${budget.fiveHourCapPct}%`,
        tone: budget.spentThisWindowPct > budget.fiveHourCapPct ? 'urgent' : 'steady',
        sub: `${budget.remainingWindowPct}% left`,
      },
      {
        key: 'depth',
        label: 'Working depth',
        value: String(budget.plan.depth),
        tone: budget.blocked ? 'urgent' : budget.reachable ? 'good' : 'watch',
        sub: `${budget.plan.maxCandidates} candidate${budget.plan.maxCandidates === 1 ? '' : 's'}${budget.plan.verify ? ', verified' : ''}`,
      },
    ];
  });
</script>

<DaydreamShell
  path="/jkai/daydreams"
  kicker="JKAI · Daydreaming"
  title={['A second brain', 'on spare cycles']}
  standfirst="It watches the household, the diary, the money and its own discoveries, and says something only when the crossing is worth it. Every claim cites its evidence; code audits it before you ever see it."
  readout={coverReadout}
  live={data.enabled}
  liveBusy={togglingEnabled}
  ontoggleLive={toggleEnabled}
  tabs={shellTabs}
  active={tab}
  ontab={(id) => setTab(id as TabId)}
  footer={[
    'strangeramblings.com/jkai/daydreams',
    'Owner-gated · nothing here leaves the house',
    `Threshold ${data.threshold.value} · ${data.threshold.feedbackCount} response${data.threshold.feedbackCount === 1 ? '' : 's'}`,
  ]}
>
  {#snippet masthead()}
    <StatDeck dark tiles={coverTiles} min={210} />
  {/snippet}

  {#if data.loadError}
    <section class="band">
      <div class="inner">
        <div class="card t-urgent">
          <p class="card-kicker">The ledger did not load</p>
          <p class="card-body">{data.loadError}</p>
          <p class="note">
            Every figure on this page is therefore a zero for a reason that has nothing to do
            with what the engine has been noticing. Reload; if it keeps failing, the server log
            carries the query error.
          </p>
        </div>
      </div>
    </section>
  {/if}

  {#if !data.enabled}
    <section class="band">
      <div class="inner">
        <div class="card t-watch">
          <p class="card-kicker">Paused</p>
          <p class="card-body">
            Nothing is being observed and nothing is being noticed. The control in the masthead
            resumes it; everything below is the state it was in when it stopped.
          </p>
        </div>
      </div>
    </section>
  {/if}

  <!-- ══ WHAT NEEDS YOU ═══════════════════════════════════════════════════
       The hub's action queue, above the tabs' content and on every tab,
       because it is the answer to the only question a reader arrives with.
       Each card names ONE thing and carries the button that does it — the
       old page made you find the section, then the sub-section, then the
       row. Ordered by the shared tone rank, so a broken job outranks a
       verdict that is merely waiting. -->
  {#if attention.length}
    <section class="band sunken attn">
      <div class="inner">
        <SectionHead
          kicker="· / Waiting on you"
          title={[attentionHeadline]}
          strap="Everything below is a thing only you can do — a name, a verdict, an approval. The engine will not ask twice, and several of the detectors stay silent until it has an answer."
        />
        <div class="grid">
          {#each attention as a (a.key)}
            <div class="card t-{a.tone}">
              <p class="card-kicker">{a.kicker}</p>
              <p class="card-figure">{a.figure}</p>
              <p class="card-body">{a.detail}</p>
              <div class="card-actions">
                <button type="button" class="cta" onclick={a.act}>{a.cta}</button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       FEED
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'feed'}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / Steer it"
          title={['Point it at', 'something']}
          strap="The only owner-authored text the engine has ever read beyond a place name. It reorders what gets attention and grants no new access — the proposer still sees the metric list and nothing else."
        />

        <div class="steer-row">
          <label class="field-label" for="steer-input">Ask it to look into something</label>
          <div class="steer-controls">
            <input
              id="steer-input"
              class="text-input"
              bind:value={steerText}
              maxlength="280"
              placeholder="e.g. whether going out late costs me the next morning"
              onkeydown={(e) => { if (e.key === 'Enter') submitSteer(); }}
            />
            <button type="button" class="cta" disabled={steerBusy || !steerText.trim()} onclick={submitSteer}>
              {steerBusy ? 'Adding…' : 'Add a steer'}
            </button>
          </div>
          {#if steerError}<p class="err">{steerError}</p>{/if}
        </div>

        {#if steers.length}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Steer</th>
                  <th class="right">Influence</th>
                  <th class="right">Do</th>
                </tr>
              </thead>
              <tbody>
                {#each steers as st (st.id)}
                  <tr class:dim={st.status !== 'active'}>
                    <td class="cell-lead">{st.text}</td>
                    <td class="right">
                      {st.status === 'active'
                        ? `${st.batchesInfluenced} batch${st.batchesInfluenced === 1 ? '' : 'es'}`
                        : st.status}
                    </td>
                    <td class="right nowrap">
                      {#if st.status === 'active'}
                        <button type="button" class="btn" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'done' })}>Done</button>
                        <button type="button" class="btn danger" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'dropped' })}>Drop</button>
                      {:else}
                        <button type="button" class="btn" onclick={() => steerPost({ action: 'set_steer_status', id: st.id, status: 'active' })}>Reopen</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <!-- ── THE FEED ─────────────────────────────────────────────────────── -->
    <section class="band sunken" id="dd-thefeed">
      <div class="inner">
        <SectionHead
          kicker="B / The feed"
          title={['Everything it', 'has noticed']}
          strap="Grouped by what sort of thing it is, how sure it was, or when it landed. Colour is priority, not category: orange is waiting on your verdict, red nearly went out wrong, and grey is finished business."
        />

        <div class="controls">
          <FacetBar label="Arrange" active={groupBy} facets={arrangeFacets} onpick={(id) => (groupBy = id as GroupBy)} />
          <FacetBar label="Show" active={filter} facets={showFacets} onpick={(id) => (filter = id as Filter)} />
          <FacetBar label="Order" active={groupBy === 'day' ? 'newest' : feedOrder} facets={feedOrderFacets} onpick={(id) => (feedOrder = id as FeedOrder)} />
        </div>
        {#if groupBy === 'day'}
          <p class="note">
            Arranged by day, so the order is the day's — a timeline that jumped about by score
            would print the same date as a heading over and over.
          </p>
        {/if}

        {#if actionError}<p class="err">{actionError}</p>{/if}

        {#if visible.length === 0}
          <div class="card t-quiet">
            <p class="card-body">
              {#if !hasRun}
                The detect pass has not run yet, so nothing has been noticed rather than nothing
                being worth noticing.
              {:else if thoughts.length === 0}
                Nothing noticed yet. {detectors.length - readyCount} of {detectors.length} detectors are
                still gathering the history they need — the Engine tab says what each is waiting for.
              {:else}
                Nothing in this view. The counts on the chips above say where everything went.
              {/if}
            </p>
          </div>
        {:else}
          {#each grouped as g (g.key)}
            <!-- A group header that carries its own statistics, so "what is it
                 noticing, how strongly, and how has that landed" is answerable
                 without opening anything. The useful rate is withheld below five
                 votes rather than printed over two — see thought-groups.ts. -->
            <div class="group">
              <button type="button" class="group-hd" onclick={() => toggleGroup(g.key)}>
                <span class="group-caret">{collapsed[g.key] ? '▸' : '▾'}</span>
                <span class="group-label">{g.label}</span>
                <span class="group-n">{g.items.length}</span>
              </button>
              {#if g.stats}
                <p class="group-stats">
                  mean {g.stats.meanScore.toFixed(2)}
                  · {g.stats.delivered} reached you
                  {#if g.stats.held} · {g.stats.held} held{/if}
                  {#if g.stats.usefulRate != null}
                    · {Math.round(g.stats.usefulRate * 100)}% useful over {g.stats.rated}
                  {:else if g.stats.rated}
                    · {g.stats.rated} rated
                  {/if}
                </p>
              {/if}
              <span class="group-rule"></span>
            </div>
            {#if g.blurb && !collapsed[g.key]}
              <p class="group-blurb">{g.blurb}</p>
            {/if}

            <!-- ── The board ─────────────────────────────────────────────
                 Three columns, not one long list. The feed is a set of
                 unrelated observations to be triaged, not a document to be
                 read top to bottom, and a single column made it look like the
                 latter — you scrolled a thousand pixels to find out whether
                 there were four things or forty.

                 An OPEN card takes the full row (`grid-column: 1 / -1`): the
                 detail carries a map, an evidence list, a components table and
                 a note box, none of which survive a 320px column. -->
            <div class="board">
              {#each collapsed[g.key] ? [] : g.items as t (t.id)}
                {@const dest = thoughtDestination(t)}
                <article class="card t-{thoughtTone(t)}" class:open={expanded === t.id}>
                  <div class="card-hd">
                    <button type="button" class="card-title" onclick={() => (expanded = expanded === t.id ? null : t.id)}>
                      {headline(t)}
                    </button>
                    {#if isAnswered(t)}
                      <span class="pill t-good">answered</span>
                    {:else}
                      <span class="pill t-{thoughtTone(t)}">{t.status}</span>
                    {/if}
                  </div>

                  <!-- A question about a place that now has a name is finished
                       business, and saying so stops it reading as still open. The
                       stored title is kept beneath, because it is what was actually
                       asked at the time. -->
                  {#if isAnswered(t)}
                    <p class="card-body">
                      You named this <strong>{t.placeLabel}</strong>{t.placeVisits ? ` · ${t.placeVisits} visits` : ''}.
                      It asked: “{t.title}”
                    </p>
                  {:else}
                    <p class="card-body">{t.explanation}</p>
                  {/if}

                  <div class="card-meta">
                    {#if kindChip(t).musing}
                      <span class="tag accent">{kindChip(t).text}</span>
                    {:else}
                      <span class="tag">{kindChip(t).text}</span>
                    {/if}
                    {#key data.threshold.value}
                      <span
                        class="tag t-{bandTone(likelihoodBand(t.score, data.threshold.value).id)}"
                        title={likelihoodBand(t.score, data.threshold.value).meaning}
                      >
                        {likelihoodBand(t.score, data.threshold.value).label}
                      </span>
                    {/key}
                    <span class="meta-item">score {t.score}</span>
                    <span class="meta-item">{ago(t.createdAt)}</span>
                    {#if !t.placeLabel && t.placeAddress}
                      <span class="meta-item">{t.placeAddress}</span>
                    {/if}
                    {#if !t.placeLabel && t.placeVisits}
                      <span class="meta-item">{t.placeVisits} visit{t.placeVisits === 1 ? '' : 's'}</span>
                    {/if}
                    {#if t.suppressedReason}
                      <span class="meta-item warn">held back: {t.suppressedReason}</span>
                    {/if}
                    {#if t.promptTokens + t.completionTokens > 0}
                      <span class="meta-item">{t.promptTokens + t.completionTokens} tok</span>
                    {/if}
                    {#if t.feedback}
                      <span class="meta-item good">you said {t.feedback.replace('_', ' ')}</span>
                    {/if}
                    {#if t.intelNoteId}
                      <span class="meta-item good">in the graph</span>
                    {/if}
                  </div>

                  {#if t.id === rateId}
                    <p class="cue">Opened from a notification — your answer is below.</p>
                  {/if}

                  {#if t.narrative}
                    <!-- The model's phrasing, always shown as the model's. The rule's
                         own explanation stays directly beneath it, so if this whole
                         path failed permanently the ledger would still read. -->
                    <blockquote class="quote" class:unchecked={t.verified === false}>
                      {t.narrative}
                      <span class="quote-tag" class:ok={t.verified === true}>
                        {t.verified === true ? 'model · checked' : 'model · UNCHECKED'}
                      </span>
                    </blockquote>
                  {:else if t.narrativeDroppedReason}
                    <!-- A composer that has quietly started refusing everything looks
                         exactly like a quiet week unless this is on the page. -->
                    <p class="note warn">phrasing dropped — {t.narrativeDroppedReason}</p>
                  {/if}

                  <!-- ── What the review made of it ───────────────────────────
                       A refuted thought never reaches WhatsApp, so this is the only
                       place its reasoning is ever read. A verdict you cannot see is
                       one you cannot argue with. -->
                  {#if t.reviewVerdict}
                    <p class="review r-{t.reviewVerdict}">
                      <span class="review-tag">
                        {t.reviewVerdict === 'verified'
                          ? 'checked · holds up'
                          : t.reviewVerdict === 'refuted'
                            ? 'checked · does not hold'
                            : 'checked · cannot tell'}
                        {#if typeof t.reviewLikelihood === 'number'}
                          <span class="review-p">{Math.round(t.reviewLikelihood * 100)}%</span>
                        {/if}
                      </span>
                      {#if t.reviewReasoning}<span class="review-why">{t.reviewReasoning}</span>{/if}
                      {#if t.reviewMemoryId}
                        <span class="review-mem">remembered — it will not raise this blind again</span>
                      {/if}
                    </p>
                  {/if}

                  <!-- ── The map, on the card ────────────────────────────────
                       "Suggestions about a location need a map." Not behind an
                       expand and then behind a second button: one tap on the
                       card face, because the question a place card asks —
                       "what is this?" — is answerable from the map and from
                       nothing else on the card. Coordinates are still fetched
                       on demand by the owner-gated action; the ledger payload
                       has never carried a lat/lon and still does not. -->
                  {#if hasMap(t)}
                    {#if thoughtPlace[t.id]}
                      <div class="card-map">
                        <PlaceMap
                          lat={thoughtPlace[t.id].lat}
                          lon={thoughtPlace[t.id].lon}
                          radiusM={thoughtPlace[t.id].radiusM}
                          height="180px"
                        />
                        {#if thoughtPlace[t.id].suggestedAddress}
                          <p class="note">{thoughtPlace[t.id].suggestedAddress}</p>
                        {/if}
                      </div>
                    {/if}
                  {/if}

                  <!-- ── Quick actions, on the card face ─────────────────────
                       Every one of these used to live inside the expand, or in
                       a bar that only rendered for a thought that had actually
                       been delivered. That is why the ledger has thousands of
                       rows and a few dozen verdicts: the cost of an opinion was
                       two clicks and a scroll.

                       Rating is still offered only on what actually reached
                       him — asking "was this useful?" about something suppressed
                       before it was ever sent trains the weights on something he
                       never saw. Everything else here works on any card. -->
                  <div class="quick">
                    {#if !t.feedback && SHOWN_STATUSES.includes(t.status)}
                      <button type="button" class="q good" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'useful')} title="Useful — and weave it into the Intel graph">
                        Useful
                      </button>
                      <button type="button" class="q" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'not_useful')} title="Not useful">
                        Not useful
                      </button>
                    {/if}
                    {#if t.status !== 'archived'}
                      <button type="button" class="q" disabled={busy?.startsWith(t.id)} onclick={() => archiveThought(t)} title="Seen it. File it away without saying whether it was any good.">
                        OK
                      </button>
                    {/if}
                    <!-- On ANY card, suppressed included: the automatic sweep
                         only walks unreviewed new/suppressed rows, so a held-back
                         card it has already seen has no other route to a check. -->
                    <button type="button" class="q model" disabled={busy === `${t.id}:review`} onclick={() => queueToModel(t)} title="Send it to the reviewer: it reads the sources and rules, and remembers what it decided">
                      {busy === `${t.id}:review` ? 'Checking…' : t.reviewVerdict ? 'Check again' : 'Queue to model'}
                    </button>
                    {#if hasMap(t)}
                      <button
                        type="button"
                        class="q"
                        disabled={busy === `${t.id}:map`}
                        onclick={() => toggleMap(t.id)}
                      >
                        {busy === `${t.id}:map` ? 'Loading…' : thoughtPlace[t.id] ? 'Hide map' : 'Map'}
                      </button>
                    {/if}
                    {#if dest}
                      <a class="q link" href={dest.href} title="{dest.hint}{dest.external ? ' — leaves the daydream hub' : ''}">
                        {dest.label}{#if dest.external}<span class="q-ext">↗</span>{/if}
                      </a>
                    {/if}
                    {#if t.feedback === 'useful' && !t.intelNoteId}
                      <!-- Voted useful before this shipped, or the graph was
                           busy at the time. One tap rather than a re-vote. -->
                      <button type="button" class="q" disabled={busy === `${t.id}:weave`} onclick={() => weave(t)}>
                        {busy === `${t.id}:weave` ? 'Weaving…' : 'Weave into Intel'}
                      </button>
                    {/if}
                    <button type="button" class="q more" onclick={() => (expanded = expanded === t.id ? null : t.id)}>
                      {expanded === t.id ? 'Less' : 'Why'}
                    </button>
                  </div>

                  {#if weaveNote[t.id]}<p class="note good">{weaveNote[t.id]}</p>{/if}
                  {#if reviewErr[t.id]}<p class="err">{reviewErr[t.id]}</p>{/if}
                  {#if reviewOut[t.id]}
                    <p class="note good">
                      Ruled <strong>{reviewOut[t.id].verdict}</strong> after {reviewOut[t.id].toolCalls} source
                      {reviewOut[t.id].toolCalls === 1 ? 'check' : 'checks'} — and remembered.
                    </p>
                  {/if}

                  {#if expanded === t.id}
                    <div class="detail">
                      <div class="detail-block">
                        <p class="field-label">Why this came up</p>
                        {#each rootCause(t) as line, li (li)}
                          <p class="detail-line">{line}</p>
                        {/each}
                        {#if extraComponents(t).length}
                          <div class="tbl-scroll">
                            <table class="tbl compact">
                              <thead><tr><th>Component</th><th class="right">Value</th></tr></thead>
                              <tbody>
                                {#each extraComponents(t) as [k, v] (k)}
                                  <tr><td>{k}</td><td class="right">{v}</td></tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        {/if}
                      </div>

                      <!-- What the reviewer wrote down about it. Shown here in
                           full rather than only as a verdict chip, because the
                           memory is the thing that changes what gets said next
                           and it should be arguable. -->
                      {#if reviewOut[t.id]?.memory}
                        <div class="detail-block">
                          <p class="field-label">What it now remembers</p>
                          <p class="detail-line said">{reviewOut[t.id].memory}</p>
                          {#if reviewOut[t.id].sources.length}
                            <p class="note">Checked: {reviewOut[t.id].sources.join(' · ')}</p>
                          {/if}
                        </div>
                      {/if}

                      {#if t.evidence.length}
                        <div class="detail-block">
                          <p class="field-label">What it was looking at</p>
                          <!-- Resolved on demand: the subject and sender of the
                               email, the place's rhythm, the transaction — and the
                               graph entities each source touches. -->
                          <EvidenceList thoughtId={t.id} count={t.evidence.length} />
                        </div>
                      {/if}

                      {#if (t.proposedActions ?? []).length && t.status !== 'actioned'}
                        <div class="detail-block">
                          <p class="field-label">It suggests</p>
                          <div class="card-actions">
                            {#each t.proposedActions ?? [] as a, i (i)}
                              <button type="button" class="cta" disabled={busy === `${t.id}:act${i}`} onclick={() => runAction(t, i)}>
                                {a.label}
                              </button>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <!-- A verdict says whether it landed; it can never say WHY.
                           Saved verbatim, and written to memory so the rest of jkai
                           reads it too. -->
                      <div class="detail-block">
                        <p class="field-label">Add some depth</p>
                        {#if t.note && noteDraft[t.id] === undefined}
                          <p class="detail-line said">{t.note}</p>
                          <button type="button" class="btn" onclick={() => { noteDraft[t.id] = t.note ?? ''; }}>
                            Change what you said
                          </button>
                        {:else}
                          <textarea
                            class="text-input area"
                            rows="3"
                            maxlength={MAX_NOTE_CHARS}
                            placeholder="Anything it should know — what it got wrong, what it missed, what these actually are."
                            bind:value={noteDraft[t.id]}
                          ></textarea>
                          <div class="card-actions">
                            <button
                              type="button"
                              class="cta"
                              disabled={busy === `${t.id}:note` || !(noteDraft[t.id] ?? '').trim()}
                              onclick={() => saveNote(t)}
                            >
                              {busy === `${t.id}:note` ? 'Saving…' : 'Save this'}
                            </button>
                            {#if t.note}
                              <button type="button" class="btn" onclick={() => { delete noteDraft[t.id]; noteDraft = { ...noteDraft }; }}>
                                Cancel
                              </button>
                            {/if}
                          </div>
                          <p class="note">Kept as a memory, so it informs what it says next.</p>
                        {/if}
                      </div>

                      <!-- The rarer verdicts live in the expand: `never_kind` is
                           an absolute, irreversible-feeling mute and does not
                           belong one mis-tap away on a card face. -->
                      {#if !t.feedback && SHOWN_STATUSES.includes(t.status)}
                        <div class="card-actions bar">
                          <span class="ask">Anything stronger?</span>
                          <button type="button" class="btn danger" disabled={busy?.startsWith(t.id)} onclick={() => vote(t, 'never_kind')}>
                            Never this kind
                          </button>
                          <button type="button" class="btn" disabled={busy?.startsWith(t.id)} onclick={() => post({ action: 'snooze', id: t.id, days: 7 }, `${t.id}:snooze`)}>
                            Snooze a week
                          </button>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- ── WHAT IT HAS RULED ON ───────────────────────────────────────────
         "That list of memories should be accessible somewhere."

         Somewhere is here, under the feed the rulings are about. Every row is
         a claim a model went and checked against the sources, and every one of
         them is also a `jkai_memories` row — which is the half that matters.
         A verdict in a column stops one message going out. A memory stops the
         claim being MADE again: the ponder pack cards these, refutations
         first, so the next cycle reads "the two Canva rows are one payment"
         before it proposes them as two. -->
    <section class="band" id="dd-rulings">
      <div class="inner">
        <SectionHead
          kicker="C / What it has ruled on"
          title={['Things it', 'went and checked']}
          strap="A model was given the claim, the evidence, and the ability to go and read the sources. Every verdict here is also a memory, which is why it does not have to work the same thing out twice."
        >
          {#snippet aside()}
            {#if !rulingsOpen}
              <button type="button" class="cta" onclick={loadRulings}>Show the rulings</button>
            {:else}
              <button type="button" class="btn" onclick={() => { rulingsOpen = false; }}>Close</button>
            {/if}
          {/snippet}
        </SectionHead>

        {#if rulingsOpen}
          {#if rulingsLoading}
            <div class="card t-watch"><p class="card-body">Reading what it has settled…</p></div>
          {:else if rulingsError}
            <div class="card t-urgent"><p class="card-body">Could not read the rulings: {rulingsError}</p></div>
          {:else if rulings.length === 0}
            <div class="card t-quiet">
              <p class="card-body">
                Nothing has been ruled on yet. <strong>Queue to model</strong> on any card above
                sends it to the reviewer — it reads the sources, decides whether the claim is
                actually true, and writes what it concluded to memory.
              </p>
            </div>
          {:else}
            <div class="controls">
              <FacetBar
                label="Verdict"
                active={rulingWho}
                facets={rulingFacets}
                onpick={(id) => (rulingWho = id as typeof rulingWho)}
              />
            </div>
            <div class="board">
              {#each rulingsVisible as r (r.id)}
                <article class="card t-{r.verdict === 'refuted' ? 'urgent' : r.verdict === 'verified' ? 'good' : 'watch'}">
                  <div class="card-hd">
                    <span class="card-title as-text">{r.title}</span>
                    <span class="pill t-{r.verdict === 'refuted' ? 'urgent' : r.verdict === 'verified' ? 'good' : 'watch'}">
                      {r.verdict === 'refuted' ? 'did not hold' : r.verdict === 'verified' ? 'held up' : 'cannot tell'}
                    </span>
                  </div>
                  {#if r.reasoning}<p class="card-body">{r.reasoning}</p>{/if}
                  <div class="card-meta">
                    <span class="tag">{r.kind}</span>
                    {#if typeof r.likelihood === 'number'}
                      <span class="meta-item">{Math.round(r.likelihood * 100)}% likely true</span>
                    {/if}
                    {#if r.ruledAt}<span class="meta-item">{ago(r.ruledAt)}</span>{/if}
                    {#if r.model}<span class="meta-item">{r.model}</span>{/if}
                    <!-- A ruling with no memory behind it changes nothing about
                         what gets said next, and the page must not let that look
                         the same as one that does. -->
                    {#if r.memoryId}
                      <span class="meta-item good">remembered</span>
                    {:else}
                      <span class="meta-item warn">not remembered — check it again to record it</span>
                    {/if}
                  </div>
                  {#if r.sources.length}
                    <p class="note">Checked: {r.sources.slice(0, 4).join(' · ')}</p>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </section>

    <!-- ── THE SORTING DECK ─────────────────────────────────────────────
         Everything about ranking is a random walk until the ledger has
         feedback in it, and at four interruptions a day the 25 responses the
         threshold needs are never collected. One sitting closes that gap and
         costs no interruption budget at all. -->
    {#if suppressedCount}
      <section class="band" id="dd-deck">
        <div class="inner">
          <SectionHead
            kicker="D / What it nearly said"
            title={['The things', 'it held back']}
            strap="These scored below the bar, so nothing was sent. That bar was set with no evidence at all — rating a few here is the only thing that moves it. None of this counts as a notification."
          >
            {#snippet aside()}
              {#if !deckOpen}
                <button type="button" class="cta" onclick={openDeck}>Sort through {suppressedCount}</button>
              {:else}
                {#if verdictCount}
                  <button type="button" class="cta" disabled={deckSaving} onclick={saveDeck}>
                    {deckSaving ? 'Saving…' : `Save ${verdictCount} verdict${verdictCount === 1 ? '' : 's'}`}
                  </button>
                {/if}
                <button type="button" class="btn" onclick={() => { deckOpen = false; }}>Close</button>
              {/if}
            {/snippet}
          </SectionHead>

          {#if deckDone}
            <p class="note good">
              Recorded {deckDone.recorded}{deckDone.failed ? `, ${deckDone.failed} failed` : ''}.
              Counted at 0.7 of a considered verdict.
            </p>
          {/if}
          {#if deckError}<p class="err">{deckError}</p>{/if}

          {#if !deckOpen}
            <p class="lede">Thirty at a time, most-repeated first. Nothing you do here interrupts you.</p>
          {:else if deckLoading}
            <p class="lede">Loading…</p>
          {:else if deck.length === 0}
            <p class="lede">Nothing left to sort.</p>
          {:else}
            <div class="grid">
              {#each deck as c (c.id)}
                <div class="card t-{verdicts[c.id] ? 'good' : 'watch'}" class:ruled={verdicts[c.id]}>
                  <p class="card-kicker">{c.kind} · score {c.score}{c.recurrenceCount > 1 ? ` · proposed ${c.recurrenceCount}×` : ''}</p>
                  <p class="card-title as-text">{c.title}</p>
                  <p class="card-body">{c.narrative || c.explanation}</p>
                  <div class="card-actions bar">
                    <button
                      type="button"
                      class="btn"
                      class:picked={verdicts[c.id] === 'useful'}
                      onclick={() => setVerdict(c.id, 'useful')}
                    >Useful</button>
                    <button
                      type="button"
                      class="btn"
                      class:picked={verdicts[c.id] === 'not_useful'}
                      onclick={() => setVerdict(c.id, 'not_useful')}
                    >Not useful</button>
                    <button
                      type="button"
                      class="btn danger"
                      class:picked={verdicts[c.id] === 'never_kind'}
                      onclick={() => setVerdict(c.id, 'never_kind')}
                    >Never this kind</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {/if}
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       FAMILY
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'family'}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / The household, now"
          title={['Where', 'everyone is']}
          strap="Read off the trail, not asked for. A card goes grey when the last fix is over an hour old — an unknown position and a position at home are not the same answer."
        />
        <div class="grid">
          {#each familyMembers as m (m.subject)}
            <div class="card t-{m.ageMins == null || m.ageMins > 60 ? 'quiet' : m.isHome ? 'good' : 'steady'}">
              <div class="card-hd">
                <p class="card-title as-text">{cap(m.subject)}</p>
                {#if m.batteryPct != null && m.batteryPct <= 25}
                  <span class="pill t-watch">battery {m.batteryPct}%</span>
                {/if}
              </div>
              <p class="card-figure sm">
                {#if m.ageMins == null}
                  not tracked
                {:else if m.isHome}
                  at home
                {:else if m.placeLabel}
                  at {m.placeLabel}
                {:else if m.distanceHomeKm != null}
                  {m.distanceHomeKm} km out
                {:else}
                  out
                {/if}
              </p>
              <p class="card-kicker">
                {#if m.ageMins != null}seen {m.ageMins < 5 ? 'just now' : `${m.ageMins}m ago`}{:else}no recent fix{/if}
              </p>
              <div class="tbl-scroll">
                <table class="tbl compact">
                  <tbody>
                    <tr><td>First out</td><td class="right">{clock(m.today.firstOutMins)}</td></tr>
                    <tr><td>Out today</td><td class="right">{m.today.minutesOut >= 60 ? `${Math.round(m.today.minutesOut / 6) / 10}h` : `${m.today.minutesOut}m`}</td></tr>
                    <tr><td>Places</td><td class="right">{m.today.placesVisited}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="B / On the map"
          title={['Everyone,', 'plotted']}
          strap="Fetched on demand and held only for this render — positions never ride the page payload and are never cached."
        >
          {#snippet aside()}
            {#if famPositions}
              <button type="button" class="btn" onclick={loadFamilyMap}>Refresh positions</button>
            {:else}
              <button type="button" class="cta" onclick={loadFamilyMap}>Show the map</button>
            {/if}
          {/snippet}
        </SectionHead>

        {#if famLoading}
          <p class="lede">Locating everyone…</p>
        {:else if famError}
          <div class="card t-urgent">
            <p class="card-body">{famError}</p>
            <div class="card-actions"><button type="button" class="btn" onclick={loadFamilyMap}>Try again</button></div>
          </div>
        {:else if famPositions && famPositions.length}
          <FamilyMap positions={famPositions} />
        {:else if famPositions}
          <p class="lede">Nobody has a recent position.</p>
        {/if}
      </div>
    </section>

    <!-- ── EACH PERSON'S OWN WORK ────────────────────────────────────────
         This tab was a presence map. Four of the five people in the trail have
         had a year of position history and a feature store since the family
         backfill, and nothing had ever asked a question about them, because
         the sweep and the hypothesis proposer both ran for John alone. Both
         are per-subject now.

         A suggestion is filed under a person by its CITATIONS — the ponder
         pack cards each member as `family:<subject>` — never by finding their
         name in the text, which would file every thought that mentions them. -->
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="C / Each person"
          title={['What the sweep', 'found, per head']}
          strap="Questions are proposed per person nightly, and the false-discovery correction is applied within that person — never across the household."
        />

        {#each familyMembers as m (m.subject)}
          {@const d = familyDetail[m.subject]}
          <div class="person">
            <button type="button" class="person-hd" onclick={() => togglePerson(m.subject)}>
              <span class="group-caret">{openPerson === m.subject ? '▾' : '▸'}</span>
              <span class="person-name">{cap(m.subject)}</span>
              <span class="person-counts">
                {d?.hypotheses?.length ?? 0} question{(d?.hypotheses?.length ?? 0) === 1 ? '' : 's'}
                · {d?.sweep?.findings?.length ?? 0} finding{(d?.sweep?.findings?.length ?? 0) === 1 ? '' : 's'}
                · {d?.thoughts?.length ?? 0} suggestion{(d?.thoughts?.length ?? 0) === 1 ? '' : 's'}
              </span>
            </button>

            {#if openPerson === m.subject}
              <div class="person-body">
                <!-- Questions live on the Discoveries board, which spans the
                     whole household with a name against each card. A second
                     copy here would be two places to read the same thing and
                     one of them would go stale. -->
                <div class="detail-block">
                  <p class="field-label">Questions asked about {cap(m.subject)}</p>
                  {#if !d?.hypotheses?.length}
                    <p class="detail-line">
                      Nothing yet. Questions are proposed nightly per person, and only once there
                      are enough days of history to answer them.
                    </p>
                  {:else}
                    <p class="detail-line">
                      {d.hypotheses.length} question{d.hypotheses.length === 1 ? '' : 's'},
                      {d.hypotheses.filter((h) => h.verdict === 'supported').length} still holding.
                      They sit on the board with everyone else's.
                    </p>
                    <button type="button" class="cta" onclick={() => openBoardFor(m.subject)}>
                      Open {cap(m.subject)}'s questions
                    </button>
                  {/if}
                </div>

                <div class="detail-block">
                  <p class="field-label">What the sweep found</p>
                  {#if !d?.sweep}
                    <p class="detail-line">The sweep has not run for {cap(m.subject)} yet.</p>
                  {:else}
                    <p class="detail-line">
                      {d.sweep.testsRun} tests · {d.sweep.naiveHits} would pass an uncorrected p&lt;0.05 ·
                      <b>{d.sweep.findings.length}</b> survive the false-discovery correction.
                      {#if d.sweep.errors?.length}<br />{d.sweep.errors[0]}{/if}
                    </p>
                    {#if d.sweep.findings.length}
                      <div class="tbl-scroll">
                        <table class="tbl compact">
                          <thead><tr><th>Pair</th><th class="right">r</th><th class="right">q</th><th class="right">n</th></tr></thead>
                          <tbody>
                            {#each d.sweep.findings.slice(0, 6) as f, fi (fi)}
                              <tr>
                                <td class="cell-lead">{(f as Record<string, unknown>).a} ↔ {(f as Record<string, unknown>).b}</td>
                                <td class="right">{Number((f as Record<string, unknown>).r ?? 0).toFixed(2)}</td>
                                <td class="right">{Number((f as Record<string, unknown>).q ?? 0).toFixed(3)}</td>
                                <td class="right">{String((f as Record<string, unknown>).n ?? '—')}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  {/if}
                </div>

                <div class="detail-block">
                  <p class="field-label">Suggestions that cited {cap(m.subject)}</p>
                  {#if !d?.thoughts?.length}
                    <p class="detail-line">Nothing has cited {cap(m.subject)} as evidence yet.</p>
                  {:else}
                    <div class="tbl-scroll">
                      <table class="tbl compact">
                        <thead><tr><th>Suggestion</th><th>Kind</th><th class="right">Score</th><th class="right">Status</th></tr></thead>
                        <tbody>
                          {#each d.thoughts as t (t.id)}
                            <tr>
                              <td class="cell-lead"><a class="link" href="/jkai/daydreams?tab=feed&rate={t.id}">{t.title}</a></td>
                              <td>{kindLabel(t.kind)}</td>
                              <td class="right">{t.score}</td>
                              <td class="right">{t.status}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       DISCOVERIES
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'discoveries'}
    <!-- Yesterday, in one card. Quiet days are reported as clearly as busy
         ones — a digest that only appears when there is news cannot be
         trusted when it is silent. -->
    {#if digest}
      <section class="band">
        <div class="inner">
          <SectionHead kicker="A / Yesterday" title={['The morning', 'card']} strap={digest.day} />
          <div class="card t-steady">
            <p class="card-body lead">{digest.summary}</p>
            {#if digest.narrative}
              <blockquote class="quote" class:unchecked={digest.verified === false}>
                {digest.narrative}
                <span class="quote-tag" class:ok={digest.verified === true}>
                  {digest.verified === true ? 'model · checked' : 'model · UNCHECKED'}
                </span>
              </blockquote>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <!-- What it has been wondering about. The model picks the questions; code
         answers them. Everything asked is shown, however it turned out. -->
    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="B / What it wondered"
          title={['Questions asked', 'before the answers']}
          strap="The assistant chooses what to investigate before it sees any results, then deterministic statistics answer it. A question that came back empty is kept exactly as long as one that held."
        >
          {#snippet aside()}
            {#if !boardOpen}
              <button type="button" class="cta" onclick={openBoard}>Open the board</button>
            {:else}
              <button type="button" class="btn" onclick={() => { boardOpen = false; }}>Close</button>
            {/if}
          {/snippet}
        </SectionHead>

        {#if boardError}<p class="err">{boardError}</p>{/if}

        {#if boardOpen}
          {#if boardLoading}
            <p class="lede">Loading…</p>
          {:else if board.length === 0}
            <p class="lede">Nothing asked yet. The first batch arrives on the next nightly cycle.</p>
          {:else}
            <div class="controls">
              {#if boardPeople.length > 1}
                <FacetBar label="Whose" active={boardWho} facets={boardWhoFacets} onpick={(id) => (boardWho = id)} />
              {/if}
              <FacetBar label="Verdict" active={boardVerdict} facets={boardVerdictFacets} onpick={(id) => (boardVerdict = id)} />
              <FacetBar label="Order" active={boardOrder} facets={boardOrderFacets} onpick={(id) => (boardOrder = id as BoardOrder)} />
            </div>

            {#if boardVisible.length === 0}
              <div class="card t-quiet">
                <p class="card-body">No question matches that combination. The counts on the chips say where they all went.</p>
              </div>
            {/if}

            <div class="stack">
              {#each boardVisible as q (q.id)}
                <div class="card t-{verdictTone(q.verdict)}">
                  <div class="card-hd">
                    <p class="card-title as-text">{q.question}</p>
                    <span class="pill t-{verdictTone(q.verdict)}">
                      {q.verdict ? (VERDICT_LABEL[q.verdict] ?? q.verdict) : 'not answered yet'}
                    </span>
                  </div>
                  <p class="card-kicker">{cap(q.subject)}</p>

                  {#if q.summary}<p class="card-body lead">{q.summary}</p>{/if}
                  <p class="card-body">{q.rationale}</p>

                  <div class="card-meta">
                    <span class="tag">{q.metricA}{q.lagDays ? ' → ' : ' ~ '}{q.metricB}</span>
                    {#if q.lagDays}<span class="meta-item">next day</span>{/if}
                    <span class="meta-item">expected {q.direction}</span>
                    {#if q.retestCount > 0}<span class="meta-item">retested {q.retestCount}×</span>{/if}
                    <!-- Rounded. The stored values are raw doubles and the card
                         was rendering `r -0.11998358323004636`, which reads as
                         precision the measurement does not have. -->
                    {#if q.r != null}<span class="meta-item">r {q.r.toFixed(2)}</span>{/if}
                    {#if q.qValue != null}<span class="meta-item">q {q.qValue.toFixed(3)}</span>{/if}
                    {#if q.pairs != null}<span class="meta-item">n {q.pairs}</span>{/if}
                    <!-- Nothing is filtered by verdict when choosing what to
                         retest, so every answer here is provisional. -->
                    {#if q.retestInDays !== null}
                      <span class="meta-item">{q.retestInDays === 0 ? 'due to be checked again' : `checked again in ${q.retestInDays}d`}</span>
                    {/if}
                    <!-- The family size is shown because a q-value cannot be
                         read without it: q over 4 tests and q over 400 are not
                         the same number. -->
                    {#if q.familySize}
                      <span class="meta-item">corrected across {q.familySize} test{q.familySize === 1 ? '' : 's'}</span>
                    {/if}
                  </div>

                  <div class="card-actions bar">
                    {#if q.feedback}
                      <span class="meta-item good">you said {q.feedback.replace('_', ' ')}</span>
                    {:else}
                      <span class="ask">Worth asking?</span>
                      <button type="button" class="cta" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'useful')}>Yes</button>
                      <button type="button" class="btn" disabled={busy === `q:${q.id}`} onclick={() => rateQ(q, 'not_useful')}>No</button>
                    {/if}
                    <button type="button" class="btn" onclick={() => toggleHypDetail(q.id)}>
                      {hypOpen === q.id ? 'Hide the days' : 'Show the days behind this'}
                    </button>
                  </div>

                  {#if hypOpen === q.id}
                    {@const d = hypDetail[q.id]}
                    <div class="detail">
                      {#if hypDetailError[q.id]}
                        <p class="err">{hypDetailError[q.id]}</p>
                      {:else if !d}
                        <p class="detail-line">Reading the days…</p>
                      {:else}
                        <p class="detail-line">
                          {d.days.length} day{d.days.length === 1 ? '' : 's'} in the window,
                          <b>{d.days.length - d.unusedCount}</b> with both readings present — that
                          count is the n above. Pairwise deletion, never imputation: a day missing
                          either half is dropped rather than filled in.
                          {#if d.lagDays}<br />Lagged: {d.metricA} on a day is paired with {d.metricB} on the next.{/if}
                        </p>
                        <div class="tbl-scroll">
                          <table class="tbl compact">
                            <thead>
                              <tr>
                                <th>Day</th>
                                <th class="right">{d.metricA}</th>
                                <th class="right">{d.metricB}{d.lagDays ? ' (next day)' : ''}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each d.days.filter((x) => x.used).slice(-40).reverse() as row (row.day)}
                                <tr>
                                  <td>{row.day}</td>
                                  <td class="right">{row.a}</td>
                                  <td class="right">{row.b}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                        {#if d.days.length - d.unusedCount > 40}
                          <p class="note">Most recent 40 of {d.days.length - d.unusedCount} shown.</p>
                        {/if}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="lede">
            Every question the engine has ever asked, whose it was, and what the data said back —
            including the ones that came back empty.
          </p>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="C / Lines of enquiry"
          title={['Arcs it decided', 'to pursue']}
          strap="Each earns its keep from the questions inside its metric set — a line that keeps producing nothing is abandoned by arithmetic, not by mood."
        />
        {#if (discoveries?.leads ?? []).length === 0}
          <div class="card t-quiet">
            <p class="card-body">
              No lines of enquiry yet. The ponder engine opens one when a pattern deserves weeks
              rather than a sentence.
            </p>
          </div>
        {:else}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Metrics</th>
                  <th class="right">Score</th>
                  <th class="right">Rounds</th>
                  <th class="right">Held</th>
                  <th class="right">State</th>
                </tr>
              </thead>
              <tbody>
                {#each discoveries?.leads ?? [] as l (l.id)}
                  <tr class:dim={l.status !== 'open'}>
                    <td class="cell-lead">
                      <span class="cell-title">{l.title}</span>
                      <span class="cell-sub">{l.rationale}</span>
                    </td>
                    <td class="cell-wrap">{l.metrics.join(' · ')}</td>
                    <td class="right">{Math.round(l.score * 100) / 100}</td>
                    <td class="right">{l.roundsRun}</td>
                    <td class="right">{l.hypothesesHeld}/{l.hypothesesSpawned}</td>
                    <td class="right"><span class="pill t-{leadTone(l.status)}">{l.status}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="D / The sweep"
          title={['Every pair,', 'every night']}
          strap={discoveries?.sweep ? `Last reported ${ago(String(discoveries.sweep.ts))}` : 'The daily every-pair sweep has not reported yet.'}
        />
        <div class="card t-{discoveries?.sweep ? 'steady' : 'watch'}">
          <p class="card-body">
            {discoveries?.sweep
              ? discoveries.sweep.summary
              : 'Nothing to report. The sweep tests every pair of series it has enough days for, corrects for how many tests that was, and keeps only what survives.'}
          </p>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="E / Digests"
          title={['Every morning', 'card it wrote']}
          strap="{(discoveries?.digests ?? []).length} entries. The Sunday letter shares a day with that day's daily digest by design."
        />
        {#if (discoveries?.digests ?? []).length === 0}
          <div class="card t-quiet"><p class="card-body">No digests yet.</p></div>
        {:else}
          <div class="stack tight">
            <!-- Keyed on subject AND day. The Sunday letter shares a day with
                 that day's daily digest, and keying on the day alone threw
                 `each_key_duplicate` — which does not degrade a row, it kills
                 the component, so the whole tab stopped opening. -->
            {#each discoveries?.digests ?? [] as d (`${d.subject}-${d.day}`)}
              <details class="disclose">
                <summary>
                  <span class="disclose-day">{d.day}</span>
                  {#if d.subject === 'weekly'}<span class="pill t-action">weekly</span>{/if}
                  <span class="disclose-sum">{d.summary}</span>
                </summary>
                {#if d.narrative}
                  <blockquote class="quote" class:unchecked={d.verified === false}>
                    {d.narrative}
                    <span class="quote-tag" class:ok={d.verified === true}>
                      {d.verified === true ? 'model · checked' : 'model · UNCHECKED'}
                    </span>
                  </blockquote>
                {/if}
              </details>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       CALENDAR
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'calendar'}
    <!-- ── THE DIARY, AND WHAT THE ENGINE MAY SEE OF IT ──────────────────
         Your note in August: "some of those calendar events are rolling
         reminders". A standing reminder is a real event and a fictional
         commitment at once, and nothing in the data separates them — so this
         is the control that does. -->
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / The diary"
          title={['What it may', 'reason about']}
          strap="A standing reminder is a real event and a fictional commitment at once, and nothing in the data separates them. This is the control that does."
        />
        <CalendarBoard onchanged={() => invalidateAll()} />
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       PLACES
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'places'}
    {#if !unnamed.length && !quietUnnamed && !named.length}
      <section class="band">
        <div class="inner">
          <SectionHead kicker="A / Places" title={['Nothing has', 'a name yet']} strap="Places emerge from the household trail — one stay of ten minutes makes a place, three separate days makes a question." />
          <div class="card t-quiet">
            <p class="card-body">
              No places yet.
              {#if transitPlaces}
                {transitPlaces} {transitPlaces === 1 ? 'cluster is' : 'clusters are'} set aside as
                transit — points the trail passes through rather than stops at.
              {/if}
            </p>
          </div>
        </div>
      </section>
    {/if}

    <!-- ── UNNAMED PLACES ──────────────────────────────────────────────
         First on the tab on purpose. Several detectors are inert until a place
         has a name, so this is the highest-leverage thing on the whole hub. -->
    {#if unnamed.length || quietUnnamed}
      <section class="band" id="dd-unnamed">
        <div class="inner">
          <SectionHead
            kicker="A / What is this place?"
            title={['A name turns', 'a dot into a fact']}
            strap="Several detectors stay silent until a place has one. A page you opened is attention you offered, so naming thirty here costs none of the interruption budget four-a-day protects."
          >
            {#snippet aside()}
              {#if !sessionOpen}
                <button type="button" class="cta" onclick={openSession}>
                  Name them in one go — {counts.unnamedPlaces} waiting
                </button>
              {:else}
                {#if draftCount}
                  <button type="button" class="cta" disabled={sessionSaving} onclick={saveSession}>
                    {sessionSaving ? 'Saving…' : `Save ${draftCount} name${draftCount === 1 ? '' : 's'}`}
                  </button>
                {/if}
                <button type="button" class="btn" onclick={() => { sessionOpen = false; }}>Close the session</button>
              {/if}
            {/snippet}
          </SectionHead>

          <p class="lede">
            Each one arrives with a suggested name and address the background geocoder wrote hours
            ago — the difference between a confirmation and a memory test.
            {#if transitPlaces}
              {transitPlaces} more {transitPlaces === 1 ? 'cluster is' : 'clusters are'} set aside as
              transit — never asked about.
            {/if}
            {#if quietUnnamed}
              {quietUnnamed} of them {quietUnnamed === 1 ? 'has' : 'have'} been visited on fewer than
              {askAtVisits} separate days, so {quietUnnamed === 1 ? 'it is' : 'they are'} never
              interrupted about — but {quietUnnamed === 1 ? 'it is' : 'they are'} in the session.
            {/if}
          </p>

          {#if sessionDone}
            <p class="note good">
              Named {sessionDone.named}{sessionDone.failed ? `, ${sessionDone.failed} failed` : ''}.
              {#if sessionDone.thoughtsResolved}
                Closed {sessionDone.thoughtsResolved} open question{sessionDone.thoughtsResolved === 1 ? '' : 's'}.
              {/if}
            </p>
          {/if}
          {#if sessionError}<p class="err">{sessionError}</p>{/if}

          {#if sessionOpen}
            {#if sessionLoading}
              <p class="lede">Loading the queue…</p>
            {:else if sessionQueue.length === 0}
              <p class="lede">Nothing left unnamed.</p>
            {:else}
              <div class="stack tight">
                {#each sessionQueue as q (q.id)}
                  {@const draft = drafts[q.id]}
                  <div class="card t-{draft && draft.label.trim() ? 'good' : 'action'} row">
                    <div class="row-id">
                      <p class="card-kicker">{q.rhythm}</p>
                      {#if q.suggestedAddress}
                        <p class="card-body sm">{q.suggestedAddress}</p>
                      {:else}
                        <p class="card-body sm dim">no address found for this spot</p>
                      {/if}
                    </div>
                    <div class="row-controls">
                      {#if !draft && q.suggestedLabel}
                        <button type="button" class="cta" onclick={() => acceptSuggestion(q)}>
                          {q.suggestedLabel}{q.suggestedKind ? ` · ${q.suggestedKind}` : ''}
                        </button>
                        <button type="button" class="btn" onclick={() => editDraft(q, 'label', '')}>Something else</button>
                      {:else}
                        <input
                          class="text-input"
                          value={draft?.label ?? ''}
                          placeholder={q.suggestedLabel ?? 'What is it called?'}
                          oninput={(e) => editDraft(q, 'label', e.currentTarget.value)}
                        />
                        <select
                          class="text-input select"
                          value={draft?.kind ?? q.suggestedKind ?? 'other'}
                          onchange={(e) => editDraft(q, 'kind', e.currentTarget.value)}
                        >
                          {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
                        </select>
                        {#if draft}
                          <button type="button" class="btn" onclick={() => clearDraft(q.id)}>Skip</button>
                        {/if}
                      {/if}
                      <button
                        type="button"
                        class="btn danger"
                        disabled={busy === `ignore:${q.id}`}
                        onclick={() => post({ action: 'ignore_place', placeId: q.id }, `ignore:${q.id}`)}
                      >Never ask</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="controls">
              <FacetBar label="Order" active={placeOrder} facets={placeOrderFacets} onpick={(id) => (placeOrder = id as PlaceOrder)} />
            </div>

            <div class="stack tight">
              {#each unnamedOrdered as p (p.id)}
                <div class="card t-{placeTone(p, askAtVisits)} row">
                  <div class="row-id">
                    <!-- The geocoder's guess, marked as a guess. Without it every
                         card in this list reads "somewhere you stop" and the
                         question is a memory test rather than a confirmation. -->
                    <p class="card-title as-text">
                      {p.suggestedLabel ?? p.suggestedAddress ?? 'Somewhere you stop'}
                    </p>
                    <p class="card-kicker">
                      {rhythm(p)}{p.suggestedLabel ? ' · suggested, check it' : ''}
                    </p>
                  </div>
                  {#if namingPlace !== p.id}
                    <div class="row-controls">
                      <button type="button" class="cta" onclick={() => openNaming(p)}>Name it</button>
                      <button
                        type="button"
                        class="btn danger"
                        disabled={busy === `ignore:${p.id}`}
                        onclick={() => post({ action: 'ignore_place', placeId: p.id }, `ignore:${p.id}`)}
                      >Stop asking</button>
                    </div>
                  {/if}

                  {#if namingPlace === p.id}
                    <div class="detail wide">
                      <PlaceMap lat={p.lat} lon={p.lon} radiusM={p.radiusM} />
                      <p class="note">
                        {#if suggesting}
                          Looking up what is there…
                        {:else if suggestion?.address}
                          {suggestion.address}
                          {#if suggestion.name}<span class="dim"> · suggested, check it</span>{/if}
                        {:else}
                          No address found for this spot — the map is the better guide.
                        {/if}
                      </p>
                      {#if visits.length}
                        <div class="detail-block">
                          <p class="field-label">Who was here, and when</p>
                          <div class="tbl-scroll">
                            <table class="tbl compact">
                              <thead><tr><th>Who</th><th>Day</th><th>Date</th><th class="right">At</th><th class="right">Stayed</th></tr></thead>
                              <tbody>
                                {#each visits as v (v.startedAt + v.subject)}
                                  <tr>
                                    <td>{cap(v.subject)}</td>
                                    <td>{v.dayName}</td>
                                    <td>{v.dateLabel}</td>
                                    <td class="right">{v.timeLabel}</td>
                                    <td class="right">{v.dwellMins} min</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      {/if}
                      <div class="row-controls">
                        <input
                          class="text-input"
                          bind:value={placeLabel}
                          placeholder="What is it called?"
                          onkeydown={(e) => { if (e.key === 'Enter') submitName(p.id); }}
                        />
                        <select class="text-input select" bind:value={placeKind}>
                          {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
                        </select>
                        <button
                          type="button"
                          class="cta"
                          disabled={busy === `name:${p.id}` || !placeLabel.trim()}
                          onclick={() => submitName(p.id)}
                        >Save</button>
                        <button type="button" class="btn" onclick={() => { namingPlace = null; placeLabel = ''; suggestion = null; }}>Cancel</button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <!-- ── NAMED PLACES ────────────────────────────────────────────────── -->
    {#if named.length}
      <section class="band sunken">
        <div class="inner">
          <SectionHead
            kicker="B / Named"
            title={['Ground it', 'already knows']}
            strap="A named place is quoted back as fact, so it is only ever written from your answer — never from the geocoder's guess."
          />
          <div class="controls">
            <FacetBar label="Order" active={placeOrder} facets={placeOrderFacets} onpick={(id) => (placeOrder = id as PlaceOrder)} />
          </div>
          <div class="tbl-scroll">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Kind</th>
                  <th>Rhythm</th>
                  <th class="right">Days</th>
                  <th class="right">In memory</th>
                </tr>
              </thead>
              <tbody>
                {#each namedOrdered as p (p.id)}
                  <tr>
                    <td class="cell-lead"><span class="cell-title">{p.label}</span></td>
                    <td>{p.kind}</td>
                    <td class="cell-wrap">{rhythm(p)}</td>
                    <td class="right">{p.distinctDays}</td>
                    <td class="right">
                      <span class="pill t-{p.hasMemory ? 'good' : 'watch'}">{p.hasMemory ? 'yes' : 'no'}</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    {/if}
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       MONEY
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'money'}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / Evidenced spend"
          title={['Only what', 'left a receipt']}
          strap="Receipts{money?.bank.enabled ? ' and the nightly bank pull' : ''}, deduped on the transaction id. It understates cash and always will — nothing here is a budget."
        />
        <StatDeck tiles={moneyTiles} min={220} />

        {#if (money?.byDay ?? []).length >= 2}
          <div class="chart">
            <Sparkline
              points={(money?.byDay ?? []).map((d) => ({ label: d.day, value: d.minor / 100 }))}
              format={(v) => `£${v.toFixed(2)}`}
              height={64}
            />
          </div>
        {/if}

        {#if (money?.topMerchants ?? []).length}
          <div class="chips">
            {#each money?.topMerchants ?? [] as m (m.merchant)}
              <span class="chip-stat"><b>{pounds(m.minor)}</b> {m.merchant}</span>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead kicker="B / Recent" title={['Every verified', 'row']} strap="Nothing on this table was inferred; each row came from a receipt or a bank line with an id behind it." />
        {#if (money?.rows ?? []).length === 0}
          <div class="card t-quiet">
            <p class="card-body">
              Nothing verified yet. Receipts land as they arrive by email{money?.bank.enabled ? ' and from the bank overnight' : ''}.
            </p>
          </div>
        {:else}
          <div class="controls">
            <FacetBar label="Order" active={moneyOrder} facets={moneyOrderFacets} onpick={(id) => (moneyOrder = id as MoneyOrder)} />
          </div>
          <div class="tbl-scroll">
            <table class="tbl">
              <thead><tr><th>Day</th><th>Merchant</th><th class="right">Amount</th><th class="right">Via</th></tr></thead>
              <tbody>
                {#each moneyRows as r (r.id)}
                  <tr>
                    <td>{r.day}</td>
                    <td class="cell-lead">{r.merchant}</td>
                    <td class="right num">{pounds(r.amountMinor)}</td>
                    <td class="right">{r.source}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead kicker="C / Coming up" title={['Dates found', 'in the post']} strap="Renewals and appointments pulled out of email, next 60 days. Read as a prompt, not a diary — the diary is on the Calendar tab." />
        {#if (money?.renewals ?? []).length === 0}
          <div class="card t-quiet"><p class="card-body">No dated events found in recent email.</p></div>
        {:else}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead><tr><th>Date</th><th>Type</th><th>What</th></tr></thead>
              <tbody>
                {#each money?.renewals ?? [] as r (r.id)}
                  <tr><td class="nowrap">{r.date}</td><td>{r.type}</td><td class="cell-lead">{r.title}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead kicker="D / Offers" title={['Money left', 'on the table']} strap="Expiring first. Extracted from email and never acted on — the engine has no permission to spend anything." />
        {#if (money?.offers ?? []).length === 0}
          <div class="card t-quiet"><p class="card-body">No live offers.</p></div>
        {:else}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead><tr><th>Expires</th><th>Merchant</th><th>Offer</th><th class="right">Code</th></tr></thead>
              <tbody>
                {#each money?.offers ?? [] as o (o.id)}
                  <tr>
                    <td class="nowrap">{o.expiresAt ? String(o.expiresAt).slice(0, 10) : 'no expiry'}</td>
                    <td class="cell-lead">{o.merchant}</td>
                    <td class="cell-wrap">{o.summary}</td>
                    <td class="right">{o.code ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band" id="dd-bank">
      <div class="inner">
        <SectionHead
          kicker="E / Bank rails"
          title={['The nightly', 'debits pull']}
          strap="TrueLayer and PayPal, debits only, deduped on the transaction id and written into the same table the email receipt reader uses — so everything downstream reads one set of numbers."
        >
          {#snippet aside()}
            <button
              type="button"
              class={money?.bank.enabled ? 'btn danger' : 'cta'}
              disabled={bankBusy}
              onclick={toggleBank}
            >
              {bankBusy ? 'Saving…' : money?.bank.enabled ? 'Turn the rails off' : 'Arm the rails'}
            </button>
          {/snippet}
        </SectionHead>

        <!-- A job that has only ever skipped looks identical to a job that ran
             and found nothing, unless the page says when it is next due and
             whether that moment is inside its own window. daydream-bank sat in
             exactly that state for three days and the only clue was a pulse
             summary. -->
        <div class="card t-{money?.bank.enabled ? (money?.bank.willSkip ? 'watch' : 'good') : 'quiet'}">
          <p class="card-kicker">{money?.bank.enabled ? 'Armed' : 'Off'}</p>
          <p class="card-body">
            {#if money?.bank.enabled}
              Pulling nightly.
              {#if money?.bank.lastRun}Last run: {money.bank.lastRun.summary}{/if}
              It fails loudly rather than quietly if the TrueLayer token has gone stale.
            {:else}
              Off. Arming it starts the nightly pull; nothing is read until you do.
            {/if}
          </p>
          <div class="card-meta">
            {#if money?.bank.window}<span class="meta-item">window {money.bank.window}</span>{/if}
            {#if money?.bank.nextRunAt}
              <span class="meta-item">next {new Date(money.bank.nextRunAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</span>
            {/if}
            {#if money?.bank.willSkip}
              <span class="meta-item warn">that lands outside the window — it will skip</span>
            {/if}
          </div>
          {#if bankError}<p class="err">{bankError}</p>{/if}
        </div>
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       IMPROVEMENT
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'improvement'}
    <!-- ── IS THE LOOP CLOSING? ─────────────────────────────────────────
         The scoreboard for folding self-improvement into daydreaming. Two
         dashboards showed a great deal about that engine — runs, phases,
         budget, generated code — and neither showed whether anything it built
         was ever used. On the day the merge started: 33 tools shipped in a
         fortnight, none ever called. -->
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / Is the loop closing?"
          title={['What it built,', 'and what it used']}
          strap="Two dashboards showed everything about the self-improvement engine except whether a single thing it built was ever called. On the day this merged: 33 tools shipped, none used."
        />
        <LoopScoreboard health={data.loop} verdict={data.loopVerdict} />
      </div>
    </section>
  {/if}

  <!-- ══════════════════════════════════════════════════════════════════════
       ENGINE
       ═══════════════════════════════════════════════════════════════════ -->
  {#if tab === 'engine'}
    <!-- ── WHAT IS ACTUALLY REACHING THE REASONING ───────────────────────
         Thirteen green jobs and 242 registered signals say nothing about
         whether any of it reaches the part that draws conclusions. On the day
         this was written, 185 Home Assistant sensors were registered and NONE
         were in the sweep — they had 2 observed days against a 14-day floor —
         and nothing on the page said so. -->
    <section class="band" id="dd-provenance">
      <div class="inner">
        <SectionHead
          kicker="A / What reaches the reasoning"
          title={['Registered is not', 'the same as used']}
          strap="A series joins the sweep only once it has {provenance.minPairs} observed days, and the proposer may only ask about a fixed vocabulary — so a sensor can be recording, correlating and still never be the subject of a question."
        />
        <p class="lede">
          {provenance.sweepable} of {provenance.registered} registered signals are in the sweep.
          Nothing below is asserted; each line carries the measurement behind it, and a path closed
          on purpose is drawn differently from one that is broken.
        </p>

        {#if provenance.sources.length === 0}
          <div class="card t-quiet"><p class="card-body">Nothing measured yet.</p></div>
        {:else}
          <div class="stack">
            {#each provenance.sources as src (src.key)}
              <div class="card t-steady">
                <div class="card-hd">
                  <p class="card-title as-text">{src.label}</p>
                  <span class="pill t-steady">{src.summary}</span>
                </div>
                <p class="card-body">{src.blurb}</p>
                <div class="tbl-scroll">
                  <table class="tbl compact">
                    <thead><tr><th>State</th><th>Reaches</th><th>Measurement</th></tr></thead>
                    <tbody>
                      {#each src.links as l, li (li)}
                        <tr>
                          <td class="nowrap">
                            <span class="pill t-{provenanceTone(l.state)}">
                              {l.state === 'by_design' ? 'not wired' : l.state}
                            </span>
                          </td>
                          <td class="cell-lead">{l.to}</td>
                          <td class="cell-wrap">{l.detail}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- ── ENGINE STATE ─────────────────────────────────────────────────
         Everything else is meaningless if the engine has not run, and "quiet"
         and "not wired up" have to be tellable apart. -->
    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="B / Engine state"
          title={['Has it actually', 'been running?']}
          strap={hasRun ? `Last looked ${ago(engine.lastDetectAt)}.` : 'It has never run. Everything below is therefore a zero about the engine, not about your life.'}
        >
          {#snippet aside()}
            <button type="button" class="btn" disabled={backfilling} onclick={runBackfill}>
              {backfilling ? 'Pulling history…' : 'Backfill from Home Assistant'}
            </button>
          {/snippet}
        </SectionHead>

        <StatDeck tiles={engineTiles} min={210} />

        {#if engine.summary}<p class="lede">{engine.summary}</p>{/if}
        {#if backfillNote}<p class="note good">{backfillNote}</p>{/if}

        {#if engine.pausedActions.length}
          <div class="card t-watch">
            <p class="card-kicker">Not running</p>
            <p class="card-body">{engine.pausedActions.join(', ')}</p>
          </div>
        {/if}

        {#if engine.sources.some((s) => s.status === 'failed')}
          <div class="card t-urgent">
            <p class="card-kicker">Sources that failed last tick</p>
            <p class="card-body">
              {engine.sources.filter((s) => s.status === 'failed').map((s) => `${s.key} (${s.detail})`).join('; ')}
            </p>
          </div>
        {/if}

        {#if delivery?.hasWhatsApp}
          <div class="card t-good">
            <p class="card-kicker">Delivery</p>
            <p class="card-body">
              Over <strong>WhatsApp</strong> — reply 👍 / 👎 / “never” to any thought within 12 hours
              and it counts as feedback.
            </p>
          </div>
        {:else if delivery && !delivery.hasPushSubscriber}
          <!-- The documented root cause of the empty feedback ledger: with
               nowhere to push, every thought falls back to a chat note whose
               feedback link is rarely followed, so the learning loop never gets
               an input. -->
          <div class="card t-urgent">
            <p class="card-kicker">Nowhere to deliver</p>
            <p class="card-body">
              No WhatsApp number and no push subscriber, so thoughts fall back to chat notes — and
              without feedback the confidence threshold never relaxes. The sorting deck on the Feed
              tab is the way round it.
            </p>
          </div>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="C / Budget"
          title={['What thinking', 'is allowed to cost']}
          strap={budget ? `Running ${budget.modelId}.` : 'Could not read the model or the usage meter.'}
        />

        {#if !budget}
          <div class="card t-urgent"><p class="card-body">Could not read the model or the usage meter.</p></div>
        {:else if !budget.applies}
          <div class="card t-steady">
            <p class="card-body">
              Running on <strong>{budget.provider}</strong>, so the subscription caps do not apply —
              this spend is cash, and nothing here limits it.
            </p>
          </div>
        {:else}
          <StatDeck tiles={budgetTiles} min={230} />
          {#if budget.blocked}
            <div class="card t-urgent">
              <p class="card-kicker">Paused</p>
              <p class="card-body">{budget.blockedReason}</p>
            </div>
          {:else if !budget.reachable}
            <div class="card t-watch">
              <p class="card-kicker">Usage meter unreachable</p>
              <p class="card-body">Working at minimum depth rather than stopping.</p>
            </div>
          {/if}
          <p class="lede">
            Spare budget buys more <strong>thinking</strong>, never more notifications: extra
            headroom adds a verification pass and more candidates considered. What reaches your
            phone is capped separately at {delivery?.maxPerDay ?? 4} a day.
          </p>
        {/if}
      </div>
    </section>

    <!-- ── MODEL-AUTHORED RULES ─────────────────────────────────────────
         The mesh. The model writes the rule; deterministic code evaluates it;
         nothing fires until it is approved here. A proposal has already passed
         validation and a backtest by the time it appears. -->
    {#if proposedRules.length || activeRules.length}
      <section class="band sunken" id="dd-rules">
        <div class="inner">
          <SectionHead
            kicker="D / Rules jkai wrote"
            title={['Proposed as data,', 'never as code']}
            strap="A condition over a fixed list of facts. Each is validated and replayed against your history before it reaches you, and nothing fires until you approve it."
          />

          {#if proposedRules.length}
            <div class="stack">
              {#each proposedRules as r (r.id)}
                <article class="card t-action">
                  <div class="card-hd">
                    <p class="card-title as-text">{r.spec?.description ?? r.kind}</p>
                    <span class="pill t-action">{r.proposalKind}</span>
                  </div>
                  <p class="card-body">{r.rationale}</p>
                  <div class="card-meta">
                    <span class="tag">{r.kind}</span>
                    <span class="meta-item">{r.backtestNote ? r.backtestNote : 'not backtested'}</span>
                  </div>
                  {#if r.backtestLowerBound}
                    <p class="note warn">
                      Estimate is a floor, not a count — the replay could not rebuild every fact this
                      rule uses, so it will fire more often than shown.
                    </p>
                  {/if}
                  <div class="card-actions bar">
                    <button type="button" class="cta" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'approve' }, `rule:${r.id}`)}>
                      Approve
                    </button>
                    <button type="button" class="btn danger" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'reject' }, `rule:${r.id}`)}>
                      Reject
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}

          {#if activeRules.length}
            <div class="tbl-scroll">
              <table class="tbl">
                <thead>
                  <tr><th>Rule</th><th>What it says</th><th class="right">Fired</th><th class="right">Votes</th><th class="right">Do</th></tr>
                </thead>
                <tbody>
                  {#each activeRules as r (r.id)}
                    <tr>
                      <td class="nowrap">{r.kind}</td>
                      <td class="cell-lead">{r.spec?.description ?? ''}</td>
                      <td class="right">{r.firedCount}</td>
                      <td class="right nowrap">{r.usefulCount}↑ {r.notUsefulCount}↓</td>
                      <td class="right">
                        <button type="button" class="btn danger" disabled={busy === `rule:${r.id}`} onclick={() => post({ action: 'decide_rule', ruleId: r.id, decision: 'deprecate' }, `rule:${r.id}`)}>
                          Retire
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <!-- ── DETECTORS ────────────────────────────────────────────────────
         Every detector appears, ready or not. One missing would be
         indistinguishable from one that is merely quiet — the same conflation
         the readiness gate exists to prevent. -->
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="E / Detectors"
          title={['What each one', 'is waiting for']}
          strap="Each declares the history it needs before it may speak and returns nothing below that. A weight of 1.00 means the ledger has no opinion about it yet."
        />
        <div class="controls">
          <FacetBar label="State" active={detState} facets={detStateFacets} onpick={(id) => (detState = id as DetState)} />
          <FacetBar label="Order" active={detOrder} facets={detOrderFacets} onpick={(id) => (detOrder = id as DetOrder)} />
        </div>

        {#if detectorRows.length === 0}
          <div class="card t-quiet"><p class="card-body">No detector is in that state.</p></div>
        {:else}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Detector</th>
                  <th>What it looks for</th>
                  <th>State</th>
                  <th class="right">Weight</th>
                  <th class="right">Votes</th>
                  <th class="right">Do</th>
                </tr>
              </thead>
              <tbody>
                {#each detectorRows as d (d.kind)}
                  <tr class:dim={d.muted}>
                    <td class="nowrap">{d.kind}</td>
                    <td class="cell-lead cell-wrap">{d.description}</td>
                    <td>
                      <span class="pill t-{detectorTone(d)}">
                        {d.muted ? 'muted' : d.readiness?.ready ? 'ready' : (d.readiness?.reason ?? 'not yet assessed')}
                      </span>
                    </td>
                    <td class="right num" title="Learned multiplier from your feedback">×{d.weight.toFixed(2)}</td>
                    <td class="right nowrap">{d.useful || d.notUseful ? `${d.useful}↑ ${d.notUseful}↓` : '—'}</td>
                    <td class="right">
                      {#if d.muted}
                        <button type="button" class="btn" disabled={busy === `unmute:${d.kind}`} onclick={() => post({ action: 'unmute_kind', kind: d.kind }, `unmute:${d.kind}`)}>
                          Un-mute
                        </button>
                      {:else}
                        <span class="dim">—</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead kicker="F / Coverage" title={['How much of', 'each day it saw']} strap="Thirty days. A low figure is a phone that stopped reporting, not a day nobody moved — the two are the same shape in the data and only this line separates them." />
        {#if (telemetry?.coverage ?? []).length >= 2}
          <div class="chart">
            <Sparkline
              points={(telemetry?.coverage ?? []).map((c) => ({ label: c.day, value: c.coverage }))}
              max={1}
              format={(v) => `${Math.round(v * 100)}%`}
              height={72}
            />
          </div>
        {:else}
          <div class="card t-quiet"><p class="card-body">Not enough day rows yet.</p></div>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="G / Ponder telemetry"
          title={['The fabrication', 'meter']}
          strap="“Audit dropped” counts musings deleted for citing evidence that does not exist. A rising number means the model is reaching; zero means the wide view is holding."
        />
        {#if (telemetry?.ponderRuns ?? []).length === 0}
          <div class="card t-quiet"><p class="card-body">No ponder cycles yet.</p></div>
        {:else}
          <div class="tbl-scroll">
            <table class="tbl">
              <thead>
                <tr><th>When</th><th class="right">Cards in</th><th class="right">Musings</th><th class="right">Kept</th><th class="right">Held</th><th class="right">Audit dropped</th><th class="right">Leads</th></tr>
              </thead>
              <tbody>
                {#each telemetry?.ponderRuns ?? [] as r (String(r.ts))}
                  <tr>
                    <td class="nowrap">{ago(String(r.ts))}</td>
                    <td class="right num">{r.cards ?? '—'}</td>
                    <td class="right num">{r.proposed ?? '—'}</td>
                    <td class="right num">{r.created ?? '—'}</td>
                    <td class="right num">{r.suppressed ?? '—'}</td>
                    <td class="right num" class:bad={(r.dropped ?? 0) > 0}>{r.dropped ?? '—'}</td>
                    <td class="right num">{r.leads ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <section class="band sunken" id="dd-jobs">
      <div class="inner">
        <SectionHead
          kicker="H / Jobs"
          title={['Every scheduled', 'pass, and its last word']}
          strap="A job that has only ever skipped looks exactly like a job that ran and found nothing. The outcome column is the difference, and a failing streak outranks everything else on this page."
        />
        <div class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr><th>Job</th><th>Every</th><th>Last outcome</th><th>Said</th></tr>
            </thead>
            <tbody>
              {#each jobRows as j (j.name)}
                <tr>
                  <td class="nowrap">{j.name.replace('daydream-', '')}</td>
                  <td class="nowrap">{cadence(j.cadenceSeconds)}</td>
                  <td class="nowrap">
                    <span class="pill t-{jobTone(j)}">{j.pulse ? j.pulse.outcome : 'never'}</span>
                    <span class="meta-item">{j.pulse ? ago(String(j.pulse.ts)) : ''}</span>
                  </td>
                  <td class="cell-lead cell-wrap">{j.pulse?.summary ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  {/if}
</DaydreamShell>

<style>
  /* ══ The daydream hub, in the /health editorial system ═══════════════════
     Radii 0 (pills 100 only), no shadows, no springs, 12px mono floor. Colour
     is PRIORITY, not category: every card, pill and tag reads its hue from one
     `--tone` set by the `t-*` class the page put on it, and those classes come
     from `$lib/daydream/priority.ts` rather than from whatever word the
     database happened to store.

     jkai keeps its own reading face (Selawik/Segoe) — see the type scope in
     app.css. `--font-display` and `--font-mono` are unchanged inside jkai, so
     the editorial voice carries without touching the body token. */

  /* ——— bands ————————————————————————————————————————————————————— */

  .band {
    padding: clamp(28px, 3.4vw, 52px) clamp(18px, 3vw, 44px);
    border-top: 1px solid var(--line-hair);
    /* The tab rail is sticky, so anything scrolled to by the action queue would
       land underneath it without this. */
    scroll-margin-top: 60px;
  }
  .band.sunken {
    background: var(--bg-section);
  }
  .band.attn {
    border-top: 0;
    border-bottom: 2px solid var(--text-primary);
  }
  .inner {
    max-width: 1500px;
    margin: 0 auto;
    min-width: 0;
  }

  /* ——— type ————————————————————————————————————————————————————— */

  .lede {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 90ch;
    text-wrap: pretty;
    margin: 0 0 20px;
  }
  .note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    max-width: 96ch;
    margin: 12px 0 0;
  }
  .note.warn {
    color: var(--warn);
  }
  .note.good {
    color: var(--good);
  }
  .err {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.05em;
    color: var(--error);
    margin: 12px 0 0;
  }
  .field-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }
  .dim {
    color: var(--text-ghost);
  }
  .link {
    color: var(--accent);
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }

  /* ——— controls ————————————————————————————————————————————————— */

  .controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0 20px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 22px;
  }

  .cta,
  .btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 16px;
    border-radius: 0;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  /* The primary. Solid, so there is never a question which button does the
     thing the section is about. */
  .cta {
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
  }
  .cta:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn {
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
  }
  .btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .btn.danger:hover:not(:disabled) {
    border-color: var(--error);
    color: var(--error);
  }
  /* A verdict already cast, in a deck where the row stays editable. */
  .btn.picked {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .btn.danger.picked {
    background: var(--error);
    border-color: var(--error);
    color: var(--bg);
  }
  .cta:disabled,
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cta:focus-visible,
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .text-input {
    font-family: var(--font-body);
    /* 16px, not smaller: mobile Safari force-zooms the viewport on a sub-16px
       field and strands the rest of the form off-screen. */
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 9px 12px;
    min-width: 0;
    flex: 1 1 220px;
  }
  .text-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .text-input.area {
    width: 100%;
    resize: vertical;
    line-height: 1.5;
  }
  .text-input.select {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    text-transform: lowercase;
  }

  .steer-row {
    margin-bottom: 22px;
  }
  .steer-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  /* ——— cards ———————————————————————————————————————————————————
     One shape, six tones. The left rule is the whole colour system: a 3px
     stripe in `--tone`, which is also the kicker and the pill. */

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .stack.tight {
    gap: 8px;
  }

  /* ——— the board ————————————————————————————————————————————————
     Three columns of cards, which is what the feed always was: a set of
     unrelated observations to triage, not a document to read top to bottom.
     One column meant scrolling a thousand pixels to find out whether there
     were four things or forty.

     `align-items: start` matters — without it every card in a row stretches to
     the tallest, so one long explanation gives two neighbours a foot of empty
     paper. Cards are their own height and the row is ragged, which is correct
     for a board and wrong for a table. */
  .board {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: 14px;
  }
  /* An open card takes the whole row. The detail carries a map, an evidence
     list, a components table and a note box, and none of them survive a 320px
     column — so the card that is being read stops being a column. */
  .board > .card.open {
    grid-column: 1 / -1;
  }
  @media (max-width: 1200px) {
    .board {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 820px) {
    .board {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* ——— quick actions ————————————————————————————————————————————
     A row of small square chips on the card FACE. These used to live inside
     the expand, or in a bar that only rendered for a thought that had actually
     been delivered — which is why the ledger has thousands of rows and a few
     dozen verdicts: an opinion cost two clicks and a scroll.

     Deliberately smaller and quieter than `.cta`. There are up to seven of
     them on a card and thirty cards on a board; at CTA weight the page would
     be a wall of orange and nothing would read as primary. */
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line-hair);
  }
  .q {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .q:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .q:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .q:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* The one that endorses, and the one that spends. Filled, because those two
     are the actions with consequences — a vote weaves into the graph and a
     review costs an xhigh model pass. */
  .q.good {
    border-color: var(--good);
    color: var(--good);
  }
  .q.good:hover:not(:disabled) {
    background: var(--good);
    border-color: var(--good);
    color: var(--bg);
  }
  .q.model {
    border-color: var(--accent);
    color: var(--accent);
  }
  .q.model:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
  .q.link {
    border-style: dashed;
    color: var(--accent-ink);
    border-color: var(--accent-ink-tint-35);
  }
  .q.link:hover {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .q-ext {
    margin-left: 4px;
    opacity: 0.7;
  }
  /* No `margin-left: auto` here. In a 320px column this row wraps, and an
     auto margin then strands "Why" alone on a line of its own, right-aligned —
     which it did on three cards out of four. It reads as the last item in the
     row, so it should simply BE the last item in the row. */
  .q.more {
    color: var(--text-ghost);
    border-style: dotted;
  }

  .card-map {
    margin-top: 12px;
  }

  .card {
    --tone: var(--accent-ink);
    position: relative;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone);
    border-radius: 0;
    padding: 18px 20px;
    min-width: 0;
  }
  .card.t-urgent {
    --tone: var(--error);
    background: var(--error-bg);
  }
  .card.t-action {
    --tone: var(--accent);
    background: var(--accent-tint-04);
  }
  .card.t-watch {
    --tone: var(--warn);
  }
  .card.t-good {
    --tone: var(--good);
  }
  .card.t-steady {
    --tone: var(--accent-ink);
  }
  .card.t-quiet {
    --tone: var(--text-ghost);
    background: transparent;
  }
  .card.open {
    border-color: var(--tone);
  }
  .card.ruled {
    opacity: 0.72;
  }

  /* The naming rows and the session rows: identity on the left, the controls
     that act on it on the right, wrapping to two lines on a phone. */
  .card.row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .row-id {
    min-width: 0;
    flex: 1 1 320px;
  }
  .row-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .card-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone, var(--text-muted));
    margin: 0 0 10px;
  }

  .card-title.as-text {
    cursor: default;
  }
  .card-title {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1.15;
    letter-spacing: -0.01em;
    text-align: left;
    color: var(--text-primary);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    min-width: 0;
    transition: color var(--t-fast) var(--ease-out);
  }
  .card-title:hover {
    color: var(--accent);
  }
  .card-title:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* Same type, no affordance — a heading that opens nothing. */
  .card-title.as-text {
    cursor: default;
  }
  .card-title.as-text:hover {
    color: var(--text-primary);
  }

  /* The one big number a card is allowed. */
  .card-figure {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--tone);
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }
  .card-figure.sm {
    font-size: 22px;
  }

  .card-body {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 0;
  }
  .card-body.lead {
    color: var(--text-primary);
  }
  .card-body.sm {
    font-size: var(--fs-nav);
  }
  .card-body + .card-body {
    margin-top: 10px;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 8px 14px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-top: 14px;
  }
  .meta-item.warn {
    color: var(--warn);
  }
  .meta-item.good {
    color: var(--good);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  /* The rating bar: a rule above it, because it is a different act from
     reading the card. */
  .card-actions.bar {
    padding-top: 14px;
    border-top: 1px solid var(--line-hair);
  }
  .ask {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: 4px;
  }

  /* ——— pills and tags ——————————————————————————————————————————— */

  .pill {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 3px 10px;
    border: 1px solid currentcolor;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .pill.t-urgent {
    color: var(--error);
  }
  .pill.t-action {
    color: var(--accent);
    background: var(--accent-tint-08);
  }
  .pill.t-watch {
    color: var(--warn);
  }
  .pill.t-good {
    color: var(--good);
  }
  .pill.t-steady {
    color: var(--accent-ink);
  }
  .pill.t-quiet {
    color: var(--text-ghost);
  }

  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .tag.accent {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .tag.t-action {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .tag.t-watch {
    border-color: var(--warn-border);
    color: var(--warn);
  }
  .tag.t-steady {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
  }

  /* ——— quotes and reviews ——————————————————————————————————————
     The model's phrasing is always shown AS the model's, and an unchecked one
     is drawn differently from a checked one — a composer that has quietly
     started refusing everything looks exactly like a quiet week otherwise. */

  .quote {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-primary);
    background: var(--accent-ink-tint-06);
    border-left: 2px solid var(--accent-ink);
    border-radius: 0;
    padding: 14px 16px;
    margin: 14px 0 0;
    text-wrap: pretty;
  }
  .quote.unchecked {
    background: var(--warn-bg);
    border-left-color: var(--warn);
  }
  .quote-tag {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--warn);
    margin-top: 10px;
  }
  .quote-tag.ok {
    color: var(--good);
  }

  .review {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    font-size: var(--fs-nav);
    line-height: 1.55;
    border-top: 1px solid var(--line-hair);
    padding-top: 12px;
    margin: 14px 0 0;
    color: var(--text-secondary);
  }
  .review-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .review.r-verified .review-tag {
    color: var(--good);
  }
  .review.r-refuted .review-tag {
    color: var(--error);
  }
  .review-p {
    margin-left: 6px;
    opacity: 0.75;
  }
  /* A ruling with a memory behind it changes what gets said next; one without
     changes nothing. The page must not let those look the same. */
  .review-mem {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--good);
    white-space: nowrap;
  }
  .review-why {
    min-width: 0;
  }

  .cue {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 12px 0 0;
  }

  /* ——— the expanded detail ——————————————————————————————————————— */

  .detail {
    border-top: 1px solid var(--line-hair);
    margin-top: 16px;
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .detail.wide {
    flex-basis: 100%;
    width: 100%;
  }
  .detail-block {
    min-width: 0;
  }
  .detail-line {
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 92ch;
    text-wrap: pretty;
    margin: 0 0 8px;
  }
  .detail-line.said {
    color: var(--text-primary);
    border-left: 2px solid var(--accent-tint-35);
    padding-left: 12px;
  }

  /* ——— feed groups ——————————————————————————————————————————————
     The header carries its own statistics, so "what is it noticing, how
     strongly, and how has that landed" is answerable without opening a thing. */

  .group {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin: 30px 0 6px;
  }
  .group:first-of-type {
    margin-top: 0;
  }
  .group-hd {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-primary);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    cursor: pointer;
    transition: color var(--t-fast) var(--ease-out);
  }
  .group-hd:hover {
    color: var(--accent);
  }
  .group-hd:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .group-caret {
    color: var(--accent);
  }
  .group-n {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .group-stats {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0;
  }
  .group-rule {
    flex: 1 1 40px;
    height: 1px;
    background: var(--line);
  }
  .group-blurb {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 92ch;
    text-wrap: pretty;
    margin: 0 0 14px;
  }

  /* ——— per-person disclosure ————————————————————————————————————— */

  .person {
    border-top: 1px solid var(--line-hair);
  }
  .person:last-child {
    border-bottom: 1px solid var(--line-hair);
  }
  .person-hd {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    width: 100%;
    text-align: left;
    padding: 16px 0;
    background: none;
    border: 0;
    border-radius: 0;
    cursor: pointer;
  }
  .person-hd:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .person-name {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .person-counts {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .person-body {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 0 0 24px;
  }

  /* ——— tables ————————————————————————————————————————————————————
     Every table on the hub is this one: mono, hairline rows, headings in
     uppercase muted mono, numbers right-aligned in the code face so columns
     line up (Selawik has no tnum, which is why the numeric cells name
     --font-code rather than --font-mono). */

  .tbl-scroll {
    overflow-x: auto;
    border: 1px solid var(--card-border);
    margin-top: 14px;
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .tbl thead tr {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  .tbl th {
    padding: 11px 12px;
    text-align: left;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tbl th.right {
    text-align: right;
  }
  .tbl tbody tr {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .tbl tbody tr:last-child {
    border-bottom: none;
  }
  /* Hover is a tint. No fade, no lift. */
  .tbl tbody tr:hover {
    background: rgba(26, 16, 8, 0.05);
  }
  .tbl tbody tr.dim {
    color: var(--text-ghost);
  }
  .tbl td {
    padding: 10px 12px;
    vertical-align: middle;
    color: var(--text-secondary);
  }
  .tbl.compact th,
  .tbl.compact td {
    padding: 7px 10px;
  }
  .tbl th.right,
  .tbl td.right {
    text-align: right;
    /* Shrink-to-fit, so the slack in a four-column table lands in the column
       carrying the words rather than being shared out evenly and leaving a
       60px hole between a merchant and its amount. */
    width: 1%;
    white-space: nowrap;
  }
  .tbl td.num {
    font-family: var(--font-code);
    font-variant-numeric: tabular-nums;
  }
  .tbl td.nowrap {
    white-space: nowrap;
  }
  .tbl td.cell-wrap {
    min-width: 22ch;
  }
  .tbl td.bad {
    color: var(--error);
    font-weight: 700;
  }
  .cell-lead {
    color: var(--text-primary);
  }
  .cell-title {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .cell-sub {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 60ch;
    margin-top: 4px;
  }

  /* ——— odds and ends ——————————————————————————————————————————— */

  .chart {
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    padding: 16px;
    margin-top: 18px;
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 18px;
  }
  .chip-stat {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    padding: 6px 12px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    color: var(--text-secondary);
  }
  .chip-stat b {
    color: var(--accent);
    margin-right: 6px;
  }

  .disclose {
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--accent-ink);
    border-radius: 0;
    background: var(--surface-card);
    padding: 12px 16px;
  }
  .disclose summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    cursor: pointer;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .disclose summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .disclose-day {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .disclose-sum {
    min-width: 0;
  }

  @media (max-width: 700px) {
    .card-title {
      font-size: var(--fs-body);
    }
    .card.row {
      align-items: flex-start;
    }
  }
</style>
