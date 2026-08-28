// postures.ts — the strategic posture axes. Each is a genuine, contested tension a
// data strategy must take a position on. Valued −1…+1 (0 = balanced). `affects` gives
// the effect on each capability area's *effectiveness* as the value moves toward +1
// (the rightLabel), applied symmetrically toward −1 (the leftLabel) by the engine.
// Weights are modest (±0.05…0.25) and documented in params.ts.

import type { PostureAxis } from '$lib/dfe-data-strategy/types';

export const POSTURE_AXES: PostureAxis[] = [
  {
    id: 'operating-model',
    leftLabel: 'Centralise',
    rightLabel: 'Federate',
    description:
      'A single central platform & team versus domain-owned data (a "data mesh"). Centralising strengthens the platform and control; federating puts ownership and sharing closer to the people who know the data.',
    tension: 'Control & consistency vs. domain ownership & agility.',
    eli5: 'One big central data team, or lots of smaller teams owning their own data?',
    affects: [
      { area: 'platform', weight: -0.25 },
      { area: 'quality', weight: -0.15 },
      { area: 'governance', weight: -0.1 },
      { area: 'sharing', weight: 0.22 },
      { area: 'skills', weight: 0.18 },
      { area: 'value', weight: 0.12 },
    ],
  },
  {
    id: 'build-buy',
    leftLabel: 'Build in-house',
    rightLabel: 'Buy / SaaS',
    description:
      'Build capability internally or buy it from the market. Buying gets a platform faster; building grows lasting internal skill and control.',
    tension: 'Speed-to-capability vs. lasting internal capability & control.',
    eli5: 'Build our own tools, or buy them off the shelf?',
    affects: [
      { area: 'platform', weight: 0.2 },
      { area: 'value', weight: 0.1 },
      { area: 'skills', weight: -0.2 },
      { area: 'governance', weight: -0.06 },
      { area: 'sharing', weight: -0.05 },
    ],
  },
  {
    id: 'openness',
    leftLabel: 'Open by default',
    rightLabel: 'Secure by default',
    description:
      'Default toward open, reusable, interoperable data, or toward tightly-controlled, secure-by-default data. The right posture protects trust; the left maximises reuse and join-up.',
    tension: 'Reuse & interoperability vs. protection & public trust.',
    eli5: 'Make data open and easy to reuse, or locked-down and safe first?',
    affects: [
      { area: 'ethics', weight: 0.2 },
      { area: 'governance', weight: 0.1 },
      { area: 'interoperability', weight: -0.2 },
      { area: 'value', weight: -0.15 },
      { area: 'sharing', weight: -0.12 },
    ],
  },
  {
    id: 'standards-pace',
    leftLabel: 'Standardise now',
    rightLabel: 'Iterate & emerge',
    description:
      'Invest up-front in standards and identifiers, or let standards emerge from delivery. Standardising now buys interoperability and quality but slows early delivery.',
    tension: 'Up-front interoperability vs. delivery speed.',
    eli5: 'Agree the standards up front, or let them grow as we go?',
    affects: [
      { area: 'interoperability', weight: -0.22 },
      { area: 'quality', weight: -0.15 },
      { area: 'value', weight: 0.16 },
      { area: 'skills', weight: 0.05 },
    ],
  },
  {
    id: 'delivery',
    leftLabel: 'Deliver in-house',
    rightLabel: 'Partner-led',
    description:
      'Deliver through the department itself, or through partners (LAs, MATs, agencies, ONS). Partner-led delivery unlocks cross-system sharing but adds coordination cost and dilutes control of quality.',
    tension: 'Control & quality vs. reach across the system.',
    eli5: 'Do it ourselves, or work mostly through partners?',
    affects: [
      { area: 'sharing', weight: 0.2 },
      { area: 'governance', weight: -0.12 },
      { area: 'quality', weight: -0.1 },
      { area: 'skills', weight: -0.06 },
    ],
  },
  {
    id: 'ambition',
    leftLabel: 'Foundations first',
    rightLabel: 'AI / use first',
    description:
      'Lay the data foundations first, or chase use-cases and AI value now. Use-first delivers visible value sooner but risks running ahead of quality, governance and ethics.',
    tension: 'Durable foundations vs. visible near-term value.',
    eli5: 'Fix the plumbing first, or chase quick wins and AI now?',
    affects: [
      { area: 'value', weight: 0.25 },
      { area: 'quality', weight: -0.16 },
      { area: 'governance', weight: -0.1 },
      { area: 'ethics', weight: -0.1 },
    ],
  },
];

export const POSTURE_IDS = POSTURE_AXES.map((p) => p.id);
export const POSTURE_BY_ID: Record<string, PostureAxis> = Object.fromEntries(
  POSTURE_AXES.map((p) => [p.id, p]),
);
