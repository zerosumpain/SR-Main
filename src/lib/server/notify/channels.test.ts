import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerNotificationChannel,
  notificationChannel,
  clearNotificationChannels,
} from './channels';

/**
 * The inversion, on its own.
 *
 * `notifyOwner` lives in the platform layer and WhatsApp lives in a domain, so
 * the notifier cannot import the sender — `check-module-boundaries` failed the
 * build when it did, and it was right: the two modules were mutually dependent
 * and neither could be tested or moved alone. This slot is what replaced the
 * import, and these are the properties the notifier relies on.
 */
describe('the notification channel slot', () => {
  beforeEach(() => clearNotificationChannels());

  it('is empty until something fills it', () => {
    // The run worker and every test process have no WhatsApp client. An absent
    // channel must be an ordinary answer, not a throw — the alert is already in
    // the ledger by the time this is asked.
    expect(notificationChannel('whatsapp')).toBeUndefined();
  });

  it('hands back exactly what was registered', async () => {
    const sent: string[] = [];
    registerNotificationChannel('whatsapp', async (text) => {
      sent.push(text);
      return true;
    });
    const send = notificationChannel('whatsapp');
    expect(send).toBeDefined();
    await expect(send!('hello')).resolves.toBe(true);
    expect(sent).toEqual(['hello']);
  });

  it('lets a later registration replace an earlier one', async () => {
    registerNotificationChannel('whatsapp', async () => false);
    registerNotificationChannel('whatsapp', async () => true);
    // Boot order is not something a caller controls, and two registrations of
    // the same name is a process that loaded the barrel twice rather than a
    // fault worth failing on.
    await expect(notificationChannel('whatsapp')!('x')).resolves.toBe(true);
  });

  it('keeps channels apart by name', () => {
    registerNotificationChannel('whatsapp', async () => true);
    expect(notificationChannel('whatsapp')).toBeDefined();
    expect(notificationChannel('signal')).toBeUndefined();
  });
});
