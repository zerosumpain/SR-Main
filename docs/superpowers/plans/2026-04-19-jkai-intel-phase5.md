# JKAI Intel Phase 5 — Capture PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-optimized quick-capture interface at `/capture` that can be installed as a PWA. Supports text input, camera capture for handwriting scans, audio recording for voice memos, and offline queueing.

**Architecture:** Route within the existing SvelteKit app at `/capture` with its own minimal layout (no site nav, full-screen mobile). Web app manifest for installability. Service worker for offline caching of the app shell and IndexedDB-based note queue that syncs when online. Calls the existing `/api/jkai/intel/ingest` endpoint.

**Tech Stack:** SvelteKit, Tailwind CSS, Web App Manifest, Service Worker, MediaDevices API, MediaRecorder API, IndexedDB

---

### Task 1: PWA Manifest and Capture Layout

**Files:**
- Create: `static/capture-manifest.json`
- Create: `src/routes/capture/+layout.svelte`
- Create: `src/routes/capture/+layout.server.ts`

- [ ] **Step 1: Create the web app manifest**

Create `static/capture-manifest.json`:

```json
{
  "name": "JKAI Intel Capture",
  "short_name": "Intel",
  "description": "Quick capture for JKAI Intel knowledge graph",
  "start_url": "/capture",
  "display": "standalone",
  "background_color": "#030712",
  "theme_color": "#030712",
  "icons": [
    {
      "src": "/favicon.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

- [ ] **Step 2: Create the capture layout**

Create `src/routes/capture/+layout.server.ts`:

```typescript
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
  return {};
};
```

Create `src/routes/capture/+layout.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="#030712" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="manifest" href="/capture-manifest.json" />
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
  {@render children()}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add static/capture-manifest.json src/routes/capture/
