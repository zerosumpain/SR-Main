<script lang="ts">
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>
<svelte:head><title>CodeGraph — sources</title></svelte:head>
<section class="wrap"><h1>Code sources</h1><p>Versioned references for development. External text stays reference material; it does not establish a verified local lesson.</p>
  <details><summary>Add a reference</summary><form method="POST">
    <label>Repository<input name="repo" value="SR-Main" required /></label><label>Kind<select name="kind"><option value="documentation">Official documentation</option><option value="upstream-fix">Upstream fix</option><option value="example">Code example</option><option value="owned-repository">Owned repository</option></select></label>
    <label>Title<input name="title" required maxlength="200" /></label><label>Source URL<input type="url" name="url" required /></label><label>Commit or package version<input name="revision" required /></label><label>Licence or reuse terms<input name="license" required /></label><label>Package name, if relevant<input name="packageName" /></label><label>Relevant source excerpt<textarea name="text" required maxlength="50000" rows="7"></textarea></label><button>Save reference</button>
  </form></details>
  {#if form && 'error' in form}<p role="alert">{form.error}</p>{/if}{#if form && 'saved' in form}<p role="status">Reference saved with version and provenance.</p>{/if}
  <h2>References</h2>{#each data.sources as source}<article><h3><a href={source.url ?? '#'} rel="noreferrer">{source.title}</a></h3><p>{source.repo} · {source.revision} · {source.license} · {source.status}</p><details><summary>Evidence and provenance</summary><pre>{String(source.payload.text ?? '')}</pre><p>Imported {new Date(source.createdAt).toLocaleString()}; access: {source.access}</p></details></article>{:else}<p>No external references registered. Lockfile dependencies appear in each indexed build’s Code context.</p>{/each}
  <h2>Indexed revisions</h2>{#each data.snapshots as snapshot}<p>{snapshot.repo} · {snapshot.scope} · <code>{snapshot.revision.slice(0, 12)}</code> · {new Date(snapshot.createdAt).toLocaleString()}</p>{:else}<p>No revision snapshots yet.</p>{/each}
</section>
<style>.wrap { max-width: 960px; margin: auto; padding: 1.5rem; overflow-wrap: anywhere; } h1 { font-family: var(--font-display); } form, label { display: grid; gap: 0.5rem; } form { margin-block: 1rem; } input, select, textarea, button { font: inherit; color: var(--text-primary); background: var(--surface-card); border: 1px solid var(--line-strong); padding: 0.5rem; min-width: 0; } article { border-block-end: 1px solid var(--line); padding-block: 0.7rem; } a { color: var(--accent-ink); } code, pre { font-family: var(--font-code); } pre { white-space: pre-wrap; } summary { cursor: pointer; } [role=alert] { color: var(--error); }</style>
