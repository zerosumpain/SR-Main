<script lang="ts">
  import { enhance } from '$app/forms';
  import type { HeroActivityRules } from '$lib/constants/hero-slots';
  let { rules, result }: { rules: HeroActivityRules; result?: { activityError?: string; activitySaved?: boolean } | null } = $props();
</script>
<section class="nm-sec" aria-labelledby="hero-activity-title">
  <div class="nm-sec-hd"><h2 id="hero-activity-title">Activity rules</h2></div>
  <p>Choose the step counts that switch animation slots. These use today’s recorded steps and the calendar day in Europe/London.
    Weekends are Saturday and Sunday. No readings today uses Default.</p>
  <form method="POST" action="?/activity" use:enhance>
    <label class="nm-field"><span class="sr-label-tight">Averagely active from (steps)</span>
      <input class="nm-text-input" type="number" name="averageSteps" min="1" max="100000" step="1" value={rules.averageSteps} required />
    </label>
    <label class="nm-field"><span class="sr-label-tight">Very active from (steps)</span>
      <input class="nm-text-input" type="number" name="veryActiveSteps" min="2" max="100000" step="1" value={rules.veryActiveSteps} required />
    </label>
    <button class="nm-btn-ghost" type="submit">Save activity rules</button>
  </form>
  <p class="summary">Inactive: below {rules.averageSteps.toLocaleString()} steps · Averagely active: {rules.averageSteps.toLocaleString()}–{(rules.veryActiveSteps - 1).toLocaleString()} · Very active: {rules.veryActiveSteps.toLocaleString()}+</p>
  {#if result?.activityError}<p role="alert">{result.activityError}</p>{/if}
  {#if result?.activitySaved}<p role="status">Activity rules saved.</p>{/if}
</section>
<style>
  h2 { font-family: var(--font-display); font-size: var(--fs-body-lg); }
  p { font-size: var(--fs-body); line-height: 1.6; }
  form { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; }
  .nm-field { display: flex; flex: 1 1 230px; min-width: 0; flex-direction: column; gap: 8px; }
  input { width: 100%; }
  .summary { font-size: var(--fs-label); color: var(--text-muted); }
  :is(button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
