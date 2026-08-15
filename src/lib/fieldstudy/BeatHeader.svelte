<script lang="ts">
  // Slot 1 of every template. Numeral outdents into the margin column.
  let { no, name, total = 7, remaining, minutes, variant = 'standard' }:
    { no: string; name: string; total?: number; remaining?: number; minutes?: number; variant?: 'standard' | 'display' } = $props();
  const pct = $derived(Math.round((Number(no) / total) * 100));
</script>

<div class="fs-spread">
  <div style="text-align:right">
    <div class="fs-numeral">{no}</div>
    <div class="fs-margin-label" style="margin-top:9px">Beat {no}<br />of {total}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <span style="width:74px;height:3px;background:rgba(26,16,8,.14)"><span style="display:block;height:100%;background:var(--accent);width:{pct}%"></span></span>
    </div>
  </div>
  <div>
    <div class="fs-beat-rule">
      <span class="fs-kicker">Beat {no}</span>
      <span class="fill"></span>
      {#if remaining !== undefined}<span class="fs-margin-label">{remaining} of {total} remaining{#if minutes} · {minutes} min{/if}</span>{/if}
    </div>
    <h1 class="fs-h1" class:fs-h1--display={variant === 'display'}>{name}</h1>
  </div>
</div>
