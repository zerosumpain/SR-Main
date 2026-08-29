<script lang="ts">
  // Triage inbox — the queue you clear with your left hand.
  //
  // Three things make it work, and all three were missing before:
  //   1. Evidence on screen. The old page showed a name and a confidence word,
  //      which is not enough to confirm or reject anything, so nobody did.
  //   2. Keyboard first. A 194-item backlog is cleared at one keystroke each or
  //      it is not cleared at all.
  //   3. A stable cursor. Actions never re-run the page load and never remove a
  //      row from the array — a resolved item is marked in place — so the
  //      position you were at is still the position you are at.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type QueueItem = PageData['entities'][number];
  type Status = 'pending' | 'confirmed' | 'rejected' | 'merged';

  /** The queue array is never filtered — resolution is recorded alongside it. */
  let items = $state<QueueItem[]>(data.entities.map((e) => ({ ...e })));
  let statuses = $state<Record<string, Status>>({});
  let cursor = $state(0);
  let busyId = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let showHelp = $state(false);
  let tab = $state<'entities' | 'alerts'>('entities');

  // ── Duplicate suggestions ────────────────────────────────────────────────
  //
  // The queue's most expensive mistake was never a wrong confirm — it was a
  // confirm that should have been a MERGE. Triage asked "is this real?" with no
  // idea that the graph already held the same thing under a slightly different
  // name, so the honest answer ("yes, it's real") added a second node for it,
  // and the duplicate count grew faster than the sweep could clear it.
  //
  // Fetched after the page rather than in its load: the resolver compares every
  // entity against every other, which is seconds of work, and a queue you cannot
  // start clearing until it finishes is worse than one whose suggestions arrive
  // a moment late.
  interface DupHint {
    otherId: string;
    otherName: string;
    otherType: string;
    confidence: number;
    reason: string;
    /** What the adjudicator said, when it has read this pair. */
    rationale: string | null;
    /** Which side the resolver would keep. */
    keepId: string;
  }
  let hints = $state<Record<string, DupHint>>({});
  let hintsLoading = $state(true);
  let hintsError = $state<string | null>(null);

  onMount(async () => {
    try {
      // 0.5 rather than the resolver's floor: below that the reason is usually
      // "the names share some words", which is not worth interrupting a triage
      // pass for.
      const res = await fetch('/api/jkai/intel/duplicates?min=0.5');
      if (!res.ok) throw new Error(`the duplicate check came back ${res.status}`);
      const body = await res.json();
      const queued = new Set(items.map((i) => i.id));
      const next: Record<string, DupHint> = {};
      for (const d of body.duplicates ?? []) {
        for (const [mine, other] of [
          [d.keep, d.merge],
          [d.merge, d.keep],
        ] as const) {
          if (!queued.has(mine.id)) continue;
          // Keep the strongest hint per queued entity.
          if (next[mine.id] && next[mine.id].confidence >= d.confidence) continue;
          next[mine.id] = {
            otherId: other.id,
            otherName: other.name,
            otherType: other.type,
            confidence: d.confidence,
            reason: d.reason,
            rationale: d.decision?.rationale ?? null,
            keepId: d.keep.id,
          };
        }
      }
      hints = next;
    } catch (err) {
      // Named rather than swallowed: with no hints and no message the page looks
      // like a graph with no duplicates in it, which is the opposite of true.
      hintsError = err instanceof Error ? err.message : 'the duplicate check failed';
    } finally {
      hintsLoading = false;
    }
  });

  const hintOf = (item: QueueItem | null): DupHint | null => (item ? (hints[item.id] ?? null) : null);
  const hintCount = $derived(
    items.filter((i) => statusOf(i) === 'pending' && hints[i.id]).length,
  );

  /**
   * Merge the current entity with what it looks like — either direction.
   *
   * The resolver has already decided which side should survive (better
   * connected, then more evidence, then the more specific name), so this takes
   * its answer rather than assuming the queued item is the loser: confirming a
   * well-connected new entity and folding a thin old one into it is a normal
   * outcome, and forcing the queue item to always lose would quietly discard
   * the better node.
   */
  async function mergeWithHint(item: QueueItem | null) {
    const hint = hintOf(item);
    if (!item || !hint || busyId) return;
    busyId = item.id;
    try {
      if (hint.keepId === item.id) {
        // The queued entity survives. Merge the other one into it, then confirm
        // it — an entity that has just absorbed another is not still a guess.
        await triage({ action: 'merge', entityId: hint.otherId, keepId: item.id });
        await triage({ action: 'confirm', entityId: item.id });
        statuses = { ...statuses, [item.id]: 'confirmed' };
        notify(`Absorbed ${hint.otherName} into ${item.name}`);
      } else {
        await triage({ action: 'merge', entityId: item.id, keepId: hint.keepId });
        statuses = { ...statuses, [item.id]: 'merged' };
        notify(`Merged ${item.name} into ${hint.otherName}`);
      }
      const { [item.id]: _gone, ...rest } = hints;
      hints = rest;
      advance();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      busyId = null;
    }
  }

  /** "No, these are two things" — recorded durably, so it is never asked again. */
  async function dismissHint(item: QueueItem | null) {
    const hint = hintOf(item);
    if (!item || !hint) return;
    const { [item.id]: _gone, ...rest } = hints;
    hints = rest;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'not-duplicate',
          aId: item.id,
          bId: hint.otherId,
          aName: item.name,
          bName: hint.otherName,
          confidence: hint.confidence,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      notify(`Recorded: ${item.name} is not ${hint.otherName}`);
    } catch {
      notify('Hidden for now, but the decision did not save');
    }
  }

  // Merge picker
  let mergeOpen = $state(false);
  let mergeQuery = $state('');
  let mergeResults = $state<Array<{ id: string; name: string; typeIcon: string; typeName: string; relationshipCount: number }>>([]);
  let mergeLoading = $state(false);

  // Alerts
  let alerts = $state(data.alerts.map((a) => ({ ...a })));
  let dismissingId = $state<string | null>(null);
  let dismissReason = $state('');

  // Plain `let`, never $state: these are handles that helper functions both
  // read and clear. Making them reactive is the classic effect_update_depth
  // trap (see the svelte5-pitfalls skill).
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;
  let rowEls: Array<HTMLElement | null> = [];
  let mergeInputEl: HTMLInputElement | null = null;
  let retypeEl: HTMLSelectElement | null = null;

  // Re-seed when the loader returns a different queue (order change, hard nav).
  // Only `data.entities` is read reactively; every write is untracked so the
  // freshly created proxies cannot re-trigger the effect that made them.
  $effect(() => {
    const incoming = data.entities;
    const incomingAlerts = data.alerts;
    untrack(() => {
      items = incoming.map((e) => ({ ...e }));
      alerts = incomingAlerts.map((a) => ({ ...a }));
      statuses = {};
      cursor = 0;
      rowEls = [];
    });
  });

  const current = $derived(items[cursor] ?? null);
  const resolvedCount = $derived(Object.keys(statuses).length);
  const remaining = $derived(items.length - resolvedCount);
  const progressPct = $derived(items.length ? Math.round((resolvedCount / items.length) * 100) : 0);

  $effect(() => {
    const i = cursor;
    rowEls[i]?.scrollIntoView({ block: 'nearest' });
  });

  function notify(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3200);
  }

  function statusOf(item: QueueItem): Status {
    return statuses[item.id] ?? 'pending';
  }

  /** Next index in `delta`'s direction that still needs a decision. */
  function nextPending(from: number, delta: number): number {
    for (let i = from; i >= 0 && i < items.length; i += delta) {
      if (statusOf(items[i]) === 'pending') return i;
    }
    return -1;
  }

  function move(delta: number) {
    const next = nextPending(cursor + delta, delta);
    if (next !== -1) {
      cursor = next;
      return;
    }
    // Nothing pending that way — step one row anyway so the list is still
    // browsable once the queue is cleared.
    cursor = Math.min(items.length - 1, Math.max(0, cursor + delta));
  }

  /** After a decision: forward to the next open item, else back to one. */
  function advance() {
    const forward = nextPending(cursor + 1, 1);
    if (forward !== -1) {
      cursor = forward;
      return;
    }
    const back = nextPending(cursor - 1, -1);
    if (back !== -1) cursor = back;
  }

  async function triage(body: Record<string, unknown>): Promise<any> {
    const res = await fetch('/api/jkai/intel/triage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function decide(item: QueueItem | null, action: 'confirm' | 'reject') {
    if (!item || busyId || statusOf(item) !== 'pending') return;
    busyId = item.id;
    try {
      await triage({ action, entityId: item.id });
      statuses = { ...statuses, [item.id]: action === 'confirm' ? 'confirmed' : 'rejected' };
      notify(action === 'confirm' ? `Confirmed ${item.name}` : `Deleted ${item.name}`);
      advance();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed');
    } finally {
      busyId = null;
    }
  }

  async function toggleWatch(item: QueueItem | null) {
    if (!item || busyId) return;
    busyId = item.id;
    const next = !item.watched;
    try {
      await triage({ action: next ? 'watch' : 'unwatch', entityId: item.id });
      item.watched = next;
      notify(next ? `Watching ${item.name}` : `Stopped watching ${item.name}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed');
    } finally {
      busyId = null;
    }
  }

  async function retype(item: QueueItem | null, typeId: string) {
    if (!item || !typeId || typeId === item.typeId) return;
    busyId = item.id;
    try {
      const body = await triage({ action: 'retype', entityId: item.id, typeId });
      item.typeId = typeId;
      item.typeName = body.type?.name ?? item.typeName;
      item.typeIcon = body.type?.icon ?? item.typeIcon;
      notify(`Retyped to ${body.type?.name ?? typeId}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Retype failed');
    } finally {
      busyId = null;
    }
  }

  function openMerge() {
    if (!current) return;
    mergeOpen = true;
    mergeQuery = current.name;
    runMergeSearch(current.name);
    queueMicrotask(() => mergeInputEl?.select());
  }

  function closeOverlays() {
    mergeOpen = false;
    showHelp = false;
  }

  function onMergeInput(value: string) {
    mergeQuery = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runMergeSearch(value), 220);
  }

  async function runMergeSearch(text: string) {
    const term = text.trim();
    if (!term) {
      mergeResults = [];
      return;
    }
    const seq = ++searchSeq;
    mergeLoading = true;
    try {
      const params = new URLSearchParams({ q: term, pageSize: '10', sort: 'connections' });
      const res = await fetch(`/api/jkai/intel/entities?${params}`);
      const body = res.ok ? await res.json() : { entities: [] };
      // A slower earlier request must not overwrite a newer result set.
      if (seq !== searchSeq) return;
      mergeResults = (body.entities ?? []).filter((e: { id: string }) => e.id !== current?.id);
    } finally {
      if (seq === searchSeq) mergeLoading = false;
    }
  }

  async function mergeInto(keepId: string) {
    const item = current;
    if (!item || busyId) return;
    busyId = item.id;
    try {
      await triage({ action: 'merge', entityId: item.id, keepId });
      statuses = { ...statuses, [item.id]: 'merged' };
      mergeOpen = false;
      notify(`Merged ${item.name} into the selected entity`);
      advance();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      busyId = null;
    }
  }

  const QUICK_REASONS = ['Not relevant', 'Already known', 'Wrong entity', 'Acted on'];

  async function dismissAlert(alertId: string, reason: string) {
    try {
      await triage({ action: 'dismiss-alert', alertId, reason });
      alerts = alerts.filter((a) => a.id !== alertId);
      dismissingId = null;
      dismissReason = '';
      notify(reason ? `Dismissed — "${reason}"` : 'Dismissed');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Dismiss failed');
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

    // Escape is handled before the typing guard: it is the way out of the merge
    // picker, whose search box has focus by the time you want to leave it.
    if (event.key === 'Escape') {
      if (mergeOpen || showHelp) {
        event.preventDefault();
        closeOverlays();
      }
      return;
    }

    if (isTypingTarget(event.target)) return;
    if (tab !== 'entities') return;

    if (event.key === '?') {
      event.preventDefault();
      showHelp = !showHelp;
      return;
    }
    if (mergeOpen || showHelp) return;

    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Enter':
      case 'y':
        event.preventDefault();
        decide(current, 'confirm');
        break;
      case 'x':
      case 'n':
        event.preventDefault();
        decide(current, 'reject');
        break;
      case 'w':
        event.preventDefault();
        toggleWatch(current);
        break;
      case 'm':
        event.preventDefault();
        openMerge();
        break;
      case 'd':
        // The suggested merge, in one key. Only bound while there IS one, so
        // the key is never a silent no-op.
        if (hintOf(current)) {
          event.preventDefault();
          mergeWithHint(current);
        }
        break;
      case 'D':
        if (hintOf(current)) {
          event.preventDefault();
          dismissHint(current);
        }
        break;
      case 't':
        event.preventDefault();
        retypeEl?.focus();
        break;
    }
  }

  function setOrder(order: string) {
    goto(order === 'impact' ? '?' : `?order=${order}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:window onkeydown={onKeydown} />

<JkaiPageTitle title="INTEL / TRIAGE" titleHref="/jkai/intel" />

<div class="wrap">
  <div class="tabs">
    <button type="button" class:on={tab === 'entities'} onclick={() => (tab = 'entities')}>
      Entities <b>{remaining}</b>
    </button>
    <button type="button" class:on={tab === 'alerts'} onclick={() => (tab = 'alerts')}>
      Alerts <b>{alerts.length}</b>
    </button>
    <div class="spacer"></div>
    {#if tab === 'entities'}
      <label class="order">
        Order
        <select value={data.order} onchange={(e) => setOrder(e.currentTarget.value)}>
          <option value="impact">Most connected</option>
          <option value="recent">Newest</option>
          <option value="weakest">Weakest evidence</option>
        </select>
      </label>
      <button type="button" class="ghost" onclick={() => (showHelp = true)}>? Keys</button>
    {/if}
  </div>

  {#if tab === 'entities'}
    {#if !items.length}
      <p class="empty">Nothing to review. Every entity in the graph has been confirmed.</p>
    {:else}
      <div class="progress">
        <div class="counter">
          <span class="pos">{cursor + 1}</span> of {items.length}
          {#if data.truncated}<span class="backlog">· {data.total} unconfirmed in total</span>{/if}
        </div>
        <div class="bar" role="progressbar" aria-valuenow={resolvedCount} aria-valuemin="0" aria-valuemax={items.length}>
          <span style="width: {progressPct}%"></span>
        </div>
        <div class="counter right">
          {resolvedCount} resolved · {remaining} left
          {#if hintsLoading}
            <span class="backlog">· checking for duplicates…</span>
          {:else if hintsError}
            <span class="backlog warn">· duplicate check failed: {hintsError}</span>
          {:else if hintCount}
            <span class="backlog">· {hintCount} look like something you already have</span>
          {/if}
        </div>
      </div>

      <div class="split">
        <ol class="queue">
          {#each items as item, i (item.id)}
            {@const status = statusOf(item)}
            <li>
              <button
                type="button"
                bind:this={rowEls[i]}
                class="row"
                class:active={i === cursor}
                class:done={status !== 'pending'}
                onclick={() => (cursor = i)}
                aria-current={i === cursor ? 'true' : undefined}
              >
                <span class="icon">{item.typeIcon}</span>
                <span class="who">
                  <span class="name">{item.name}</span>
                  <span class="sub">{item.typeName} · {item.relationshipCount} links · {item.noteCount} sources</span>
                </span>
                {#if status === 'pending'}
                  {#if hints[item.id]}
                    <span class="dup-dot" title="Looks like {hints[item.id].otherName}">⇢</span>
                  {/if}
                  {#if item.watched}<span class="star" title="Watched">★</span>{/if}
                {:else}
                  <span class="mark" class:reject={status === 'rejected'}>
                    {status === 'confirmed' ? '✓' : status === 'merged' ? '⇢' : '✕'}
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ol>

        <div class="detail">
          {#if current}
            {@const status = statusOf(current)}
            <header>
              <span class="big-icon">{current.typeIcon}</span>
              <div class="headline">
                <h2>{current.name}</h2>
                <p class="meta">
                  {current.typeName}
                  · {current.confidence} confidence
                  · {current.corroboration} corroborating
                  {#if current.sourceGrade}· grade {current.sourceGrade}{/if}
                  · added {new Date(current.createdAt).toLocaleDateString()}
                </p>
              </div>
              {#if status !== 'pending'}
                <span class="resolved" class:reject={status === 'rejected'}>{status}</span>
              {/if}
            </header>

            {#if current.summary}
              <p class="summary">{current.summary}</p>
            {/if}

            {#if current.aliases?.length}
              <div class="chips">
                {#each current.aliases as alias (alias)}<span class="chip">{alias}</span>{/each}
              </div>
            {/if}

            {#if hintOf(current)}
              {@const hint = hintOf(current)!}
              <!-- The question triage never asked. Confirming here creates a
                   second node for something the graph already holds. -->
              <div class="dup-hint">
                <div class="dh-text">
                  <span class="dh-kicker">Looks like an entity you already have</span>
                  <a class="dh-name" href="/jkai/intel/entities/{hint.otherId}">
                    {hint.otherName}<em>{hint.otherType}</em>
                  </a>
                  <p class="dh-why">{hint.reason} · {Math.round(hint.confidence * 100)}% confident</p>
                  {#if hint.rationale}
                    <p class="dh-why dh-read">{hint.rationale}</p>
                  {/if}
                </div>
                <div class="dh-acts">
                  <button
                    type="button"
                    class="primary"
                    disabled={busyId === current.id || status !== 'pending'}
                    onclick={() => mergeWithHint(current)}
                  >
                    {hint.keepId === current.id ? 'Absorb it' : 'Merge into it'} <kbd>d</kbd>
                  </button>
                  <button type="button" onclick={() => dismissHint(current)}>
                    Two things <kbd>⇧D</kbd>
                  </button>
                </div>
              </div>
            {/if}

            <section>
              <h3>Evidence</h3>
              {#if current.evidence.length}
                <ul class="evidence">
                  {#each current.evidence as ev (ev.noteId + ev.excerpt)}
                    <li>
                      {#if ev.excerpt}
                        <blockquote>{ev.excerpt}</blockquote>
                      {:else}
                        <p class="noquote">No excerpt was captured for this mention.</p>
                      {/if}
                      <a class="src" href="/jkai/intel/notes/{ev.noteId}">
                        {ev.noteTitle ?? 'Untitled note'} · {ev.noteSource} · {ev.relevance}
                      </a>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="thin">
                  No source note links to this entity. That is itself a reason to reject — it was
                  extracted and then orphaned.
                </p>
              {/if}
            </section>

            {#if current.neighbours.length}
              <section>
                <h3>Already connected to</h3>
                <div class="chips">
                  {#each current.neighbours as n (n.id)}
                    <a class="chip link" href="/jkai/intel/entities/{n.id}">{n.icon} {n.name}<em>{n.label}</em></a>
                  {/each}
                </div>
              </section>
            {/if}

            <div class="acts">
              <button
                type="button"
                class="primary"
                disabled={busyId === current.id || status !== 'pending'}
                onclick={() => decide(current, 'confirm')}
              >Confirm <kbd>y</kbd></button>
              <button
                type="button"
                class="danger"
                disabled={busyId === current.id || status !== 'pending'}
                onclick={() => decide(current, 'reject')}
              >Reject <kbd>x</kbd></button>
              <button type="button" disabled={busyId === current.id} onclick={() => openMerge()}>
                Merge <kbd>m</kbd>
              </button>
              <button type="button" disabled={busyId === current.id} onclick={() => toggleWatch(current)}>
                {current.watched ? 'Unwatch' : 'Watch'} <kbd>w</kbd>
              </button>
              <label class="retype">
                Type <kbd>t</kbd>
                <select
                  bind:this={retypeEl}
                  value={current.typeId}
                  onchange={(e) => retype(current, e.currentTarget.value)}
                >
                  {#each data.types as t (t.id)}<option value={t.id}>{t.icon} {t.name}</option>{/each}
                </select>
              </label>
              <a class="open" href="/jkai/intel/entities/{current.id}">Open</a>
            </div>
          {:else}
            <p class="empty">Queue cleared.</p>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    {#if !alerts.length}
      <p class="empty">No open alerts.</p>
    {:else}
      <ul class="alerts">
        {#each alerts as alert (alert.id)}
          <li class="alert" class:high={alert.significance === 'high'}>
            <div class="alert-head">
              <span class="sig">{alert.significance}</span>
              <strong>{alert.title}</strong>
              <span class="when">{new Date(alert.createdAt).toLocaleDateString()}</span>
            </div>
            <p class="alert-body">{alert.content}</p>
            {#if dismissingId === alert.id}
              <div class="reason">
                <input
                  placeholder="Why is this not worth keeping?"
                  bind:value={dismissReason}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') dismissAlert(alert.id, dismissReason.trim());
                  }}
                />
                <div class="quick">
                  {#each QUICK_REASONS as reason (reason)}
                    <button type="button" class="ghost" onclick={() => dismissAlert(alert.id, reason)}>{reason}</button>
                  {/each}
                </div>
                <div class="quick">
                  <button type="button" class="primary" onclick={() => dismissAlert(alert.id, dismissReason.trim())}>
                    Dismiss
                  </button>
                  <button type="button" class="ghost" onclick={() => (dismissingId = null)}>Cancel</button>
                </div>
              </div>
            {:else}
              <button type="button" class="ghost" onclick={() => { dismissingId = alert.id; dismissReason = ''; }}>
                Dismiss with reason
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

{#if mergeOpen && current}
  <div class="overlay">
    <div class="panel">
      <header>
        <h2>Merge “{current.name}” into…</h2>
        <button type="button" class="ghost" onclick={closeOverlays}>Esc</button>
      </header>
      <p class="muted">
        The entity under review becomes an alias of whichever you pick — its notes, edges and
        timeline move across, and the choice stays reversible.
      </p>
      <input
        bind:this={mergeInputEl}
        value={mergeQuery}
        oninput={(e) => onMergeInput(e.currentTarget.value)}
        placeholder="Search entities"
        aria-label="Search entities to merge into"
      />
      {#if mergeLoading}
        <p class="muted">Searching…</p>
      {:else if !mergeResults.length}
        <p class="muted">No other entity matches.</p>
      {:else}
        <ul class="results">
          {#each mergeResults as r (r.id)}
            <li>
              <button type="button" onclick={() => mergeInto(r.id)}>
                <span>{r.typeIcon} {r.name}</span>
                <em>{r.typeName} · {r.relationshipCount} links</em>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

{#if showHelp}
  <div class="overlay">
    <div class="panel">
      <header>
        <h2>Keyboard</h2>
        <button type="button" class="ghost" onclick={closeOverlays}>Esc</button>
      </header>
      <dl class="keys">
        <dt><kbd>j</kbd> <kbd>↓</kbd></dt><dd>Next undecided entity</dd>
        <dt><kbd>k</kbd> <kbd>↑</kbd></dt><dd>Previous undecided entity</dd>
        <dt><kbd>y</kbd> <kbd>⏎</kbd></dt><dd>Confirm</dd>
        <dt><kbd>x</kbd> <kbd>n</kbd></dt><dd>Reject — deletes the entity</dd>
        <dt><kbd>m</kbd></dt><dd>Merge into an existing entity</dd>
        <dt><kbd>d</kbd></dt><dd>Apply the suggested merge, when there is one</dd>
        <dt><kbd>⇧D</kbd></dt><dd>Record that the suggestion is two different things</dd>
        <dt><kbd>w</kbd></dt><dd>Watch / unwatch</dd>
        <dt><kbd>t</kbd></dt><dd>Change type</dd>
        <dt><kbd>?</kbd></dt><dd>This help</dd>
      </dl>
      <p class="muted">Keys are ignored while you are typing in a field.</p>
    </div>
  </div>
{/if}

{#if toast}
  <div class="toast">{toast}</div>
{/if}

<style>
  .wrap {
    padding: 16px 20px 28px;
    /* Full-bleed, like every Intel surface — a centred column beside a
       full-width graph read as a bug. Prose keeps its own measure below. */
    width: 100%;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-hair);
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .tabs .spacer {
    flex: 1;
  }
  .tabs > button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 6px 11px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .tabs > button.on {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .tabs > button b {
    font-weight: 500;
    color: var(--text-muted);
  }
  .order {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .counter {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .counter .pos {
    color: var(--accent);
    font-size: var(--fs-label);
  }
  .counter .backlog.warn {
    color: var(--warn);
  }
  .counter .backlog {
    color: var(--text-ghost);
  }
  .bar {
    flex: 1;
    min-width: 120px;
    height: 3px;
    background: var(--line);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--t-fast) var(--ease-out);
  }

  .split {
    display: grid;
    grid-template-columns: minmax(240px, 340px) 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 860px) {
    .split {
      grid-template-columns: 1fr;
    }
    .queue {
      max-height: 260px;
    }
  }

  .queue {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 70vh;
    overflow-y: auto;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    background: transparent;
    border: 0;
    border-left: 2px solid transparent;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
  }
  .row:hover {
    background: var(--surface-overlay);
  }
  .row.active {
    border-left-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .row.done {
    opacity: 0.42;
  }
  .row .icon {
    font-size: var(--fs-body);
    line-height: 1;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: var(--fs-body-sm);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .star {
    color: var(--accent);
    font-size: var(--fs-label);
  }
  .dup-dot {
    color: var(--accent-ink);
    font-size: var(--fs-label);
  }

  /* The suggestion banner, above the evidence: it changes which QUESTION you
     are answering, so it has to be read before the evidence rather than after
     it. */
  .dup-hint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin: 0 0 14px;
    padding: 11px 13px;
    border: 1px solid var(--accent-ink);
    border-left-width: 3px;
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
  }
  .dh-text {
    min-width: 0;
  }
  .dh-kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-ink);
  }
  .dh-name {
    display: inline-block;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    text-decoration: none;
  }
  .dh-name:hover {
    color: var(--accent);
  }
  .dh-name em {
    font-style: normal;
    margin-left: 7px;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .dh-why {
    margin: 3px 0 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.45;
  }
  .dh-read {
    color: var(--text-ghost);
    font-style: italic;
  }
  .dh-acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .mark {
    color: var(--success);
    font-size: var(--fs-nav);
  }
  .mark.reject {
    color: var(--error);
  }

  .detail {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--card-bg);
    padding: 16px;
  }
  .detail > header {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    margin-bottom: 10px;
  }
  .big-icon {
    font-size: 1.625rem;
    line-height: 1;
  }
  .headline {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-body-lg);
    font-weight: 600;
    word-break: break-word;
  }
  .meta {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .resolved {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--success);
    border: 1px solid var(--success-border);
    border-radius: var(--radius-sharp);
    padding: 2px 7px;
  }
  .resolved.reject {
    color: var(--error);
    border-color: var(--error-border);
  }
  .summary {
    margin: 0 0 12px;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  section {
    margin-bottom: 14px;
  }
  h3 {
    margin: 0 0 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    font-weight: 500;
  }
  .evidence {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  blockquote {
    margin: 0;
    padding: 8px 11px;
    background: var(--surface-sunken);
    border-left: 2px solid var(--accent-tint-35);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .noquote,
  .thin {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .src {
    display: inline-block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: none;
  }
  .src:hover {
    text-decoration: underline;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-size: var(--fs-label-xs);
    padding: 3px 9px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    text-decoration: none;
  }
  .chip em {
    font-style: normal;
    font-family: var(--font-mono);
    color: var(--text-ghost);
  }
  .chip.link:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  .acts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--line-hair);
  }
  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #fff;
  }
  button.danger {
    border-color: var(--error-border);
    color: var(--error);
  }
  button.danger:hover:not(:disabled) {
    border-color: var(--error);
    color: var(--error);
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 1px 4px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
  }
  .retype {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }
  select,
  input {
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-body);
    font-family: var(--font-body);
    text-transform: none;
    letter-spacing: 0;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .open {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-ink);
    text-decoration: none;
    margin-left: auto;
  }
  .open:hover {
    text-decoration: underline;
  }

  .alerts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .alert {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    padding: 11px 13px;
  }
  .alert.high {
    border-left-color: var(--error);
  }
  .alert-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sig {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .when {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .alert-body {
    margin: 6px 0 9px;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .reason {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .reason input {
    width: 100%;
  }
  .quick {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh 16px 16px;
    background: rgba(26, 16, 8, 0.35);
  }
  .panel {
    width: min(560px, 100%);
    /* Opaque: a floating panel over the grain background is unreadable otherwise. */
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    padding: 16px;
  }
  .panel > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .panel h2 {
    font-size: var(--fs-body);
  }
  .panel input {
    width: 100%;
    margin-bottom: 10px;
  }
  .muted {
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 46vh;
    overflow-y: auto;
  }
  .results button {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    text-transform: none;
    letter-spacing: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    border-color: transparent;
    border-bottom: 1px solid var(--line-hair);
    border-radius: 0;
    color: var(--text-primary);
  }
  .results em {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0 0 10px;
  }
  .keys dt {
    display: flex;
    gap: 4px;
  }
  .keys dd {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }

  .empty {
    padding: 48px 0;
    text-align: center;
    font-size: var(--fs-body-sm);
    color: var(--text-ghost);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 140;
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
