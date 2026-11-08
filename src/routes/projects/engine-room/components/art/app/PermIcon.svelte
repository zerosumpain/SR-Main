<script lang="ts">
  // PermIcon — a small drawn icon for each permission and entitlement the manifest lists,
  // matched by what the key is about rather than by exact name, so a new key still gets a
  // sensible drawing and the unknown fall back to a plain mark.
  let { name }: { name: string } = $props();
  const k = $derived(name.toLowerCase());
  const kind = $derived(
    k.includes('health') ? 'heart'
    : k.includes('location') ? 'pin'
    : k.includes('motion') ? 'walk'
    : k.includes('camera') ? 'camera'
    : k.includes('network') ? 'wifi'
    : k.includes('speech') ? 'speech'
    : k.includes('microphone') ? 'mic'
    : k.includes('time-sensitive') ? 'clock'
    : k.includes('push') ? 'bell'
    : k.includes('apple') ? 'person'
    : k.includes('keychain') ? 'key'
    : 'dot',
  );
  const extra = $derived(k.includes('always') || k.includes('background') ? 'sweep' : k.includes('update') ? 'plus' : null);
</script>

<svg viewBox="0 0 48 48" aria-hidden="true" class="pi">
  {#if kind === 'heart'}
    <path d="M24 39 C 10 29, 6 22, 6 16 A9 9 0 0 1 24 12 A9 9 0 0 1 42 16 C 42 22, 38 29, 24 39Z" />
    <path class="acc" d="M10 23 H18 L21 17 L26 29 L29 23 H38" />
  {:else if kind === 'pin'}
    <path d="M24 42 C 14 30, 11 24, 11 18 A13 13 0 1 1 37 18 C 37 24, 34 30, 24 42Z" /><circle class="acc" cx="24" cy="18" r="4.5" />
  {:else if kind === 'walk'}
    <circle class="acc" cx="27" cy="8" r="4" /><path d="M24 15 L20 27 L26 31 L24 42 M20 27 L14 40 M23 17 L31 23 L36 21 M23 17 L15 21 L13 27" />
  {:else if kind === 'camera'}
    <rect x="6" y="14" width="36" height="24" rx="4" /><path d="M17 14 L20 9 H28 L31 14" /><circle class="acc" cx="24" cy="26" r="6.5" />
  {:else if kind === 'wifi'}
    <path d="M7 19 A25 25 0 0 1 41 19 M13 26 A16 16 0 0 1 35 26 M19 32 A8 8 0 0 1 29 32" /><circle class="acc dotf" cx="24" cy="38" r="3" />
  {:else if kind === 'speech'}
    <path d="M8 10 H40 V31 H22 L13 39 V31 H8Z" /><path class="acc" d="M15 21 V22 M20 17 V26 M25 14 V29 M30 18 V25 M34 20 V23" />
  {:else if kind === 'mic'}
    <rect x="18" y="6" width="12" height="22" rx="6" /><path d="M11 22 A13 13 0 0 0 37 22 M24 35 V42 M17 42 H31" /><path class="acc" d="M21 14 H27 M21 19 H27" />
  {:else if kind === 'bell'}
    <path d="M12 34 V22 A12 12 0 0 1 36 22 V34 L40 38 H8Z M20 42 H28" /><circle class="acc dotf" cx="36" cy="11" r="5" />
  {:else if kind === 'clock'}
    <circle cx="24" cy="25" r="15" /><path class="acc" d="M24 16 V25 L30 29" /><path d="M14 6 L8 12 M34 6 L40 12" />
  {:else if kind === 'person'}
    <circle cx="24" cy="16" r="8" /><path d="M8 42 A16 14 0 0 1 40 42" /><path class="acc" d="M30 30 L34 34 L42 25" />
  {:else if kind === 'key'}
    <circle cx="15" cy="24" r="8" /><path d="M23 24 H42 M36 24 V31 M42 24 V29" /><circle class="acc dotf" cx="15" cy="24" r="2.5" />
  {:else}
    <rect x="10" y="10" width="28" height="28" rx="2" /><circle class="acc dotf" cx="24" cy="24" r="4" />
  {/if}
  {#if extra === 'sweep'}<path class="acc" d="M38 40 A18 18 0 0 0 44 30" />{/if}
  {#if extra === 'plus'}<path class="acc" d="M40 4 V14 M35 9 H45" />{/if}
</svg>

<style>
  .pi { width: 100%; height: 100%; display: block; overflow: visible; }
  .pi :global(*) { fill: none; stroke: var(--fg); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  .pi :global(.acc) { stroke: var(--tone-text); }
  .pi :global(.dotf) { fill: var(--tone-text); stroke: none; }
</style>
