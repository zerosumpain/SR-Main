<script lang="ts">
  // One Snap Happy picture: a flat, bold, original drawing on a paper tile,
  // meant to be read from across a living room in a fraction of a second.
  // Every picture shares one viewBox (0 0 100 100), one ink outline and one
  // small palette, so the lookalikes (engine and bus, kettle, teapot and mug,
  // custard cream, toast and cake, scone and cake) tempt on shape and colour
  // without ever being the same thing.
  import { PICTURES, type Picture } from '$lib/games/snap-happy';

  let { pic, size = '100%' }: { pic: Picture; size?: string } = $props();
</script>

<span class="snap-pic" style:width={size} style:height={size}>
  <svg viewBox="0 0 100 100" role="img" aria-label={PICTURES[pic].label.replace(/^the /, '')}>
    <rect class="snap-paper" x="0" y="0" width="100" height="100" rx="2" />
    <g class="snap-art">
      {#if pic === 'engine'}
        <!-- An early locomotive: long boiler, tall flared chimney, upright cylinders, no cab, a tender behind. -->
        <line class="snap-n" x1="2" y1="91" x2="98" y2="91" />
        <rect class="snap-k" x="4" y="50" width="20" height="24" rx="1" />
        <rect class="snap-t" x="7" y="44" width="14" height="8" rx="1" />
        <circle class="snap-o" cx="14" cy="80" r="8" />
        <circle class="snap-k" cx="14" cy="80" r="2" />
        <rect class="snap-k" x="24" y="70" width="70" height="6" />
        <rect class="snap-p" x="30" y="44" width="58" height="26" rx="13" />
        <line class="snap-n" x1="44" y1="45" x2="44" y2="69" />
        <line class="snap-n" x1="60" y1="45" x2="60" y2="69" />
        <rect class="snap-k" x="38" y="30" width="7" height="15" />
        <rect class="snap-k" x="53" y="30" width="7" height="15" />
        <rect class="snap-k" x="74" y="14" width="9" height="31" />
        <polygon class="snap-k" points="70,8 87,8 84,16 73,16" />
        <circle class="snap-c" cx="91" cy="15" r="4" />
        <circle class="snap-c" cx="95" cy="6" r="3" />
        <rect class="snap-k" x="94" y="64" width="4" height="10" />
        <circle class="snap-o" cx="44" cy="80" r="11" />
        <circle class="snap-o" cx="74" cy="80" r="11" />
        <line class="snap-thin" x1="33" y1="80" x2="55" y2="80" />
        <line class="snap-thin" x1="44" y1="69" x2="44" y2="91" />
        <line class="snap-thin" x1="63" y1="80" x2="85" y2="80" />
        <line class="snap-thin" x1="74" y1="69" x2="74" y2="91" />
        <circle class="snap-k" cx="44" cy="80" r="3" />
        <circle class="snap-k" cx="74" cy="80" r="3" />
        <line class="snap-rod" x1="44" y1="76" x2="74" y2="76" />
      {:else if pic === 'bus'}
        <!-- A red double-decker, side on. -->
        <rect class="snap-r" x="6" y="14" width="88" height="66" rx="7" />
        <rect class="snap-c" x="6" y="45" width="88" height="5" />
        <rect class="snap-c" x="12" y="21" width="16" height="17" rx="2" />
        <rect class="snap-c" x="32" y="21" width="16" height="17" rx="2" />
        <rect class="snap-c" x="52" y="21" width="16" height="17" rx="2" />
        <rect class="snap-c" x="72" y="21" width="16" height="17" rx="2" />
        <rect class="snap-c" x="12" y="55" width="16" height="14" rx="2" />
        <rect class="snap-c" x="32" y="55" width="16" height="14" rx="2" />
        <rect class="snap-c" x="52" y="55" width="16" height="14" rx="2" />
        <rect class="snap-k" x="74" y="53" width="13" height="27" />
        <rect class="snap-k" x="4" y="78" width="92" height="5" rx="1" />
        <circle class="snap-k" cx="26" cy="84" r="10" />
        <circle class="snap-k" cx="74" cy="84" r="10" />
        <circle class="snap-c" cx="26" cy="84" r="3.5" />
        <circle class="snap-c" cx="74" cy="84" r="3.5" />
      {:else if pic === 'kettle'}
        <!-- A stovetop kettle: domed body, carry handle over the top, straight spout with a whistle. -->
        <path class="snap-n snap-heavy" d="M33 42 C33 16 67 16 67 42" />
        <path class="snap-o" d="M30 64 L10 38 L15 34 L36 54 Z" />
        <rect class="snap-k" x="7" y="32" width="8" height="7" rx="1" transform="rotate(-38 11 35)" />
        <path class="snap-o" d="M18 84 C18 58 30 42 50 42 C70 42 82 58 82 84 Z" />
        <path class="snap-n" d="M30 56 C36 50 42 48 48 48" />
        <ellipse class="snap-k" cx="50" cy="42" rx="12" ry="4" />
        <circle class="snap-k" cx="50" cy="37" r="4" />
        <rect class="snap-k" x="14" y="84" width="72" height="6" rx="2" />
      {:else if pic === 'teapot'}
        <!-- A round brown-betty teapot: curved spout, loop handle on the side, lid and knob. -->
        <path class="snap-p" d="M26 64 C16 62 12 50 6 42 L11 39 C16 46 21 52 28 53 Z" />
        <path class="snap-n snap-heavy" d="M74 48 C92 48 92 76 72 76" />
        <ellipse class="snap-p" cx="50" cy="62" rx="28" ry="24" />
        <path class="snap-c" d="M23 60 C34 66 66 66 77 60 L77 66 C66 72 34 72 23 66 Z" />
        <path class="snap-p" d="M33 41 C38 30 62 30 67 41 Z" />
        <circle class="snap-k" cx="50" cy="30" r="5" />
        <rect class="snap-k" x="32" y="84" width="36" height="6" rx="2" />
      {:else if pic === 'mug'}
        <!-- A mug of tea, steaming. -->
        <path class="snap-n" d="M36 24 C30 18 42 14 36 6" />
        <path class="snap-n" d="M48 24 C42 18 54 14 48 6" />
        <path class="snap-n" d="M60 24 C54 18 66 14 60 6" />
        <path class="snap-n snap-heavy" d="M70 42 C90 42 90 72 70 72" />
        <rect class="snap-o" x="24" y="32" width="48" height="56" rx="4" />
        <ellipse class="snap-t" cx="48" cy="34" rx="22" ry="4" />
        <path class="snap-c" d="M48 70 C40 62 36 56 42 52 C45 50 48 53 48 55 C48 53 51 50 54 52 C60 56 56 62 48 70 Z" />
      {:else if pic === 'biscuit'}
        <!-- A custard cream from above: pale oblong, dotted rim, a scroll and a flower stamped in the middle. -->
        <rect class="snap-b" x="8" y="22" width="84" height="56" rx="3" />
        <rect class="snap-n snap-thin" x="15" y="29" width="70" height="42" rx="2" />
        <path class="snap-n snap-thin" d="M22 50 C22 38 34 38 34 46 C34 52 26 52 28 46" />
        <path class="snap-n snap-thin" d="M78 50 C78 62 66 62 66 54 C66 48 74 48 72 54" />
        <circle class="snap-n snap-thin" cx="50" cy="50" r="7" />
        <path class="snap-n snap-thin" d="M50 36 V43 M50 57 V64 M38 50 H43 M57 50 H62" />
        {#each [20, 30, 40, 50, 60, 70, 80] as x (x)}
          <circle class="snap-dot" cx={x} cy="25.5" r="1.3" />
          <circle class="snap-dot" cx={x} cy="74.5" r="1.3" />
        {/each}
        {#each [36, 50, 64] as y (y)}
          <circle class="snap-dot" cx="11.5" cy={y} r="1.3" />
          <circle class="snap-dot" cx="88.5" cy={y} r="1.3" />
        {/each}
        <rect class="snap-cream" x="10" y="78" width="80" height="4" />
        <rect class="snap-b" x="8" y="82" width="84" height="6" rx="2" />
      {:else if pic === 'scone'}
        <!-- A scone on a plate, split side showing, cream and jam on top. -->
        <ellipse class="snap-c" cx="50" cy="86" rx="42" ry="7" />
        <path class="snap-t" d="M16 82 C14 60 20 50 50 50 C80 50 86 60 84 82 Z" />
        <path class="snap-b" d="M17 68 C30 72 70 72 83 68 L84 74 C70 78 30 78 16 74 Z" />
        <path class="snap-w" d="M24 52 C18 44 28 36 36 40 C40 30 58 30 62 38 C72 34 82 44 76 52 C60 56 40 56 24 52 Z" />
        <path class="snap-r" d="M36 40 C38 32 58 30 62 38 C58 44 42 46 36 40 Z" />
      {:else if pic === 'cake'}
        <!-- A layered sponge: jam and cream inside, white icing, a cherry on top. -->
        <ellipse class="snap-c" cx="50" cy="88" rx="44" ry="6" />
        <rect class="snap-b" x="14" y="62" width="72" height="24" rx="2" />
        <rect class="snap-r" x="14" y="56" width="72" height="6" />
        <rect class="snap-w" x="14" y="50" width="72" height="6" />
        <rect class="snap-b" x="14" y="32" width="72" height="18" rx="2" />
        <path class="snap-w" d="M12 28 H88 V36 C84 36 84 44 80 44 C76 44 76 36 72 36 H62 C58 36 58 46 54 46 C50 46 50 36 46 36 H34 C30 36 30 42 26 42 C22 42 22 36 18 36 H12 Z" />
        <path class="snap-n snap-thin" d="M50 20 C52 14 56 10 60 8" />
        <circle class="snap-r" cx="50" cy="22" r="6" />
      {:else if pic === 'toast'}
        <!-- A slice of toast with a pat of butter. -->
        <path class="snap-t" d="M18 88 L18 40 C6 36 8 10 30 10 L70 10 C92 10 94 36 82 40 L82 88 Z" />
        <path class="snap-b" d="M26 80 L26 36 C18 32 20 18 32 18 L68 18 C80 18 82 32 74 36 L74 80 Z" />
        <rect class="snap-butter" x="38" y="40" width="24" height="18" rx="2" transform="rotate(-12 50 49)" />
      {:else if pic === 'clock'}
        <!-- A town clock tower: a big face, a pointed spire, a doorway at the foot. -->
        <polygon class="snap-p" points="32,32 50,9 68,32" />
        <rect class="snap-k" x="48" y="4" width="4" height="7" />
        <rect class="snap-s" x="34" y="32" width="32" height="56" />
        <rect class="snap-s" x="28" y="84" width="44" height="10" />
        <rect class="snap-k" x="30" y="30" width="40" height="5" />
        <circle class="snap-c" cx="50" cy="50" r="12" />
        <line class="snap-n" x1="50" y1="50" x2="50" y2="41" />
        <line class="snap-n" x1="50" y1="50" x2="57" y2="53" />
        <circle class="snap-k" cx="50" cy="50" r="2" />
        <rect class="snap-k" x="45" y="68" width="10" height="16" rx="5" />
      {:else if pic === 'bridge'}
        <!-- A stone arch bridge over a river. -->
        <rect class="snap-p" x="0" y="72" width="100" height="28" />
        <path class="snap-n snap-thin snap-wave" d="M6 84 C12 80 18 88 24 84 M58 92 C64 88 70 96 76 92 M70 80 C76 76 82 84 88 80" />
        <path class="snap-s" d="M2 34 L98 34 L98 80 L86 80 C86 60 70 50 50 50 C30 50 14 60 14 80 L2 80 Z" />
        <rect class="snap-s" x="2" y="26" width="96" height="8" />
        <path class="snap-n snap-thin" d="M50 50 V40 M34 54 L28 44 M66 54 L72 44 M22 64 L12 58 M78 64 L88 58" />
      {:else if pic === 'umbrella'}
        <!-- An open umbrella with a crook handle. -->
        <path class="snap-n snap-heavy" d="M50 46 V82 C50 92 36 92 36 84" />
        <path class="snap-o" d="M6 50 C6 26 26 12 50 12 C74 12 94 26 94 50 C88 44 78 44 72 50 C66 44 56 44 50 50 C44 44 34 44 28 50 C22 44 12 44 6 50 Z" />
        <path class="snap-p" d="M28 50 C28 30 38 16 50 12 C62 16 72 30 72 50 C66 44 56 44 50 50 C44 44 34 44 28 50 Z" />
        <path class="snap-n snap-thin" d="M50 12 V50" />
        <rect class="snap-k" x="48" y="5" width="4" height="8" />
      {:else if pic === 'boot'}
        <!-- A green wellie, side on. -->
        <path class="snap-g" d="M28 10 H60 V60 C60 66 66 68 72 70 L84 74 C92 77 92 88 84 88 H26 C24 88 24 86 24 84 L28 10 Z" />
        <rect class="snap-k" x="24" y="84" width="66" height="8" rx="2" />
        <rect class="snap-c" x="27" y="10" width="34" height="7" />
        <path class="snap-n snap-thin" d="M58 66 C64 74 74 76 80 76" />
        <rect class="snap-k" x="52" y="24" width="6" height="18" rx="3" />
      {:else if pic === 'bike'}
        <!-- A bike, side on. -->
        <circle class="snap-n snap-heavy" cx="24" cy="66" r="17" />
        <circle class="snap-n snap-heavy" cx="76" cy="66" r="17" />
        <path class="snap-n snap-thin" d="M24 49 V83 M7 66 H41 M76 49 V83 M59 66 H93" />
        <path class="snap-n snap-frame" d="M24 66 L42 38 L68 38 L48 66 Z M42 38 L48 66 M68 38 L76 66" />
        <path class="snap-n snap-frame" d="M64 26 L68 38" />
        <path class="snap-n snap-heavy" d="M58 26 H72" />
        <path class="snap-k" d="M33 30 H50 C50 34 44 36 33 34 Z" />
        <line class="snap-n snap-frame" x1="42" y1="38" x2="40" y2="32" />
        <circle class="snap-k" cx="48" cy="66" r="4" />
      {:else if pic === 'boat'}
        <!-- A little sailing boat on the water. -->
        <path class="snap-n snap-thin snap-sea" d="M4 92 C12 86 20 96 28 90 C36 86 44 96 52 90 C60 86 68 96 76 90 C84 86 92 96 98 90" />
        <line class="snap-n snap-heavy" x1="52" y1="8" x2="52" y2="66" />
        <polygon class="snap-c" points="54,12 54,62 86,62" />
        <polygon class="snap-c" points="50,18 50,62 22,62" />
        <polygon class="snap-r" points="52,6 52,16 66,11" />
        <path class="snap-p" d="M8 66 H92 L80 84 H22 Z" />
        <circle class="snap-c" cx="34" cy="74" r="3" />
        <circle class="snap-c" cx="50" cy="74" r="3" />
        <circle class="snap-c" cx="66" cy="74" r="3" />
      {:else if pic === 'sheep'}
        <!-- A woolly sheep with a black face and legs. -->
        <rect class="snap-k" x="28" y="66" width="6" height="22" rx="2" />
        <rect class="snap-k" x="62" y="66" width="6" height="22" rx="2" />
        <path class="snap-w" d="M22 50 C14 46 16 32 28 34 C30 24 44 22 50 30 C56 22 72 24 72 34 C84 32 88 46 80 50 C88 56 84 70 72 68 C68 78 52 78 48 70 C42 78 26 76 26 68 C14 70 12 56 22 50 Z" />
        <ellipse class="snap-k" cx="84" cy="44" rx="10" ry="13" transform="rotate(-18 84 44)" />
        <ellipse class="snap-k" cx="74" cy="34" rx="6" ry="3" transform="rotate(-30 74 34)" />
        <circle class="snap-c snap-eye" cx="86" cy="40" r="2" />
        <path class="snap-w" d="M76 30 C76 24 86 24 88 30 C84 34 80 34 76 30 Z" />
      {/if}
    </g>
  </svg>
</span>

<style>
  .snap-pic {
    --snap-paper: #f6eedb;
    --snap-ink: #1b1a17;
    --snap-cream: #fffaf0;
    --snap-red: #c8302a;
    --snap-green: #2e7a3c;
    --snap-orange: var(--accent, #e8622c);
    --snap-petrol: var(--accent-ink, #1f5c66);
    --snap-biscuit: #ecc677;
    --snap-crust: #b8732f;
    --snap-stone: #cdb88c;
    --snap-butter: #f6dc6a;
    display: inline-block;
    flex: none;
    line-height: 0;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .snap-paper {
    fill: var(--snap-paper);
  }
  .snap-art {
    stroke: var(--snap-ink);
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .snap-k,
  .snap-dot {
    fill: var(--snap-ink);
  }
  .snap-dot {
    stroke: none;
  }
  .snap-c {
    fill: var(--snap-cream);
  }
  .snap-w {
    fill: var(--snap-cream);
  }
  .snap-r {
    fill: var(--snap-red);
  }
  .snap-g {
    fill: var(--snap-green);
  }
  .snap-o {
    fill: var(--snap-orange);
  }
  .snap-p {
    fill: var(--snap-petrol);
  }
  .snap-b {
    fill: var(--snap-biscuit);
  }
  .snap-t {
    fill: var(--snap-crust);
  }
  .snap-s {
    fill: var(--snap-stone);
  }
  .snap-butter {
    fill: var(--snap-butter);
  }
  .snap-cream {
    fill: var(--snap-cream);
  }
  .snap-n {
    fill: none;
  }
  .snap-thin {
    stroke-width: 2;
  }
  .snap-heavy {
    stroke-width: 6;
  }
  .snap-frame {
    stroke: var(--snap-red);
    stroke-width: 5;
  }
  .snap-rod {
    stroke-width: 4;
  }
  .snap-wave {
    stroke: var(--snap-cream);
  }
  .snap-sea {
    stroke: var(--snap-petrol);
    stroke-width: 3;
  }
  .snap-eye {
    stroke: none;
  }
</style>
