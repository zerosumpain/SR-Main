<script lang="ts">
  // Counter — a live figure that counts up the first time it scrolls into view.
  //
  // The server renders the true value, so the number is right before any script runs and
  // stays right for a reader with reduced motion. Only once the page is live does it drop to
  // zero and climb, and only when the reader can see it climbing.
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { inView } from '../../lib/motion';
  import { still } from '../../lib/motion';

  interface Props {
    /** The figure. null renders a dash: a dash says we don't know, a zero is a claim. */
    value: number | null | undefined;
    /** Decimal places to show. */
    places?: number;
    prefix?: string;
    suffix?: string;
    duration?: number;
  }
  let { value, places = 0, prefix = '', suffix = '', duration = 1600 }: Props = $props();

  const target = $derived(value == null || !Number.isFinite(value) ? null : value);
  const t = new Tween(0, { duration: 0, easing: cubicOut });
  let armed = $state(false);
  let seen = $state(false);

  $effect(() => {
    // Before hydration the SSR value shows. After it, hold at zero until seen.
    if (target == null) return;
    if (!armed) { t.set(target, { duration: 0 }); return; }
    t.set(seen ? target : 0, { duration: seen ? duration : 0 });
  });

  function watch(el: HTMLElement) {
    if (still()) return;
    armed = true;
    return inView(el, () => { seen = true; }, { amount: 0.6 });
  }

  const fmt = (n: number) =>
    n.toLocaleString('en-GB', { minimumFractionDigits: places, maximumFractionDigits: places });
</script>

<span class="ctr" {@attach watch} aria-label={target == null ? 'not available' : `${prefix}${fmt(target)}${suffix}`}>
  <span aria-hidden="true">{#if target == null}—{:else}{prefix}{fmt(t.current)}{suffix}{/if}</span>
</span>

<style>
  .ctr { font-variant-numeric: tabular-nums; }
</style>
