<script lang="ts">
  import { page } from '$app/stores';
  import { app } from '../lib/appState.svelte';

  const base = '/projects/data-standard-designer';
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const activeHref = $derived(pathname === base ? '' : pathname.slice(base.length + 1).split('/')[0]);

  // Review groups interoperability + impact.
  const isActive = (href: string) => activeHref === href || (href === 'interoperability' && activeHref === 'impact');

  const briefDone = $derived(!!(app.brief.name && app.brief.purpose));
  const schemaDone = $derived(app.fields.length > 0);

  const STEPS = $derived([
    { href: 'brief', label: 'Brief', done: briefDone },
    { href: 'schema', label: 'Schema', done: schemaDone },
    { href: 'interoperability', label: 'Review', done: schemaDone, score: app.mounted && app.fields.length ? app.overall : null },
    { href: 'publish', label: 'Publish', done: false },
  ]);

  function band(v: number): string {
    if (v >= 80) return 'var(--success)';
    if (v >= 60) return '#6a8f2d';
    if (v >= 40) return 'var(--warn)';
    return 'var(--error)';
  }
</script>

<nav class="stepper" aria-label="Design steps">
  {#each STEPS as s, i}
    {#if i > 0}<span class="conn" class:filled={STEPS[i - 1].done} aria-hidden="true"></span>{/if}
    <a
      href={`${base}/${s.href}`}
      class="step"
      class:active={isActive(s.href)}
      class:done={s.done && !isActive(s.href)}
    >
      <span class="dot">{#if s.done && !isActive(s.href)}✓{:else}{i + 1}{/if}</span>
      <span class="lbl">{s.label}</span>
      {#if s.score != null}<span class="score" style="color:{band(s.score)}">{s.score}</span>{/if}
    </a>
  {/each}
</nav>

<style>
  .stepper { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 6px 18px 8px; }
  .step { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: var(--radius-pill); position: relative; }
  .step .dot {
    width: 22px; height: 22px; border-radius: var(--radius-pill); display: inline-flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-size: 11px; border: 1.5px solid var(--card-border); color: var(--text-muted); background: var(--surface-elevated);
  }
  .step .lbl { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
  .step:hover .lbl, .step:hover .dot { color: var(--text-primary); }
  .step:hover .dot { border-color: var(--text-secondary); }

  .step.done .dot { border-color: var(--success); color: var(--success); background: var(--success-bg); }
  .step.done .lbl { color: var(--text-secondary); }

  .step.active .dot { background: var(--accent); border-color: var(--accent); color: #fff; }
  .step.active .lbl { color: var(--text-primary); font-weight: 600; }

  .score { font-family: var(--font-display); font-size: 16px; line-height: 1; margin-left: 2px; }

  .conn { width: 22px; height: 2px; background: var(--divider); border-radius: 2px; }
  .conn.filled { background: var(--success); }

  @media (max-width: 560px) {
    .step .lbl { display: none; }
    .step.active .lbl { display: inline; }
  }
</style>