git commit -m "feat(intel): add PWA manifest and capture layout"
```

---

### Task 2: Capture Page — Text and Format Selection

**Files:**
- Create: `src/routes/capture/+page.svelte`

The main capture interface with text input, format selector, and submit.

- [ ] **Step 1: Create the capture page**

Create `src/routes/capture/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';

  let title = $state('');
  let content = $state('');
  let format = $state('text');
  let file: File | null = $state(null);
  let submitting = $state(false);
  let error = $state('');
  let success = $state('');
  let mode = $state<'text' | 'camera' | 'audio'>('text');

  // Audio recording
  let recording = $state(false);
  let mediaRecorder: MediaRecorder | null = $state(null);
  let audioChunks: Blob[] = [];
  let recordingDuration = $state(0);
  let recordingInterval: ReturnType<typeof setInterval>;

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

      // Success — clear form
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

  // Camera capture
  async function capturePhoto() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) {
          file = f;
          format = 'handwriting_scan';
          mode = 'text'; // Return to text mode to add context
        }
      };
      input.click();
    } catch (e: any) {
      error = `Camera error: ${e.message}`;
    }
  }

  // Audio recording
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
        mode = 'text'; // Return to text mode
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
  <!-- Header -->
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-lg font-bold">Quick Capture</h1>
    <a href="/jkai/intel" class="text-xs text-gray-400 hover:text-gray-300">Dashboard</a>
  </div>

  <!-- Mode Selector -->
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

  <!-- Audio Recording -->
  {#if mode === 'audio'}
    <div class="bg-gray-900 rounded-lg p-6 mb-4 text-center">
      {#if recording}
        <div class="text-4xl font-mono text-red-400 mb-4">{formatDuration(recordingDuration)}</div>
        <div class="w-4 h-4 bg-red-500 rounded-full mx-auto mb-4 animate-pulse"></div>
        <button
          onclick={stopRecording}
          class="px-8 py-3 bg-red-600 rounded-lg font-medium"
        >Stop Recording</button>
      {:else}
        <div class="text-gray-400 mb-4 text-sm">Tap to start recording a voice memo</div>
        <button
          onclick={startRecording}
          class="w-16 h-16 bg-red-600 rounded-full mx-auto flex items-center justify-center"
        >
          <div class="w-6 h-6 bg-white rounded-full"></div>
        </button>
      {/if}
    </div>
  {/if}

  <!-- File Attachment Preview -->
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

  <!-- Title -->
  <input
    type="text"
    bind:value={title}
    placeholder="Title (optional)"
    class="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-sky-500"
  />

  <!-- Content -->
  <textarea
    bind:value={content}
    placeholder={file ? 'Add context for the attachment (optional)...' : 'Type or paste your note...'}
    rows={8}
    class="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-sky-500 resize-none flex-1"
  ></textarea>

  <!-- Format -->
  <div class="flex gap-2 mb-4 flex-wrap">
    {#each formats as f}
      <button
        onclick={() => { format = f.value; }}
        class="px-3 py-1.5 rounded-full text-xs {format === f.value ? 'bg-sky-600' : 'bg-gray-800'}"
      >{f.label}</button>
    {/each}
  </div>

  <!-- Status Messages -->
  {#if error}
    <div class="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2 mb-3">{error}</div>
  {/if}
  {#if success}
    <div class="text-sm text-emerald-400 bg-emerald-900/20 rounded-lg px-3 py-2 mb-3">{success}</div>
  {/if}

  <!-- Submit -->
  <button
    onclick={submit}
    disabled={submitting || (!content && !file)}
    class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 rounded-lg py-3.5 font-medium text-sm mt-auto"
  >
    {submitting ? 'Submitting...' : 'Capture'}
  </button>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/capture/+page.svelte
git commit -m "feat(intel): add capture PWA page with text, camera, and audio"
```

---

### Task 3: Service Worker for Offline Support

**Files:**
- Create: `static/capture-sw.js`
- Modify: `src/routes/capture/+layout.svelte` (register service worker)

- [ ] **Step 1: Create the service worker**

Create `static/capture-sw.js`:

```javascript
const CACHE_NAME = 'intel-capture-v1';
const PRECACHE_URLS = [
  '/capture',
];

// Install: precache the capture page shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for app shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: always network (offline handled by IndexedDB queue in the app)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: try network, fall back to cache
  if (url.pathname.startsWith('/capture')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
```

- [ ] **Step 2: Register the service worker in the capture layout**

Modify `src/routes/capture/+layout.svelte` to add service worker registration. Add a script block inside the component:

Add after the existing `<svelte:head>` block:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/capture-sw.js').catch((err) => {
        console.warn('[capture] SW registration failed:', err);
      });
    }
  });
</script>
```

(Replace the existing script block which just has the children prop.)

- [ ] **Step 3: Commit**

```bash
git add static/capture-sw.js src/routes/capture/+layout.svelte
git commit -m "feat(intel): add service worker for offline capture support"
```

---

### Task 4: Offline Queue with IndexedDB

**Files:**
- Create: `src/lib/jkai/intel/offline-queue.ts`
- Modify: `src/routes/capture/+page.svelte` (add offline fallback)

- [ ] **Step 1: Create the offline queue module**

Create `src/lib/jkai/intel/offline-queue.ts`:

```typescript
/**
 * Client-side IndexedDB queue for offline note capture.
 * Notes are stored locally when offline and synced when connectivity returns.
 */

const DB_NAME = 'intel-capture';
const STORE_NAME = 'pending-notes';
const DB_VERSION = 1;

interface PendingNote {
  id?: number;
  title: string;
  content: string;
  format: string;
  file?: { name: string; type: string; data: ArrayBuffer };
  createdAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueNote(note: Omit<PendingNote, 'id' | 'createdAt'>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({ ...note, createdAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingNotes(): Promise<PendingNote[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingNote(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncPendingNotes(): Promise<number> {
  const notes = await getPendingNotes();
  let synced = 0;

  for (const note of notes) {
    try {
      const form = new FormData();
      if (note.title) form.append('title', note.title);
      if (note.content) form.append('content', note.content);
      form.append('source', 'pwa');
      form.append('format', note.format);

      if (note.file) {
        const blob = new Blob([note.file.data], { type: note.file.type });
        form.append('file', new File([blob], note.file.name, { type: note.file.type }));
      }

      const res = await fetch('/api/jkai/intel/ingest', {
        method: 'POST',
        body: form,
      });

      if (res.ok) {
        await removePendingNote(note.id!);
        synced++;
      }
    } catch {
      // Still offline or server error — leave in queue
      break;
    }
  }

  return synced;
}
```

- [ ] **Step 2: Add offline fallback to capture page**

Modify `src/routes/capture/+page.svelte`. Add imports and offline logic:

At the top of the `<script>` block, add:

```typescript
  import { onMount } from 'svelte';
  import { queueNote, syncPendingNotes, getPendingNotes } from '$lib/jkai/intel/offline-queue';

  let online = $state(true);
  let pendingCount = $state(0);
  let syncing = $state(false);
```

Add an `onMount` block:

```typescript
  onMount(() => {
    online = navigator.onLine;
    window.addEventListener('online', async () => {
      online = true;
      // Auto-sync when coming back online
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

    // Check for pending notes
    getPendingNotes().then((notes) => { pendingCount = notes.length; });
  });
```

In the `submit()` function, wrap the fetch in an online check. Replace the try block content with:

```typescript
    try {
      if (!online) {
        // Queue offline
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

      // Online — submit directly
      const form = new FormData();
      // ... (keep the existing FormData construction and fetch)
```

After the header, add an offline/pending indicator:

```svelte
  <!-- Connection Status -->
  {#if !online}
    <div class="bg-amber-900/30 text-amber-400 rounded-lg px-3 py-2 text-xs mb-3 text-center">
      Offline — notes will be queued and synced when connected
    </div>
  {/if}
  {#if pendingCount > 0}
    <div class="bg-sky-900/30 text-sky-400 rounded-lg px-3 py-2 text-xs mb-3 text-center">
      {pendingCount} note{pendingCount > 1 ? 's' : ''} pending sync
      {#if syncing}
        <span class="ml-1">syncing...</span>
      {/if}
    </div>
  {/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/intel/offline-queue.ts src/routes/capture/+page.svelte
git commit -m "feat(intel): add offline queue with IndexedDB and auto-sync"
```

---

### Task 5: Protect Capture Route

**Files:**
- Modify: `src/hooks.server.ts`

The `/capture` route needs to be auth-protected like `/jkai/**`.

- [ ] **Step 1: Add /capture to protected routes**

Read `src/hooks.server.ts`, find the route protection logic, and add `/capture` to the protected paths alongside `/jkai/**`.

The existing protection likely checks `path.startsWith('/jkai')` or similar. Add `path.startsWith('/capture')` to the same condition.

- [ ] **Step 2: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(intel): protect capture route with auth"
```
