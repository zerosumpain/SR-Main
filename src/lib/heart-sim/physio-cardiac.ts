// Physiologically accurate 6-phase cardiac cycle.
//
// Maps to a real heartbeat (~857ms at 70 BPM):
//   0.00–0.10  atrial systole       (atrial kick)
//   0.10–0.15  isovolumetric contract (all valves closed)
//   0.15–0.45  ventricular ejection (the big push into aorta/pulm trunk)
//   0.45–0.55  isovolumetric relax  (all valves closed)
//   0.55–0.70  rapid passive filling (A→V via AV valves)
//   0.70–1.00  diastasis            (slow continued filling)
//
// Force ratio ventricular ejection : atrial systole ≈ 5 : 1, matching the
// real ~25% atrial-kick contribution to ventricular filling.

import {
  CHAMBER_C, pathPump, pushToward, contract,
  type FluidSolver,
} from './solver';
import { VALVES, type ValveStates } from './anatomy';

export type PhysioPhase =
  | 'atrialSystole' | 'isoContract' | 'ejection'
  | 'isoRelax' | 'rapidFilling' | 'diastasis';

interface PhaseDef { name: PhysioPhase; end: number; }
const PHASES: PhaseDef[] = [
  { name: 'atrialSystole', end: 0.10 },
  { name: 'isoContract',   end: 0.15 },
  { name: 'ejection',      end: 0.45 },
  { name: 'isoRelax',      end: 0.55 },
  { name: 'rapidFilling',  end: 0.70 },
  { name: 'diastasis',     end: 1.00 },
];

export interface PhysioCardiacState {
  bpm: number;
  t: number;
  phase: PhysioPhase;
  phaseFrac: number;   // within current phase (0..1)
  cyclePhi: number;    // overall cycle 0..1
  valves: ValveStates;
}

export function makePhysioCardiacState(bpm: number): PhysioCardiacState {
  return {
    bpm, t: 0,
    phase: 'diastasis', phaseFrac: 0, cyclePhi: 0,
    valves: { tricuspid: true, mitral: true, pulmonary: false, aortic: false },
  };
}

export function tickPhysioCardiac(s: PhysioCardiacState, dt: number): void {
  s.t += dt;
  const T = 60 / Math.max(20, s.bpm);
  const phi = (s.t % T) / T;
  s.cyclePhi = phi;
  let prev = 0;
  for (const p of PHASES) {
    if (phi < p.end) {
      s.phase = p.name;
      s.phaseFrac = (phi - prev) / (p.end - prev);
      break;
    }
    prev = p.end;
  }
  // Valve states by phase. AV (tricuspid/mitral) open during atrial systole
  // and the two filling phases. Semilunar (pulmonary/aortic) only during
  // ventricular ejection.
  const av = s.phase === 'atrialSystole' || s.phase === 'rapidFilling' || s.phase === 'diastasis';
  const sl = s.phase === 'ejection';
  s.valves.tricuspid = av;
  s.valves.mitral    = av;
  s.valves.pulmonary = sl;
  s.valves.aortic    = sl;
}

// Force scale ratios — atrial:ventricular ≈ 1:5 (physiological).
// Cavity pump magnitudes are 3× the previous baseline (200% stronger) for
// dramatic, very visible systole. Atrial:ventricular ratio preserved.
const ATR_PUSH = 144;
const ATR_CONTRACT = 81;
const VENT_PUSH = 1080;
const VENT_CONTRACT = 585;
const ISO_CONTRACT = 159;      // pre-ejection wind-up
const RAPID_FILL = 117;
const DIASTASIS_FILL = 42;
const VESSEL_BASELINE = 1.0;   // multiplier on pathPump baseAmp
const TURBULENCE = 5;

export function makePhysioCardiacForce(
  solver: FluidSolver,
  state: PhysioCardiacState,
  bpm: () => number,
) {
  return (i: number, fOut: Float32Array) => {
    const x = solver.pos[i * 2], y = solver.pos[i * 2 + 1];
    const ch = solver.chamber[i];
    const ci = solver.comfort[i];
    const r = Math.min(2.6, Math.max(0.5, bpm() / 70));
    const linK = r;
    const quadK = r * r;
    // Bell amp within current phase — peaks mid-phase.
    const amp = Math.sin(Math.PI * state.phaseFrac);

    // Brownian turbulence (modest — physio flow should look directed).
    fOut[0] += (Math.random() - 0.5) * TURBULENCE * linK * ci;
    fOut[1] += (Math.random() - 0.5) * TURBULENCE * linK * ci;

    // Vessel pumping (cardiac-triggered waves are still managed by solver paths).
    pathPump(x, y, fOut, linK * VESSEL_BASELINE, 200 * linK);

    switch (state.phase) {
      case 'atrialSystole':
        if (ch === 0) {  // RA
          pushToward(x, y, VALVES.tricuspid.bx, VALVES.tricuspid.by, fOut, ATR_PUSH * quadK * amp);
          contract(CHAMBER_C.RA, x, y, fOut, ATR_CONTRACT * quadK * amp);
        } else if (ch === 2) {  // LA
          pushToward(x, y, VALVES.mitral.bx, VALVES.mitral.by, fOut, ATR_PUSH * 1.1 * quadK * amp);
          contract(CHAMBER_C.LA, x, y, fOut, ATR_CONTRACT * quadK * amp);
        }
        break;

      case 'isoContract':
        // Pressure builds, no flow — gentle contraction wind-up.
        if (ch === 1)      contract(CHAMBER_C.RV, x, y, fOut, ISO_CONTRACT * quadK * amp);
        else if (ch === 3) contract(CHAMBER_C.LV, x, y, fOut, ISO_CONTRACT * quadK * amp);
        break;

      case 'ejection':
        if (ch === 1) {  // RV
          pushToward(x, y, VALVES.pulmonary.bx, VALVES.pulmonary.by, fOut, VENT_PUSH * 0.8 * quadK * amp);
          contract(CHAMBER_C.RV, x, y, fOut, VENT_CONTRACT * 0.8 * quadK * amp);
        } else if (ch === 3) {  // LV
          pushToward(x, y, VALVES.aortic.bx, VALVES.aortic.by, fOut, VENT_PUSH * quadK * amp);
          contract(CHAMBER_C.LV, x, y, fOut, VENT_CONTRACT * quadK * amp);
        }
        break;

      case 'isoRelax':
        // No flow.
        break;

      case 'rapidFilling':
        // Strong passive flow A→V.
        if (ch === 0) pushToward(x, y, VALVES.tricuspid.bx, VALVES.tricuspid.by, fOut, RAPID_FILL * linK * amp);
        else if (ch === 2) pushToward(x, y, VALVES.mitral.bx, VALVES.mitral.by, fOut, RAPID_FILL * linK * amp);
        break;

      case 'diastasis':
        // Slow continued passive flow.
        if (ch === 0) pushToward(x, y, VALVES.tricuspid.bx, VALVES.tricuspid.by, fOut, DIASTASIS_FILL * linK);
        else if (ch === 2) pushToward(x, y, VALVES.mitral.bx, VALVES.mitral.by, fOut, DIASTASIS_FILL * linK);
        break;
    }
  };
}
