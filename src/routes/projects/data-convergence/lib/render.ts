// Canvas-2D rendering for the convergence timeline.
//
// Pure-ish: given a model + a frame state (size, playhead, hover), it draws.
// The component file owns animation/state; this module owns pixels.

import type { ResolvedModel, ResolvedStrand, ID } from './types';
import {
  strandCentreY,
  strandAmplitude,
  spineThicknessAt,
  constituentsInside,
  usersToThickness,
  convergenceProgress,
  PX_PER_DAY_WAVE,
} from './strands';

export interface RenderState {
  width: number;
  height: number;
  dpr: number;
  playhead: number;          // ms epoch
  hoverId: ID | 'spine' | null;
  showWaveSamples: boolean;  // dev only
}

export interface CanvasMetrics {
  /** Centre line y in CSS px. */
  centreY: number;
  /** Left edge of the drawing area (CSS px). */
  leftX: number;
  /** Right edge of the drawing area (CSS px). */
  rightX: number;
  /** Scale applied to all layout-y values (birthOffset etc) so the layout
   *  fits the available vertical space without clipping. */
  yScale: number;
}

// ------- Theme palette (kept here so render is self-contained) -------
const PAPER = '#f1ead6';
const INK = '#1c1611';
const INK_SOFT = 'rgba(28, 22, 17, 0.42)';
const INK_FAINT = 'rgba(28, 22, 17, 0.18)';
const SPINE_FILL = 'rgba(28, 22, 17, 0.78)';

export function metricsFor(state: RenderState, model: ResolvedModel): CanvasMetrics {
  // Reserve room left & right for source labels / future room.
  const leftX = 96;
  const rightX = state.width - 32;
  const centreY = state.height / 2;
  // Half the available vertical space, minus a safety margin for amplitude /
  // thickness / time axis labels.
  const verticalRoom = state.height / 2 - 60;
  // Largest absolute birthOffset across all strands tells us the natural
  // extent of the layout.
  let maxOffset = 1;
  for (const s of model.strands) {
    const a = Math.abs(s.birthOffset);
    if (a > maxOffset) maxOffset = a;
  }
  // Add the maximum stroke half-thickness so the broadest strand still fits.
  let maxThickness = 0;
  for (const s of model.strands) {
    if (s.thickness > maxThickness) maxThickness = s.thickness;
  }
  const extent = maxOffset + maxThickness * 0.6 + 12;
  const yScale = Math.min(1, verticalRoom / extent);
  return { centreY, leftX, rightX, yScale };
}

/** Convert world time (ms) to canvas x (CSS px). */
export function timeToX(t: number, model: ResolvedModel, m: CanvasMetrics): number {
  const range = Math.max(1, model.tEnd - model.tStart);
  const p = (t - model.tStart) / range;
  return m.leftX + p * (m.rightX - m.leftX);
}

/** Inverse — for the scrubber. */
export function xToTime(x: number, model: ResolvedModel, m: CanvasMetrics): number {
  const p = (x - m.leftX) / Math.max(1, m.rightX - m.leftX);
  return model.tStart + p * (model.tEnd - model.tStart);
}

export function render(ctx: CanvasRenderingContext2D, model: ResolvedModel, state: RenderState) {
  const { width, height, dpr } = state;
  // Reset transform for the new frame.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Clear with the paper colour.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const m = metricsFor(state, model);

  drawTimeAxis(ctx, model, m, state);
  drawSpine(ctx, model, m, state);
  drawStrands(ctx, model, m, state);
  drawPlayhead(ctx, model, m, state);
}

// ------- Time axis -------

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  ctx.save();
  ctx.strokeStyle = INK_FAINT;
  ctx.lineWidth = 1;
  ctx.fillStyle = INK_SOFT;
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';

  const ticks = niceTicks(model.tStart, model.tEnd, 7);
  for (const t of ticks) {
    const x = timeToX(t, model, m);
    ctx.beginPath();
    ctx.setLineDash([1, 4]);
    ctx.moveTo(x, 24);
    ctx.lineTo(x, state.height - 56);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = formatYearMonth(t);
    const w = ctx.measureText(label).width;
    ctx.fillText(label, x - w / 2, state.height - 38);
  }
  ctx.restore();
}

