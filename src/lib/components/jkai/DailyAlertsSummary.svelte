<script lang="ts">
  import { dailyAlertsText, DAILY_ALERTS_HREF, type DailyAlertsSummary } from '$lib/jkai/intel/daily-alerts';
  let { summary }: { summary: DailyAlertsSummary } = $props();
</script>
<section class="alerts-summary" aria-label="Daily alerts">
  <div class="alerts-heading">
    <a href={DAILY_ALERTS_HREF}>Daily alerts</a>
    <span>{dailyAlertsText(summary)}</span>
    {#if summary.total > summary.items.length}<a class="view-all" href={DAILY_ALERTS_HREF}>View all {summary.total}</a>{/if}
  </div>
  {#if summary.items.length}
    <ul>
      {#each summary.items as alert (alert.id)}
        <li>
          <div class="alert-title">
            <span class="priority" class:high={alert.significance === 'high'} class:medium={alert.significance === 'medium'}>{alert.significance} priority</span>
            <strong>{alert.title}</strong>
          </div>
          <p>{alert.content}</p>
        </li>
      {/each}
    </ul>
  {/if}
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
  a:focus-visible { outline:2px solid var(--accent-on-dark); outline-offset:3px; }
  @media (max-width:799px) { ul { grid-template-columns:minmax(0,1fr); } }
</style>
