<script lang="ts">
  // The diary — what the engine may see of it, and what you can write to it.
  //
  // Reading the calendar is a live CalDAV round trip, so nothing here happens
  // on page load: the tab fetches a month when it is opened and when the month
  // changes, and never otherwise. Same rule the ledger loader follows.
  //
  // Excluded events render ALONGSIDE the rest, struck through, not filtered
  // out. A filter you cannot see is a filter you cannot revise, and the whole
  // point of making exclusion total was that undoing it is one tap.
  //
  // ── Three things you can do to an entry, and they are genuinely different ─
  //
  //   EXPLAIN   — tell the ENGINE what an entry means. Local, never leaves the
  //               box. "PE day: a reminder to pack the kit, not a commitment."
  //   DETAIL    — write notes or a location onto the REAL calendar entry, which
  //               everyone with that calendar then sees. An external write.
  //   IGNORE    — the entry contributes no busy minutes, reaches no prompt and
  //               is the reason for no suggestion. Local, and one tap to undo.
  //
  // The first two were one control before, and they are not the same thing:
  // one is a private annotation, the other changes a shared calendar. They are
  // now separately labelled and separately confirmed.
  //
  // ── Buttons ──────────────────────────────────────────────────────────────
  //
  // This component predates the hub's editorial chrome and was still wearing
  // `.row-link` — bare accent text with no hit area, which is why the three
  // exclude controls read as prose rather than as actions. It uses the hub's
  // own `.cta` / `.btn` now: solid burnt orange for the thing the section is
  // about, a ruled outline for everything else. Defined locally because Svelte
  // scopes CSS per component and the page's copies reach none of this markup.

  export interface BoardEvent {
    id: string | null;
    uid: string | null;
    title: string;
    start: string;
    end: string | null;
    location: string | null;
    calendar: string | null;
    excluded: boolean;
    hiddenBy?: string | null;
    /** A note-only rule covering this event: what it MEANS, without hiding it. */
    noteId?: string | null;
    note?: string | null;
    noteScope?: string | null;
  }

  export interface BoardExclusion {
    id: string;
    hidden: boolean;
    scope: string;
    uid: string | null;
    occurrenceStart: string | null;
    title: string | null;
    calendarName: string | null;
    reason: string | null;
    matchKey: string;
    createdAt: string;
  }

  let { onchanged }: { onchanged?: () => void } = $props();

  const TZ = 'Europe/London';

  // `monthAnchor` is the first of the displayed month, as YYYY-MM-DD.
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  let monthAnchor = $state(`${todayKey.slice(0, 7)}-01`);
  let events = $state<BoardEvent[]>([]);
  let exclusions = $state<BoardExclusion[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let partial = $state(false);
  let truncated = $state(false);

  // Which event's panel is open, and what is typed into it.
  let openEvent = $state<string | null>(null);
  let reason = $state('');
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let actionNote = $state<string | null>(null);

  function shiftMonth(by: number) {
    const [y, m] = monthAnchor.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    monthAnchor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  function endOfMonth(anchor: string): string {
    const [y, m] = anchor.split('-').map(Number);
    // The tool's range end is exclusive at midnight, so ask through the 1st of
    // the next month.
    const d = new Date(Date.UTC(y, m, 1));
    return d.toISOString().slice(0, 10);
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/daydream/thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  async function loadMonth(anchor: string) {
    loading = true;
    loadError = null;
    try {
      const out = await post({ action: 'calendar_window', from: anchor, to: endOfMonth(anchor) });
      if (out.error) throw new Error(String(out.error));
      events = (out.events ?? []) as BoardEvent[];
      exclusions = (out.exclusions ?? []) as BoardExclusion[];
      partial = out.partial === true;
      truncated = out.truncated === true;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      events = [];
    } finally {
      loading = false;
    }
  }

  // Fetch when the month changes, and once on mount.
  //
  // `lastRequested` is a PLAIN let, never $state: it is a request handle, and
  // an effect that both reads and writes it as $state would subscribe to its
  // own write and loop. `monthAnchor` is the only tracked read here.
  let lastRequested: string | null = null;
  $effect(() => {
    const anchor = monthAnchor;
    if (anchor === lastRequested) return;
    lastRequested = anchor;
    void loadMonth(anchor);
  });

  const monthLabel = $derived(
    new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${monthAnchor}T12:00:00Z`),
    ),
  );

  /** Events bucketed by their local day. */
  const byDay = $derived.by(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const map = new Map<string, BoardEvent[]>();
    for (const e of events) {
      const d = new Date(e.start);
      if (Number.isNaN(d.getTime())) continue;
      const key = fmt.format(d);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  });

  /** The grid: whole weeks, Monday-first, covering the month. */
  const weeks = $derived.by(() => {
    const [y, m] = monthAnchor.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    // getUTCDay: 0=Sun. Monday-first means Sunday sits at the end.
    const lead = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: Array<{ key: string; day: number; inMonth: boolean }> = [];
    for (let i = 0; i < lead; i++) cells.push({ key: `pad-${i}`, day: 0, inMonth: false });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        key: `${monthAnchor.slice(0, 8)}${String(d).padStart(2, '0')}`,
        day: d,
        inMonth: true,
      });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false });
    const out: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  });

  const hiddenThisMonth = $derived(events.filter((e) => e.excluded).length);

  function timeOf(e: BoardEvent): string {
    const d = new Date(e.start);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  }

  function eventKey(e: BoardEvent): string {
    return `${e.uid ?? e.id ?? e.title}|${e.start}`;
  }

  /**
   * `hidden` false saves what the entry MEANS without removing it.
   *
   * The reason box previously had no submit of its own — the only way to record
   * anything was to press one of the Ignore buttons, which also hid the event.
   * That is wrong for an entry like a PE day: it is not a real time commitment,
   * but it IS a reminder to put the kit in the bag, and hiding it would have
   * hidden the reminder too.
   */
  async function exclude(
    e: BoardEvent,
    scope: 'series' | 'occurrence' | 'title',
    hidden = true,
  ) {
    busy = `${eventKey(e)}:${scope}:${hidden}`;
    actionError = null;
    try {
      const out = await post({
        action: 'exclude_event',
        scope,
        hidden,
        uid: e.uid ?? '',
        occurrenceStart: e.start,
        title: e.title,
        calendarName: e.calendar ?? '',
        reason,
      });
      if (out.error) throw new Error(String(out.error));
      openEvent = null;
      reason = '';
      await loadMonth(monthAnchor);
      onchanged?.();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function restore(id: string) {
    busy = `restore:${id}`;
    actionError = null;
    try {
      const out = await post({ action: 'restore_event', id });
      if (out.error) throw new Error(String(out.error));
      await loadMonth(monthAnchor);
      onchanged?.();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  /** The stored rule hiding this occurrence, so "restore" knows what to undo. */
  function ruleFor(e: BoardEvent): BoardExclusion | null {
    if (!e.hiddenBy) return null;
    return exclusions.find((x) => x.matchKey === e.hiddenBy) ?? null;
  }

  function scopeWords(scope: string): string {
    return scope === 'series'
      ? 'every occurrence'
      : scope === 'occurrence'
        ? 'this date only'
        : 'anything with this title';
  }

  // ── The calendars this box may write to ────────────────────────────────
  //
  // Fetched once, on demand, and only when a write form is opened — a CalDAV
  // discovery round trip is not worth spending on a month someone is only
  // reading.
  type CalendarOption = { value: string; label: string };
  let calendars = $state<CalendarOption[]>([]);
  let calendarsLoaded = $state(false);
  let calendarsError = $state<string | null>(null);

  async function ensureCalendars() {
    if (calendarsLoaded) return;
    calendarsError = null;
    try {
      const out = await post({ action: 'calendar_list' });
      if (out.error) throw new Error(String(out.error));
      calendars = (out.calendars ?? []) as CalendarOption[];
      calendarsLoaded = true;
      if (calendars.length && !newCal) newCal = calendars[0].value;
    } catch (err) {
      calendarsError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Writing an event ──────────────────────────────────────────────────
  //
  // All-day is the default, and that is deliberate. The entries this hub is
  // about — a term date, a bin day, a thing to remember — are days rather than
  // meetings, and asking for two ISO date-times before you can write "dentist,
  // Thursday" is how a create form goes unused.
  let composeOpen = $state(false);
  let newCal = $state('');
  let newTitle = $state('');
  let newAllDay = $state(true);
  let newDate = $state(todayKey);
  let newEndDate = $state('');
  let newStartTime = $state('09:00');
  let newEndTime = $state('10:00');
  let newLocation = $state('');
  let newNotes = $state('');

  async function openCompose(dayKey?: string) {
    composeOpen = true;
    actionNote = null;
    actionError = null;
    if (dayKey) newDate = dayKey;
    await ensureCalendars();
  }

  /** Local wall-clock date + time as an ISO instant.
   *
   *  The box is Europe/London and so is the diary, so the browser's own offset
   *  is the right one — `new Date('2026-08-31T09:00')` with no zone is parsed
   *  as LOCAL time by every engine, which is exactly what was typed. Building
   *  the string by hand and appending 'Z' would silently shift every summer
   *  event by an hour. */
  function localIso(date: string, time: string): string {
    const d = new Date(`${date}T${time}`);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  async function createEvent() {
    if (!newTitle.trim() || !newCal) return;
    busy = 'create';
    actionError = null;
    actionNote = null;
    try {
      const payload: Record<string, unknown> = {
        action: 'create_event',
        calendar: newCal,
        title: newTitle.trim(),
        location: newLocation.trim(),
        notes: newNotes.trim(),
      };
      if (newAllDay) {
        payload.allDayStart = newDate;
        payload.allDayEnd = newEndDate || newDate;
      } else {
        payload.start = localIso(newDate, newStartTime);
        payload.end = localIso(newEndDate || newDate, newEndTime);
      }
      const out = await post(payload);
      if (out.error) throw new Error(String(out.error));
      actionNote = `“${newTitle.trim()}” is in your calendar.`;
      newTitle = '';
      newLocation = '';
      newNotes = '';
      composeOpen = false;
      // The new entry only exists on iCloud until the month is re-read; the
      // grid is a cache of one CalDAV call.
      await loadMonth(monthAnchor);
      onchanged?.();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  // ── Adding detail to a real entry ─────────────────────────────────────
  //
  // Separate state from `reason`, and separately labelled, because these two
  // boxes look identical and do opposite things: one annotates the engine's
  // copy, the other rewrites a calendar everybody else can see.
  let detailNotes = $state('');
  let detailLocation = $state('');

  async function pushDetail(e: BoardEvent) {
    if (!e.id || !e.calendar) return;
    if (!detailNotes.trim() && !detailLocation.trim()) return;
    busy = `${eventKey(e)}:detail`;
    actionError = null;
    actionNote = null;
    try {
      const out = await post({
        action: 'update_event',
        calendar: e.calendar,
        eventId: e.id,
        // Only what was typed. The tool preserves omitted fields and treats an
        // empty string as "clear it", so sending a blank box would delete a
        // location nobody asked to remove.
        ...(detailNotes.trim() ? { notes: detailNotes.trim() } : {}),
        ...(detailLocation.trim() ? { location: detailLocation.trim() } : {}),
      });
      if (out.error) throw new Error(String(out.error));
      actionNote = 'Written to the calendar entry itself.';
      detailNotes = '';
      detailLocation = '';
      await loadMonth(monthAnchor);
      onchanged?.();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  function openPanel(e: BoardEvent) {
    const key = eventKey(e);
    openEvent = openEvent === key ? null : key;
    reason = '';
    detailNotes = '';
    detailLocation = e.location ?? '';
    actionNote = null;
  }
</script>

<div class="cal-hd">
  <div class="cal-nav">
    <button type="button" class="btn" onclick={() => shiftMonth(-1)} disabled={loading}>← Prev</button>
    <span class="cal-month">{monthLabel}</span>
    <button type="button" class="btn" onclick={() => shiftMonth(1)} disabled={loading}>Next →</button>
  </div>
  <div class="cal-hd-right">
    <span class="cal-meta">
      {#if loading}reading the diary…{:else}{events.length - hiddenThisMonth} shown{#if hiddenThisMonth} · {hiddenThisMonth} ignored{/if}{/if}
    </span>
    <button type="button" class="cta" onclick={() => (composeOpen ? (composeOpen = false) : openCompose())}>
      {composeOpen ? 'Close' : 'New event'}
    </button>
  </div>
</div>

<p class="sec-lede">
  Three things you can do to an entry. <b>Explain</b> it — what it actually means — and the
  engine keeps it and reads your words alongside the diary. <b>Add detail</b> and the notes
  or location go onto the real calendar entry, where everyone who has that calendar sees
  them. Or <b>ignore</b> it, and it contributes no busy minutes, reaches no prompt, and is
  the reason for no suggestion. Only the middle one leaves this box, and none of them
  deletes anything.
</p>

{#if loadError}
  <p class="warn-line err">Could not read the calendar: {loadError}</p>
{/if}
{#if partial}
  <p class="warn-line">At least one calendar could not be read, so this month may be missing entries.</p>
{/if}
{#if truncated}
  <p class="warn-line">More events than the read limit — this month is a floor, not a count.</p>
{/if}
{#if actionError}
  <p class="warn-line err">{actionError}</p>
{/if}
{#if actionNote}
  <p class="warn-line good">{actionNote}</p>
{/if}

<!-- ── Writing a new entry ──────────────────────────────────────────────
     A real CalDAV write, through the same registry tool the chat surface
     uses. There is one calendar client in this codebase and this is not a
     second one. -->
{#if composeOpen}
  <div class="cal-panel compose">
    <p class="panel-kicker">New entry — this writes to your actual calendar</p>
    {#if calendarsError}
      <p class="warn-line err">Could not list your calendars: {calendarsError}</p>
    {/if}
    <div class="form-grid">
      <label class="fld">
        <span class="fld-label">Calendar</span>
        <select class="text-input" bind:value={newCal}>
          {#each calendars as c (c.value)}
            <option value={c.value}>{c.label}</option>
          {/each}
          {#if !calendars.length}<option value="">loading…</option>{/if}
        </select>
      </label>
      <label class="fld wide">
        <span class="fld-label">What is it</span>
        <input class="text-input" bind:value={newTitle} maxlength="200" placeholder="Dentist" />
      </label>
      <label class="fld">
        <span class="fld-label">Starts</span>
        <input class="text-input" type="date" bind:value={newDate} />
      </label>
      <label class="fld">
        <span class="fld-label">Ends <span class="dim">(blank = same day)</span></span>
        <input class="text-input" type="date" bind:value={newEndDate} />
      </label>
      {#if !newAllDay}
        <label class="fld">
          <span class="fld-label">From</span>
          <input class="text-input" type="time" bind:value={newStartTime} />
        </label>
        <label class="fld">
          <span class="fld-label">To</span>
          <input class="text-input" type="time" bind:value={newEndTime} />
        </label>
      {/if}
      <label class="fld">
        <span class="fld-label">Where</span>
        <input class="text-input" bind:value={newLocation} maxlength="200" placeholder="optional" />
      </label>
      <label class="fld wide">
        <span class="fld-label">Notes</span>
        <input class="text-input" bind:value={newNotes} maxlength="500" placeholder="optional" />
      </label>
    </div>
    <div class="cal-actions">
      <label class="chk">
        <input type="checkbox" bind:checked={newAllDay} />
        <span>All day</span>
      </label>
      <button
        type="button"
        class="cta"
        disabled={busy === 'create' || !newTitle.trim() || !newCal}
        onclick={createEvent}
      >
        {busy === 'create' ? 'Writing…' : 'Add to calendar'}
      </button>
      <button type="button" class="btn" onclick={() => (composeOpen = false)}>Cancel</button>
    </div>
  </div>
{/if}

<div class="tablewrap">
  <div class="cal-grid" role="grid" aria-label="Calendar month">
    {#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as dow (dow)}
      <div class="cal-dow">{dow}</div>
    {/each}
    {#each weeks as week, wi (wi)}
      {#each week as cell (cell.key)}
        <div class="cal-cell" class:pad={!cell.inMonth} class:today={cell.key === todayKey}>
          {#if cell.inMonth}
            <div class="cal-dayhd">
              <span class="cal-daynum">{cell.day}</span>
              <!-- Adding an entry to the day you are looking at, rather than
                   opening a form and typing the date back in. -->
              <button
                type="button"
                class="cal-add"
                title="Add an entry on this day"
                aria-label="Add an entry on {cell.key}"
                onclick={() => openCompose(cell.key)}
              >+</button>
            </div>
            {#each byDay.get(cell.key) ?? [] as e (eventKey(e))}
              <button
                type="button"
                class="cal-ev"
                class:excluded={e.excluded}
                class:on={openEvent === eventKey(e)}
                onclick={() => openPanel(e)}
                title={e.excluded ? 'Ignored — tap to restore' : 'Tap to explain, detail or ignore'}
              >
                <span class="cal-ev-time">{timeOf(e)}</span>
                <span class="cal-ev-title">{e.title}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/each}
    {/each}
  </div>
</div>

<!-- The panel for whichever event is open. Outside the grid so a long form
     cannot stretch a cell and knock the month out of shape. -->
{#each events as e (eventKey(e))}
  {#if openEvent === eventKey(e)}
    <div class="cal-panel">
      <div class="cal-panel-hd">
        <strong>{e.title}</strong>
        <span class="mono">{e.start.slice(0, 16).replace('T', ' ')}{e.calendar ? ` · ${e.calendar}` : ''}</span>
      </div>

      {#if e.excluded}
        {@const rule = ruleFor(e)}
        <p class="sec-lede">
          Ignored{#if rule} — {scopeWords(rule.scope)}{#if rule.reason}, because “{rule.reason}”{/if}{/if}.
          The engine cannot see it.
        </p>
        {#if rule}
          <div class="cal-actions">
            <button type="button" class="cta" disabled={busy === `restore:${rule.id}`} onclick={() => restore(rule.id)}>
              {busy === `restore:${rule.id}` ? 'Restoring…' : 'Stop ignoring this'}
            </button>
          </div>
        {/if}
      {:else}
        {#if e.note}
          <p class="cal-note">You said: “{e.note}”{#if e.noteScope === 'title'} — about anything called this{:else if e.noteScope === 'series'} — about every occurrence{/if}.</p>
        {/if}

        <!-- 1 · Explain, locally. -->
        <p class="panel-kicker">Tell the engine what this means <span class="dim">— stays here</span></p>
        <textarea
          class="text-input area"
          rows="2"
          maxlength="280"
          placeholder="e.g. “PE day: a reminder to put the kit in the bag, not a time commitment”."
          bind:value={reason}
        ></textarea>
        <div class="cal-actions">
          <button
            type="button"
            class="cta"
            disabled={!!busy || !reason.trim()}
            onclick={() => exclude(e, e.uid ? 'series' : 'title', false)}
          >
            {busy && busy.endsWith(':false') ? 'Saving…' : 'Save this note'}
          </button>
          {#if e.uid}
            <button
              type="button"
              class="btn"
              disabled={!!busy || !reason.trim()}
              onclick={() => exclude(e, 'title', false)}
            >
              Save it for anything called this
            </button>
          {/if}
        </div>

        <!-- 2 · Detail, on the real entry. A different destination, so a
             different label and its own confirmation line. -->
        <p class="panel-kicker">
          Add detail to the calendar entry
          <span class="dim">— everyone with this calendar sees it</span>
        </p>
        {#if e.id && e.calendar}
          <div class="form-grid">
            <label class="fld">
              <span class="fld-label">Where</span>
              <input class="text-input" bind:value={detailLocation} maxlength="200" placeholder={e.location ?? 'optional'} />
            </label>
            <label class="fld wide">
              <span class="fld-label">Notes</span>
              <input class="text-input" bind:value={detailNotes} maxlength="500" placeholder="what this is, who is going, what to bring" />
            </label>
          </div>
          <div class="cal-actions">
            <button
              type="button"
              class="cta"
              disabled={busy === `${eventKey(e)}:detail` || (!detailNotes.trim() && !detailLocation.trim())}
              onclick={() => pushDetail(e)}
            >
              {busy === `${eventKey(e)}:detail` ? 'Writing…' : 'Write it to the calendar'}
            </button>
          </div>
        {:else}
          <p class="note-hint">
            This occurrence carries no calendar resource id, so it cannot be edited from here —
            only explained or ignored.
          </p>
        {/if}

        <!-- 3 · Ignore. -->
        <p class="panel-kicker">Or stop it counting as a commitment at all</p>
        <div class="cal-actions">
          <button type="button" class="btn" disabled={!!busy} onclick={() => exclude(e, 'occurrence')}>
            Ignore this date
          </button>
          {#if e.uid}
            <button type="button" class="btn" disabled={!!busy} onclick={() => exclude(e, 'series')}>
              Ignore every occurrence
            </button>
          {/if}
          <button type="button" class="btn danger" disabled={!!busy} onclick={() => exclude(e, 'title')}>
            Ignore anything called this
          </button>
        </div>

        <p class="note-hint">
          A note leaves the entry where it is and explains it; ignoring removes it from busy
          minutes, prompts and suggestions. Either way your words are kept and read
          back.{#if !e.uid} This entry carries no calendar UID, so it can only be matched by date or by title.{/if}
        </p>
      {/if}
    </div>
  {/if}
{/each}

<div class="cal-hidden">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">What you have told it about the diary</span>
    <span class="nm-sec-meta">
      {exclusions.filter((x) => x.hidden).length} ignored · {exclusions.filter((x) => !x.hidden).length} explained
    </span>
  </div>
  {#if exclusions.length === 0}
    <div class="empty">Nothing hidden, nothing explained. The engine sees the whole diary and takes every entry at face value.</div>
  {:else}
    <div class="rows tight">
      {#each exclusions as x (x.id)}
        <div class="excl-row">
          <span class="mono excl-kind" class:note={!x.hidden}>{x.hidden ? 'ignored' : 'noted'}</span>
          <span class="excl-title">{x.title ?? x.uid ?? x.matchKey}</span>
          <span class="mono excl-scope">{scopeWords(x.scope)}</span>
          {#if x.reason}<span class="excl-reason">“{x.reason}”</span>{/if}
          <button type="button" class="btn small" disabled={busy === `restore:${x.id}`} onclick={() => restore(x.id)}>
            {busy === `restore:${x.id}` ? 'Removing…' : x.hidden ? 'Stop ignoring' : 'Forget this note'}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* ── The hub's chrome, defined locally ──────────────────────────────────
     Svelte scopes CSS per component, so `.cta`, `.btn`, `.text-input` and the
     rest — all defined in +page.svelte — reach none of the markup here. This
     component used to borrow `.row-link` and got bare unstyled text instead,
     which is exactly how the three exclude controls looked. Same values as the
     page, so the two surfaces stay one design. */

  .sec-lede { margin: 0 0 14px; font-size: var(--fs-body-sm); line-height: 1.6; color: var(--text-secondary); max-width: 90ch; text-wrap: pretty; }
  .warn-line { margin: 0.6rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--warn); }
  .warn-line.err { color: var(--error); }
  .warn-line.good { color: var(--good); }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--text-ghost); }
  .tablewrap { overflow-x: auto; }
  .rows { display: flex; flex-direction: column; gap: 0.5rem; }
  .rows.tight { gap: 0.25rem; }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--line-strong); line-height: 1.6; }

  .nm-sec-hd { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }

  /* Buttons — the hub's pair. Solid burnt orange for the thing the panel is
     about, a ruled outline for everything else. Square, mono, uppercase. */
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
    transition: background-color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .cta { color: var(--bg); background: var(--accent); border: 1px solid var(--accent); }
  .cta:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn { color: var(--text-primary); background: transparent; border: 1px solid var(--line-strong); }
  .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .btn.danger:hover:not(:disabled) { border-color: var(--error); color: var(--error); }
  .btn.small { padding: 5px 10px; }
  .cta:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cta:focus-visible, .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

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
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
  }
  .text-input:focus { outline: none; border-color: var(--accent); }
  .text-input.area { resize: vertical; line-height: 1.5; }

  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 14px; margin: 10px 0 4px; }
  .fld { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .fld.wide { grid-column: span 2; }
  .fld-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted); }
  .chk { display: inline-flex; align-items: center; gap: 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); cursor: pointer; }
  .chk input { accent-color: var(--accent); }

  .cal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
  .panel-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-muted); margin: 20px 0 8px; }
  .panel-kicker:first-child { margin-top: 0; }
  .note-hint { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.6; color: var(--text-muted); }

  .cal-hd { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .cal-nav { display: flex; align-items: center; gap: 14px; }
  .cal-hd-right { display: flex; align-items: center; gap: 14px; }
  .cal-month { font-family: var(--font-display); font-size: 1.15rem; font-weight: 900; color: var(--text-primary); }
  .cal-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(96px, 1fr)); gap: 1px; background: var(--line-hair); border: 1px solid var(--line-strong); min-width: 700px; }
  .cal-dow { background: var(--bg); padding: 0.35rem 0.5rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .cal-cell { background: var(--bg); min-height: 5.5rem; padding: 0.3rem 0.35rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .cal-cell.pad { background: var(--bg-section); }
  .cal-cell.today { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cal-dayhd { display: flex; align-items: center; justify-content: space-between; }
  .cal-daynum { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  /* The per-day add. Ghosted until the cell is hovered, so a month grid is not
     31 competing buttons — but always present for a keyboard, which cannot
     hover. */
  .cal-add {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    padding: 2px 5px;
    border: 1px solid transparent;
    background: none;
    color: var(--text-ghost);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease-out);
  }
  .cal-cell:hover .cal-add, .cal-add:focus-visible { opacity: 1; border-color: var(--accent); color: var(--accent); }

  .cal-ev { display: flex; gap: 0.35rem; align-items: baseline; width: 100%; text-align: left; background: none; border: none; border-left: 2px solid var(--accent); padding: 0.1rem 0.25rem; cursor: pointer; font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .cal-ev:hover { background: var(--accent-tint-08); }
  .cal-ev.on { background: var(--accent-tint-14); color: var(--text-primary); }
  .cal-ev-time { font-family: var(--font-mono); color: var(--text-ghost); flex: none; }
  .cal-ev-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cal-ev.excluded { border-left-color: var(--line-strong); opacity: 0.55; }
  .cal-ev.excluded .cal-ev-title { text-decoration: line-through; }

  .cal-panel { margin-top: 0.9rem; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: 16px 18px; background: var(--bg-section); }
  .cal-panel.compose { border-left-width: 4px; }
  .cal-panel-hd { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; font-size: var(--fs-label); }
  .cal-panel-hd .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .cal-note { margin: 0 0 0.6rem; font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); border-left: 2px solid var(--accent); padding-left: 0.6rem; }
  .excl-kind { flex: none; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 0.3rem; border: 1px solid var(--line-strong); color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .excl-kind.note { color: var(--accent); border-color: var(--accent); }
  .cal-hidden { margin-top: 1.6rem; }
  .excl-row { display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: center; font-size: var(--fs-label-xs); border-bottom: 1px solid var(--line-hair); padding-bottom: 0.4rem; }
  .excl-title { color: var(--text-secondary); }
  .excl-scope { color: var(--text-ghost); }
  .excl-reason { color: var(--text-muted); font-style: italic; }

  @media (max-width: 640px) {
    .fld.wide { grid-column: span 1; }
  }
</style>
