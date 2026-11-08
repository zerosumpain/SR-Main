<script lang="ts">
  // An index card pinned to the page: card stock with a red head rule and
  // petrol lines (notes-paper.css's .np-card), a drawing pin, and a tilt of a
  // degree or so. For the latest post on a contents page, a pull quote, a
  // short note. The tilt is static, and print straightens it.
  //
  //   <IndexCard as="aside" tilt={-1.2} pin>…</IndexCard>
  import type { Snippet } from 'svelte';

  let {
    as = 'div',
    tilt = 1.2,
    pin = true,
    lined = true,
    class: className = '',
    children,
    ...rest
  }: {
    as?: 'div' | 'aside' | 'article' | 'li' | 'section' | 'figure';
    /** Degrees off true; 0 for a straight card. */
    tilt?: number;
    pin?: boolean;
    /** Ruled like an index card; false for plain card stock. */
    lined?: boolean;
    class?: string;
    children: Snippet;
    [attr: string]: unknown;
  } = $props();
</script>

<svelte:element this={as} class="np-card {className}" class:np-card--plain={!lined} style:--np-tilt="{tilt}deg" {...rest}>
  {#if pin}<span class="np-pin" aria-hidden="true"></span>{/if}
  {@render children()}
</svelte:element>
