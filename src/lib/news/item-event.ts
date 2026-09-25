/**
 * The `news.item` event for one gather: every story the desk had never stored
 * before, in ONE event. A gather upserts dozens of rows and a first gather
 * hundreds, so an event per story would start a workflow run per story; one per
 * gather lets a workflow decide for itself what is worth a notification.
 *
 * `titles` is the headlines joined into one string so a trigger filter can say
 * `titles contains "openai"` without reaching into the items array. Capped at
 * 50 items — a first gather is history, not news.
 */
export interface NewItem {
  key: string;
  source: string;
  title: string;
  url: string | null;
  domain: string | null;
}

export const NEWS_EVENT_MAX_ITEMS = 50;

export function newsItemPayload(items: readonly NewItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  const kept = items.slice(0, NEWS_EVENT_MAX_ITEMS);
  return {
    count: items.length,
    sources: [...new Set(kept.map((i) => i.source))],
    titles: kept.map((i) => i.title).join(' | '),
    items: kept,
  };
}
