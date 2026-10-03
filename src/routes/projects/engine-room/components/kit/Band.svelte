<script lang="ts">
  // Band — a full-bleed section of the page. The study is built from these, alternating
  // ink and paper the way /health does: measurement on ink, argument on paper.
  //
  // A band sets `data-surface`, so anything inside it picks the right foreground ramp and
  // the right shade of its part's colour without being told which ground it is on.
  import type { Snippet } from 'svelte';
  import type { PartId } from '../../lib/nav';

  interface Props {
    surface?: 'ink' | 'paper' | 'deep' | 'lift';
    part?: PartId;
    id?: string;
    /** Vertical padding: hero is tall, tight is for a strip. */
    pad?: 'hero' | 'normal' | 'tight' | 'none';
    /** Let the inner column run the full width of the window. */
    bleed?: boolean;
    label?: string;
    children: Snippet;
  }
  let { surface = 'paper', part, id, pad = 'normal', bleed = false, label, children }: Props = $props();
</script>

<section class="band {surface} pad-{pad}" data-surface={surface === 'ink' ? 'ink' : 'paper'} data-part={part} {id} aria-label={label}>
  <div class="inner" class:bleed>{@render children()}</div>
</section>

<style>
  .band { position: relative; background: var(--ground); scroll-margin-top: var(--topH, 0px); }
  .band.deep { background: var(--er-paper-deep); }
  .band.lift { background: var(--er-paper-hi); }
  .band.paper + :global(.band.paper) { border-top: 1px solid rgba(26, 16, 8, 0.1); }
  .inner { max-width: var(--er-measure); margin: 0 auto; padding: 0 var(--er-gutter); position: relative; }
  .inner.bleed { max-width: none; padding: 0; }
  .pad-hero { padding: clamp(56px, 8vw, 120px) 0 clamp(48px, 6vw, 96px); }
  .pad-normal { padding: clamp(48px, 6vw, 92px) 0; }
  .pad-tight { padding: clamp(24px, 3vw, 40px) 0; }
  .pad-none { padding: 0; }
</style>
