<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import { dailyAlertsText, DAILY_ALERTS_HREF, type DailyAlertsSummary } from '$lib/jkai/intel/daily-alerts';
  let { summary }: { summary: DailyAlertsSummary } = $props();
  let editing = $state<string | null>(null);
  let reason = $state('');
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let reasonInput: HTMLTextAreaElement;
  let dismissed = $state<string[]>([]);
  const visible = $derived.by(() => {
    const removed = summary.items.filter((alert) => dismissed.includes(alert.id));
    return {
      ...summary,
      total: summary.total - removed.length,
      high: summary.high - removed.filter((alert) => alert.significance === 'high').length,
      items: summary.items.filter((alert) => !dismissed.includes(alert.id)),
    };
  });

  async function startDismissal(id: string) {
    editing = id;
    reason = '';
    error = '';
    notice = '';
    await tick();
    reasonInput?.focus();
  }

  async function dismiss(id: string) {
    if (saving) return;
    saving = true;
    error = '';
    try {
      const response = await fetch(`/api/jkai/intel/alerts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) throw new Error('Unable to dismiss this alert. Please try again.');
      dismissed = [...dismissed, id];
      editing = null;
      reason = '';
      notice = 'Alert dismissed.';
      // Reload all mounted summaries and fill the preview from remaining alerts.
      try { await invalidateAll(); } catch {
        notice = 'Alert dismissed. Reload to refresh the remaining alerts.';
      }
      await tick();
      headingLink?.focus();
    } catch {
      error = 'Unable to dismiss this alert. Please try again.';
    } finally {
      saving = false;
    }
  }
  let headingLink: HTMLAnchorElement;
</script>
<section class="alerts-summary" aria-label="Daily alerts">
  <div class="alerts-heading">
    <a bind:this={headingLink} href={DAILY_ALERTS_HREF}>Daily alerts</a>
    <span>{dailyAlertsText(visible)}</span>
    {#if visible.total > visible.items.length}<a class="view-all" href={DAILY_ALERTS_HREF}>View all {visible.total}</a>{/if}
  </div>
  {#if visible.items.length}
    <ul>
      {#each visible.items as alert (alert.id)}
        <li>
          <div class="alert-title">
            <span class="priority" class:high={alert.significance === 'high'} class:medium={alert.significance === 'medium'}>{alert.significance} priority</span>
            <strong>{alert.title}</strong>
          </div>
          <p>{alert.content} <button type="button" class="dismiss" disabled={saving} aria-expanded={editing === alert.id} aria-label={`Dismiss ${alert.title}`} onclick={() => startDismissal(alert.id)}>Dismiss</button></p>
          {#if editing === alert.id}
            <form onsubmit={(event) => { event.preventDefault(); void dismiss(alert.id); }}>
              <label for={`dismiss-reason-${alert.id}`}>Reason for dismissal (optional)</label>
              <textarea bind:this={reasonInput} id={`dismiss-reason-${alert.id}`} bind:value={reason} disabled={saving} rows="2" placeholder="Why are you dismissing this alert?"></textarea>
              {#if error}<p role="alert">{error}</p>{/if}
              <div class="dismiss-actions">
                <button type="submit" class="confirm" disabled={saving}>{saving ? 'Dismissing…' : 'Dismiss alert'}</button>
                <button type="button" disabled={saving} onclick={async () => { editing = null; error = ''; await tick(); headingLink?.focus(); }}>Cancel</button>
              </div>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <span class="notice" role="status">{notice}</span>
</section>
<style>
  .alerts-summary { color:var(--bg); margin-bottom:16px; font-size:var(--fs-nav); min-width:0; }
  .alerts-heading { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:baseline; padding-bottom:8px; border-bottom:1px solid rgba(237,228,212,.25); }
  .alerts-heading > a { font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.08em; }
  a { color:var(--accent-ink-on-dark); }
  .alerts-heading > span, p { color:rgba(237,228,212,.72); }
  ul { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:20px; list-style:none; padding:0; margin:0; }
  li { padding:6px 0; border-bottom:1px solid rgba(237,228,212,.2); overflow-wrap:anywhere; min-width:0; }
  .alert-title { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 8px; line-height:1.35; }
  strong { font-weight:600; }
  .priority { flex-shrink:0; padding:2px 5px; border:1px solid currentColor; font-size:var(--fs-label-xs); line-height:1.2; text-transform:uppercase; letter-spacing:.04em; color:var(--accent-ink-on-dark); }
  .priority.high { color:var(--bg); border-color:var(--accent-on-dark); background:rgba(232,134,58,.22); }
  .priority.medium { color:var(--accent-on-dark); }
  p { margin:5px 0 0; line-height:1.4; }
  .view-all { margin-left:auto; font-size:var(--fs-label-xs); }
  .dismiss { margin-left:6px; padding:1px 6px; }
  button { color:var(--bg); border:1px solid rgba(237,228,212,.4); background:transparent; padding:4px 8px; font:inherit; font-size:var(--fs-label-xs); cursor:pointer; }
  button:hover { border-color:var(--accent-on-dark); }
  button:disabled { opacity:.6; cursor:wait; }
  form { margin-top:10px; }
  label { display:block; margin-bottom:4px; }
  textarea { display:block; width:100%; box-sizing:border-box; resize:vertical; padding:8px; background:var(--surface-card); color:var(--text-primary); border:1px solid var(--line-strong); font:inherit; font-size:var(--fs-body); }
  .dismiss-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .confirm { background:var(--accent-on-dark); color:var(--text-primary); border-color:var(--accent-on-dark); }
  .notice { display:block; margin-top:4px; }
  a:focus-visible, button:focus-visible, textarea:focus-visible { outline:2px solid var(--accent-on-dark); outline-offset:3px; }
  @media (max-width:799px) { ul { grid-template-columns:minmax(0,1fr); } }
</style>
