// Canvas-2D rendering for the convergence timeline. V2.
//
// V2 changes:
//  - Spine is now a SINGLE moving rainbow bar — coloured stripes for each
//    contributing source, all sharing one always-animating sine displacement.
//    No more individual wave-threads through the spine area.
//  - Spine oscillation period is calibrated to the active zoom so the visual
//    rhythm matches the time axis (1 day, 1 week, 1 month, 1 year per cycle).
//  - Outputs render as labelled circles off the spine with bezier connectors.
//  - Reference-data feeds render as a dotted tick stream entering the spine.
//  - Pan/zoom: the visible time window is the spec's `spanMs`, centred on the
//    playhead, clamped to model bounds.

import type {
  ResolvedModel, ResolvedStrand, ResolvedOutput, ID, ZoomLevel,
} from './types';
import { ZOOM_SPECS } from './types';
import {
  strandCentreY, strandAmplitude, spineThicknessAt,
  usersToThickness, spineStripeColoursAt, OUTPUT_OFFSET_PX,
} from './strands';

export interface RenderState {
  width: number;
  height: number;
  dpr: number;
  /** World time (ms epoch) at the playhead. */
  playhead: number;
  /** Real wall-clock time (ms) — used to animate the rainbow spine. */
  animTime: number;
  zoom: ZoomLevel;
  hoverId: ID | 'spine' | null;
  hoverOutputId: ID | null;
}

export interface CanvasMetrics {
  centreY: number;
  leftX: number;
  rightX: number;
  yScale: number;
  /** Visible time window, ms. */
  viewStart: number;
  viewEnd: number;
  /** Oscillation wavelength in CSS px for the spine bar at this zoom. */
  spineWavelengthPx: number;
  /** Pre-computed output track centres, keyed by output id. */
  outputTrackY: Map<ID, number>;
}

// Output band layout — each output gets its own horizontal track at a fixed
// y in CSS px. Tracks stack inward from the top / bottom edge of the canvas.
const OUTPUT_EDGE_PAD = 36;
const OUTPUT_TRACK_GAP = 28;

// ------- Theme palette -------
const PAPER = '#f1ead6';
const INK = '#1c1611';
const INK_SOFT = 'rgba(28, 22, 17, 0.5)';
const INK_FAINT = 'rgba(28, 22, 17, 0.16)';

export function metricsFor(state: RenderState, model: ResolvedModel): CanvasMetrics {
  const leftX = 24;
  const rightX = state.width - 24;
  const centreY = state.height / 2;

  // View window: span centred on playhead, clamped to model bounds.
  const span = ZOOM_SPECS[state.zoom].spanMs;
  const oscCount = ZOOM_SPECS[state.zoom].oscCount;
  let viewStart = state.playhead - span / 2;
  let viewEnd = state.playhead + span / 2;
  const pad = span * 0.06;
  if (viewStart < model.tStart - pad) {
    viewStart = model.tStart - pad;
    viewEnd = viewStart + span;
  }
  if (viewEnd > model.tEnd + pad) {
    viewEnd = model.tEnd + pad;
    viewStart = viewEnd - span;
  }

  // Output track layout — reserve space at the top and bottom of the canvas.
  const aboveOuts = model.outputs.filter((o) => o.resolvedSide === 'above');
  const belowOuts = model.outputs.filter((o) => o.resolvedSide === 'below');
  const outputTrackY = new Map<ID, number>();
  aboveOuts.forEach((o, i) => {
    outputTrackY.set(o.id, OUTPUT_EDGE_PAD + i * OUTPUT_TRACK_GAP);
  });
  belowOuts.forEach((o, i) => {
    outputTrackY.set(o.id, state.height - OUTPUT_EDGE_PAD - i * OUTPUT_TRACK_GAP);
  });
  const aboveBandPx = OUTPUT_EDGE_PAD + Math.max(0, aboveOuts.length - 1) * OUTPUT_TRACK_GAP;
  const belowBandPx = OUTPUT_EDGE_PAD + Math.max(0, belowOuts.length - 1) * OUTPUT_TRACK_GAP;

  // Strands live between the output bands.
  const verticalRoomAbove = centreY - aboveBandPx - 20;
  const verticalRoomBelow = (state.height - centreY) - belowBandPx - 26; // 26 for time axis
  const verticalRoom = Math.min(verticalRoomAbove, verticalRoomBelow);

  let maxOffset = 1;
  for (const s of model.strands) {
    const a = Math.abs(s.birthOffset);
    if (a > maxOffset) maxOffset = a;
  }
  let maxThickness = 0;
  for (const s of model.strands) {
    if (s.thickness > maxThickness) maxThickness = s.thickness;
  }
  const extent = maxOffset + maxThickness * 0.6 + 8;
  const yScale = Math.min(1, verticalRoom / extent);

  const spineWavelengthPx = (rightX - leftX) / oscCount;

  return { centreY, leftX, rightX, yScale, viewStart, viewEnd, spineWavelengthPx, outputTrackY };
}