function niceTicks(start: number, end: number, target: number): number[] {
  const range = end - start;
  if (range <= 0) return [];
  // Pick interval out of {1 month, 3 months, 6 months, 1 year, 2 years}.
  const candidates = [
    1000 * 60 * 60 * 24 * 30,
    1000 * 60 * 60 * 24 * 91,
    1000 * 60 * 60 * 24 * 182,
    1000 * 60 * 60 * 24 * 365,
    1000 * 60 * 60 * 24 * 365 * 2,
    1000 * 60 * 60 * 24 * 365 * 5,
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (range / c <= target * 1.2) { best = c; break; }
  }
  const ticks: number[] = [];
  // Snap first tick to start of a month.
  const d0 = new Date(start);
  d0.setUTCDate(1);
  d0.setUTCHours(0, 0, 0, 0);
  let t = d0.getTime();
  while (t < start) t += best;
  for (; t <= end; t += best) ticks.push(t);
  return ticks;
}

function formatYearMonth(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).toUpperCase();
}

// ------- The spine -------

function drawSpine(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  const t = state.playhead;
  // Build segments at strand merge events into the spine.
  // We draw the spine from tStart to tEnd; thickness steps up at each merge
  // event that's <= t. For x > playhead, draw an even thinner "outline" so
  // there's a visual cue for "where the spine will run".

  // Merge events directly into spine, sorted.
  const events = model.strands
    .filter((s) => s.mergeInto === 'spine')
    .map((s) => s.mergeMs)
    .sort((a, b) => a - b);
  const breakpoints = [model.tStart, ...events, model.tEnd];

  // Draw the future-spine guideline (faint hairline) under everything.
  ctx.save();
  ctx.strokeStyle = INK_FAINT;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(m.leftX, m.centreY);
  ctx.lineTo(m.rightX, m.centreY);
  ctx.stroke();
  ctx.restore();

  // Solid spine up to the playhead.
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const a = breakpoints[i];
    const b = breakpoints[i + 1];
    const visB = Math.min(b, t);
    if (visB <= a) continue;
    const thickness = spineThicknessAt(model, a + (visB - a) / 2);
    drawSpineSegment(ctx, model, m, a, visB, thickness);
  }

  // Draw constituent threads inside the spine for the live portion.
  drawConstituentBraid(ctx, model, m, state, 'spine');
}

function drawSpineSegment(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  a: number,
  b: number,
  thickness: number,
) {
  const x1 = timeToX(a, model, m);
  const x2 = timeToX(b, model, m);
  ctx.fillStyle = SPINE_FILL;
  ctx.fillRect(x1, m.centreY - thickness / 2, x2 - x1, thickness);
}

// ------- Strands -------

function drawStrands(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  // Draw in order: leaves first so their constituent threads get drawn after
  // (on top of) their parents — but actually we want parents underneath, so
  // sort by depth ascending. We approximate depth by ancestry length.
  const sorted = [...model.strands].sort((a, b) => a.ancestry.length - b.ancestry.length);
  for (const s of sorted) {
    drawStrand(ctx, model, m, state, s);
  }
}

function drawStrand(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
  strand: ResolvedStrand,
) {
  const t = state.playhead;
  if (t < strand.startMs) return;
  const endT = Math.min(t, strand.mergeMs);
  if (endT <= strand.startMs) return;

  // Determine whether this strand has children that have merged in by endT;
  // if so it's a "merged strand" carrying multiple constituent colours.
  const constituents = constituentsInside(strand.id, model, endT);
  // If this strand has zero children that have merged, it's a single-colour source.
  const selfAlone = constituents.length === 0;

  if (selfAlone) {
    drawLeafStrand(ctx, model, m, state, strand, endT);
  } else {
    // Hover highlight only — the braid below provides the actual visual mass.
    if (state.hoverId === strand.id) drawMergedStrandHalo(ctx, model, m, state, strand, endT, constituents);
    drawConstituentBraid(ctx, model, m, state, strand.id);
  }
}

