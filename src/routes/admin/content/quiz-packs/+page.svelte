<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const when = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const LABEL = { draft: 'Draft', drafting: 'Writing…', approved: 'On the TV' } as const;
</script>

<svelte:head><title>Kelly's Quiz Night · Content</title></svelte:head>

<main class="qp">
  <h1>Kelly's Quiz Night</h1>
  <p class="qp-lead">
    Quiz packs about the family. Give a pack a subject, paste in notes and add old photos with a caption each (who, where,
    when); jkai drafts questions from them and nothing else. Edit, then approve — an approved pack is on the TV's Quiz Night.
  </p>

  <form method="POST" action="?/create" class="qp-new">
    <label><span>Title</span><input name="title" maxlength="60" required placeholder="Whitby, summer 2015" /></label>
    <label><span>Subject</span><input name="subject" maxlength="60" placeholder="Family holidays" /></label>
    <label class="qp-wide"><span>Notes</span><textarea name="notes" rows="5" placeholder="What happened, who was there, the bits everyone remembers…"></textarea></label>
    <button type="submit">New pack</button>
  </form>

  <h2>Packs</h2>
  {#if data.packs.length === 0}
    <p class="qp-muted">No packs yet.</p>
  {:else}
    <ul class="qp-list">
      {#each data.packs as p (p.id)}
        <li>
          <a href="/admin/content/quiz-packs/{p.id}">{p.title}</a>
          <span class="qp-muted">{p.subject ? `${p.subject} · ` : ''}{p.questions} questions · {p.photos} photos · {when(p.updatedAt)}</span>
          <span class="qp-status" class:qp-on={p.status === 'approved'}>{LABEL[p.status]}</span>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .qp { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; font-family: var(--font-body); }
  h1 { font-family: var(--font-display); font-weight: var(--font-display-weight); font-size: 1.75rem; margin: 0 0 0.75rem; }
  h2 { font-family: var(--font-mono); font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 2rem 0 0.75rem; color: var(--text-muted); }
  .qp-lead { line-height: 1.6; margin: 0 0 1.5rem; }
  .qp-new { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; align-items: end; }
  .qp-wide { grid-column: 1 / -1; }
  label { display: flex; flex-direction: column; gap: 0.3rem; }
  label span { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  input, textarea { font: inherit; font-size: 1rem; padding: 0.5rem 0.6rem; border: 1px solid var(--line-strong); border-radius: 2px; background: var(--surface-elevated); color: inherit; }
  button { justify-self: start; font: inherit; padding: 0.5rem 0.9rem; border-radius: 2px; border: 1px solid var(--accent-ink); background: var(--accent-ink); color: var(--bg); cursor: pointer; }
  .qp-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem; }
  .qp-list li { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; align-items: baseline; border-top: 1px solid var(--line-strong); padding-top: 0.6rem; }
  .qp-list a { color: var(--accent-ink); font-weight: 600; }
  .qp-muted { color: var(--text-muted); font-size: 0.9rem; }
  .qp-status { margin-left: auto; font-family: var(--font-mono); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .qp-on { color: var(--success); }
</style>
