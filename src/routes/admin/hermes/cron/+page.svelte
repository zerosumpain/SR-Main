<svelte:head><title>Hermes cron — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  let { data, form } = $props();

  let pending = $state(false);
  // Shared enhance handler: keep the form values, then re-load the jobs list.
  function refresh() {
    pending = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      await invalidateAll();
      pending = false;
    };
  }

  function fmtWhen(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Hermes</div>
      <h1>Cron jobs</h1>
      <p class="sub">
        {#if data.direct}
          Engine scheduled jobs on <code>{data.hostname}</code>.
        {:else if data.canManage}
          Engine scheduled jobs (proxied to homeserv over Tailscale).
        {:else}
          Unavailable — host <code>{data.hostname}</code> has no homeserv route.
        {/if}
        These are <strong>engine-local</strong> jobs — separate from the Postgres
        workflow schedules at <a href="/admin/scheduled">/admin/scheduled</a>.
      </p>
    </div>
    <a class="back-link" href="/admin/hermes">← Hermes</a>
  </header>

  {#if data.available}
    {#if form?.error}<p class="banner err">{form.error}</p>{/if}
    {#if form?.ok && form?.op === 'create'}<p class="banner ok">Created job{form.jobId ? ` ${form.jobId}` : ''}.</p>{/if}
    {#if data.error}<p class="banner err">Could not load jobs: {data.error}</p>{/if}

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">New job</span></div>
      <form method="POST" action="?/create" use:enhance={refresh} class="new-job">
        <div class="nj-row">
          <input name="name" class="nm-text-input" placeholder="Job name (optional)" autocomplete="off" />
          <input name="schedule" class="nm-text-input grow" required autocomplete="off"
            placeholder="Schedule — 30m · every 2h · 0 9 * * * · 2026-06-04T19:00" />
        </div>
        <textarea name="prompt" class="nm-text-input" rows="2" autocomplete="off"
          placeholder="Prompt / task for the agent at fire time (e.g. 'Remind John to…')"></textarea>
        <div class="nj-row">
          <label class="nj-lbl mono">deliver
            <select name="deliver" class="nm-text-input">
              {#each data.deliveries as d (d)}<option value={d}>{d}</option>{/each}
            </select>
          </label>
          <label class="nj-lbl mono">repeat
            <input name="repeat" type="number" min="1" class="nm-text-input nj-repeat" placeholder="∞" />
          </label>
          <button type="submit" class="nm-save-btn" disabled={pending}>Create job</button>
        </div>
        <p class="deliver-note mono">
          Delivery is restricted to <strong>whatsapp</strong> (lands on your phone) and
          <strong>local</strong> (runs on the gateway host). jkai-chat delivery is
          dropped on restart / with no live client, so it's not offered.
        </p>
      </form>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Scheduled jobs</span>
        <span class="nm-sec-meta">{data.jobs.length} {data.jobs.length === 1 ? 'job' : 'jobs'}</span>
      </div>
      {#if data.jobs.length === 0}
        <p class="empty mono">No cron jobs scheduled.</p>
      {:else}
        <div class="jobs">
          {#each data.jobs as j (j.id)}
            <div class="job" data-enabled={j.enabled}>
              <div class="job-main">
                <div class="job-name">
                  {j.name || '(unnamed)'}
                  {#if !j.enabled}<span class="tag paused">paused</span>{/if}
                  {#if j.noAgent}<span class="tag">script</span>{/if}
                </div>
                <div class="job-sub mono">
                  {j.scheduleDisplay || j.scheduleKind} · → {j.deliver ?? '—'}
                  {#if j.repeat.times > 1}· {j.repeat.completed}/{j.repeat.times} runs{/if}
                </div>
                {#if j.prompt}<div class="job-prompt">{j.prompt}</div>{/if}
                <div class="job-meta mono">
                  next {fmtWhen(j.nextRunAt)} · last {fmtWhen(j.lastRunAt)}{#if j.lastStatus} ({j.lastStatus}){/if}
                  {#if j.lastError}<span class="job-err">⚠ {j.lastError}</span>{/if}
                </div>
              </div>
              <div class="job-actions">
                {#if j.enabled}
                  <form method="POST" action="?/pause" use:enhance={refresh}>
                    <input type="hidden" name="id" value={j.id} />
                    <button class="row-btn" disabled={pending}>Pause</button>
                  </form>
                {:else}
                  <form method="POST" action="?/resume" use:enhance={refresh}>
                    <input type="hidden" name="id" value={j.id} />
                    <button class="row-btn" disabled={pending}>Resume</button>
                  </form>
                {/if}
                <form method="POST" action="?/run" use:enhance={refresh}>
                  <input type="hidden" name="id" value={j.id} />
                  <button class="row-btn" disabled={pending}>Run now</button>
                </form>
                <form method="POST" action="?/remove" use:enhance={refresh}>
                  <input type="hidden" name="id" value={j.id} />
                  <button class="row-btn danger" disabled={pending}>Remove</button>
                </form>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="nm-sec">
      <p class="empty mono">
        Cron authoring needs a homeserv route — open <code>http://homeserv:5173/admin/hermes/cron</code>,
        or configure the proxy on this host.
      </p>
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.5rem; }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); }
  .page-hdr h1 { margin: 0.2rem 0 0; font-family: var(--font-brand, var(--font-display)); font-size: 1.6rem; font-weight: 500; }
  .sub { margin: 0.6rem 0 0; font-size: 0.92rem; line-height: 1.45; color: var(--text-secondary); max-width: 62ch; }
  .sub a, .empty a { color: var(--accent); text-decoration: none; }
  .sub a:hover { text-decoration: underline; }
  code { font-family: var(--font-mono); font-size: 0.85em; background: var(--code-bg); padding: 0.1em 0.35em; border-radius: var(--radius-sharp); }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  .nm-sec { background: var(--card-bg); border: 1px solid var(--card-border); padding: 1rem 1.1rem; margin-bottom: 1.1rem; }
  .nm-sec-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.7rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); }
  .nm-sec-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }

  .banner { font-size: 0.88rem; padding: 0.5rem 0.8rem; border-radius: var(--radius-round); margin: 0 0 1rem; }
  .banner.ok { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
  .banner.err { background: color-mix(in srgb, var(--error) 14%, transparent); color: var(--error); }
  .empty { font-size: 0.9rem; color: var(--text-secondary); }

  .new-job { display: flex; flex-direction: column; gap: 0.6rem; }
  .nj-row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: flex-end; }
  .nm-text-input { background: var(--bg-section); border: 1px solid var(--card-border); padding: 0.45rem 0.6rem; color: var(--text-primary); font-size: 0.9rem; font-family: inherit; }
  .nm-text-input:focus { outline: none; border-color: var(--accent); }
  .grow { flex: 1; min-width: 16rem; }
  textarea.nm-text-input { width: 100%; resize: vertical; }
  .nj-lbl { display: flex; flex-direction: column; gap: 0.2rem; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .nj-repeat { width: 6rem; }
  .nm-save-btn { font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.45rem 0.9rem; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer; margin-left: auto; }
  .nm-save-btn:disabled { opacity: 0.5; cursor: default; }
  .deliver-note { font-size: 11px; color: var(--text-muted); margin: 0.2rem 0 0; line-height: 1.4; }

  .jobs { display: flex; flex-direction: column; }
  .job { display: flex; justify-content: space-between; gap: 1rem; padding: 0.7rem 0.2rem; border-bottom: 1px solid var(--card-border); }
  .job:last-child { border-bottom: none; }
  .job[data-enabled='false'] { opacity: 0.65; }
  .job-main { min-width: 0; flex: 1; }
  .job-name { font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem; }
  .tag { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.1em 0.4em; border-radius: var(--radius-sharp); background: var(--bg-section); color: var(--text-muted); }
  .tag.paused { color: var(--error); }
  .job-sub { font-size: 11px; color: var(--text-secondary); margin-top: 0.2rem; }
  .job-prompt { font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.3rem; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .job-meta { font-size: 10px; color: var(--text-ghost); margin-top: 0.3rem; }
  .job-err { color: var(--error); margin-left: 0.5rem; }
  .job-actions { display: flex; gap: 0.4rem; align-items: flex-start; flex-shrink: 0; }
  .job-actions form { margin: 0; }
  .row-btn { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.25rem 0.55rem; border-radius: 4px; border: 1px solid var(--card-border); background: transparent; color: var(--text-secondary); cursor: pointer; }
  .row-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--text-muted); }
  .row-btn.danger { color: var(--error); border-color: color-mix(in srgb, var(--error) 40%, transparent); }
  .row-btn:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 640px) {
    .job { flex-direction: column; }
    .job-actions { flex-wrap: wrap; }
  }
</style>