function drawLeafStrand(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
  strand: ResolvedStrand,
  endT: number,
) {
  // A single oscillating ribbon in the strand's colour.
  const samples = sampleStrandPath(model, m, strand, endT);
  if (samples.length < 2) return;

  ctx.save();
  ctx.strokeStyle = strand.colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, usersToThickness(strand.users));
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
  ctx.stroke();

  // Subtle inner highlight for that warm braided look.
  ctx.strokeStyle = withAlpha('#ffffff', 0.18);
  ctx.lineWidth = Math.max(0.6, ctx.lineWidth * 0.35);
  ctx.stroke();
  ctx.restore();

  // Hover halo.
  if (state.hoverId === strand.id) {
    ctx.save();
    ctx.strokeStyle = withAlpha(strand.colour, 0.28);
    ctx.lineWidth = Math.max(8, usersToThickness(strand.users) * 2.2);
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawMergedStrandHalo(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
  strand: ResolvedStrand,
  endT: number,
  constituents: ResolvedStrand[],
) {
  const samples = sampleStrandPath(model, m, strand, endT);
  if (samples.length < 2) return;
  const baseThickness = constituents.reduce((s, c) => s + usersToThickness(c.users), 0)
    + usersToThickness(strand.users);
  ctx.save();
  ctx.strokeStyle = withAlpha(strand.colour, 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = baseThickness + 14;
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
  ctx.stroke();
  ctx.restore();
}

/** Draw constituent threads currently bound inside `parentId`, twisted as a braid. */
function drawConstituentBraid(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
  parentId: ID | 'spine',
) {
  const t = state.playhead;
  // Constituents = leaves whose ancestry includes parentId and have merged by t.
  // Actually: we want ALL strands (incl. intermediates) that have merged into
  // this parent (directly or via a child of this parent that has also merged).
  // The braid for the spine should show only leaf-level threads, not intermediate ones.
  // Easiest definition: a strand contributes a thread inside parentId iff:
  //   (1) parentId is in its ancestry,
  //   (2) every node on its ancestry path *between itself and parentId* has merged by t.
  const threads: ResolvedStrand[] = [];
  for (const s of model.strands) {
    if (s.mergeMs > t) continue; // hasn't merged on yet
    const ancestry = s.ancestry;
    const idx = ancestry.indexOf(parentId as ID | 'spine');
    if (idx <= 0) continue; // not an ancestor (or it's itself)
    // Check every intermediate node (between self and parent) has also merged by t.
    let ok = true;
    for (let i = 1; i < idx; i++) {
      const mid = ancestry[i];
      if (mid === 'spine') break;
      const midStrand = model.strands.find((x) => x.id === mid);
      if (!midStrand || midStrand.mergeMs > t) {
        ok = false; break;
      }
    }
    if (ok) threads.push(s);
  }

  if (threads.length === 0) return;

  // The braid occupies the parent's current thickness.
  // Parent's centreline path:
  const parentSamples = parentId === 'spine'
    ? spineSampleLine(model, m, t)
    : (() => {
        const ps = model.strands.find((x) => x.id === parentId);
        if (!ps) return [];
        const endT = Math.min(t, ps.mergeMs);
        return sampleStrandPath(model, m, ps, endT);
      })();
  if (parentSamples.length < 2) return;

  // For the spine, the right end is min(t, tEnd); for intermediates similar.
  // Sort threads for stable position assignment.
  const sorted = [...threads].sort((a, b) => a.startMs - b.startMs);

  // Total thickness based on threads' own thicknesses.
  const totalThickness = sorted.reduce((s, c) => s + usersToThickness(c.users), 0);
  // Compute each thread's y-band centre relative to parent centreline.
  const offsets: number[] = [];
  let cursor = -totalThickness / 2;
  for (const th of sorted) {
    const w = usersToThickness(th.users);
    offsets.push(cursor + w / 2);
    cursor += w;
  }

  // Draw each thread along the parent's centreline with twist offset.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  sorted.forEach((th, i) => {
    const baseOffset = offsets[i];
    const ownThick = Math.max(1.2, usersToThickness(th.users) * 0.78);

    // Each thread gets a phase offset for the twist undulation.
    const phase = (i / sorted.length) * Math.PI * 2 + (i * 0.7);
    // Twist period in CSS px — the smaller, the tighter the braid.
    const twistPeriodPx = 64;
    // Twist amplitude scales with band size but capped.
    const twistAmp = Math.min(totalThickness * 0.42, 8);

    ctx.beginPath();
    for (let k = 0; k < parentSamples.length; k++) {
      const p = parentSamples[k];
      const wobble = Math.sin((p.x / twistPeriodPx) * Math.PI * 2 + phase) * twistAmp;
      const y = p.y + baseOffset + wobble;
      if (k === 0) ctx.moveTo(p.x, y);
      else ctx.lineTo(p.x, y);
    }
    ctx.strokeStyle = th.colour;
    ctx.lineWidth = ownThick;
    ctx.stroke();

    // Highlight (gives the threads a 3D fibre feel).
    ctx.strokeStyle = withAlpha('#ffffff', 0.16);
    ctx.lineWidth = Math.max(0.5, ownThick * 0.35);
    ctx.stroke();
  });
  ctx.restore();
}

/** The spine sample line — straight horizontal from tStart to min(t, tEnd). */
function spineSampleLine(model: ResolvedModel, m: CanvasMetrics, t: number) {
  const endT = Math.min(t, model.tEnd);
  const startX = timeToX(model.tStart, model, m);
  const endX = timeToX(endT, model, m);
  const samples: { x: number; y: number }[] = [];
  const step = 4;
  for (let x = startX; x <= endX; x += step) samples.push({ x, y: m.centreY });
  samples.push({ x: endX, y: m.centreY });
  return samples;
}

// ------- Strand path sampling -------

