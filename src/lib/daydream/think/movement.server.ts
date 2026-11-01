// src/lib/daydream/think/movement.server.ts
//
// Gathering the household's movement for the think loop (`movement.ts`): the
// nightly patterns report, the live forecast and the forecast's own scorecard.
// Every read is soft, as on the situation card: one that fails is "unknown"
// in the text and costs the cycle nothing. The forecast is read as the OWNER
// (`{ kind: 'owner' }`, as the watch and parent alerts read it) — the think
// loop is his, and only a PRIVATE cycle ever calls this.

import { renderMovement, movementCardLines, MOVEMENT_SECTIONS, type MovementInputs, type MovementSection } from './movement';

const soft = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

export async function loadMovement(now = new Date()): Promise<MovementInputs> {
  const [{ loadPatterns }, { loadForecast }, { loadScorecard }, { listMembers }] = await Promise.all([
    import('$lib/home/presence/patterns.server'),
    import('$lib/home/presence/forecast.server'),
    import('$lib/home/presence/forecast-eval.server'),
    import('$lib/home/presence/members'),
  ]);
  const [report, read, stored, roster] = await Promise.all([
    soft(loadPatterns()),
    soft(loadForecast({ kind: 'owner' }, 28, null, now)),
    soft(loadScorecard()),
    soft(listMembers()),
  ]);
  return {
    report,
    forecast: read?.forecast ?? null,
    scorecard: stored?.latest ?? null,
    names: Object.fromEntries((roster ?? []).map((m) => [m.subject, m.displayName])),
  };
}

/** The situation card's movement lines. */
export async function movementCard(now = new Date()): Promise<string[]> {
  return movementCardLines(await loadMovement(now));
}

/** The `household_patterns` tool. */
export async function householdPatternsTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const asked = typeof args.section === 'string' ? args.section : 'summary';
  const section = ((MOVEMENT_SECTIONS as readonly string[]).includes(asked) ? asked : 'summary') as MovementSection;
  const person = typeof args.person === 'string' ? args.person : null;
  return renderMovement(await loadMovement(now), section, person);
}