/** Convert world time (ms) to canvas x using the current view window. */
export function timeToX(t: number, m: CanvasMetrics): number {
  const range = Math.max(1, m.viewEnd - m.viewStart);
  const p = (t - m.viewStart) / range;
  return m.leftX + p * (m.rightX - m.leftX);
}

/** Inverse. */
export function xToTime(x: number, m: CanvasMetrics): number {
  const p = (x - m.leftX) / Math.max(1, m.rightX - m.leftX);
  return m.viewStart + p * (m.viewEnd - m.viewStart);
}

// ------- Top-level render -------

export function render(ctx: CanvasRenderingContext2D, model: ResolvedModel, state: RenderState) {
  const { width, height, dpr } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const m = metricsFor(state, model);

  drawTimeAxis(ctx, model, m, state);
  drawSpineRainbow(ctx, model, m, state);
  drawReferenceFeeds(ctx, model, m, state);
  drawStrands(ctx, model, m, state);
  drawOutputs(ctx, model, m, state);
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

  const ticks = niceTicks(m.viewStart, m.viewEnd, state.zoom);
  for (const tick of ticks) {
    const x = timeToX(tick.t, m);
    if (x < m.leftX - 30 || x > m.rightX + 30) continue;
    ctx.beginPath();
    ctx.setLineDash([1, 4]);
    ctx.moveTo(x, 28);
    ctx.lineTo(x, state.height - 32);
    ctx.stroke();
    ctx.setLineDash([]);
    const w = ctx.measureText(tick.label).width;
    ctx.fillText(tick.label, x - w / 2, state.height - 14);
  }
  ctx.restore();
}

