<script lang="ts">
  import { onMount } from 'svelte';
  import { queueNote, syncPendingNotes, getPendingNotes } from '$lib/jkai/intel/offline-queue';

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

<div class="flex-1 flex flex-col p-4 max-w-lg mx-auto w-full">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-lg font-bold">Quick Capture</h1>
    <a href="/jkai/intel" class="text-xs text-gray-400 hover:text-gray-300">Dashboard</a>
  </div>

  <div class="flex gap-2 mb-4">
    <button
      onclick={() => { mode = 'text'; }}
      class="flex-1 py-2.5 rounded-lg text-sm font-medium {mode === 'text' ? 'bg-sky-600' : 'bg-gray-800'}"
    >Text</button>
    <button
      onclick={capturePhoto}
      class="flex-1 py-2.5 rounded-lg text-sm font-medium bg-gray-800 active:bg-gray-700"
    >Camera</button>
    <button
      onclick={() => { mode = 'audio'; }}
      class="flex-1 py-2.5 rounded-lg text-sm font-medium {mode === 'audio' ? 'bg-sky-600' : 'bg-gray-800'}"
    >Audio</button>
  </div>

  {#if !online}
    <div class="bg-amber-900/30 text-amber-400 rounded-lg px-3 py-2 text-xs mb-3 text-center">
      Offline — notes will be queued and synced when connected
    </div>
  {/if}
  {#if pendingCount > 0}
    <div class="bg-sky-900/30 text-sky-400 rounded-lg px-3 py-2 text-xs mb-3 text-center">
      {pendingCount} note{pendingCount > 1 ? 's' : ''} pending sync
      {#if syncing}<span class="ml-1">syncing...</span>{/if}
    </div>
  {/if}

  {#if mode === 'audio'}
    <div class="bg-gray-900 rounded-lg p-6 mb-4 text-center">
      {#if recording}
        <div class="text-4xl font-mono text-red-400 mb-4">{formatDuration(recordingDuration)}</div>
        <div class="w-4 h-4 bg-red-500 rounded-full mx-auto mb-4 animate-pulse"></div>
        <button onclick={stopRecording} class="px-8 py-3 bg-red-600 rounded-lg font-medium">Stop Recording</button>
      {:else}
        <div class="text-gray-400 mb-4 text-sm">Tap to start recording a voice memo</div>
        <button onclick={startRecording} class="w-16 h-16 bg-red-600 rounded-full mx-auto flex items-center justify-center">
          <div class="w-6 h-6 bg-white rounded-full"></div>
        </button>
      {/if}
    </div>
  {/if}

  {#if file}
    <div class="bg-gray-900 rounded-lg p-3 mb-3 flex items-center justify-between">
      <div class="text-sm">
        <span class="text-gray-400">{file.type.startsWith('image/') ? '📸' : '🎙️'}</span>
        <span class="ml-2">{file.name}</span>
        <span class="text-xs text-gray-500 ml-2">({(file.size / 1024).toFixed(0)} KB)</span>
      </div>
      <button onclick={clearFile} class="text-xs text-gray-400 hover:text-red-400 px-2">Remove</button>
    </div>
  {/if}

  <input
    type="text"
    bind:value={title}
    placeholder="Title (optional)"
    class="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-sky-500"
  />

  <textarea
    bind:value={content}
    placeholder={file ? 'Add context for the attachment (optional)...' : 'Type or paste your note...'}
    rows={8}
    class="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-sky-500 resize-none flex-1"
  ></textarea>

  <div class="flex gap-2 mb-4 flex-wrap">
    {#each formats as f}
      <button
        onclick={() => { format = f.value; }}
        class="px-3 py-1.5 rounded-full text-xs {format === f.value ? 'bg-sky-600' : 'bg-gray-800'}"
      >{f.label}</button>
    {/each}
  </div>

  {#if error}
    <div class="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mb-3">{error}</div>
  {/if}
  {#if success}
    <div class="text-sm text-emerald-400 bg-emerald-900/20 rounded-lg px-3 py-2 mb-3">{success}</div>
  {/if}

  <button
    onclick={submit}
    disabled={submitting || (!content && !file)}
    class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 rounded-lg py-3.5 font-medium text-sm mt-auto"
  >
    {submitting ? 'Submitting...' : 'Capture'}
  </button>
</div>
