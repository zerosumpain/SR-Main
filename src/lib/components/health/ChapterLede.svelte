<script lang="ts">
  // The sentence that opens a chapter.
  //
  // Set in the body face rather than the mono label face on purpose: it is
  // prose, and every other line of chrome on this page is a mono label. That
  // contrast is what stops the page reading as a wall of instrumentation.
  let { text }: { text: string } = $props();
</script>

{#if text}
  <p class="lede">{text}</p>
{/if}

<style>
  .lede {
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 28px 0;
    /* No measure cap. The chapter is the column: a lede that stopped at 62ch
       left half the chapter empty beside it and read as a pull-quote rather
       than as the sentence the charts below are answering. */
    border-left: 2px solid var(--accent);
    padding-left: 18px;
  }

  @media (max-width: 720px) {
    .lede {
      font-size: var(--fs-body);
      margin-bottom: 20px;
      padding-left: 12px;
    }
  }
</style>
