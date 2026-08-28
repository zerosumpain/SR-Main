// what3words-style names for discovered segments.
//
// A segment has no name of its own — it is a stretch of ground nobody labelled.
// A word triple gives it a handle you can say out loud and remember, which
// "segment #47" never will. The register is deliberately outdoors: a name half
// suggests the kind of ground before you have opened it.
//
// The triple is DERIVED from geometry, so the same stretch proposes the same
// name from a cold start. It is not, however, re-derived on every rebuild:
// segments-service reconciles recomputed geometry against stored rows and
// hands the survivor its predecessor's name, because a name that changed
// because a rebuild shifted the start by 30 m would be worse than useless.

import { formatDistance } from '../format';

/** Creatures and plants — the thing that lives there. */
const LIVING = [
  'heron','kestrel','bramble','rowan','lapwing','curlew','otter','badger','hazel','alder',
  'willow','hawthorn','blackthorn','teasel','foxglove','bracken','gorse','heather','thistle','nettle',
  'campion','cowslip','sorrel','yarrow','comfrey','elder','hornbeam','sycamore','beech','birch',
  'larch','juniper','holly','ivy','mistletoe','primrose','bluebell','snowdrop','celandine','meadowsweet',
  'ragwort','clover','vetch','plantain','dogrose','honeysuckle','columbine','harebell','knapweed','mallow',
  'buzzard','merlin','harrier','hobby','osprey','raven','rook','jackdaw','magpie','wren',
  'robin','dunnock','warbler','chiffchaff','blackcap','redstart','wheatear','stonechat','whinchat','skylark',
  'pipit','wagtail','dipper','kingfisher','moorhen','coot','mallard','teal','widgeon','shelduck',
  'oystercatcher','redshank','dunlin','snipe','woodcock','pheasant','partridge','grouse','stoat','weasel',
  'marten','polecat','hare','rabbit','vole','shrew','hedgehog','fox','roe','fallow',
  'muntjac','adder','newt','toad','minnow','chub','dace','grayling','trout','salmon',
  'mayfly','damsel','dragonfly','ringlet','gatekeeper','brimstone','orangetip','peacock','admiral','fritillary',
  'skipper','lacewing','hoverfly','bumblebee','cricket','beetle','swift','swallow',
] as const;

/** Materials and colours — what it is made of, or the colour of it. */
const MATTER = [
  'copper','iron','amber','slate','rust','brass','pewter','flint','chalk','granite',
  'sandstone','limestone','marble','quartz','agate','jasper','onyx','jet','coal','cinder',
  'ember','umber','ochre','sienna','saffron','indigo','cobalt','verdigris','patina','bronze',
  'silver','gilt','tin','zinc','nickel','steel','wrought','russet','scarlet','crimson',
  'vermilion','carmine','madder','coral','apricot','tawny','chestnut','auburn','ginger','honey',
  'straw','flaxen','ivory','cream','bone','pearl','oyster','dove','pewter-grey','charcoal',
  'soot','peat','loam','clay','marl','shingle','pebble','cobble','sand','silt',
  'moss','lichen','fern','sedge','rush','reed','bark','sap','resin','tallow',
  'linen','canvas','hessian','felt','tweed','worsted','velvet','satin','lace','ribbon',
  'lantern','candle','tinder','kindling','birchbark','driftwood','bleached','weathered','frosted','dew',
  'mist','haar','rime','hoar','sleet','thaw','spate','brack','saline','brine',
  'seaglass','flintstone','ironstone','greensand','gritstone','millstone','whinstone','basalt','shale-grey','copperas',
  'verditer','smalt','azure','viridian','celadon','chert','tufa','travertine',
] as const;

/** Path and terrain features — the shape of the ground under you. */
const GROUND = [
  'stile','ford','holloway','causeway','hollow','brow','spur','ridge','scar','crag',
  'tor','fell','moor','heath','common','green','lane','byway','bridleway','towpath',
  'footbridge','packhorse','drove','ginnel','snicket','twitten','wynd','close','croft','garth',
  'paddock','meadow','ley','furlong','headland','verge','hedgerow','coppice','spinney','copse',
  'holt','grove','thicket','brake','glade','ride','avenue','culvert','sluice','weir',
  'lock','staithe','wharf','quay','jetty','slipway','strand','foreshore','saltmarsh','fen',
  'carr','mire','bog','slack','dell','dene','cleugh','gill','beck','brook',
  'burn','rill','spring','well','trough','pond','mere','tarn','pool','reach',
  'bend','meander','oxbow','bank','levee','dyke','ditch','drain','cutting','embankment',
  'viaduct','arch','gateway','stepping','boardwalk','duckboard','corduroy','pavement','cobbles','setts',
  'gravelpit','scree','boulder','outcrop','ledge','shelf','terrace','bench','saddle','col',
  'pass','notch','gap','cleft','chine','combe','coombe','corrie','hanger','chase',
  'warren','mound','barrow','cairn','waymark','summit','shoulder','zigzag',
] as const;

