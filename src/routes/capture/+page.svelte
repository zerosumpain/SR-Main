<script lang="ts">
  import { onMount } from 'svelte';
  import { queueNote, syncPendingNotes, getPendingNotes } from '$lib/jkai/intel/offline-queue';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let title = $state('');
  let content = $state('');
  let format = $state('text');
  let file: File | null = $state(null);
  let submitting = $state(false);
  let error = $state('');
  let success = $state('');
  let mode = $state<'text' | 'camera' | 'audio'>('text');

  let recording = $state(false);
  let mediaRecorder: MediaRecorder | null = $state(null);
  let audioChunks: Blob[] = [];
  let recordingDuration = $state(0);
  let recordingInterval: ReturnType<typeof setInterval>;

  let online = $state(true);
  let pendingCount = $state(0);
  let syncing = $state(false);

  onMount(() => {
    online = navigator.onLine;
    window.addEventListener('online', async () => {
      online = true;
      syncing = true;
      const synced = await syncPendingNotes();
      if (synced > 0) {
        success = `Synced ${synced} offline note${synced > 1 ? 's' : ''}!`;
        setTimeout(() => { success = ''; }, 3000);
      }
      pendingCount = (await getPendingNotes()).length;
      syncing = false;
    });
    window.addEventListener('offline', () => { online = false; });
    getPendingNotes().then((notes) => { pendingCount = notes.length; });
  });

  const formats = [
    { value: 'text', label: 'Notes' },
    { value: 'meeting_transcript', label: 'Meeting' },
    { value: 'email', label: 'Email' },
    { value: 'summary', label: 'Summary' },
  ];

  async function submit() {
    if (!content && !file) {
      error = 'Add some text or a file.';
      return;
    }

    submitting = true;
    error = '';
    success = '';

    try {
      if (!online) {
        let fileData: { name: string; type: string; data: ArrayBuffer } | undefined;
        if (file) {
          fileData = { name: file.name, type: file.type, data: await file.arrayBuffer() };
        }
        await queueNote({ title, content, format, file: fileData });
        title = '';
        content = '';
        file = null;
        format = 'text';
        mode = 'text';
        pendingCount++;
        success = 'Saved offline. Will sync when connected.';
        setTimeout(() => { success = ''; }, 3000);
        return;
      }

      const form = new FormData();
      if (title) form.append('title', title);
      if (content) form.append('content', content);
      form.append('source', 'pwa');
      form.append('format', format);
      if (file) form.append('file', file);

      const res = await fetch('/api/jkai/intel/ingest', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Failed (${res.status})`);
      }

      title = '';
      content = '';
      file = null;
      format = 'text';
      mode = 'text';
      success = 'Note captured! Processing in background.';
      setTimeout(() => { success = ''; }, 3000);
    } catch (e: any) {
      error = e.message;
    } finally {
      submitting = false;
    }
  }

  function capturePhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) {
        file = f;
        format = 'handwriting_scan';
        mode = 'text';
      }
    };
    input.click();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        file = new File([blob], `voice-memo-${Date.now()}.webm`, { type: 'audio/webm' });
        format = 'audio_transcript';
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recordingInterval);
        recordingDuration = 0;
        mode = 'text';
      };

      recorder.start();
      mediaRecorder = recorder;
      recording = true;
      recordingDuration = 0;
      recordingInterval = setInterval(() => { recordingDuration++; }, 1000);
    } catch (e: any) {
      error = `Microphone error: ${e.message}`;
    }
  }

  function stopRecording() {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      recording = false;
      mediaRecorder = null;
    }
  }

  function clearFile() {
    file = null;
    if (format === 'handwriting_scan' || format === 'audio_transcript') {
      format = 'text';
    }
  }

  function formatDuration(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<svelte:head>
  <title>Capture — Strange Ramblings</title>
</svelte:head>

<div class="capture-page">
  <header class="capture-hdr">
    <a href="/" class="brand">strange ramblings</a>
    <a href="/jkai/intel" class="capture-hdr-link">Dashboard →</a>
  </header>

  <main class="capture-main">
    <div class="kicker">Quick capture</div>
    <h1 class="display capture-title">drop a note.</h1>

    <div class="mode-row">
      <button
        type="button"
        class="nm-btn-ghost"
        data-active={mode === 'text'}
        onclick={() => { mode = 'text'; }}
      >Text</button>
      <button type="button" class="nm-btn-ghost" onclick={capturePhoto}>Camera</button>
      <button
        type="button"
        class="nm-btn-ghost"
        data-active={mode === 'audio'}
        onclick={() => { mode = 'audio'; }}
      >Audio</button>
    </div>

    {#if !online}
      <div class="banner banner-warn">Offline — notes will be queued and synced when connected</div>
    {/if}
    {#if pendingCount > 0}
      <div class="banner banner-info">
        {pendingCount} note{pendingCount > 1 ? 's' : ''} pending sync
        {#if syncing}<span class="muted">· syncing…</span>{/if}
      </div>
    {/if}

    {#if mode === 'audio'}
      <div class="audio-pad">
        {#if recording}
          <div class="audio-dur display">{formatDuration(recordingDuration)}</div>
          <div class="audio-dot" aria-hidden="true"></div>
          <button type="button" class="nm-save-btn audio-stop" onclick={stopRecording}>Stop recording</button>
        {:else}
          <p class="audio-hint">Tap to start recording a voice memo</p>
          <button type="button" class="audio-record" onclick={startRecording} aria-label="Start recording">
            <span class="audio-record-dot"></span>
          </button>
        {/if}
      </div>
    {/if}

    {#if file}
      <div class="file-row">
        <div class="file-meta">
          <span class="file-kind">{file.type.startsWith('image/') ? 'IMG' : file.type.startsWith('audio/') ? 'AUD' : 'FILE'}</span>
          <span class="file-name">{file.name}</span>
          <span class="file-size">{(file.size / 1024).toFixed(0)} KB</span>
        </div>
        <button type="button" class="nm-link-btn danger" onclick={clearFile}>Remove</button>
      </div>
    {/if}

    <div class="nm-field">
      <label for="capture-title" class="sr-label-tight">Title (optional)</label>
      <input
        id="capture-title"
        type="text"
        class="nm-text-input"
        bind:value={title}
        placeholder="Give it a name…"
      />
    </div>

    <div class="nm-field nm-field-grow">
      <label for="capture-content" class="sr-label-tight">Content</label>
      <textarea
        id="capture-content"
        class="nm-textarea capture-textarea"
        bind:value={content}
        placeholder={file ? 'Add context for the attachment (optional)…' : 'Type or paste your note…'}
        rows="8"
      ></textarea>
    </div>

    <div class="format-row">
      <span class="sr-label-tight">Format</span>
      <div class="format-chips">
        {#each formats as f}
          <button
            type="button"
            class="nm-btn-ghost format-chip"
            data-active={format === f.value}
            onclick={() => { format = f.value; }}
          >{f.label}</button>
        {/each}
      </div>
    </div>

    {#if error}
      <div class="banner banner-error">{error}</div>
    {/if}
    {#if success}
      <div class="banner banner-success">{success}</div>
    {/if}

    <button
      type="button"
      class="nm-save-btn capture-submit"
      onclick={submit}
      disabled={submitting || (!content && !file)}
    >
      {submitting ? 'Submitting…' : 'Capture →'}
    </button>
  </main>

  <SiteFooter variant="compact" />
</div>

<style>
  .capture-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text-primary);
  }

  .capture-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid var(--line-hair);
  }
  .capture-hdr .brand { font-size: 18px; }
  .capture-hdr-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    transition: color 0.18s ease-out;
  }
  .capture-hdr-link:hover { color: var(--accent); }

  .capture-main {
    flex: 1;
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding: 2rem 1.25rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }
  .capture-title {
    font-size: clamp(36px, 9vw, 56px);
    color: var(--text-primary);
    margin: 0 0 0.25rem;
  }

  .mode-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .mode-row .nm-btn-ghost { flex: 1; padding: 10px 14px; font-size: var(--fs-label-xs); }

  .banner {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .banner-success {
    border-color: var(--success-border);
    background: var(--success-bg);
    color: var(--success);
  }
  .banner-error {
    border-color: var(--error-border);
    background: var(--error-bg);
    color: var(--error);
  }
  .banner-warn {
    border-color: var(--warn-border);
    background: var(--warn-bg);
    color: var(--warn);
  }
  .banner-info {
    border-color: var(--info-border);
    background: var(--info-bg);
    color: var(--info);
  }
  .banner .muted { color: var(--text-ghost); margin-left: 0.25rem; }

  .audio-pad {
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    padding: 1.5rem 1rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.85rem;
  }
  .audio-dur { font-size: 2.5rem; color: var(--error); margin: 0; }
  .audio-dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--error);
    animation: capture-pulse 1.2s ease-in-out infinite;
  }
  .audio-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin: 0;
  }
  .audio-record {
    width: 64px;
    height: 64px;
    border-radius: 999px;
    background: var(--error);
    border: 2px solid var(--accent);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .audio-record-dot {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: var(--bg);
  }
  .audio-stop { padding: 10px 20px; }

  @keyframes capture-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(0.8); }
  }

  .file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    padding: 0.55rem 0.75rem;
  }
  .file-meta {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    min-width: 0;
  }
  .file-kind {
    font-size: var(--fs-label-xs);
    color: var(--accent);
    border: 1px solid var(--accent-tint-35);
    padding: 1px 6px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .file-name {
    color: var(--text-primary);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .file-size { color: var(--text-ghost); font-size: var(--fs-label-xs); }

  .nm-field-grow { flex: 1; }
  .capture-textarea {
    width: 100%;
    min-height: 180px;
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    line-height: 1.5;
    resize: vertical;
  }

  .format-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .format-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .format-chip { padding: 5px 12px; font-size: var(--fs-label-xs); }

  .capture-submit {
    padding: 14px;
    font-size: var(--fs-label-xs);
    margin-top: 0.5rem;
  }
</style>
