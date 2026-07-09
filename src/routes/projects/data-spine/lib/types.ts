// types.ts — shared types for The Data Spine field study. Self-contained: never
// imported from outside this route folder.

/** How settled a claim is. FACT = documented/verifiable; HYPOTHESIS = reasoned but
 *  unproven (the spine has no published architecture, so much analysis must be);
 *  CONTESTED = actively disputed between credible parties. */
export type Confidence = 'fact' | 'hypothesis' | 'contested';

export type PersonaId =
  | 'mat'      // large multi-academy trust
  | 'la'       // local authority children's services
  | 'research' // research agencies (EPI, FFT, ADR UK)
  | 'policy'   // DfE policy professional
  | 'digital'  // DfE Digital & Technology
  | 'vendor'   // MIS vendors & data brokers
  | 'ogd'      // other government departments
  | 'parent';  // parents & privacy advocates

export interface Cited {
  sourceUrl?: string;
  confidence: Confidence;
}
