<script lang="ts">
  import { goto } from '$app/navigation';

  let title = $state('');
  let content = $state('');
  let format = $state('text');
  let file: File | null = $state(null);
  let submitting = $state(false);
  let error = $state('');

  const formats = [
    { value: 'text', label: 'Text / Notes' },
    { value: 'meeting_transcript', label: 'Meeting transcript' },
    { value: 'email', label: 'Email' },
    { value: 'summary', label: 'Summary' },
    { value: 'handwriting_scan', label: 'Handwriting scan (image)' },
    { value: 'audio_transcript', label: 'Audio recording' },
  ];

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    file = input.files?.[0] ?? null;
    if (file) {
      if (file.type.startsWith('image/')) format = 'handwriting_scan';
      else if (file.type.startsWith('audio/')) format = 'audio_transcript';
    }
  }

  async function submit() {
    if (!content && !file) {
      error = 'Please enter some text or attach a file.';
      return;
    }

    submitting = true;
    error = '';

    try {
      const form = new FormData();
      if (title) form.append('title', title);
      if (content) form.append('content', content);
      form.append('source', 'web');
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

      const data = await res.json();
      goto(`/jkai/intel/notes/${data.id}`);
    } catch (e: any) {
      error = e.message;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="p-6 max-w-3xl mx-auto">
  <a href="/jkai/intel" class="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block">&larr; Dashboard</a>

  <h1 class="text-2xl font-bold mb-6">New Note</h1>

  <div class="space-y-4">
    <div>
      <label class="block text-sm text-gray-400 mb-1">Title (optional)</label>
      <input
        type="text"
        bind:value={title}
        placeholder="e.g., 1:1 with Sarah — Platform concerns"
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
      />
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Content</label>
      <textarea
        bind:value={content}
        placeholder="Paste or type your notes, transcript, email, etc."
        rows={12}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-y"
      ></textarea>
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Format</label>
      <select
        bind:value={format}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
      >
        {#each formats as f}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
    </div>

    <div>
      <label class="block text-sm text-gray-400 mb-1">Attach file (image or audio)</label>
      <input
        type="file"
        accept="image/*,audio/*"
        onchange={handleFileChange}
        class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm"
      />
      {#if file}
        <div class="text-xs text-gray-400 mt-1">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div>
      {/if}
    </div>

    {#if error}
      <div class="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
    {/if}

    <button
      onclick={submit}
      disabled={submitting}
      class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg py-3 font-medium text-sm"
    >
      {submitting ? 'Submitting...' : 'Submit Note'}
    </button>
  </div>
</div>
