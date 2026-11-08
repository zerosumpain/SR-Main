<script lang="ts">
  // One Kelly's Quiz Night pack: its notes, its photos (shrunk in the browser,
  // then uploaded one at a time), the questions — drafted by jkai from the
  // notes and captions, edited here — and approving it for the TV.
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type Q = { id?: string; prompt: string; options: string[]; answerIndex: number; explain: string | null; photoId: string | null };

  const pack = $derived(data.pack);
  let questions = $state<Q[]>([]);
  let dirty = $state(false);
  let uploading = $state<string | null>(null);
  let uploadError = $state<string | null>(null);

  // Plain handles (svelte5-pitfalls §1).
  let poll: ReturnType<typeof setInterval> | null = null;

  // A fresh pack from the server (a save, a draft landing) replaces the editor's copy unless it has unsaved edits.
  $effect(() => {
    const stamp = data.pack.updatedAt;
    untrack(() => {
      if (!dirty) questions = structuredClone(data.pack.questions) as Q[];
      void stamp;
    });
  });

  // While jkai drafts, look again every few seconds.
  $effect(() => {
    const drafting = data.pack.status === 'drafting';
    untrack(() => {
      if (drafting && !poll) poll = setInterval(() => void invalidateAll(), 4_000);
      if (!drafting && poll) {
        clearInterval(poll);
        poll = null;
      }
    });
  });

  onMount(() => () => {
    if (poll) clearInterval(poll);
  });

  function edit(fn: () => void) {
    fn();
    dirty = true;
  }

  function addQuestion() {
    edit(() => questions.push({ prompt: '', options: ['', '', '', ''], answerIndex: 0, explain: null, photoId: null }));
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= questions.length) return;
    edit(() => {
      [questions[i], questions[j]] = [questions[j], questions[i]];
    });
  }

  /** A photo as a JPEG no longer than 1600 px on its long side — the browser decodes HEIC from an iPhone too. */
  async function shrink(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo.'))), 'image/jpeg', 0.85));
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    uploadError = null;
    for (const [i, file] of files.entries()) {
      uploading = `Adding ${i + 1} of ${files.length}…`;
      try {
        const body = new FormData();
        body.append('file', new File([await shrink(file)], 'photo.jpg', { type: 'image/jpeg' }));
        body.append('caption', '');
        const res = await fetch(`/api/admin/games/quiz-packs/${pack.id}/photos`, { method: 'POST', body });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed.');
      } catch (err) {
        uploadError = `${file.name}: ${(err as Error).message}`;
      }
    }
    uploading = null;
    input.value = '';
    await invalidateAll();
  }

  const photoById = $derived(new Map(pack.photos.map((p) => [p.id, p])));
  const LETTERS = ['A', 'B', 'C', 'D'];
</script>

<svelte:head><title>{pack.title} · Kelly's Quiz Night</title></svelte:head>

