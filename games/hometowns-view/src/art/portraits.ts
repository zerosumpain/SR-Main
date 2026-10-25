// Procedural portraits (WP8 art, spec §9.7 and §9.15): the four advisors,
// British wildlife in hi-vis vests, each with four expressions, plus the
// mayor avatars and the flag pennants of the Founding sheet. Everything is
// drawn here from circles, paths and our own palette, so there is no asset
// to license (ATTRIBUTION.md) and nothing to download: each call returns a
// small self-contained SVG string, the same on every run.
//
// The page can show these inline (advisor cards in harness mode) or load
// them as Pixi textures; `scripts/hometowns/export-art.ts` writes them as
// files for the app's asset catalogue. The look follows "toy-town Britain":
// chunky rounded shapes, warm pastels and a thin warm outline.
//
// Ids match the copy file (engine/copy.ts): advisors `advisorName.<id>`,
// expressions EXPRESSIONS, avatars AVATARS, flags `flag.<n>`.

export const ADVISOR_IDS = ['bramble', 'penny', 'mo', 'zia'] as const;
export type AdvisorId = (typeof ADVISOR_IDS)[number];

export const EXPRESSION_IDS = ['happy', 'thinking', 'proud', 'concerned'] as const;
export type Expression = (typeof EXPRESSION_IDS)[number];

