import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '$lib/constants/notification-categories';

export { NOTIFICATION_CATEGORIES, type NotificationCategory };

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]['id'];

const BY_ID = new Map(NOTIFICATION_CATEGORIES.map((c) => [c.id, c]));

/**
 * The catalogue entry for a category, or `system`.
 *
 * Never throws and never returns undefined. A caller raising an alert is in the
 * middle of something else — a failed run, a service that stopped answering —
 * and a typo in a category name must not become a second failure on top of the
 * first.
 */
export function categoryOf(id: string): NotificationCategory {
  return BY_ID.get(id) ?? BY_ID.get('system')!;
}

export function isKnownCategory(id: string): boolean {
  return BY_ID.has(id);
}