export const WORDLISTS = { LIVING, MATTER, GROUND };

/** FNV-1a, 32-bit. Small, dependency-free, and well enough spread for this. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type SegmentGeometry = Array<[number, number, number | null, number]>;

/**
 * A stable seed for a stretch of ground.
 *
 * Start, middle and end at 4 decimal places — about 11 m, comfortably inside
 * the 20 m match tolerance, so two rebuilds of the same stretch usually agree
 * without needing reconciliation to rescue the name.
 */
export function segmentSeed(coordinates: SegmentGeometry): string {
  if (!coordinates.length) return 'empty';
  const at = (i: number) => `${coordinates[i][0].toFixed(4)},${coordinates[i][1].toFixed(4)}`;
  const mid = Math.floor(coordinates.length / 2);
  return `${at(0)}|${at(mid)}|${at(coordinates.length - 1)}`;
}

/**
 * Turn a seed into `living.matter.ground`, avoiding anything already taken.
 *
 * With 128 × 128 × 128 combinations a collision is unlikely but not impossible,
 * and a duplicate name would make two different places indistinguishable — so
 * the salt loop is not decoration.
 */
export function segmentName(seed: string, taken: ReadonlySet<string> = new Set()): string {
  for (let salt = 0; salt < 64; salt++) {
    const hash = fnv1a(salt === 0 ? seed : `${seed}#${salt}`);
    const name = [
      LIVING[hash % LIVING.length],
      MATTER[Math.floor(hash / LIVING.length) % MATTER.length],
      GROUND[Math.floor(hash / (LIVING.length * MATTER.length)) % GROUND.length],
    ].join('.');
    if (!taken.has(name)) return name;
  }
  // 64 collisions in a row means the wordlists are exhausted, not unlucky.
  return `${LIVING[fnv1a(seed) % LIVING.length]}.${Date.now().toString(36)}`;
}

export interface DescriptorInput {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  effortCount: number;
}

export interface DescriptorOptions {
  /** Drop the effort count. Set where a column already carries it — saying
   *  "63 efforts" beside a column headed 63 EFFORTS is noise, not emphasis. */
  includeEfforts?: boolean;
}

/** Net climb below this reads as level ground, not as a hill worth naming. */
const NET_CLIMB_M = 20;
/** Rolling: it comes back to where it started, but not gently. */
const ROLLING_GAIN_M = 40;

export type SegmentTerrain = 'climb' | 'descent' | 'rolling' | 'flat';

/**
 * One classification for both the descriptor prose and the explorer's terrain
 * filter — kept together so a chip can never disagree with the sentence
 * beside it.
 */
export function segmentTerrain(input: {
  elevationGainM: number;
  elevationLossM: number;
}): SegmentTerrain {
  const net = input.elevationGainM - input.elevationLossM;
  if (net >= NET_CLIMB_M) return 'climb';
  if (net <= -NET_CLIMB_M) return 'descent';
  if (input.elevationGainM >= ROLLING_GAIN_M) return 'rolling';
  return 'flat';
}

/**
 * The line that rides alongside the name: `1.2 km · +48 m climb · 9 efforts`.
 *
 * Derived at render time from stored columns rather than baked into the row,
 * so an added effort updates the descriptor without a rebuild.
 */
export function segmentDescriptor(
  input: DescriptorInput,
  options: DescriptorOptions = {},
): string {
  const net = input.elevationGainM - input.elevationLossM;
  const kind = segmentTerrain(input);
  const terrain =
    kind === 'climb'
      ? `+${Math.round(net)} m climb`
      : kind === 'descent'
        ? `−${Math.round(-net)} m descent`
        : kind;

  const parts = [formatDistance(input.distanceM), terrain];
  if (options.includeEfforts !== false) {
    parts.push(`${input.effortCount} effort${input.effortCount === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