export const AVATAR_IDS = ['fox', 'owl', 'rabbit', 'squirrel', 'duck', 'mole', 'deer', 'robin', 'frog', 'puffin', 'mouse', 'heron'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/** Flag colours by FoundBody.flag, named in the copy file (poppy red … chalk white). */
export const FLAG_COLOURS: readonly string[] = ['#e05a4f', '#f4c542', '#6fbf73', '#4f9fd6', '#9d7cc9', '#ee8a3c', '#f2a7c3', '#f5f1e8'];

const INK = '#5a4636';
const VEST = '#d8f04a';
const VEST_TRIM = '#f08a24';
const STRIPE = '#eef3f5';

const svg = (body: string, bg: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">` +
  `<circle cx="64" cy="64" r="62" fill="${bg}"/>` +
  `<g stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

/** The hi-vis vest every advisor and mayor wears: shoulders, a V neck and two reflective bands. */
function vest(fur: string): string {
  return (
    `<path d="M22 128 C24 100 40 92 64 92 C88 92 104 100 106 128 Z" fill="${fur}"/>` +
    `<path d="M30 128 C32 106 42 98 52 96 L64 112 L76 96 C86 98 96 106 98 128 Z" fill="${VEST}"/>` +
    `<path d="M33 114 L95 114" stroke="${STRIPE}" stroke-width="5"/>` +
    `<path d="M31 122 L97 122" stroke="${STRIPE}" stroke-width="5"/>` +
    `<path d="M52 96 L64 112 L76 96" fill="none" stroke="${VEST_TRIM}" stroke-width="3"/>`
  );
}

interface Face {
  /** Eye centres. */
  ex: [number, number];
  ey: number;
  /** Mouth centre (or beak tip for birds). */
  mx: number;
  my: number;
  beak?: string;
  eyeRing?: string;
}

/** Eyes, brows and mouth for an expression; birds express with eyes, brows and an open or closed beak. */
function expression(f: Face, e: Expression): string {
  const [l, r] = f.ex;
  const y = f.ey;
  const ring = f.eyeRing ? `<circle cx="${l}" cy="${y}" r="7" fill="${f.eyeRing}"/><circle cx="${r}" cy="${y}" r="7" fill="${f.eyeRing}"/>` : '';
  let eyes: string;
  let brows = '';
  let mouth = '';
  switch (e) {
    case 'happy':
      eyes = dot(l, y) + dot(r, y);
      mouth = f.beak ? beakOpen(f, 4) : `<path d="M${f.mx - 9} ${f.my} Q${f.mx} ${f.my + 9} ${f.mx + 9} ${f.my}" fill="none"/>`;
      break;
    case 'thinking':
      // Eyes glance up and to the side; one brow lifts.
      eyes = dot(l + 2, y - 2) + dot(r + 2, y - 2);
      brows = `<path d="M${l - 5} ${y - 10} L${l + 5} ${y - 11}" fill="none"/><path d="M${r - 5} ${y - 13} Q${r} ${y - 16} ${r + 5} ${y - 13}" fill="none"/>`;
      mouth = f.beak ? beakClosed(f) : `<path d="M${f.mx - 6} ${f.my + 2} L${f.mx + 6} ${f.my}" fill="none"/>`;
      break;
    case 'proud':
      // Smiling eyes (^ ^), a wide grin and a sparkle.
      eyes = `<path d="M${l - 5} ${y + 1} Q${l} ${y - 6} ${l + 5} ${y + 1}" fill="none"/><path d="M${r - 5} ${y + 1} Q${r} ${y - 6} ${r + 5} ${y + 1}" fill="none"/>`;
      mouth = f.beak ? beakOpen(f, 6) : `<path d="M${f.mx - 11} ${f.my - 1} Q${f.mx} ${f.my + 12} ${f.mx + 11} ${f.my - 1} Z" fill="#fff"/>`;
      mouth += `<path d="M104 26 L107 33 L114 36 L107 39 L104 46 L101 39 L94 36 L101 33 Z" fill="#fff4b0" stroke-width="1.5"/>`;
      break;
    case 'concerned':
      // Gentle, never frightened (§9.7): tilted brows and a small wavy mouth.
      eyes = dot(l, y + 1) + dot(r, y + 1);
      brows = `<path d="M${l - 6} ${y - 9} L${l + 4} ${y - 12}" fill="none"/><path d="M${r - 4} ${y - 12} L${r + 6} ${y - 9}" fill="none"/>`;
      mouth = f.beak ? beakClosed(f) : `<path d="M${f.mx - 7} ${f.my + 3} Q${f.mx - 3} ${f.my} ${f.mx} ${f.my + 3} Q${f.mx + 3} ${f.my + 6} ${f.mx + 7} ${f.my + 3}" fill="none"/>`;
      break;
  }
  return ring + eyes + brows + mouth;
}

const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${INK}" stroke="none"/><circle cx="${x + 1.2}" cy="${y - 1.2}" r="1.1" fill="#fff" stroke="none"/>`;

function beakClosed(f: Face): string {
  return `<path d="M${f.mx - 7} ${f.my - 4} L${f.mx + 7} ${f.my - 4} L${f.mx} ${f.my + 8} Z" fill="${f.beak}"/>`;
}

function beakOpen(f: Face, gap: number): string {
  return (
    `<path d="M${f.mx - 7} ${f.my - 5} L${f.mx + 7} ${f.my - 5} L${f.mx} ${f.my + 4} Z" fill="${f.beak}"/>` +
    `<path d="M${f.mx - 5} ${f.my + gap - 2} L${f.mx + 5} ${f.my + gap - 2} L${f.mx} ${f.my + gap + 6} Z" fill="${f.beak}"/>`
  );
}

// ---- The advisors -------------------------------------------------------------------------------

/** Bramble the badger, Deputy Mayor: grey, with the white face and two dark stripes. */
function bramble(e: Expression): string {
  const head =
    `<circle cx="38" cy="38" r="9" fill="#8d8a86"/><circle cx="90" cy="38" r="9" fill="#8d8a86"/>` +
    `<ellipse cx="64" cy="62" rx="34" ry="32" fill="#a9a5a0"/>` +
    `<path d="M64 30 C56 30 54 44 54 60 C54 76 58 88 64 90 C70 88 74 76 74 60 C74 44 72 30 64 30 Z" fill="#f7f4ee" stroke="none"/>` +
    `<path d="M50 34 C44 46 44 60 50 74" stroke="#3b3632" stroke-width="10" fill="none"/>` +
    `<path d="M78 34 C84 46 84 60 78 74" stroke="#3b3632" stroke-width="10" fill="none"/>` +
    `<ellipse cx="64" cy="76" rx="6" ry="4.5" fill="#3b3632"/>`;
  const face = expression({ ex: [51, 77], ey: 58, mx: 64, my: 84, eyeRing: '#f7f4ee' }, e);
  return svg(vest('#8d8a86') + head + face, '#f3e3c3');
}

/** Penny the magpie: glossy black and white with a blue-green sheen. */
function penny(e: Expression): string {
  const head =
    `<path d="M38 40 C30 20 50 22 54 34" fill="#2f3438"/>` +
    `<ellipse cx="64" cy="60" rx="32" ry="31" fill="#2f3438"/>` +
    `<path d="M42 70 C46 88 82 88 86 70 C80 80 48 80 42 70 Z" fill="#f7f4ee"/>` +
    `<path d="M88 46 C98 52 98 66 92 72" stroke="#3f8f9c" stroke-width="5" fill="none"/>`;
  const face = expression({ ex: [52, 76], ey: 54, mx: 64, my: 70, beak: '#4a4f55', eyeRing: '#f7f4ee' }, e);
  return svg(vest('#2f3438') + head + face, '#d9ecef');
}

/** Mo the hedgehog: a spiky brown crown and a soft tan face. */
function mo(e: Expression): string {
  const spikes: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (1.05 + (0.9 * i) / 12);
    const b = Math.PI * (1.05 + (0.9 * (i + 0.5)) / 12);
    spikes.push(`${r1(64 + 44 * Math.cos(a))} ${r1(66 + 44 * Math.sin(a))}`, `${r1(64 + 33 * Math.cos(b))} ${r1(66 + 33 * Math.sin(b))}`);
  }
  const head =
    `<path d="M20 70 L${spikes.join(' L')} L108 70 C104 96 24 96 20 70 Z" fill="#8a5a3c"/>` +
    `<ellipse cx="64" cy="70" rx="27" ry="23" fill="#e9cfa8"/>` +
    `<circle cx="64" cy="80" r="5" fill="#3b2a20"/>`;
  const face = expression({ ex: [53, 75], ey: 64, mx: 64, my: 87 }, e);
  return svg(vest('#8a5a3c') + head + face, '#e6efd2');
}

/** Zia the otter: sleek brown, a pale muzzle and whiskers. */
function zia(e: Expression): string {
  const head =
    `<circle cx="40" cy="42" r="7" fill="#7b5236"/><circle cx="88" cy="42" r="7" fill="#7b5236"/>` +
    `<ellipse cx="64" cy="62" rx="32" ry="30" fill="#9a6a45"/>` +
    `<ellipse cx="64" cy="76" rx="20" ry="13" fill="#ead6bc"/>` +
    `<ellipse cx="64" cy="70" rx="6" ry="4" fill="#3b2a20"/>` +
    `<path d="M44 74 L30 70 M44 78 L30 80 M84 74 L98 70 M84 78 L98 80" stroke-width="1.5" fill="none"/>`;
  const face = expression({ ex: [51, 77], ey: 56, mx: 64, my: 80 }, e);
  return svg(vest('#9a6a45') + head + face, '#d6e8f5');
}

const r1 = (x: number) => Math.round(x * 10) / 10;

const ADVISOR_DRAW: Record<AdvisorId, (e: Expression) => string> = { bramble, penny, mo, zia };

/** One advisor's portrait as an SVG string (128 × 128). */
export function advisorPortrait(id: AdvisorId, e: Expression = 'happy'): string {
  return ADVISOR_DRAW[id](e);
}

// ---- Mayor avatars (§1.5: an animal mayor in a hi-vis vest) ---------------------------------------

interface AvatarSpec {
  fur: string;
  face: string;
  ears: 'point' | 'round' | 'long' | 'tuft' | 'none' | 'side';
  beak?: string;
  eyeRing?: string;
  nose?: string;
  bg: string;
}

const AVATAR_SPECS: Record<AvatarId, AvatarSpec> = {
  fox: { fur: '#e07b39', face: '#fbf3e6', ears: 'point', nose: '#3b2a20', bg: '#f6e0c4' },
  owl: { fur: '#9c7a55', face: '#e9d7b9', ears: 'tuft', beak: '#e0a23a', eyeRing: '#f6efe0', bg: '#e4dccb' },
  rabbit: { fur: '#b8a38c', face: '#f2e8dc', ears: 'long', nose: '#e58f9e', bg: '#e9e3f2' },
  squirrel: { fur: '#c8602e', face: '#f4dcc0', ears: 'tuft', nose: '#3b2a20', bg: '#f3e2cf' },
  duck: { fur: '#3f8f5a', face: '#3f8f5a', ears: 'none', beak: '#f2b234', bg: '#d9eef0' },
  mole: { fur: '#4b4a52', face: '#5d5c66', ears: 'none', nose: '#f0a3b0', bg: '#e8e1d6' },
  deer: { fur: '#b5835a', face: '#e6cba8', ears: 'side', nose: '#3b2a20', bg: '#e5ecd5' },
  robin: { fur: '#8b6a4c', face: '#e7653f', ears: 'none', beak: '#4a4f55', bg: '#f2e6d8' },
  frog: { fur: '#7cb35a', face: '#c9e3a4', ears: 'none', nose: '#4f7d38', bg: '#e1f0dc' },
  puffin: { fur: '#2f3438', face: '#f7f4ee', ears: 'none', beak: '#ee7a2f', bg: '#dbe9f3' },
  mouse: { fur: '#c9a67e', face: '#f1e2cc', ears: 'round', nose: '#e58f9e', bg: '#f1e9da' },
  heron: { fur: '#a3aab0', face: '#eef0f1', ears: 'none', beak: '#e3b13c', bg: '#dde9ee' },
};

function ears(s: AvatarSpec): string {
  switch (s.ears) {
    case 'point':
      return `<path d="M36 50 L40 18 L58 36 Z" fill="${s.fur}"/><path d="M92 50 L88 18 L70 36 Z" fill="${s.fur}"/>`;
    case 'round':
      return `<circle cx="38" cy="36" r="15" fill="${s.fur}"/><circle cx="90" cy="36" r="15" fill="${s.fur}"/><circle cx="38" cy="36" r="8" fill="#f2c2b8"/><circle cx="90" cy="36" r="8" fill="#f2c2b8"/>`;
    case 'long':
      return `<ellipse cx="50" cy="20" rx="8" ry="22" fill="${s.fur}"/><ellipse cx="78" cy="20" rx="8" ry="22" fill="${s.fur}"/>`;
    case 'tuft':
      return `<path d="M38 46 L36 20 L56 36 Z" fill="${s.fur}"/><path d="M90 46 L92 20 L72 36 Z" fill="${s.fur}"/>`;
    case 'side':
      return `<ellipse cx="28" cy="48" rx="14" ry="7" fill="${s.fur}"/><ellipse cx="100" cy="48" rx="14" ry="7" fill="${s.fur}"/>`;
    default:
      return '';
  }
}

/** A mayor's avatar as an SVG string; the vest's trim takes the town's flag colour. */
export function mayorAvatar(id: AvatarId, flag = 0): string {
  const s = AVATAR_SPECS[id];
  const head =
    ears(s) +
    `<ellipse cx="64" cy="62" rx="33" ry="31" fill="${s.fur}"/>` +
    (s.face !== s.fur ? `<ellipse cx="64" cy="72" rx="22" ry="17" fill="${s.face}"/>` : '') +
    (s.nose ? `<ellipse cx="64" cy="70" rx="5" ry="3.5" fill="${s.nose}"/>` : '');
  const face = expression({ ex: [51, 77], ey: 56, mx: 64, my: s.beak ? 70 : 80, beak: s.beak, eyeRing: s.eyeRing }, 'happy');
  const trim = FLAG_COLOURS[((flag % FLAG_COLOURS.length) + FLAG_COLOURS.length) % FLAG_COLOURS.length];
  return svg(vest(s.fur).replace(`stroke="${VEST_TRIM}"`, `stroke="${trim}"`) + head + face, s.bg);
}

// ---- Flags -----------------------------------------------------------------------------------------

/** A town's pennant on a pole, in its flag colour (64 × 64). */
export function flagPennant(flag: number): string {
  const c = FLAG_COLOURS[((flag % FLAG_COLOURS.length) + FLAG_COLOURS.length) % FLAG_COLOURS.length];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<g stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="M16 6 L16 60" fill="none"/>` +
    `<path d="M16 8 C30 4 40 14 54 10 L46 22 L54 34 C40 38 30 28 16 32 Z" fill="${c}"/>` +
    `<circle cx="16" cy="6" r="3" fill="#f4c542"/>` +
    `</g></svg>`
  );
}

/** Every piece of art this module draws, by file name (the export script and the tests walk it). */
export function allArt(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ADVISOR_IDS) for (const e of EXPRESSION_IDS) out[`advisor-${a}-${e}.svg`] = advisorPortrait(a, e);
  for (const v of AVATAR_IDS) out[`avatar-${v}.svg`] = mayorAvatar(v, 0);
  for (let f = 0; f < FLAG_COLOURS.length; f++) out[`flag-${f}.svg`] = flagPennant(f);
  return out;
}
