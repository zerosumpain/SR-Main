<svelte:head><title>Notes — JKAI</title></svelte:head>
<script lang="ts">
  // ── The notebook ─────────────────────────────────────────────────────────
  //
  // "Open, title, text, save, close. Usable."
  //
  // So: a list on the left, one big writing surface on the right, and nothing
  // between having an idea and typing it. `New note` puts the cursor in the
  // body immediately — an untitled note is a real note, and demanding a title
  // first is exactly the friction that stops one being made.
  //
  // Everything the ENGINE adds lives below the writing surface and is visibly
  // the engine's: the supporting block is attributed and separately clearable,
  // and the action list says what was planned and what actually ran. The body
  // box only ever contains what John typed.
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import NoteRecorder from '$lib/components/jkai/NoteRecorder.svelte';
  import {
    SINK_STORAGE_KEY,
    canChooseOutput,
    canRequestMic,
    canRouteOutput,
    micPermissionStatus,
    micStateNote,
    outputLabel,
    unblockHint,
    type MicPermission,
  } from '$lib/jkai/media/audio-access';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Note = PageData['notes'][number];
  type Action = {
    id: string; kind: string; title: string; status: string;
    error: string | null; result: string | null;
    refKind: string | null; refId: string | null;
    plannedAt: string; executedAt: string | null;
  };

  let notes = $state<Note[]>(data.notes ?? []);
  let folders = $state<string[]>(data.folders ?? []);
  let openId = $state<string | null>(null);
  let title = $state('');
  let body = $state('');
  let folder = $state('');
  let actions = $state<Action[]>([]);
  let supporting = $state<string | null>(null);
  type Recording = {
    id: string; mimeType: string; sizeBytes: number; durationSec: number | null;
    transcript: string | null; language: string | null; engine: string | null; createdAt: string;
  };
  let recordings = $state<Recording[]>([]);

  // ── Microphone and speakers ──────────────────────────────────────────────
  // Two different things. The mic is a real permission that can be asked for
  // ahead of the first recording; the speaker is a routing choice with no
  // permission behind it at all. Both are read defensively — see
  // $lib/jkai/media/audio-access.
  let micState = $state<MicPermission>('unknown');
  let micAskable = $state(false);
  let outputChoosable = $state(false);
  let sinkId = $state<string>('');
  let sinkName = $state<string>('System default');
  let audioNote = $state<string | null>(null);
  /** Read once on mount — `navigator` does not exist during SSR. */
  let browserUa = $state('');
  /** False until the permission has actually been read. Without it the first
   *  paint shows "state unknown" with no button for a frame or two, because the
   *  component renders before onMount runs — a message that flashes and then
   *  changes its mind is worse than one that waits. */
  let micReady = $state(false);

  /** Ask once, ahead of recording, so the first note is not interrupted by a
   *  permission dialog mid-thought. The tracks are stopped immediately — the
   *  grant is the only thing wanted here, not a stream. */
  /**
   * Ask for the microphone.
   *
   * Worth attempting even when the last read said `denied`: a browser will not
   * re-open the prompt after a PERSISTENT block, but Firefox's default block is
   * only for the session unless "Remember this decision" was ticked, and a read
   * can be stale. If it does throw, the message names the exact control that
   * unblocks it — a page has no way to bring the prompt back itself.
   */
  async function requestMic() {
    audioNote = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micState = 'granted';
      audioNote = 'Microphone allowed.';
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        audioNote = 'No microphone found on this device.';
        return;
      }
      micState = name === 'NotAllowedError' ? 'denied' : micState;
      audioNote = micStateNote(micState, navigator.userAgent);
    }
  }

  /** Chromium's output picker. Returns the device the user chose; everything
   *  that plays on this page is then routed to it. */
  async function chooseOutput() {
    audioNote = null;
    try {
      const device = await (
        navigator.mediaDevices as unknown as {
          selectAudioOutput: () => Promise<MediaDeviceInfo>;
        }
      ).selectAudioOutput();
      sinkId = device.deviceId ?? '';
      sinkName = outputLabel(device);
      try {
        localStorage.setItem(SINK_STORAGE_KEY, JSON.stringify({ id: sinkId, name: sinkName }));
      } catch {
        /* private mode — the choice just will not survive a reload */
      }
    } catch {
      // Dismissing the picker is a normal outcome, not an error worth shouting.
    }
  }

  function useSystemOutput() {
    sinkId = '';
    sinkName = 'System default';
    try {
      localStorage.removeItem(SINK_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Route one <audio> to the chosen device.
   *
   * An action rather than an $effect: it reads and writes the node it is given
   * and nothing else, which is exactly the shape an effect gets wrong here (and
   * the same reasoning as the autogrow action elsewhere). `update` re-runs it
   * when the sink changes, so a new choice reaches players already on screen.
   */
  function sink(node: HTMLAudioElement, id: string) {
    const apply = (value: string) => {
      const el = node as HTMLAudioElement & { setSinkId?: (v: string) => Promise<void> };
      if (typeof el.setSinkId !== 'function') return;
      // '' is the documented way to say "system default" — not a no-op.
      el.setSinkId(value).catch(() => {
        // A device can vanish between choosing and playing. Falling back to the
        // default beats throwing inside an action.
      });
    };
    apply(id);
    return { update: apply };
  }
  /** One flag for both entry points: the cover's recorder and the editor's
   *  share an upload, and neither should accept a second while one is running. */
  let transcribing = $state(false);

  let saving = $state(false);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let preview = $state(false);
  let query = $state('');
  let folderFilter = $state('');

  // The open note, as last saved. Compared against the boxes to decide whether
  // there is anything to save.
  // This must be reactive: saving changes the comparison value without changing
  // any of the fields. A plain `let` left the Save button saying "Save" until
  // the next keystroke even though the request had completed.
  let savedSnapshot = $state('');
  const dirty = $derived(openId != null && `${title}\0${body}\0${folder}` !== savedSnapshot);

  const open = $derived(notes.find((n) => n.id === openId) ?? null);
  const wordCount = $derived(body.trim() ? body.trim().split(/\s+/).length : 0);
  const readMinutes = $derived(Math.max(1, Math.ceil(wordCount / 220)));

  /** A note's display name. Falls back to its first line, because an untitled
   *  note is normal and "(untitled)" thirty times is a useless list. */
  function label(n: { title: string; body: string }): string {
    if (n.title.trim()) return n.title.trim();
    const first = n.body.split('\n').find((l) => l.trim());
    return first ? first.trim().slice(0, 60) : 'Empty note';
  }

  function excerpt(n: { title: string; body: string }): string {
    const clean = n.body.replace(/[#*_>`\-[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean || (n.title.trim() ? 'No body yet.' : 'Empty note');
  }

  function calendarDate(iso: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  }

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (folderFilter && n.folder !== folderFilter) return false;
      if (!q) return true;
      return `${n.title}\n${n.body}\n${n.folder}`.toLowerCase().includes(q);
    });
  });

  async function post(payload: Record<string, unknown>) {
    const res = await fetch('/api/daydream/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || out.error) throw new Error(String(out.error ?? 'that did not work'));
    return out;
  }

  /**
   * Send a recording up. `noteId` empty means "make a note out of this"; set
   * means "append it to the one that is open".
   *
   * Transcription is synchronous by design — a dictated note is worth waiting a
   * few seconds for, and a half-finished note appearing before its words is
   * worse than a spinner. The audio is kept either way: if transcription fails
   * the server still stores the recording and says so, because the recording is
   * the part that cannot be made again.
   */
  async function uploadRecording(blob: Blob, durationSec: number, noteId: string) {
    if (transcribing) return;
    transcribing = true;
    error = null;
    notice = null;
    try {
      if (noteId && dirty && !(await save({ quiet: true }))) return;
      const form = new FormData();
      form.append('audio', new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }));
      form.append('durationSec', String(durationSec));
      if (noteId) form.append('noteId', noteId);
      else if (folderFilter) form.append('folder', folderFilter);

      const res = await fetch('/api/daydream/notes/audio', { method: 'POST', body: form });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(out.message ?? out.error ?? 'that did not work'));

      const n = out.note as Note | null;
      if (!n) throw new Error('the server saved no note');
      const recs = (out.recordings ?? []) as Recording[];
      notes = notes.some((x) => x.id === n.id)
        ? notes.map((x) => (x.id === n.id ? n : x))
        : [n, ...notes];
      applyOpen(n, recs);
      if (!noteId) actions = [];
      preview = false;
      setOpenInUrl(n.id);
      // `ok: false` is the transcription-failed case — the recording is saved
      // and playable, so this is a notice about the words, not a failed upload.
      if (out.ok === false) error = String(out.error ?? 'Transcription failed.');
      else notice = 'Transcribed into the note.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      transcribing = false;
    }
  }

  async function deleteRecording(id: string) {
    if (!confirm('Delete this recording? The transcript stays in the note.')) return;
    try {
      const res = await fetch(`/api/daydream/notes/audio/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('could not delete that recording');
      recordings = recordings.filter((r) => r.id !== id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function clockFrom(seconds: number | null): string {
    if (!seconds || !Number.isFinite(seconds)) return '—';
    const m = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function setOpenInUrl(id: string | null) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('open', id);
    else url.searchParams.delete('open');
    window.history.replaceState(window.history.state, '', url);
  }

  async function openNote(id: string) {
    // Never lose typing to a click on another note.
    if (dirty && !(await save({ quiet: true }))) return;
    error = null;
    notice = null;
    preview = false;
    try {
      const out = await post({ action: 'get', id });
      const n = out.note as Note;
      applyOpen(n, (out.recordings ?? []) as Recording[]);
      actions = (out.actions ?? []) as Action[];
      setOpenInUrl(n.id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function applyOpen(n: Note, recs?: Recording[]) {
    // Undefined means "same note, new fields" — the callers that re-apply an
    // open note after a review, a pin or a clear have no recordings to pass and
    // must not wipe the ones on screen. Only a genuinely different note passes
    // a list (or an empty one).
    if (recs !== undefined) recordings = recs;
    openId = n.id;
    title = n.title;
    body = n.body;
    folder = n.folder;
    supporting = n.supporting;
    savedSnapshot = `${n.title}\0${n.body}\0${n.folder}`;
    notes = notes.map((x) => (x.id === n.id ? n : x));
  }

  async function newNote() {
    if (dirty && !(await save({ quiet: true }))) return;
    error = null;
    notice = null;
    try {
      const out = await post({ action: 'save', title: '', body: '', folder: folderFilter });
      const n = out.note as Note;
      notes = [n, ...notes];
      applyOpen(n, []);
      actions = [];
      preview = false;
      setOpenInUrl(n.id);
      queueMicrotask(() => bodyEl?.focus());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  let bodyEl: HTMLTextAreaElement | undefined = $state();

  async function save(opts: { quiet?: boolean } = {}): Promise<boolean> {
    if (!openId || !dirty) return true;
    saving = true;
    error = null;
    try {
      const out = await post({ action: 'save', id: openId, title, body, folder });
      const n = out.note as Note;
      savedSnapshot = `${n.title}\0${n.body}\0${n.folder}`;
      notes = notes.map((x) => (x.id === n.id ? n : x));
      if (n.folder && !folders.includes(n.folder)) folders = [...folders, n.folder].sort();
      if (!opts.quiet) notice = 'Saved.';
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      saving = false;
    }
  }

  async function closeNote() {
    if (dirty && !(await save({ quiet: true }))) return;
    openId = null;
    title = '';
    body = '';
    folder = '';
    actions = [];
    recordings = [];
    supporting = null;
    savedSnapshot = '';
    notice = null;
    setOpenInUrl(null);
  }

  async function removeNote() {
    if (!openId) return;
    // A note is typed by hand and deletion is the one thing here that cannot be
    // undone, so it asks. Archiving is the soft option and is one click away.
    if (!confirm('Delete this note for good? Archiving keeps it and hides it.')) return;
    const id = openId;
    busy = 'delete';
    try {
      await post({ action: 'delete', id });
      notes = notes.filter((n) => n.id !== id);
      await closeNote();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function archiveNote() {
    if (!openId) return;
    if (dirty && !(await save({ quiet: true }))) return;
    busy = 'archive';
    try {
      await post({ action: 'save', id: openId, status: 'archived' });
      notes = notes.filter((n) => n.id !== openId);
      await closeNote();
      notice = 'Archived — it is kept, just not listed.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  /** Run the review now rather than waiting for a quiet hour. */
  async function reviewNow() {
    if (!openId) return;
    if (dirty && !(await save({ quiet: true }))) return;
    busy = 'review';
    error = null;
    notice = null;
    try {
      const out = await post({ action: 'review_now', id: openId });
      const n = out.note as Note;
      applyOpen(n);
      actions = (out.actions ?? []) as Action[];
      const refused = (out.refused ?? []) as Array<{ error: string }>;
      notice =
        `${out.summary || 'Read it.'} — ${out.planned} planned, ${out.done} done` +
        (out.failed ? `, ${out.failed} failed` : '') +
        (refused.length ? `, ${refused.length} refused` : '');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function weaveNow() {
    if (!openId) return;
    if (dirty && !(await save({ quiet: true }))) return;
    busy = 'weave';
    error = null;
    try {
      const out = (await post({ action: 'weave', id: openId })) as {
        weave?: { status: string; entityCount?: number; chars?: number; error?: string; reason?: string };
      };
      const w = out.weave;
      notice =
        w?.status === 'woven'
          ? `Into the graph — ${w.entityCount ?? 0} entit${w.entityCount === 1 ? 'y' : 'ies'}.`
          : w?.status === 'unchanged'
            ? 'Already in the graph, unchanged.'
            : w?.status === 'too-thin'
              ? `Too short to extract (${w.chars ?? 0} characters).`
              : `Not woven: ${w?.error ?? w?.reason ?? w?.status ?? 'unknown'}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function clearSupport() {
    if (!openId) return;
    if (dirty && !(await save({ quiet: true }))) return;
    busy = 'clear';
    try {
      const out = await post({ action: 'clear_supporting', id: openId });
      applyOpen(out.note as Note);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function togglePin() {
    if (!openId || !open) return;
    if (dirty && !(await save({ quiet: true }))) return;
    busy = 'pin';
    error = null;
    try {
      const out = await post({ action: 'save', id: openId, pinned: !open.pinned });
      const n = out.note as Note;
      applyOpen(n);
      notes = [...notes].sort((a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      );
      notice = n.pinned ? 'Pinned to the top.' : 'Unpinned.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  /** Where an action's result actually lives. Built here rather than stored, so
   *  a new ref kind is one line and never a migration. */
  function refHref(a: Action): string | null {
    if (!a.refKind || !a.refId) return null;
    if (a.refKind === 'research') return `/research/${a.refId}`;
    if (a.refKind === 'intel-entity') return `/jkai/intel/entities/${a.refId}`;
    if (a.refKind === 'intel-note') return `/jkai/intel/notes/${a.refId}`;
    if (a.refKind === 'note') return `/jkai/notes?open=${a.refId}`;
    return null;
  }

  function when(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  const rendered = $derived(
    sanitizeChatHtml(marked.parse(body || '', { async: false }) as string),
  );
  const renderedSupport = $derived(
    supporting
      ? sanitizeChatHtml(marked.parse(supporting, { async: false }) as string)
      : '',
  );

  // ⌘S / Ctrl+S saves, Escape closes. A writing surface that needs the mouse to
  // save is one people lose work in.
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape' && openId) {
      void closeNote();
    } else if (!e.repeat && (e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      void newNote();
    }
  }

  // Quiet autosave makes the notebook trustworthy during long writing sessions.
  // The explicit button remains useful feedback and a keyboard target.
  $effect(() => {
    const shouldSave = dirty;
    const currentId = openId;
    title;
    body;
    folder;
    if (!shouldSave || !currentId || saving) return;
    const timer = window.setTimeout(() => void save({ quiet: true }), 1200);
    return () => window.clearTimeout(timer);
  });

  onMount(() => {
    const q = new URL(location.href).searchParams.get('open');
    if (q) void openNote(q);

    // Read the microphone state without prompting, so the page can say what is
    // wrong before a click fails, and restore a previously chosen speaker.
    browserUa = navigator.userAgent;
    micAskable = canRequestMic(navigator, window.isSecureContext);
    outputChoosable = canChooseOutput(navigator) && canRouteOutput();
    // Subscribe, not just read: when the block is lifted in the browser's own
    // UI the page becomes usable immediately instead of needing a reload.
    void micPermissionStatus(navigator, window.isSecureContext).then(({ state, status }) => {
      micState = state;
      micReady = true;
      status?.addEventListener('change', (e) => {
        const next = (e.target as { state?: string } | null)?.state;
        if (next === 'granted' || next === 'denied' || next === 'prompt') {
          micState = next;
          audioNote = next === 'granted' ? 'Microphone allowed.' : null;
        }
      });
    });
    try {
      const saved = localStorage.getItem(SINK_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { id?: string; name?: string };
        if (parsed.id) {
          sinkId = parsed.id;
          sinkName = parsed.name || 'Selected output';
        }
      }
    } catch {
      /* ignore a corrupt or unreadable value — the default is fine */
    }
    // Saving on the way out costs nothing and is the difference between a
    // notebook you trust and one you do not.
    const leave = () => {
      if (dirty && openId) {
        navigator.sendBeacon?.(
          '/api/daydream/notes',
          new Blob([JSON.stringify({ action: 'save', id: openId, title, body, folder })], {
            type: 'application/json',
          }),
        );
      }
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="notebook">
  <section class="cover">
    <div class="cover-inner">
      <div class="cover-copy">
        <p class="wordmark"><span>&gt;</span> strangeramblings.com<em>/jkai/notes</em></p>
        <p class="kicker">Notebook · private working memory</p>
        <h1>A place to think.</h1>
        <p class="standfirst">
          Capture the unfinished thing. The engine can research around it and weave it into the
          graph, but your words remain your own.
        </p>
      </div>
      <div class="cover-readout">
        <button type="button" class="new-note" onclick={newNote}>+ New note</button>
        <div class="cover-rec">
          <NoteRecorder
            tone="ink"
            label="Voice note"
            busy={transcribing}
            disabled={micState === 'insecure'}
            onrecorded={(blob, secs) => uploadRecording(blob, secs, '')}
          />
          {#if micReady && micState !== 'granted'}
            <p class="mic-ask">
              {#if micAskable}
                <button type="button" onclick={requestMic}>
                  {micState === 'denied' ? 'Try again' : 'Allow microphone'}
                </button>
              {/if}
              <span>{audioNote ?? micStateNote(micState, browserUa)}</span>
            </p>
          {:else if audioNote}
            <p class="mic-ask"><span>{audioNote}</span></p>
          {/if}
        </div>
        <p><span>Active</span>{notes.length} note{notes.length === 1 ? '' : 's'}</p>
        <p><span>Folders</span>{folders.length || '—'}</p>
        <p><span>Save</span>Automatic · 1.2s</p>
        <a href="/jkai/daydreams">Daydream engine ↗</a>
      </div>
    </div>
  </section>

  {#if data.loadError || error || notice}
    <div class="notices" aria-live="polite">
      {#if data.loadError}<p class="err">Could not read the notebook: {data.loadError}</p>{/if}
      {#if error}<p class="err">{error}</p>{/if}
      {#if notice}<p class="ok">{notice}</p>{/if}
    </div>
  {/if}

  <div class="workspace">
    <aside class="library" aria-label="Notebook library">
      <div class="library-head">
        <div>
          <p class="section-no">01 / Library</p>
          <h2>YOUR NOTES</h2>
        </div>
        <span>{visible.length}/{notes.length}</span>
      </div>

      <label class="search-wrap">
        <span aria-hidden="true">⌕</span>
        <span class="sr-only">Search notes</span>
        <input bind:value={query} placeholder="Search title, body or folder" />
        {#if query}<button type="button" aria-label="Clear search" onclick={() => (query = '')}>×</button>{/if}
      </label>

      {#if folders.length}
        <div class="folders" aria-label="Filter by folder">
          <button type="button" class:on={folderFilter === ''} onclick={() => (folderFilter = '')}>All</button>
          {#each folders as f (f)}
            <button type="button" class:on={folderFilter === f} onclick={() => (folderFilter = f)}>{f}</button>
          {/each}
        </div>
      {/if}

      {#if visible.length === 0}
        <div class="empty-list">
          <strong>{notes.length === 0 ? 'The first page is blank.' : 'No matches.'}</strong>
          <p>{notes.length === 0 ? 'An idea, a task, half a post—all are enough to begin.' : 'Try another phrase or clear the folder filter.'}</p>
        </div>
      {:else}
        <ol class="items">
          {#each visible as n, i (n.id)}
            <li>
              <button type="button" class="item" class:on={openId === n.id} onclick={() => openNote(n.id)}>
                <span class="item-index">{String(i + 1).padStart(2, '0')}</span>
                <span class="item-copy">
                  <span class="item-title">
                    {#if n.pinned}<span class="pin" title="Pinned">◆</span>{/if}{label(n)}
                  </span>
                  <span class="item-excerpt">{excerpt(n)}</span>
                  <span class="item-meta">
                    {#if n.folder}<b>{n.folder}</b>{/if}
                    <span>{when(n.updatedAt)}</span>
                    {#if n.supporting}<span class="engine-mark">Engine note</span>{/if}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </aside>

    <main class="editor">
      {#if !openId}
        <div class="blank">
          <p class="section-no">02 / Writing desk</p>
          <p class="blank-mark" aria-hidden="true">✦</p>
          <h2>Start with the rough version.</h2>
          <p>Choose a note from the library, or open a fresh page. Markdown is welcome; polish is optional.</p>
          <button type="button" class="new-note paper" onclick={newNote}>+ New note</button>
          <span class="shortcut">⌘⌥N · NEW &nbsp;&nbsp; ⌘S · SAVE</span>
        </div>
      {:else}
        <div class="editor-head">
          <div class="editor-state">
            <p class="section-no">02 / Writing desk</p>
            <span class:dirty>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
          </div>
          <div class="editor-actions">
            <NoteRecorder
              label="Dictate"
              busy={transcribing}
              disabled={!openId}
              onrecorded={(blob, secs) => uploadRecording(blob, secs, openId ?? '')}
            />
            <button type="button" class:on={preview} onclick={() => (preview = !preview)}>{preview ? 'Edit' : 'Preview'}</button>
            <button type="button" class:on={open?.pinned} disabled={busy === 'pin'} onclick={togglePin}>{open?.pinned ? 'Pinned' : 'Pin'}</button>
            <button type="button" onclick={closeNote}>Close</button>
            <button type="button" class="save" disabled={saving || !dirty} onclick={() => save()}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
          </div>
        </div>

        <article class="page">
          <input class="title" bind:value={title} aria-label="Note title" placeholder="Untitled note" maxlength="200" />
          <div class="note-meta">
            <label>
              <span>Filed under</span>
              <input bind:value={folder} placeholder="No folder" list="nb-folders" maxlength="80" />
            </label>
            <datalist id="nb-folders">{#each folders as f (f)}<option value={f}></option>{/each}</datalist>
            <p><span>Words</span>{wordCount}</p>
            <p><span>Read</span>{readMinutes} min</p>
            {#if open}<p><span>Created</span>{calendarDate(open.createdAt)}</p>{/if}
          </div>

          {#if preview}
            <div class="md body-box">{@html rendered}</div>
          {:else}
            <textarea bind:this={bodyEl} bind:value={body} placeholder="Write the thing before it disappears…" spellcheck="true"></textarea>
          {/if}

          <!-- What was said, kept beside what it became. The body above is
               yours to rewrite; these stay as recorded. -->
          {#if recordings.length}
            <section class="rec-list" aria-label="Recordings">
              <p class="rec-list-hd">
                <span>Recordings</span>
                {#if outputChoosable}
                  <span class="out-pick">
                    <button type="button" onclick={chooseOutput} title="Choose which speakers play these back">
                      Output · {sinkName}
                    </button>
                    {#if sinkId}
                      <button type="button" class="out-reset" onclick={useSystemOutput} title="Back to the system default">reset</button>
                    {/if}
                  </span>
                {/if}
                <span>{recordings.length}</span>
              </p>
              {#each recordings as r (r.id)}
                <article class="rec-row">
                  <div class="rec-row-hd">
                    <span class="rec-when">{when(r.createdAt)} · {clockFrom(r.durationSec)}</span>
                    {#if r.engine}<span class="rec-engine" title={r.engine === 'local' ? 'Transcribed on this machine, at no cost' : 'Transcribed by the metered API'}>{r.engine}</span>{/if}
                    {#if r.language}<span class="rec-lang">{r.language}</span>{/if}
                    <button type="button" class="rec-del" onclick={() => deleteRecording(r.id)}>Delete</button>
                  </div>
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <audio controls preload="metadata" use:sink={sinkId} src={`/api/daydream/notes/audio/${r.id}`}></audio>
                  {#if r.transcript === null}
                    <p class="rec-note">Not transcribed — the audio is safe, the words did not come back.</p>
                  {:else if r.transcript.trim() === ''}
                    <p class="rec-note">Transcribed to nothing — the recording was silent.</p>
                  {/if}
                </article>
              {/each}
            </section>
          {/if}
        </article>

        <section class="engine-deck">
          <div class="engine-head">
            <div>
              <p class="section-no">03 / Engine margin</p>
              <h2>THINK AROUND IT.</h2>
            </div>
            <p>The model works beside your note—never inside it.</p>
          </div>
          <div class="engine-controls">
            <button type="button" class="engine-primary" disabled={busy === 'review'} onclick={reviewNow}>{busy === 'review' ? 'Reading…' : 'Read it now'}</button>
            <button type="button" disabled={busy === 'weave'} onclick={weaveNow}>{busy === 'weave' ? 'Weaving…' : 'Into the graph'}</button>
            <span class="engine-spacer"></span>
            <button type="button" disabled={busy === 'archive'} onclick={archiveNote}>Archive</button>
            <button type="button" class="danger" disabled={busy === 'delete'} onclick={removeNote}>Delete</button>
          </div>

          {#if supporting}
            <div class="support">
              <div class="support-hd">
                <div><span>Supporting note</span><p>Written by the model · {open?.supportingAt ? when(open.supportingAt) : 'recently'}</p></div>
                <button type="button" disabled={busy === 'clear'} onclick={clearSupport}>Clear</button>
              </div>
              <div class="md dark-md">{@html renderedSupport}</div>
            </div>
          {:else if !actions.length}
            <p class="engine-empty">No model work yet. Ask the engine to read this note when it has enough shape.</p>
          {/if}

          {#if actions.length}
            <div class="acts">
              <p class="actions-label">Action ledger · {actions.length}</p>
              <ol class="act-list">
                {#each actions as a (a.id)}
                  {@const href = refHref(a)}
                  <li class="act a-{a.status}">
                    <span class="act-kind">{a.kind}</span>
                    <div class="act-copy"><strong>{a.title}</strong>{#if a.result}<p>{a.result}</p>{/if}{#if a.error}<p class="act-error">{a.error}</p>{/if}</div>
                    <span class="act-state">{a.status === 'done' ? `done · ${when(a.executedAt)}` : a.status === 'refused' ? 'refused' : a.status === 'failed' ? 'failed' : `planned · ${when(a.plannedAt)}`}</span>
                    {#if href}<a {href}>Open ↗</a>{/if}
                  </li>
                {/each}
              </ol>
            </div>
          {/if}
        </section>
      {/if}
    </main>
  </div>

  <footer class="foot">
    <p>strangeramblings.com/jkai/notes · private notebook</p>
    <p>Owner words remain separate from model context</p>
    <p>Autosave · Markdown · Knowledge graph</p>
  </footer>
</div>

<style>
  /* The page follows the shared warm-brutalist system: hard edges, no card
     shadows, one burnt-orange action colour and a separate petrol tone for
     model-authored context. */
  .err,
  .ok {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
  }
  .err { color: var(--error); }
  .ok { color: var(--good); }

  /* Rendered Markdown uses the same reading face as the writing surface. */
  .md { font-size: var(--fs-body-sm); line-height: 1.7; color: var(--text-primary); }
  .md :global(h1), .md :global(h2), .md :global(h3) {
    font-family: var(--font-display);
    line-height: 1.2;
    margin: 1.1em 0 0.4em;
  }
  .md :global(h1) { font-size: 1.35rem; }
  .md :global(h2) { font-size: 1.15rem; }
  .md :global(h3) { font-size: 1rem; }
  .md :global(p) { margin: 0 0 0.8em; }
  .md :global(ul), .md :global(ol) { margin: 0 0 0.8em; padding-left: 1.3em; }
  .md :global(li) { margin: 0.2em 0; }
  .md :global(code) { font-size: max(0.9em, var(--fs-label-xs)); background: var(--accent-tint-08); padding: 1px 4px; }
  .md :global(pre) { background: var(--surface-sunken); border: 1px solid var(--line-hair); padding: 10px 12px; overflow-x: auto; }
  .md :global(pre code) { background: none; padding: 0; }
  .md :global(blockquote) { border-left: 2px solid var(--accent); margin: 0 0 0.8em; padding-left: 0.8em; color: var(--text-secondary); }
  .md :global(a) { color: var(--accent); }
  .md :global(table) { border-collapse: collapse; width: 100%; margin: 0 0 0.8em; }
  .md :global(th), .md :global(td) { border: 1px solid var(--line-hair); padding: 5px 8px; text-align: left; }
  /* ── Notebook v2 ────────────────────────────────────────────────────────
     The health hub's dark instrument / paper editorial rhythm, adapted to an
     application: cover, library instrument rail, paper writing desk, dark
     engine margin. The older declarations above remain intentionally harmless
     for the few shared primitives; this block owns the composed surface. */
  .notebook {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    overflow-x: hidden;
  }
  .cover {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(18px, 2.2vw, 30px) clamp(18px, 3.2vw, 48px) clamp(20px, 2.4vw, 30px);
  }
  .cover-inner {
    max-width: 1500px;
    margin: 0 auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 42px;
  }
  .cover-copy { flex: 1 1 600px; min-width: 0; }
  .wordmark {
    margin: 0 0 9px;
    font-family: var(--font-brand);
    font-size: var(--fs-label);
    color: rgba(237, 228, 212, 0.58);
  }
  .wordmark span { color: var(--accent-on-dark); }
  .wordmark em { color: rgba(237, 228, 212, 0.34); font-style: normal; }
  .cover .kicker {
    margin: 0 0 7px;
    color: var(--accent-on-dark);
  }
  .cover h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 3.9vw, 3.35rem);
    line-height: 0.98;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    color: var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 11px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
    text-wrap: pretty;
  }
  .cover-readout {
    flex: 0 1 404px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: min(100%, 404px);
    border-top: 1px solid rgba(237, 228, 212, 0.25);
  }
  .cover-readout .new-note { grid-column: 1 / -1; }
  /* Left column of the 2x2 keeps clear of the divider; right column clears it
     on the other side. Without both, "automatic · 1.2s" butts "daydream". */
  .cover-readout p:nth-of-type(1),
  .cover-readout p:nth-of-type(3) {
    padding-right: 14px;
  }
  .cover-readout p:nth-of-type(2),
  .cover-readout a {
    padding-left: 14px;
    border-left: 1px solid rgba(237, 228, 212, 0.14);
  }
  .cover-readout p,
  .cover-readout a {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    padding: 8px 0;
    border-bottom: 1px solid rgba(237, 228, 212, 0.14);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    color: rgba(237, 228, 212, 0.78);
  }
  .cover-readout p span { color: rgba(237, 228, 212, 0.38); }
  .cover-readout a { color: var(--accent-on-dark); text-decoration: none; }
  .new-note {
    padding: 10px 16px;
    margin: 0 0 12px;
    border: 1px solid var(--accent-on-dark);
    border-radius: 0;
    background: var(--accent-on-dark);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .new-note:hover { background: var(--bg); border-color: var(--bg); }
  .new-note:focus-visible { outline: 2px solid var(--bg); outline-offset: 3px; }

  .notices {
    max-width: 1500px;
    margin: 0 auto;
    padding: 12px clamp(18px, 3vw, 44px) 0;
  }
  .notices .err,
  .notices .ok { margin: 0 0 7px; padding: 8px 11px; border-left: 3px solid currentColor; background: var(--surface-sunken); }

  .workspace {
    max-width: 1500px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(320px, 0.42fr) minmax(0, 1fr);
    min-height: 520px;
    border-left: 1px solid var(--line-hair);
    border-right: 1px solid var(--line-hair);
  }
  .section-no {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .library {
    min-width: 0;
    background: var(--surface-rail);
    border-right: 1px solid var(--line-strong);
  }
  .library-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 20px 13px;
    border-bottom: 2px solid var(--text-primary);
  }
  .library-head h2,
  .engine-head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.8vw, 2.5rem);
    line-height: 0.95;
  }
  .library-head > span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 12px 16px 8px;
    padding: 0 11px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .search-wrap > span:first-child { color: var(--accent); font-size: var(--fs-body-lg); }
  .search-wrap input {
    flex: 1;
    min-width: 0;
    padding: 9px 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-body);
  }
  .search-wrap button {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-body-lg);
    cursor: pointer;
  }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .folders {
    display: flex;
    gap: 0;
    margin: 0 16px 8px;
    padding-bottom: 4px;
    overflow-x: auto;
  }
  .folders button {
    flex: none;
    padding: 6px 10px;
    border: 0;
    border-bottom: 2px solid var(--line-strong);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .folders button.on { border-bottom-color: var(--accent); color: var(--accent); }
  .items {
    display: block;
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .item {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    gap: 10px;
    width: 100%;
    padding: 10px 16px 11px;
    border: 0;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--line-hair);
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }
  .item:hover { background: var(--accent-tint-04); }
  .item.on { border-left-color: var(--accent); background: var(--bg); }
  .item-index {
    padding-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .item.on .item-index { color: var(--accent); }
  .item-copy { display: block; min-width: 0; }
  .item-title {
    display: block;
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--fs-body);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .pin { margin-right: 6px; color: var(--accent); font-size: var(--fs-label-xs); }
  .item-excerpt {
    display: -webkit-box;
    margin-top: 3px;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    color: var(--text-muted);
    font-size: var(--fs-label);
    line-height: 1.35;
  }
  .item-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 5px; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .item-meta b { color: var(--accent); font-weight: 500; }
  .engine-mark { color: var(--accent-ink); }
  .empty-list { padding: 22px 20px; }
  .empty-list strong { font-family: var(--font-display); font-size: var(--fs-display-xs); }
  .empty-list p { max-width: 28ch; color: var(--text-muted); line-height: 1.5; }

  .editor { min-width: 0; background: var(--bg); }
  /* Top-aligned and compact. Centred in a 650px minimum it read as a second
     page rather than the continuation of the library beside it, and the desk
     opened with ~400px of nothing above the fold. */
  .blank {
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 18px clamp(22px, 3.2vw, 52px) clamp(28px, 3.4vw, 52px);
    border: 0;
    text-align: left;
  }
  .blank-mark { margin: 0 0 10px; color: var(--accent); font-size: 1.35rem; }
  .blank h2 { margin: 0; max-width: 20ch; font-family: var(--font-display); font-size: clamp(1.6rem, 2.8vw, 2.45rem); line-height: 0.98; text-transform: uppercase; }
  .blank > p:not(.section-no):not(.blank-mark) { max-width: 54ch; margin: 12px 0; color: var(--text-muted); font-size: var(--fs-body); line-height: 1.5; }
  .blank .new-note.paper { margin: 2px 0 12px; background: var(--accent); border-color: var(--accent); color: var(--bg); }
  .blank .new-note.paper:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .shortcut { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); letter-spacing: 0.09em; }

  .editor-head {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 20px;
    border-bottom: 1px solid var(--line-strong);
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(10px);
  }
  .editor-state { display: flex; align-items: baseline; gap: 14px; }
  .editor-state .section-no { margin: 0; }
  .editor-state > span { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--good); text-transform: uppercase; letter-spacing: 0.08em; }
  .editor-state > span.dirty { color: var(--warn); }
  .editor-actions { display: flex; align-items: center; gap: 5px; }
  .editor-actions button,
  .engine-controls button,
  .support-hd button {
    padding: 7px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .editor-actions button:hover:not(:disabled), .editor-actions button.on { border-color: var(--accent); color: var(--accent); }
  .editor-actions button.save { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  button:disabled { opacity: 0.48; cursor: not-allowed; }
  button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .page { padding: clamp(22px, 2.6vw, 40px) clamp(22px, 3.6vw, 60px) 46px; }
  .page .title {
    display: block;
    width: 100%;
    margin: 0 0 15px;
    padding: 0 0 12px;
    border: 0;
    border-bottom: 2px solid var(--text-primary);
    border-radius: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-display);
    /* An <input> cannot wrap: at 4.8rem an everyday title ran past the column
       edge and was clipped mid-word. This fits ~34 characters at 1600px. */
    font-size: clamp(1.5rem, 2.5vw, 2.35rem);
    line-height: 1.05;
    text-overflow: ellipsis;
  }
  .page .title::placeholder { color: rgba(26, 16, 8, 0.22); }
  .page .title:focus { border-bottom-color: var(--accent); }
  /* The cover's recorder sits under "+ New note" and spans the readout, so a
     spoken note is a peer of a typed one rather than a hidden alternative. */
  .cover-rec { grid-column: 1 / -1; margin: 0 0 12px; }

  /* Recordings — provenance under the writing surface, not content. Quiet by
     construction: the words are already in the body above. */
  .mic-ask {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.6);
  }
  .mic-ask button {
    padding: 5px 10px;
    border: 1px solid var(--accent-on-dark);
    border-radius: 0;
    background: transparent;
    color: var(--accent-on-dark);
    font: inherit;
    cursor: pointer;
  }
  .mic-ask button:hover { background: var(--accent-on-dark); color: var(--text-primary); }

  .out-pick { display: inline-flex; align-items: center; gap: 8px; }
  .out-pick button {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .out-pick button:hover { color: var(--accent); }
  .out-pick .out-reset { color: var(--text-ghost); }

  .rec-list { margin-top: 26px; padding-top: 14px; border-top: 1px solid var(--line-hair); }
  .rec-list-hd {
    display: flex; justify-content: space-between; gap: 12px; margin: 0 0 10px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-ghost);
  }
  .rec-row { padding: 10px 0; border-bottom: 1px solid var(--line-hair); }
  .rec-row:last-child { border-bottom: 0; }
  .rec-row-hd {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 7px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .rec-when { color: var(--text-muted); }
  .rec-engine { color: var(--accent-ink); }
  .rec-lang { color: var(--text-ghost); }
  .rec-del {
    margin-left: auto; padding: 0; border: 0; background: none; cursor: pointer;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-ghost);
  }
  .rec-del:hover { color: var(--error); }
  .rec-row audio { width: 100%; max-width: 420px; height: 34px; }
  .rec-note { margin: 7px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

  .note-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 26px;
    margin-bottom: 18px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .note-meta label { display: flex; flex: 1 1 220px; flex-direction: column; gap: 4px; }
  .note-meta span { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-ghost); }
  .note-meta input { width: 100%; padding: 3px 0; border: 0; border-bottom: 1px solid transparent; outline: 0; background: transparent; color: var(--accent); font-size: var(--fs-body); }
  .note-meta input:focus { border-bottom-color: var(--accent); }
  .note-meta p { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .page textarea,
  .body-box {
    display: block;
    width: 100%;
    min-height: 460px;
    padding: 0;
    border: 0;
    outline: 0;
    resize: vertical;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 1.72;
  }
  .page textarea::placeholder { color: var(--text-ghost); }

  .engine-deck {
    padding: clamp(22px, 2.8vw, 38px) clamp(22px, 3.6vw, 56px) 40px;
    background: var(--text-primary);
    color: var(--bg);
  }
  .engine-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 15px; border-bottom: 1px solid rgba(237, 228, 212, 0.2); }
  .engine-head .section-no { color: var(--accent-on-dark); }
  .engine-head h2 { color: var(--bg); }
  .engine-head > p { max-width: 36ch; margin: 0; color: rgba(237, 228, 212, 0.55); font-size: var(--fs-label); line-height: 1.45; }
  .engine-controls { display: flex; flex-wrap: wrap; gap: 7px; margin: 18px 0 0; }
  .engine-controls button, .support-hd button { border-color: rgba(237, 228, 212, 0.22); color: rgba(237, 228, 212, 0.78); }
  .engine-controls button:hover:not(:disabled), .support-hd button:hover:not(:disabled) { border-color: var(--accent-on-dark); color: var(--accent-on-dark); }
  .engine-controls .engine-primary { background: var(--accent-on-dark); border-color: var(--accent-on-dark); color: var(--text-primary); }
  .engine-controls .danger:hover:not(:disabled) { border-color: var(--error); color: #ef8f8f; }
  .engine-spacer { flex: 1; }
  .engine-empty { margin: 30px 0 0; color: rgba(237, 228, 212, 0.45); font-style: italic; }
  .support { margin-top: 30px; padding: 20px 22px; border: 1px solid rgba(237, 228, 212, 0.18); border-left: 3px solid var(--accent-on-dark); background: rgba(237, 228, 212, 0.035); }
  .support-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  .support-hd span, .actions-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-on-dark); }
  .support-hd p { margin: 4px 0 0; font-size: var(--fs-label-xs); color: rgba(237, 228, 212, 0.4); }
  .dark-md { color: rgba(237, 228, 212, 0.82); }
  .dark-md :global(code) { background: rgba(237, 228, 212, 0.1); }
  .dark-md :global(a) { color: var(--accent-on-dark); }
  .dark-md :global(blockquote) { border-left-color: var(--accent-on-dark); color: rgba(237, 228, 212, 0.65); }
  .acts { margin-top: 34px; }
  .actions-label { margin: 0 0 10px; }
  .act-list { margin: 0; gap: 0; border-top: 1px solid rgba(237, 228, 212, 0.18); }
  .act {
    display: grid;
    grid-template-columns: minmax(80px, 0.22fr) minmax(180px, 1fr) auto auto;
    align-items: baseline;
    gap: 12px 18px;
    padding: 13px 10px;
    border: 0;
    border-left: 3px solid rgba(237, 228, 212, 0.22);
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
    background: transparent;
    color: var(--bg);
  }
  .act.a-done { border-left-color: var(--good-on-dark); }
  .act.a-failed { border-left-color: var(--error); }
  .act.a-refused { border-left-color: var(--warn); }
  .act-kind { color: var(--accent-on-dark); }
  .act-copy strong { font-size: var(--fs-label); font-weight: 500; }
  .act-copy p { margin: 5px 0 0; color: rgba(237, 228, 212, 0.55); font-size: var(--fs-label); line-height: 1.45; }
  .act-copy p.act-error { color: #ef8f8f; }
  .act-state { color: rgba(237, 228, 212, 0.4); }
  .act a { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-on-dark); text-transform: uppercase; }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 20px clamp(18px, 3vw, 44px) 30px;
    background: var(--text-primary);
    border-top: 1px solid rgba(237, 228, 212, 0.15);
    color: rgba(237, 228, 212, 0.4);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .foot p { margin: 0; }

  @media (max-width: 900px) {
    /* Once this stacks, the flex main axis is vertical — so `flex: 1 1 600px`
       on the copy stopped meaning "600px wide" and started meaning "600px
       TALL", which is where ~430px of empty ink under the standfirst came
       from. The basis has to be reset, not just the readout's. */
    .cover-inner { align-items: flex-start; flex-direction: column; gap: 18px; }
    .cover-copy { flex: 0 0 auto; }
    .cover-readout { flex-basis: auto; }
    .workspace { grid-template-columns: minmax(0, 1fr); }
    .library { border-right: 0; border-bottom: 2px solid var(--text-primary); }
    .items { max-height: 390px; overflow-y: auto; }
    .editor-head { top: 0; }
  }
  @media (max-width: 620px) {
    .cover { padding-top: 18px; }
    .cover h1 { font-size: clamp(1.7rem, 7.4vw, 2.4rem); }
    .library-head { padding: 22px 18px 16px; }
    .editor-head { align-items: flex-start; flex-direction: column; }
    .editor-actions { width: 100%; overflow-x: auto; padding-bottom: 2px; }
    .page { padding: 36px 20px 50px; }
    .page .title { font-size: 2.35rem; }
    .note-meta { gap: 12px 20px; }
    .page textarea, .body-box { min-height: 430px; font-size: var(--fs-body); }
    .engine-head { align-items: flex-start; flex-direction: column; }
    .engine-spacer { display: none; }
    .act { grid-template-columns: 1fr auto; }
    .act-kind, .act-copy { grid-column: 1; }
    .act-state, .act a { grid-column: 2; }
    .foot { flex-direction: column; }
  }
</style>
