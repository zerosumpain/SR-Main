// Server-side entry point for the scorer.
//
// `score.ts` deliberately takes no dependency on the filesystem so it can run in
// the browser as the author types. This supplies the committed card for callers
// that run on the server — generation loops, endpoints, tests.

import type { Register } from './types';
import { getVoiceCard } from './card';
import { scoreVoice, type VoiceScore } from './score';

export function scoreVoiceServer(text: string, register: Register = 'public-prose'): VoiceScore {
  return scoreVoice(text, register, getVoiceCard());
}

export { scoreVoice } from './score';
export type { VoiceScore, Finding, Severity } from './score';
