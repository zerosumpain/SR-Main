// "RTX 5060 or better" needs an order, and the order is a judgement — so it is
// written down here, in code, where it can be read and argued with, rather than
// asked of a model per listing.
//
// Scores are APPROXIMATE relative desktop raster performance at 1080p–1440p
// (RTX 4090 = 100), rounded from the usual review aggregates as of late 2026.
// They only need to put cards in the right order around a threshold; two cards
// a point apart should be read as equals. Memory variants (5060 Ti 8GB/16GB,
// 9060 XT 8GB/16GB) share a score: the rank question is "this class or
// better", and VRAM is a separate thing to ask for if it matters.
//
// Laptop parts share desktop names and are much slower. A listing that says
// "laptop" is not ranked at all — see `parseGpu`.

const SCORES: Record<string, number> = {
  // NVIDIA 30
  'RTX 3050': 20, 'RTX 3060': 30, 'RTX 3060 TI': 38, 'RTX 3070': 44, 'RTX 3070 TI': 47,
  'RTX 3080': 55, 'RTX 3080 TI': 60, 'RTX 3090': 62, 'RTX 3090 TI': 66,
  // NVIDIA 40
  'RTX 4060': 36, 'RTX 4060 TI': 42, 'RTX 4070': 55, 'RTX 4070 SUPER': 62, 'RTX 4070 TI': 66,
  'RTX 4070 TI SUPER': 71, 'RTX 4080': 80, 'RTX 4080 SUPER': 82, 'RTX 4090': 100,
  // NVIDIA 50
  'RTX 5050': 32, 'RTX 5060': 43, 'RTX 5060 TI': 50, 'RTX 5070': 63, 'RTX 5070 TI': 77,
  'RTX 5080': 87, 'RTX 5090': 125,
  // AMD 6000
  'RX 6600': 30, 'RX 6600 XT': 34, 'RX 6650 XT': 36, 'RX 6700 XT': 43, 'RX 6750 XT': 46,
  'RX 6800': 53, 'RX 6800 XT': 60, 'RX 6900 XT': 64, 'RX 6950 XT': 67,
  // AMD 7000
  'RX 7600': 35, 'RX 7600 XT': 37, 'RX 7700 XT': 49, 'RX 7800 XT': 58, 'RX 7900 GRE': 64,
  'RX 7900 XT': 73, 'RX 7900 XTX': 82,
  // AMD 9000
  'RX 9060 XT': 48, 'RX 9070': 68, 'RX 9070 XT': 76,
  // Intel Arc
  'ARC A750': 30, 'ARC A770': 33, 'ARC B570': 34, 'ARC B580': 39,
};

const NVIDIA = /\b(?:geforce\s*)?rtx\s*(\d{4})\s*(ti\s*super|ti|super)?(?![a-z0-9])/i;
const AMD = /\b(?:radeon\s*)?rx\s*(\d{4})\s*(xtx|xt|gre)?(?![a-z0-9])/i;
const ARC = /\barc\s*([ab]\d{3})(?![a-z0-9])/i;

/** Canonical name for a GPU mention, e.g. "GeForce RTX 5060Ti" → "RTX 5060 TI". Null when none is named. */
export function canonicalGpu(text: string): string | null {
  const n = NVIDIA.exec(text);
  if (n) return `RTX ${n[1]}${n[2] ? ' ' + n[2].toUpperCase().replace(/\s+/g, ' ') : ''}`;
  const a = AMD.exec(text);
  if (a) return `RX ${a[1]}${a[2] ? ' ' + a[2].toUpperCase() : ''}`;
  const i = ARC.exec(text);
  if (i) return `ARC ${i[1].toUpperCase()}`;
  return null;
}

export function gpuScore(name: string): number | null {
  return SCORES[name.toUpperCase().replace(/\s+/g, ' ').trim()] ?? null;
}

export interface GpuReading {
  name: string;
  score: number | null;
  laptop: boolean;
}

/**
 * The GPU a listing names. The TITLE wins over the description: a description
 * that says "a big step up from the RTX 3060" must not rank the machine as a
 * 3060. Returns null when neither names one.
 */
export function parseGpu(title: string, description = ''): GpuReading | null {
  const name = canonicalGpu(title) ?? canonicalGpu(description);
  if (!name) return null;
  const laptop = /\blaptop\b|\bnotebook\b/i.test(title);
  return { name, score: laptop ? null : gpuScore(name), laptop };
}

export function knownGpus(): string[] {
  return Object.keys(SCORES);
}
