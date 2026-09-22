/**
 * Where a notification can be sent, without the notifier knowing where that is.
 *
 * `notifyOwner` lives in `$lib/server` — the platform layer, which by rule has
 * no domain knowledge — and WhatsApp lives in `$lib/workflows`, which is a
 * domain. Importing the sender directly pointed the dependency upward and made
 * the two modules mutually dependent; `check-module-boundaries` says so, and it
 * is right. A platform service that needs a feature is a feature that should be
 * passing something in.
 *
 * So it is inverted. This file holds a slot; the domain fills it at boot. The
 * notifier calls whatever is in the slot and imports nothing.
 *
 * An unfilled slot is not an error and must never throw. The notifier runs in
 * every process — the web app, the run worker, a test — and only some of them
 * have a WhatsApp client. An alert is still written to the ledger, and the
 * phone still collects it; what is missing is one channel, which is exactly
 * what the ledger's per-channel timestamps are there to record.
 */

/** Returns whether it actually went. Must not throw. */
export type NotificationSender = (text: string) => Promise<boolean>;

const senders = new Map<string, NotificationSender>();

export function registerNotificationChannel(name: string, send: NotificationSender): void {
  senders.set(name, send);
}

export function notificationChannel(name: string): NotificationSender | undefined {
  return senders.get(name);
}

/** For a test that needs to assert nothing was sent. */
export function clearNotificationChannels(): void {
  senders.clear();
}
