const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
  day: 'numeric',
  month: 'short',
});

/**
 * Format a timestamp for human-readable display in John's timezone (Europe/London).
 * Returns e.g. "08:22 BST, 15 Apr" or null if input is null/undefined.
 */
export function formatTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return formatter.format(date);
}
