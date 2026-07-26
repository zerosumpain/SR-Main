<script lang="ts">
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
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

<JkaiPageTitle title="NEW NOTE" titleHref="/jkai/intel/notes" />

<div class="p-6 sm:p-10 max-w-3xl mx-auto">
  <div class="space-y-4">
    <div>
      <label class="block text-sm mb-1" style="color: var(--text-secondary);">Title (optional)</label>
      <input
        type="text"
        bind:value={title}
        placeholder="e.g., 1:1 with Sarah — Platform concerns"
        class="w-full rounded-[var(--radius-round)] px-3 py-2 text-sm focus:outline-none border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      />
    </div>

    <div>
      <label class="block text-sm mb-1" style="color: var(--text-secondary);">Content</label>
      <textarea
        bind:value={content}
        placeholder="Paste or type your notes, transcript, email, etc."
        rows={12}
        class="w-full rounded-[var(--radius-round)] px-3 py-2 text-sm focus:outline-none border resize-y"
        style="background: var(--card-bg); border-color: var(--card-border);"
      ></textarea>
    </div>

    <div>
      <label class="block text-sm mb-1" style="color: var(--text-secondary);">Format</label>
      <select
        bind:value={format}
        class="w-full rounded-[var(--radius-round)] px-3 py-2 text-sm focus:outline-none border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        {#each formats as f}
          <option value={f.value}>{f.label}</option>
        {/each}
      </select>
    </div>

    <div>
      <label class="block text-sm mb-1" style="color: var(--text-secondary);">Attach file (image or audio)</label>
      <input
        type="file"
        accept="image/*,audio/*"
        onchange={handleFileChange}
        class="w-full rounded-[var(--radius-round)] px-3 py-2 text-sm border"
        style="background: var(--card-bg); border-color: var(--card-border);"
      />
      {#if file}
        <div class="text-xs mt-1" style="color: var(--text-ghost);">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div>
      {/if}
    </div>

    {#if error}
      <div class="text-sm border rounded px-3 py-2" style="color: var(--error); background: var(--error-bg); border-color: var(--error-border);">{error}</div>
    {/if}

    <button
      onclick={submit}
      disabled={submitting}
      class="w-full disabled:opacity-50 rounded-[var(--radius-round)] py-3 font-medium text-sm"
      style="background: var(--accent); color: white;"
    >
      {submitting ? 'Submitting...' : 'Submit Note'}
    </button>
  </div>
</div>
