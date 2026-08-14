/**
 * A picture of the research graph, for documents.
 *
 * The Word export could describe a session's entities in prose but never showed
 * their shape, which is the one thing a graph is for. `docx` can embed an SVG,
 * so the diagram is laid out here rather than rasterised — no headless browser,
 * no native image dependency.
 *
 * SVG in a .docx requires a raster fallback for viewers that predate SVG
 * support (Word 2016 and older, most third-party readers). `fallbackPng` emits
 * a tiny valid PNG for that slot, and the export writes a text rendering of the
 * same structure directly beneath the image — so a reader whose viewer shows
 * only the fallback still gets the content, rather than a grey box.
 */
import { deflateSync } from 'node:zlib';

export interface GraphImageNode {
  id: string;
  name: string;
  degree: number;
  weight: number;
}
export interface GraphImageEdge {
  source: string;
  target: string;
}

const WIDTH = 900;
const HEIGHT = 560;
const BG = '#ede4d4';
const INK = '#1a1008';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deterministic radial layout, ordered by connectedness.
 *
 * A force simulation would need d3 and several hundred ticks on the server for
 * a picture nobody can drag. Ranking by degree and placing the best-connected
 * entity at the centre says the same thing a settled force layout would, and
 * renders identically every time — which matters when the output is a document
 * someone may regenerate and diff.
 */
export function layoutGraph(
  nodes: GraphImageNode[],
  max = 28,
): Map<string, { x: number; y: number; r: number; node: GraphImageNode }> {
  const ranked = [...nodes].sort((a, b) => b.degree - a.degree || b.weight - a.weight).slice(0, max);
  const placed = new Map<string, { x: number; y: number; r: number; node: GraphImageNode }>();
  if (ranked.length === 0) return placed;

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radiusOf = (n: GraphImageNode) => 6 + Math.sqrt(Math.max(1, n.degree)) * 3.2;

  placed.set(ranked[0].id, { x: cx, y: cy, r: radiusOf(ranked[0]), node: ranked[0] });

  const rest = ranked.slice(1);
  // Two rings so labels have room; the inner ring takes the better-connected.
  const inner = rest.slice(0, Math.min(10, rest.length));
  const outer = rest.slice(inner.length);

  const ring = (list: GraphImageNode[], rr: number, offset: number) => {
    list.forEach((n, i) => {
      const a = offset + (i / Math.max(1, list.length)) * Math.PI * 2;
      placed.set(n.id, {
        x: cx + Math.cos(a) * rr,
        y: cy + Math.sin(a) * rr * 0.78,
        r: radiusOf(n),
        node: n,
      });
    });
  };
  ring(inner, 140, -Math.PI / 2);
  ring(outer, 240, -Math.PI / 2 + 0.28);

  return placed;
}

/** Sequential fill on centrality — the same single-hue ramp the web view uses. */
function fill(weight: number): string {
  const a = 0.22 + Math.max(0, Math.min(1, weight)) * 0.68;
  return `rgba(196, 87, 10, ${a.toFixed(3)})`;
}

export function renderGraphSvg(nodes: GraphImageNode[], edges: GraphImageEdge[]): string {
  const placed = layoutGraph(nodes);
  if (placed.size === 0) return '';

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  );
  lines.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>`);

  for (const e of edges) {
    const a = placed.get(e.source);
    const b = placed.get(e.target);
    if (!a || !b) continue;
    lines.push(
      `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(26,16,8,0.22)" stroke-width="1.2"/>`,
    );
  }

  for (const p of placed.values()) {
    // Solid stroke, not just fill: the pale end of the ramp sits near 1.2:1
    // against this background and would otherwise be invisible.
    lines.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${fill(p.node.weight)}" stroke="${INK}" stroke-width="1.1"/>`,
    );
    const name = p.node.name.length > 24 ? p.node.name.slice(0, 23) + '…' : p.node.name;
    lines.push(
      `<text x="${(p.x + p.r + 4).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" font-family="monospace" font-size="12" fill="${INK}" paint-order="stroke" stroke="${BG}" stroke-width="3">${esc(name)}</text>`,
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/** A flat, readable rendering of the same graph, for viewers that cannot show the SVG. */
export function describeGraph(nodes: GraphImageNode[], edges: GraphImageEdge[]): string[] {
  const placed = layoutGraph(nodes);
  const nameById = new Map([...placed.values()].map((p) => [p.node.id, p.node.name]));
  const out: string[] = [];
  for (const p of [...placed.values()].sort((a, b) => b.node.degree - a.node.degree)) {
    const links = edges
      .filter((e) => e.source === p.node.id || e.target === p.node.id)
      .map((e) => nameById.get(e.source === p.node.id ? e.target : e.source))
      .filter((n): n is string => !!n);
    const unique = [...new Set(links)].slice(0, 6);
    out.push(
      `${p.node.name} (${p.node.degree} link${p.node.degree === 1 ? '' : 's'})` +
        (unique.length ? ` — connected to ${unique.join(', ')}` : ''),
    );
  }
  return out;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A minimal solid-colour PNG, used only as the docx fallback slot.
 *
 * Hand-rolled because the alternative is a native image dependency for an image
 * almost nobody sees — modern Word renders the SVG. The text rendering that
 * follows the image in the document is what actually serves those readers.
 */
export function fallbackPng(width = 8, height = 8): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[o++] = 0xed;
      raw[o++] = 0xe4;
      raw[o++] = 0xd4;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