interface PathSample {
  x: number;
  y: number;
  /** World time at this sample (ms). */
  t: number;
}

function sampleStrandPath(
  model: ResolvedModel,
  m: CanvasMetrics,
  strand: ResolvedStrand,
  endT: number,
): PathSample[] {
  const startX = timeToX(strand.startMs, model, m);
  const endX = timeToX(endT, model, m);
  if (endX <= startX) return [];

  const step = 3; // CSS px between samples — small enough to look smooth
  const samples: PathSample[] = [];
  // Wavelength in px: PX_PER_DAY_WAVE divided by freqPerDay (so high frequency => short wavelength).
  // Equivalently: oscillations per px = freqPerDay / PX_PER_DAY_WAVE.
  const freqRadPerPx = (strand.freqPerDay / PX_PER_DAY_WAVE) * Math.PI * 2;
  // Above-or-below the centreline alternation: start positive on top, depending on birthOffset sign.
  const sideSign = strand.birthOffset === 0 ? 1 : Math.sign(strand.birthOffset) || 1;
  for (let x = startX; x <= endX; x += step) {
    const tx = invLerp(startX, endX, x);
    const t = strand.startMs + tx * (endT - strand.startMs);
    const cy = m.centreY + strandCentreY(strand, model, t) * m.yScale;
    const amp = strandAmplitude(strand, t);
    // Oscillation: sin wave with frequency. Phase based on world time.
    const wave = Math.sin((x - startX) * freqRadPerPx) * amp * sideSign;
    samples.push({ x, y: cy + wave, t });
  }
  // Force last sample exactly at endX to land cleanly on the merge point.
  if (samples.length) {
    const last = samples[samples.length - 1];
    if (last.x < endX) samples.push({ x: endX, y: m.centreY + strandCentreY(strand, model, endT) * m.yScale, t: endT });
  }
  return samples;
}

// ------- Playhead -------

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  const x = timeToX(state.playhead, model, m);
  ctx.save();
  ctx.strokeStyle = withAlpha(INK, 0.55);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 24);
  ctx.lineTo(x, state.height - 56);
  ctx.stroke();
  ctx.restore();

  // Date pill above.
  const label = new Date(state.playhead).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  ctx.save();
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
  const w = ctx.measureText(label).width + 14;
  const h = 20;
  ctx.fillStyle = INK;
  roundRect(ctx, x - w / 2, 8, w, h, 4);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.fillText(label, x - w / 2 + 7, 22);
  ctx.restore();
}

// ------- Hit testing -------

/** Returns the strand id at the mouse position, or 'spine' / null. */
export function hitTest(
  mx: number,
  my: number,
  model: ResolvedModel,
  state: RenderState,
): ID | 'spine' | null {
  const m = metricsFor(state, model);
  const t = state.playhead;
  // Convert mx to world time so we can test bands.
  const tAtX = xToTime(mx, model, m);

  // Reverse iteration so top-most threads win.
  // Test merged-strand backings first (the wide hit area), then leaves.
  const sorted = [...model.strands].sort((a, b) => b.ancestry.length - a.ancestry.length);
  for (const s of sorted) {
    if (tAtX < s.startMs || tAtX > Math.min(t, s.mergeMs)) continue;
    // Compute centre y at tAtX
    const cy = m.centreY + strandCentreY(s, model, tAtX) * m.yScale;
    const totalThick = Math.max(usersToThickness(s.users), strandTotalDrawnThickness(s, model, tAtX));
    const tolerance = 8;
    if (Math.abs(my - cy) <= totalThick / 2 + tolerance) {
      return s.id;
    }
  }
  // Spine fallback.
  if (tAtX >= model.tStart && tAtX <= Math.min(t, model.tEnd)) {
    const cy = m.centreY;
    const totalThick = spineThicknessAt(model, tAtX);
    if (Math.abs(my - cy) <= totalThick / 2 + 6) return 'spine';
  }
  return null;
}

function strandTotalDrawnThickness(
  strand: ResolvedStrand,
  model: ResolvedModel,
  t: number,
): number {
  // Self + every descendant whose mergeMs <= t.
  let total = usersToThickness(strand.users);
  for (const s of model.strands) {
    if (s.id === strand.id) continue;
    if (!s.ancestry.includes(strand.id)) continue;
    if (s.mergeMs <= t) total += usersToThickness(s.users);
  }
  return total;
}

// ------- Small utilities -------

function invLerp(a: number, b: number, x: number): number {
  if (b === a) return 0;
  return (x - a) / (b - a);
}

function withAlpha(hex: string, alpha: number): string {
  // Accept #rgb / #rrggbb / rgba(...).
  if (hex.startsWith('rgba')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
