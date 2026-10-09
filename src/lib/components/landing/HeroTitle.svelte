<script lang="ts">
  // The landing masthead every hero view shares: the name on two lines, then
  // the subtitle. Kept in one place because the rambler walks along the tops
  // of "strange ramblings" — the span carrying the text floor must stay real,
  // static inline text in every view, and the page's only h1.
  import { scenery } from '$lib/landing/ramblers/scenery';
</script>

<h1 class="ht-title">JK’s<br /><span use:scenery={{ text: true }}>strange ramblings</span></h1>
<p class="ht-lede">I say things, I do things, and I share things. And look hey, now you see things</p>

<style>
  .ht-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(var(--fs-display-sm), 5vw, var(--fs-display-md));
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
  }
  .ht-lede {
    margin: 14px 0 0;
    font-size: var(--fs-body-lg);
    line-height: 1.4;
    color: rgba(237, 228, 212, 0.82);
  }
  @media (max-width: 760px) {
    .ht-lede {
      font-size: var(--fs-body);
    }
  }
  @media print {
    .ht-title,
    .ht-lede {
      color: #1a1008;
    }
  }
</style>