function niceTicks(start: number, end: number, zoom: ZoomLevel): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const dayMs = 1000 * 60 * 60 * 24;
  if (zoom === '6m') {
    // monthly ticks
    const d = new Date(start);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    while (d.getTime() < end) {
      out.push({ t: d.getTime(), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).toUpperCase() });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else if (zoom === '1y') {
    // monthly ticks
    const d = new Date(start);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    while (d.getTime() < end) {
      out.push({ t: d.getTime(), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).toUpperCase() });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else if (zoom === '10y') {
    // yearly ticks
    const yStart = new Date(start).getUTCFullYear();
    const yEnd = new Date(end).getUTCFullYear();
    for (let y = yStart; y <= yEnd; y++) {
      out.push({ t: Date.UTC(y, 0, 1), label: `’${String(y).slice(-2)}` });
    }
  } else {
    // every 5 years
    const yStart = Math.floor(new Date(start).getUTCFullYear() / 5) * 5;
    const yEnd = new Date(end).getUTCFullYear();
    for (let y = yStart; y <= yEnd; y += 5) {
      out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
    }
  }
  void dayMs;
  return out;
}

// ------- Spine (the moving rainbow bar) -------

function drawSpineRainbow(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  // Phase animation — rolls regardless of play state so the bar is "alive".
  const phase = (state.animTime / 1000) * Math.PI * 1.2; // ~0.6 cycles/s
  const wavelengthPx = m.spineWavelengthPx;
  const radPerPx = (Math.PI * 2) / Math.max(1, wavelengthPx);
  const ampMax = Math.min(10, Math.max(3, wavelengthPx * 0.16));

  // Maximum px we'll let the rainbow bar grow to — proportionate to canvas height.
  // The bar should be a strong focal element but not eat the whole frame.
  const MAX_SPINE_PX = Math.min(64, Math.max(28, state.height * 0.16));
  // Compute the spine's "natural" max thickness (sum of all leaf contributors).
  let maxNatural = 0;
  for (const s of model.strands) {
    if (s.ancestry.includes('spine')) maxNatural += usersToThickness(s.users);
  }
  const stripeScale = maxNatural > 0 ? Math.min(1, MAX_SPINE_PX / maxNatural) : 1;

  // Faint future-spine guide (dashed line so the user sees where the spine will run).
  ctx.save();
  ctx.strokeStyle = INK_FAINT;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(m.leftX, m.centreY);
  ctx.lineTo(m.rightX, m.centreY);
  ctx.stroke();
  ctx.restore();

  // Sample x positions along the visible range.
  const step = 2;
  const xStart = m.leftX;
  const xEnd = m.rightX;

  // Precompute samples with their current stripe sets and a shared sine displacement.
  const samples: { x: number; t: number; y: number; stripes: { strand: ResolvedStrand; ramp: number }[] }[] = [];
  for (let x = xStart; x <= xEnd; x += step) {
    const t = xToTime(x, m);
    const alive = t >= model.tStart && t <= model.tEnd;
    const stripes = alive ? spineStripeColoursAt('spine', model, t) : [];
    // Local amplitude — bigger as the spine has more sources flowing.
    let segNatural = 0;
    for (const stripe of stripes) segNatural += usersToThickness(stripe.strand.users) * stripe.ramp;
    const fullness = maxNatural > 0 ? Math.min(1, segNatural / maxNatural) : 0;
    const ampHere = alive ? ampMax * (0.35 + 0.65 * fullness) : 0;
    const y = m.centreY + Math.sin(x * radPerPx + phase) * ampHere;
    samples.push({ x, t, y, stripes });
  }

  if (samples.length < 2) return;

  // Stable stripe order so the rainbow doesn't shuffle as the playhead moves.
  const stripeOrder = computeSpineStripeOrder(model);

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];

    // Merge the stripe sets of the two adjacent samples (a + b) so we draw smooth segments.
    const merged = new Map<ID, { strand: ResolvedStrand; ramp: number }>();
    for (const stripe of a.stripes) merged.set(stripe.strand.id, { ...stripe });
    for (const stripe of b.stripes) {
      const prev = merged.get(stripe.strand.id);
      if (prev) merged.set(stripe.strand.id, { strand: stripe.strand, ramp: Math.max(prev.ramp, stripe.ramp) });
      else merged.set(stripe.strand.id, { ...stripe });
    }

    const ordered = [...merged.values()].sort((u, v) => {
      const ai = stripeOrder.get(u.strand.id) ?? 9999;
      const bi = stripeOrder.get(v.strand.id) ?? 9999;
      return ai - bi;
    });

    let segThickness = 0;
    for (const item of ordered) segThickness += usersToThickness(item.strand.users) * item.ramp * stripeScale;
    // Always show a thin spine line if any source has started — so the rope is anchored even when very early.
    if (segThickness > 0) segThickness = Math.max(segThickness, 3);

    if (segThickness <= 0) continue;

    let cursor = -segThickness / 2;
    for (const item of ordered) {
      const h = usersToThickness(item.strand.users) * item.ramp * stripeScale;
      if (h <= 0.1) continue;
      drawStripeSegment(ctx, a.x, a.y + cursor, b.x, b.y + cursor, h, item.strand.colour, 0.92);
      cursor += h;
    }
  }
}

