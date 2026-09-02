<script lang="ts">
  let { tag }: {
    tag: string;
  } = $props();
</script>

<div class="lh">
  <p class="lh-tag">{tag}</p>
  <h1 class="lh-title">JK&rsquo;s strange ramblings</h1>
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
    font-family: var(--font-display);
    font-size: clamp(58px, 6.2vw, 100px);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.048em;
    text-transform: uppercase;
    text-wrap: balance;
    color: var(--text-primary);
    margin: 0;
    max-width: 12ch;
  }

  @media (max-width: 640px) {
    .lh-title {
      font-size: clamp(42px, 12.5vw, 58px);
    }
  }
</style>
