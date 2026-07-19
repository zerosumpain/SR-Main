// Launcher recents — localStorage frecency for the ⌘K launcher, mirroring
// the canvas palette's recents.ts. Records workspace picks by href; the
// launcher floats the top-picked workspaces into a "Recent" group.
export const LAUNCHER_RECENTS_KEY = 'jkaiLauncherRecents';
export const MAX_LAUNCHER_RECENTS = 30;

function load(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LAUNCHER_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(arr: string[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAUNCHER_RECENTS_KEY, JSON.stringify(arr));
}

export function recordLauncherPick(href: string) {
  const arr = load();
  arr.push(href);
  while (arr.length > MAX_LAUNCHER_RECENTS) arr.shift();
  save(arr);
}

/** Pick-counts by href — recency-weighted (later picks count slightly more). */
export function getLauncherRecentScores(): Record<string, number> {
  const arr = load();
  const scores: Record<string, number> = {};
  arr.forEach((href, i) => {
    scores[href] = (scores[href] ?? 0) + 1 + i / arr.length;
  });
  return scores;
}
