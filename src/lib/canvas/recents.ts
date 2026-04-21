export const RECENTS_KEY = 'canvasPaletteRecents';
export const MAX_RECENTS = 20;

function load(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(arr: string[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RECENTS_KEY, JSON.stringify(arr));
}

export function recordPick(type: string) {
  const arr = load();
  arr.push(type);
  while (arr.length > MAX_RECENTS) arr.shift();
  save(arr);
}

export function getRecentCounts(): Record<string, number> {
  const arr = load();
  const counts: Record<string, number> = {};
  for (const t of arr) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}
