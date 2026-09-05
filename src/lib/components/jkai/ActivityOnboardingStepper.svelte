<script lang="ts">
  import { ACTIVITY_ONBOARDING_STEPS } from '$lib/activity/onboarding';

  let {
    current,
    compact = false,
  }: {
    current: number;
    compact?: boolean;
  } = $props();
</script>

<ol class:compact class="onboarding-steps" aria-label="Source setup progress">
  {#each ACTIVITY_ONBOARDING_STEPS as label, index (label)}
    {@const number = index + 1}
    <li class:active={number === current} class:complete={number < current} aria-current={number === current ? 'step' : undefined}>
      <span>{number < current ? '✓' : number}</span>
      <small>{label}</small>
    </li>
  {/each}
</ol>

<style>
  .onboarding-steps {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    margin: 0;
    padding: 18px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    text-transform: uppercase;
  }
  li::after {
    content: '';
    position: absolute;
    z-index: -1;
    top: 11px;
    left: 22px;
    width: calc(100% - 22px);
    border-top: 1px solid var(--line-strong);
  }
  li:last-child::after { display: none; }
  span {
    width: 23px;
    height: 23px;
    flex: 0 0 23px;
    display: grid;
    place-items: center;
    border: 1px solid currentColor;
    background: var(--bg);
    font-size: var(--fs-label-xs);
  }
  small {
    overflow: hidden;
    padding-right: 8px;
    background: var(--bg);
    font-size: var(--fs-label-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.active { color: var(--accent, #c4570a); }
  li.complete { color: var(--success, #2d7a3a); }
  @media (max-width: 760px) {
    .onboarding-steps { grid-template-columns: repeat(8, 1fr); gap: 4px; }
    li { justify-content: center; }
    li::after { left: calc(50% + 12px); width: calc(100% - 24px); }
    small { display: none; }
    li.active small {
      position: absolute;
      top: 31px;
      left: 50%;
      display: block;
      overflow: visible;
      padding: 0;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .onboarding-steps { padding-bottom: 34px; }
  }
</style>
