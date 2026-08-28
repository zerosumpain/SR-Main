<script lang="ts">
  // The diary, and what the engine is allowed to see of it.
  //
  // Reading the calendar is a live CalDAV round trip, so nothing here happens
  // on page load — the tab fetches a month when it is opened and when the
  // month changes, and never otherwise. Same rule the ledger loader follows.
  //
  // Excluded events are rendered ALONGSIDE the rest, struck through, not
  // filtered out of the view. A filter you cannot see is a filter you cannot
  // revise, and the whole point of making exclusion total was that undoing it
  // is one tap.

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

  // Which event's exclude panel is open, and what is typed into it.
  let openEvent = $state<string | null>(null);
  let reason = $state('');
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

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
   * The reason box previously had no submit of its own — the only way to
   * record anything was to press one of the Ignore buttons, which also hid the
   * event. That is wrong for an entry like a PE day: it is not a real time
   * commitment, but it IS a reminder to put the kit in the bag, and hiding it
   * would have hidden the reminder too.
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
</script>

<div class="cal-hd">
  <div class="cal-nav">
    <button class="row-link" onclick={() => shiftMonth(-1)} disabled={loading}>← prev</button>
    <span class="cal-month">{monthLabel}</span>
    <button class="row-link" onclick={() => shiftMonth(1)} disabled={loading}>next →</button>
  </div>
  <span class="cal-meta">
    {#if loading}reading the diary…{:else}{events.length - hiddenThisMonth} shown{#if hiddenThisMonth} · {hiddenThisMonth} ignored{/if}{/if}
  </span>
</div>

<p class="sec-lede">
  Two things you can do to an entry. <b>Explain</b> it — what it actually means — and the
  engine keeps it and reads your words alongside the diary. Or <b>ignore</b> it, and it
  contributes no busy minutes, reaches no prompt, and is the reason for no suggestion.
  Neither deletes anything from your calendar, and both undo in one tap.
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

<div class="tablewrap">
  <div class="cal-grid" role="grid" aria-label="Calendar month">
    {#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as dow (dow)}
      <div class="cal-dow">{dow}</div>
    {/each}
    {#each weeks as week, wi (wi)}
      {#each week as cell (cell.key)}
        <div class="cal-cell" class:pad={!cell.inMonth} class:today={cell.key === todayKey}>
          {#if cell.inMonth}
            <div class="cal-daynum">{cell.day}</div>
            {#each byDay.get(cell.key) ?? [] as e (eventKey(e))}
              <button
                class="cal-ev"
                class:excluded={e.excluded}
                onclick={() => { openEvent = openEvent === eventKey(e) ? null : eventKey(e); reason = ''; }}
                title={e.excluded ? 'Ignored — tap to restore' : 'Tap to ignore'}
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
          <button class="row-link" disabled={busy === `restore:${rule.id}`} onclick={() => restore(rule.id)}>
            {busy === `restore:${rule.id}` ? 'Restoring…' : 'Stop ignoring this'}
          </button>
        {/if}
      {:else}
        {#if e.note}
          <p class="cal-note">You said: “{e.note}”{#if e.noteScope === 'title'} — about anything called this{:else if e.noteScope === 'series'} — about every occurrence{/if}.</p>
        {/if}

        <textarea
          class="note-input"
          rows="2"
          maxlength="280"
          placeholder="What is this, really? — e.g. “PE day: a reminder to put the kit in the bag, not a time commitment”."
          bind:value={reason}
        ></textarea>

        <!-- TWO different things, and the difference matters. A note tells the
             engine what an entry MEANS and leaves it in the diary; ignoring
             removes it from busy minutes, prompts and suggestions. The box had
             no submit of its own, so the only way to record anything was to
             hide the event — the wrong answer for a PE day, which is not a time
             commitment but IS a reminder to pack the kit. -->
        <p class="note-hint">Keep it, and tell it what this means:</p>
        <div class="thought-actions">
          <button
            class="row-link"
            disabled={!!busy || !reason.trim()}
            onclick={() => exclude(e, e.uid ? 'series' : 'title', false)}
          >
            {busy && busy.endsWith(':false') ? 'Saving…' : 'Save this note'}
          </button>
          {#if e.uid}
            <button
              class="row-link"
              disabled={!!busy || !reason.trim()}
              onclick={() => exclude(e, 'title', false)}
            >
              Save it for anything called this
            </button>
          {/if}
        </div>

        <p class="note-hint">Or stop it counting as a commitment at all:</p>
        <div class="thought-actions">
          <button class="row-link" disabled={!!busy} onclick={() => exclude(e, 'occurrence')}>
            Ignore this date
          </button>
          {#if e.uid}
            <button class="row-link" disabled={!!busy} onclick={() => exclude(e, 'series')}>
              Ignore every occurrence
            </button>
          {/if}
          <button class="row-link" disabled={!!busy} onclick={() => exclude(e, 'title')}>
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
          <button class="row-link" disabled={busy === `restore:${x.id}`} onclick={() => restore(x.id)}>
            {busy === `restore:${x.id}` ? 'Removing…' : x.hidden ? 'Stop ignoring' : 'Forget this note'}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* ── Styles this component was BORROWING from the page ─────────────────
     Svelte scopes CSS per component, so `.row-link`, `.sec-lede`,
     `.thought-actions` and the rest — all defined in +page.svelte — reached
     none of the markup here. The three exclude controls rendered as bare
     unstyled text rather than as actions, which is exactly how it looked.
     Defined locally, matching the page's values. */
  .sec-lede { margin: 0 0 0.9rem; font-size: var(--fs-label); line-height: 1.55; color: var(--text-muted); max-width: 68ch; }
  .warn-line { margin: 0.6rem 0 0; font-size: var(--fs-label); line-height: 1.5; color: var(--warn, #b0892a); }
  .warn-line.err { color: var(--error, #c44); }
  .mono { font-family: var(--font-mono); }
  .tablewrap { overflow-x: auto; }
  .rows { display: flex; flex-direction: column; gap: 0.5rem; }
  .rows.tight { gap: 0.25rem; }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--line-strong); line-height: 1.6; }

  .nm-sec-hd { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }

  .row-link { background: none; border: none; padding: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); cursor: pointer; }
  .row-link:hover:not(:disabled) { text-decoration: underline; }
  .row-link:disabled { opacity: 0.45; cursor: default; }
  .thought-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }

  .note-input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.6rem; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-label-sm, 0.875rem); line-height: 1.5; resize: vertical; }
  .note-hint { margin: 0.3rem 0 0; font-size: var(--fs-label-xs); color: var(--text-muted); }

  .cal-hd { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.5rem; }
  .cal-nav { display: flex; align-items: baseline; gap: 0.8rem; }
  .cal-month { font-family: var(--font-display); font-size: 1.15rem; font-weight: 900; color: var(--text-primary); }
  .cal-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(96px, 1fr)); gap: 1px; background: var(--line-hair); border: 1px solid var(--line-strong); min-width: 700px; }
  .cal-dow { background: var(--bg); padding: 0.35rem 0.5rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .cal-cell { background: var(--bg); min-height: 5.5rem; padding: 0.3rem 0.35rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .cal-cell.pad { background: var(--card-bg); }
  .cal-cell.today { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cal-daynum { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .cal-ev { display: flex; gap: 0.35rem; align-items: baseline; width: 100%; text-align: left; background: none; border: none; border-left: 2px solid var(--accent); padding: 0.1rem 0.25rem; cursor: pointer; font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .cal-ev:hover { background: var(--card-bg); }
  .cal-ev-time { font-family: var(--font-mono); color: var(--text-ghost); flex: none; }
  .cal-ev-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cal-ev.excluded { border-left-color: var(--line-strong); opacity: 0.55; }
  .cal-ev.excluded .cal-ev-title { text-decoration: line-through; }

  .cal-panel { margin-top: 0.8rem; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: 0.8rem 0.9rem; background: var(--card-bg); }
  .cal-panel-hd { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; font-size: var(--fs-label); }
  .cal-panel-hd .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .cal-note { margin: 0 0 0.6rem; font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); border-left: 2px solid var(--accent); padding-left: 0.6rem; }
  .excl-kind { flex: none; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 0.3rem; border: 1px solid var(--line-strong); color: var(--text-ghost); }
  .excl-kind.note { color: var(--accent); border-color: var(--accent); }
  .cal-hidden { margin-top: 1.4rem; }
  .excl-row { display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: baseline; font-size: var(--fs-label-xs); border-bottom: 1px solid var(--line-hair); padding-bottom: 0.3rem; }
  .excl-title { color: var(--text-secondary); }
  .excl-scope { color: var(--text-ghost); }
  .excl-reason { color: var(--text-muted); font-style: italic; }
</style>