function drawStripeSegment(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  height: number,
  colour: string,
  alpha: number,
) {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, y2 + height);
  ctx.lineTo(x1, y1 + height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Compute the stripe order across the spine based on each strand's merge
 *  date (oldest first → at the centre of the bar; newest → edges). Reference
 *  feeds sort by startMs. */
function computeSpineStripeOrder(model: ResolvedModel): Map<ID, number> {
  const order = new Map<ID, number>();
  const sorted = [...model.strands]
    .filter((s) => s.ancestry.includes('spine'))
    .sort((a, b) => {
      const aT = a.isReference ? a.startMs : a.mergeMs;
      const bT = b.isReference ? b.startMs : b.mergeMs;
      return aT - bT;
    });
  sorted.forEach((s, i) => order.set(s.id, i));
  return order;
}

// ------- Reference-data tick stream -------

function drawReferenceFeeds(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  const t = state.playhead;
  // Stack reference feeds: each gets its own row above OR below the spine, with a
  // header band, a label, and tick marks falling onto the spine.
  const refs = model.strands.filter((s) => s.isReference);
  if (refs.length === 0) return;
  ctx.save();
  refs.forEach((s, i) => {
    if (s.startMs > Math.max(state.playhead, m.viewEnd)) return;
    const stopMs = Math.min(s.mergeMs, m.viewEnd);
    const startMs = Math.max(s.startMs, m.viewStart);
    if (stopMs <= startMs) return;

    // Alternate sides; positions stack inward toward the spine.
    const sideSign = i % 2 === 0 ? -1 : 1;
    const rowIdx = Math.floor(i / 2);
    const baseOff = OUTPUT_OFFSET_PX * 0.42 * m.yScale;
    const headerY = m.centreY + sideSign * (baseOff + rowIdx * 22);
    const spineY = m.centreY;

    const startX = timeToX(startMs, m);
    const stopX = timeToX(stopMs, m);
    if (stopX - startX < 6) return;

    // Background band.
    ctx.fillStyle = hexAlpha(s.colour, 0.08);
    ctx.fillRect(startX, headerY - 8, stopX - startX, 16);
    // Top/bottom hairlines.
    ctx.strokeStyle = hexAlpha(s.colour, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, headerY - 8);
    ctx.lineTo(stopX, headerY - 8);
    ctx.moveTo(startX, headerY + 8);
    ctx.lineTo(stopX, headerY + 8);
    ctx.stroke();

    // Tick marks.
    const periodMs = ZOOM_SPECS_TICK_PERIOD[state.zoom];
    let cursor = Math.ceil(s.startMs / periodMs) * periodMs;
    while (cursor <= stopMs) {
      if (cursor >= startMs && cursor <= t) {
        const x = timeToX(cursor, m);
        ctx.strokeStyle = hexAlpha(s.colour, 0.85);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, headerY + (sideSign === -1 ? 8 : -8));
        ctx.lineTo(x, spineY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Solid dot on the header band.
        ctx.fillStyle = s.colour;
        ctx.beginPath();
        ctx.arc(x, headerY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      cursor += periodMs;
    }

    // Label inside the band.
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = PAPER;
    const labelText = s.name.toUpperCase();
    const labelX = Math.max(m.leftX + 6, startX + 6);
    const labelY = headerY + 3.5;
    // Draw a chip behind the label so it doesn't blend with the canvas.
    const lw = ctx.measureText(labelText).width;
    ctx.fillStyle = s.colour;
    roundRect(ctx, labelX - 4, labelY - 9, lw + 8, 12, 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.fillText(labelText, labelX, labelY);
  });
  ctx.restore();
}

const ZOOM_SPECS_TICK_PERIOD: Record<ZoomLevel, number> = {
  '6m':    1000 * 60 * 60 * 24 * 7,        // 1 week
  '1y':    1000 * 60 * 60 * 24 * 14,       // 2 weeks
  '10y':   1000 * 60 * 60 * 24 * 60,       // 2 months
  'adult': 1000 * 60 * 60 * 24 * 365,      // 1 year
};

// ------- Strands (everything not in the spine, with colour always prominent) -------

function drawStrands(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  // Reference feeds are drawn separately.
  const sorted = [...model.strands]
    .filter((s) => !s.isReference)
    .sort((a, b) => a.ancestry.length - b.ancestry.length);
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

  const samples = sampleStrandPath(model, m, strand, endT);
  if (samples.length < 2) return;

  // Hover halo.
  if (state.hoverId === strand.id || (state.hoverOutputId && strand.outputs?.includes(state.hoverOutputId))) {
    ctx.save();
    ctx.strokeStyle = hexAlpha(strand.colour, 0.35);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(10, usersToThickness(strand.users) * 2.4);
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // Main coloured ribbon.
  ctx.save();
  ctx.strokeStyle = strand.colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.4, usersToThickness(strand.users));
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i].x, samples[i].y);
  ctx.stroke();

  // Inner highlight to give the ribbon depth.
  ctx.strokeStyle = hexAlpha('#ffffff', 0.22);
  ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.32);
  ctx.stroke();

  // Outer outline so the colour stays readable against the rainbow spine.
  ctx.strokeStyle = hexAlpha(INK, 0.25);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Start cap — small dot to anchor the strand visually.
  ctx.save();
  ctx.fillStyle = strand.colour;
  ctx.beginPath();
  ctx.arc(samples[0].x, samples[0].y, Math.max(2.5, usersToThickness(strand.users) * 0.45), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexAlpha(INK, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function sampleStrandPath(
  model: ResolvedModel,
  m: CanvasMetrics,
  strand: ResolvedStrand,
  endT: number,
): { x: number; y: number; t: number }[] {
  const startX = timeToX(strand.startMs, m);
  const endX = timeToX(endT, m);
  if (endX - startX < 1) return [];
  const samples: { x: number; y: number; t: number }[] = [];
  const dayMs = 1000 * 60 * 60 * 24;
  const tRange = endT - strand.startMs;
  const pxRange = endX - startX;
  const daysPerPx = (tRange / dayMs) / Math.max(1, pxRange);
  // Natural cycles-per-px from data cadence. Capped so even daily cadence at
  // 6m zoom remains readable (min wavelength ~7 px).
  let cyclesPerPx = strand.freqPerDay * daysPerPx;
  const maxCyclesPerPx = 1 / 7;
  if (cyclesPerPx > maxCyclesPerPx) cyclesPerPx = maxCyclesPerPx;
  const radPerPx = cyclesPerPx * Math.PI * 2;
  // Step size adapts to frequency — denser sampling for high-freq strands.
  const step = Math.max(1.5, Math.min(3, 1 / (cyclesPerPx * 4)));
  const sideSign = strand.birthOffset === 0 ? 1 : Math.sign(strand.birthOffset) || 1;
  for (let x = startX; x <= endX; x += step) {
    const ratio = (x - startX) / Math.max(1, endX - startX);
    const t = strand.startMs + ratio * (endT - strand.startMs);
    const cy = m.centreY + strandCentreY(strand, model, t) * m.yScale;
    const amp = strandAmplitude(strand, t);
    const wave = Math.sin((x - startX) * radPerPx) * amp * sideSign;
    samples.push({ x, y: cy + wave, t });
  }
  return samples;
}

// ------- Collections / Outputs (annual instance tracks) -------
//
// In V3 each output runs *every year*. We render a horizontal track for each
// output at a fixed CSS-px y; on that track, a dot appears at each year's x
// the playhead has reached. Each dot has connectors to the contributing
// source strands at the same x — never to the spine directly.

const YEAR_MS = 1000 * 60 * 60 * 24 * 365.25;

function drawOutputs(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  for (const out of model.outputs) {
    drawOutputTrack(ctx, model, m, state, out);
  }
}

function drawOutputTrack(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
  out: ResolvedOutput,
) {
  const trackY = m.outputTrackY.get(out.id);
  if (trackY === undefined) return;
  const hovered = state.hoverOutputId === out.id;
  const sideSign = out.resolvedSide === 'above' ? -1 : 1;

  // Determine year range — from the model's start year up to its end year.
  const yStart = new Date(model.tStart).getUTCFullYear();
  const yEnd = new Date(model.tEnd).getUTCFullYear() + 1;

  // Faint track baseline so the user can scan all years for this output.
  ctx.save();
  ctx.strokeStyle = hexAlpha(out.colour, hovered ? 0.5 : 0.18);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(m.leftX, trackY);
  ctx.lineTo(m.rightX, trackY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Label pill at the left edge of the track.
  drawOutputLabel(ctx, m, out, trackY, hovered);

  // For each year, render a dot + connectors to active source strands.
  const playheadYear = new Date(state.playhead).getUTCFullYear();
  for (let yr = yStart; yr <= yEnd; yr++) {
    const yearMs = Date.UTC(yr, 0, 1);
    // Use a "collection date" mid-year so it doesn't sit on top of the time-axis tick.
    const collectionMs = yearMs + YEAR_MS * 0.5;
    if (collectionMs > state.playhead) break; // not revealed yet
    const dotX = timeToX(collectionMs, m);
    if (dotX < m.leftX - 14 || dotX > m.rightX + 14) continue;

    // Identify currently-active contributing sources.
    const activeSources: ResolvedStrand[] = [];
    for (const sid of out.sourceIds) {
      const s = model.strands.find((x) => x.id === sid);
      if (!s) continue;
      if (collectionMs < s.startMs || collectionMs > s.mergeMs) continue;
      activeSources.push(s);
    }

    // Draw connectors UNDER the dot.
    for (const s of activeSources) {
      const sourceY = m.centreY + strandCentreY(s, model, collectionMs) * m.yScale;
      const highlight = hovered || state.hoverId === s.id;
      drawCollectionConnector(
        ctx,
        { x: dotX, y: trackY },
        { x: dotX, y: sourceY },
        s.colour,
        out.colour,
        sideSign,
        highlight,
      );
    }

    // The dot itself. Most recent year is brightest, older ones fade.
    const isLatest = yr === playheadYear;
    const hasActive = activeSources.length > 0;
    const dotAlpha = hasActive ? 1 : 0.4;
    drawCollectionDot(ctx, dotX, trackY, out.colour, dotAlpha, isLatest || hovered);
  }
}

function drawOutputLabel(
  ctx: CanvasRenderingContext2D,
  m: CanvasMetrics,
  out: ResolvedOutput,
  trackY: number,
  hovered: boolean,
) {
  ctx.save();
  ctx.font = '10.5px "DM Sans", system-ui, sans-serif';
  const label = out.name;
  const lw = ctx.measureText(label).width;
  const padX = 8;
  const w = lw + padX * 2;
  const h = 18;
  const x = m.leftX + 4;
  // Pill background.
  ctx.fillStyle = hovered ? out.colour : hexAlpha(out.colour, 0.92);
  roundRect(ctx, x, trackY - h / 2, w, h, 9);
  ctx.fill();
  // Text.
  ctx.fillStyle = PAPER;
  ctx.fillText(label, x + padX, trackY + 3.5);
  ctx.restore();
}

function drawCollectionDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colour: string,
  alpha: number,
  emphasised: boolean,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = emphasised ? 5.2 : 4;
  // Halo for the latest / hovered instance.
  if (emphasised) {
    ctx.fillStyle = hexAlpha(colour, 0.22);
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Solid dot.
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Inner highlight.
  ctx.fillStyle = hexAlpha('#ffffff', 0.55);
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCollectionConnector(
  ctx: CanvasRenderingContext2D,
  fromOut: { x: number; y: number },
  toSrc: { x: number; y: number },
  sourceColour: string,
  outputColour: string,
  sideSign: number,
  highlighted: boolean,
) {
  ctx.save();
  // Use source colour so eye traces source → collection.
  ctx.strokeStyle = hexAlpha(sourceColour, highlighted ? 0.95 : 0.55);
  ctx.lineWidth = highlighted ? 2 : 1.2;
  ctx.lineCap = 'round';
  // Bezier with the control point pulled toward the source side so the curve
  // hugs the strand briefly before splaying out to the collection track.
  const dy = toSrc.y - fromOut.y;
  const cp1 = { x: fromOut.x, y: fromOut.y + dy * 0.65 };
  const cp2 = { x: toSrc.x, y: toSrc.y - dy * 0.25 };
  ctx.beginPath();
  ctx.moveTo(fromOut.x, fromOut.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, toSrc.x, toSrc.y);
  ctx.stroke();
  // Small terminator tick at the source end, in the output's colour, so the
  // connection back to the consuming activity is still legible.
  ctx.fillStyle = outputColour;
  ctx.beginPath();
  ctx.arc(toSrc.x, toSrc.y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  void sideSign;
}

// ------- Playhead -------

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  model: ResolvedModel,
  m: CanvasMetrics,
  state: RenderState,
) {
  const x = timeToX(state.playhead, m);
  if (x < m.leftX || x > m.rightX) return;
  ctx.save();
  ctx.strokeStyle = hexAlpha(INK, 0.62);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 24);
  ctx.lineTo(x, state.height - 32);
  ctx.stroke();
  ctx.restore();

  // Date pill.
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

export function hitTest(
  mx: number,
  my: number,
  model: ResolvedModel,
  state: RenderState,
): { kind: 'strand'; id: ID } | { kind: 'output'; id: ID } | { kind: 'spine' } | null {
  const m = metricsFor(state, model);
  const t = state.playhead;
  const tAtX = xToTime(mx, m);

  // Outputs first — match against their full horizontal track.
  for (const out of model.outputs) {
    const trackY = m.outputTrackY.get(out.id);
    if (trackY === undefined) continue;
    if (Math.abs(my - trackY) <= 9) return { kind: 'output', id: out.id };
  }

  // Strands.
  const sorted = [...model.strands]
    .filter((s) => !s.isReference)
    .sort((a, b) => b.ancestry.length - a.ancestry.length);
  for (const s of sorted) {
    if (tAtX < s.startMs || tAtX > Math.min(t, s.mergeMs)) continue;
    const cy = m.centreY + strandCentreY(s, model, tAtX) * m.yScale;
    const thick = Math.max(8, usersToThickness(s.users));
    if (Math.abs(my - cy) <= thick / 2 + 6) return { kind: 'strand', id: s.id };
  }
  // Reference feeds — match against their header band.
  for (const s of model.strands) {
    if (!s.isReference) continue;
    if (tAtX < s.startMs || tAtX > s.mergeMs) continue;
    const sideSign = s.birthOffset < 0 ? -1 : 1;
    const headerY = m.centreY + sideSign * OUTPUT_OFFSET_PX * 0.55 * m.yScale;
    if (Math.abs(my - headerY) <= 12) return { kind: 'strand', id: s.id };
  }
  // Spine fallback.
  if (tAtX >= model.tStart && tAtX <= Math.min(t, model.tEnd)) {
    const cy = m.centreY;
    const tot = spineThicknessAt(model, tAtX);
    if (Math.abs(my - cy) <= tot / 2 + 8) return { kind: 'spine' };
  }
  return null;
}

// ------- Utilities -------

function hexAlpha(hex: string, alpha: number): string {
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
  x: number, y: number, w: number, h: number, r: number,
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
