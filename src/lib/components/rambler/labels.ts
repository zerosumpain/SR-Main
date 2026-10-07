// Plain words for the drives and choices, shared by the explainer's readouts.
import type { Choice, Drive } from '$lib/landing/ramblers/drives';

export const DRIVE_LABEL: Record<Drive, string> = {
  sleep: 'Sleep pressure',
  restless: 'Restlessness',
  attention: 'Tired brain',
  stress: 'Stress',
  appetite: 'Appetite',
  work: 'Work pull',
  curious: 'Curiosity',
  energy: 'Energy',
};

export const CHOICE_LABEL: Record<Choice, string> = {
  wander: 'Mooch about',
  run: 'Run',
  workout: 'Work out',
  cycle: 'Cycle',
  garden: 'Garden',
  lookout: 'Sit up top',
  stargaze: 'Stargaze',
  study: 'Read',
  think: 'Think',
  tv: 'Telly',
  sofa: 'Sofa',
  nap: 'Nap',
  sleep: 'Sleep',
  tea: 'Tea',
  eat: 'Eat',
  meditate: 'Meditate',
  drive: 'Drive out',
  puddle: 'Puddles',
  snowman: 'Snowman',
  umbrella: 'Umbrella walk',
};
