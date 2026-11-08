<svelte:options css="injected" />

<!--
  The place view's live sky (src/lib/landing/sky.ts) and the hero city's main
  colours (src/lib/landing/place-city.ts), registered as colours so a change
  of light can ease between two skies instead of jumping: the hero transitions
  these, and the page below it its ground, over a couple of seconds (never
  under reduced motion). Unregistered, a gradient's var() cannot be animated.

  Nothing to draw: this is only its stylesheet. `@property` is a global
  at-rule, so it applies page-wide from here, but it lives in the place view's
  lazy chunk (injected with it, like every component under the views; see
  page-view.svelte.ts) rather than in app.css, so no other page and no other
  view downloads it. Rendered by HeroPlace, which always comes with the
  place view's showcase, so the page below (+page.svelte's ground) has it too.
-->

<style>
  @property --sky-top {
    syntax: '<color>';
    inherits: true;
    initial-value: #05070e;
  }
  @property --sky-mid {
    syntax: '<color>';
    inherits: true;
    initial-value: #080b17;
  }
  @property --sky-low {
    syntax: '<color>';
    inherits: true;
    initial-value: #0e1222;
  }
  @property --sky-haze {
    syntax: '<color>';
    inherits: true;
    initial-value: transparent;
  }
  @property --sky-ground {
    syntax: '<color>';
    inherits: true;
    initial-value: #0b0806;
  }
  @property --city-glass {
    syntax: '<color>';
    inherits: true;
    initial-value: #0e121a;
  }
  @property --city-stone {
    syntax: '<color>';
    inherits: true;
    initial-value: #13110f;
  }
  @property --city-metal {
    syntax: '<color>';
    inherits: true;
    initial-value: #0b0d12;
  }
  @property --city-glaze {
    syntax: '<color>';
    inherits: true;
    initial-value: #07090e;
  }
  @property --city-near {
    syntax: '<color>';
    inherits: true;
    initial-value: #0e1515;
  }
  @property --city-far {
    syntax: '<color>';
    inherits: true;
    initial-value: #15211f;
  }
  @property --city-cloud {
    syntax: '<color>';
    inherits: true;
    initial-value: #0f1213;
  }
</style>
