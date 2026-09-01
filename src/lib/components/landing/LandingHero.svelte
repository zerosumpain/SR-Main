<script lang="ts">
  let { tag, primary, ghost, strap }: {
    tag: string;
    primary: string;
    ghost: string;
    strap: string;
  } = $props();
</script>

<div class="lh">
  <p class="lh-tag">{tag}</p>
  <h1 class="lh-title">
    <span class="lh-owner">JK&rsquo;s</span>
    <span class="lh-name">strange ramblings</span>
  </h1>
  <div class="lh-status">
    <p class="lh-status-label">And his current status is&hellip;</p>
    <p class="lh-head"><span>{primary}</span> <span class="ghost">{ghost}</span></p>
    <p class="lh-strap">{strap}</p>
  </div>
</div>

<style>
  .lh {
    width: 100%;
    max-width: 1080px;
  }
  .lh-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 clamp(18px, 2.5vh, 28px);
  }
  .lh-title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
  }
  .lh-owner {
    font-family: var(--font-mono);
    font-size: clamp(14px, 1.35vw, 20px);
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .lh-name {
    display: block;
    font-family: var(--font-display);
    font-size: clamp(58px, 6.8vw, 104px);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.048em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .lh-status {
    max-width: 760px;
    margin-top: clamp(30px, 4.5vh, 48px);
    padding-left: clamp(16px, 2vw, 26px);
    border-left: 3px solid var(--accent);
  }
  .lh-status-label {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label-wide);
    line-height: 1.3;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lh-head {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(36px, 4vw, 62px);
    line-height: 0.94;
    letter-spacing: -0.036em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .lh-head > span {
    display: inline-block;
    white-space: nowrap;
  }
  .lh-head .ghost {
    color: var(--text-ghost);
  }
  .lh-strap {
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 14px 0 0;
    max-width: 52ch;
  }

  @media (max-width: 640px) {
    .lh-name {
      font-size: clamp(48px, 15vw, 68px);
      white-space: normal;
      text-wrap: balance;
    }
    .lh-head {
      font-size: clamp(34px, 11vw, 48px);
    }
  }
</style>