<main class="qe">
  <p class="qe-kicker"><a href="/admin/content/quiz-packs">Kelly's Quiz Night</a></p>
  <h1>{pack.title}</h1>
  <p class="qe-state" class:qe-on={pack.status === 'approved'}>
    {pack.status === 'approved' ? 'On the TV — editing sends it back to draft' : pack.status === 'drafting' ? 'jkai is drafting questions…' : 'Draft'}
  </p>

  {#if form && 'error' in form && form.error}<p class="qe-err" role="alert">{form.error}</p>{/if}
  {#if form && 'warning' in form && form.warning}<p class="qe-err" role="status">{form.warning}</p>{/if}
  {#if pack.draftError}<p class="qe-err">{pack.draftError}</p>{/if}

  <section>
    <h2>About this pack</h2>
    <form method="POST" action="?/details" use:enhance class="qe-grid">
      <label><span>Title</span><input name="title" value={pack.title} maxlength="60" /></label>
      <label><span>Subject</span><input name="subject" value={pack.subject} maxlength="60" /></label>
      <label class="qe-wide"><span>Notes — everything jkai may ask about</span><textarea name="notes" rows="8">{pack.notes}</textarea></label>
      <button type="submit">Save</button>
    </form>
  </section>

  <section>
    <h2>Photos · {pack.photos.length}</h2>
    <p class="qe-muted">Caption each one: who is in it, where, what was going on. jkai only reads the captions.</p>
    <label class="qe-upload">
      <span>Add photos</span>
      <input type="file" accept="image/*" multiple onchange={upload} disabled={!!uploading} />
    </label>
    {#if uploading}<p class="qe-muted">{uploading}</p>{/if}
    {#if uploadError}<p class="qe-err">{uploadError}</p>{/if}
    <ul class="qe-photos">
      {#each pack.photos as p, i (p.id)}
        <li>
          <img src={p.url} alt={p.caption || `Photo ${i + 1}`} loading="lazy" />
          <form method="POST" action="?/caption" use:enhance class="qe-caption">
            <input type="hidden" name="photoId" value={p.id} />
            <input name="caption" value={p.caption} maxlength="200" placeholder="Rory and Gran on Whitby pier" aria-label="Caption" />
            <input name="year" value={p.year ?? ''} inputmode="numeric" maxlength="4" placeholder="Year" aria-label="Year" class="qe-year" />
            <button type="submit">Save</button>
          </form>
          <form method="POST" action="?/removePhoto" use:enhance>
            <input type="hidden" name="photoId" value={p.id} />
            <button type="submit" class="qe-link">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Questions · {questions.length}</h2>
    <form method="POST" action="?/draft" use:enhance class="qe-inline">
      <button type="submit" disabled={pack.status === 'drafting' || dirty}>{questions.length ? 'Draft more with jkai' : 'Draft questions with jkai'}</button>
      {#if dirty}<span class="qe-muted">Save your edits first.</span>{/if}
    </form>

    <form
      method="POST"
      action="?/questions"
      use:enhance={() =>
        async ({ update }) => {
          dirty = false;
          await update({ reset: false });
        }}
    >
      <input type="hidden" name="questions" value={JSON.stringify(questions)} />
      <ol class="qe-qs">
        {#each questions as q, i (q.id ?? `new-${i}`)}
          <li>
            <textarea rows="2" value={q.prompt} oninput={(e) => edit(() => (q.prompt = e.currentTarget.value))} aria-label="Question {i + 1}"></textarea>
            <div class="qe-options">
              {#each q.options as _, k (k)}
                <label class="qe-option" class:qe-right={q.answerIndex === k}>
                  <input type="radio" name="right-{i}" checked={q.answerIndex === k} onchange={() => edit(() => (q.answerIndex = k))} aria-label="{LETTERS[k]} is right" />
                  <span>{LETTERS[k]}</span>
                  <input value={q.options[k]} oninput={(e) => edit(() => (q.options[k] = e.currentTarget.value))} aria-label="Answer {LETTERS[k]}" />
                </label>
              {/each}
            </div>
            <input class="qe-explain" value={q.explain ?? ''} placeholder="After the answer: a line to read out" oninput={(e) => edit(() => (q.explain = e.currentTarget.value || null))} />
            <div class="qe-row">
              <select value={q.photoId ?? ''} onchange={(e) => edit(() => (q.photoId = e.currentTarget.value || null))} aria-label="Photo">
                <option value="">No photo</option>
                {#each pack.photos as p, n (p.id)}
                  <option value={p.id}>Photo {n + 1}{p.caption ? ` — ${p.caption.slice(0, 40)}` : ''}</option>
                {/each}
              </select>
              {#if q.photoId && photoById.get(q.photoId)}<img class="qe-thumb" src={photoById.get(q.photoId)?.url} alt="" />{/if}
              <button type="button" class="qe-link" onclick={() => move(i, -1)} disabled={i === 0}>Up</button>
              <button type="button" class="qe-link" onclick={() => move(i, 1)} disabled={i === questions.length - 1}>Down</button>
              <button type="button" class="qe-link qe-danger" onclick={() => edit(() => questions.splice(i, 1))}>Delete</button>
            </div>
          </li>
        {/each}
      </ol>
      <div class="qe-inline">
        <button type="button" class="qe-ghost" onclick={addQuestion}>Add a question</button>
        <button type="submit" disabled={!dirty}>Save questions</button>
      </div>
    </form>
  </section>

  <section class="qe-inline">
    {#if pack.status === 'approved'}
      <form method="POST" action="?/unapprove" use:enhance><button type="submit" class="qe-ghost">Take off the TV</button></form>
    {:else}
      <form method="POST" action="?/approve" use:enhance><button type="submit" disabled={dirty || pack.status === 'drafting'}>Approve for the TV</button></form>
    {/if}
    <form method="POST" action="?/delete" onsubmit={(e) => { if (!confirm('Delete this pack and its photos?')) e.preventDefault(); }}>
      <button type="submit" class="qe-link qe-danger">Delete pack</button>
    </form>
  </section>
</main>

<style>
  .qe { max-width: 52rem; margin: 0 auto; padding: 2rem 1rem 5rem; font-family: var(--font-body); }
  .qe-kicker { margin: 0; font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
  .qe-kicker a { color: var(--text-muted); }
  h1 { font-family: var(--font-display); font-weight: var(--font-display-weight); font-size: 1.75rem; margin: 0.3rem 0 0.4rem; }
  h2 { font-family: var(--font-mono); font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 2.2rem 0 0.6rem; color: var(--text-muted); }
  .qe-state { margin: 0 0 1rem; color: var(--text-muted); }
  .qe-on { color: var(--success); }
  .qe-err { color: var(--error); }
  .qe-muted { color: var(--text-muted); font-size: 0.9rem; margin: 0.3rem 0; }
  .qe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .qe-wide { grid-column: 1 / -1; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label > span { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  input, textarea, select { font: inherit; font-size: 1rem; padding: 0.45rem 0.55rem; border: 1px solid var(--line-strong); border-radius: 2px; background: var(--surface-elevated); color: inherit; }
  textarea { resize: vertical; }
  button { justify-self: start; font: inherit; padding: 0.45rem 0.9rem; border-radius: 2px; border: 1px solid var(--accent-ink); background: var(--accent-ink); color: var(--bg); cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .qe-ghost { background: transparent; color: var(--accent-ink); }
  .qe-link { background: none; border: none; padding: 0.2rem 0.3rem; color: var(--accent-ink); text-decoration: underline; }
  .qe-danger { color: var(--error); }
  .qe-inline { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin: 0.75rem 0; }
  .qe-upload { flex-direction: row; align-items: center; gap: 0.75rem; }
  .qe-photos { list-style: none; padding: 0; margin: 0.75rem 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; }
  .qe-photos li { display: grid; gap: 0.4rem; }
  .qe-photos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 2px; background: var(--surface-elevated); }
  .qe-caption { display: flex; gap: 0.4rem; }
  .qe-caption input:first-of-type { flex: 1; min-width: 0; }
  .qe-year { width: 4.5rem; }
  .qe-qs { margin: 0; padding-left: 1.4rem; display: grid; gap: 1.25rem; }
  .qe-qs > li { display: grid; gap: 0.45rem; border-top: 1px solid var(--line-strong); padding-top: 0.8rem; }
  .qe-options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
  .qe-option { flex-direction: row; align-items: center; gap: 0.4rem; padding: 0.2rem 0.3rem; border: 1px solid transparent; border-radius: 2px; }
  .qe-option > span { font-family: var(--font-mono); font-size: 0.8rem; }
  .qe-option input:not([type='radio']) { flex: 1; min-width: 0; }
  .qe-right { border-color: var(--success); }
  .qe-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .qe-thumb { width: 3.5rem; height: 2.6rem; object-fit: cover; border-radius: 2px; }
  @media (max-width: 40rem) {
    .qe-grid, .qe-options { grid-template-columns: 1fr; }
  }
</style>
