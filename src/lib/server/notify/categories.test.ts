import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CATEGORIES, categoryOf, isKnownCategory } from './categories';

describe('the notification catalogue', () => {
  it('gives every category a label and a sentence a person can read', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(category.id).toMatch(/^[a-z][a-z-]*$/);
      expect(category.label.length).toBeGreaterThan(0);
      // The description is what the phone's settings screen shows under the
      // switch. A category with no description is a switch with no meaning.
      expect(category.description.length).toBeGreaterThan(10);
      expect(category.minIntervalSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = NOTIFICATION_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds health to a three-hour floor', () => {
    // John's number, from the brief. The watcher polls every fifteen minutes;
    // this is the only thing that makes that safe.
    const health = categoryOf('health');
    expect(health.minIntervalSeconds).toBe(3 * 60 * 60);
    expect(health.native).toBe(true);
    // And it does NOT default to WhatsApp — a figure that moves all day would
    // otherwise arrive there all day, which is the behaviour being replaced.
    expect(health.whatsapp).toBe(false);
  });

  it('keeps every existing WhatsApp alert on WhatsApp by default', () => {
    // The routing table is new; the behaviour it replaces is not. Anything that
    // reached WhatsApp before this existed must keep reaching it until somebody
    // decides otherwise on the settings screen.
    for (const id of ['build', 'deploy', 'uptime', 'intel', 'system']) {
      expect(categoryOf(id).whatsapp).toBe(true);
    }
    // `chat` is the exception, and deliberately so: those alerts went through
    // the empty push shim and reached nothing at all, and chat already
    // escalates to WhatsApp by another path.
    expect(categoryOf('chat').whatsapp).toBe(false);
    expect(categoryOf('chat').native).toBe(true);
  });

  it('answers for a category it has never heard of rather than throwing', () => {
    // A caller raising an alert is already in the middle of something going
    // wrong. A typo in a category name must not become a second failure.
    expect(categoryOf('does-not-exist').id).toBe('system');
    expect(isKnownCategory('does-not-exist')).toBe(false);
    expect(isKnownCategory('health')).toBe(true);
  });

  it('leaves event-shaped categories unthrottled', () => {
    // A build result and a deploy failure are events, not readings. Suppressing
    // the second one loses information rather than noise.
    for (const id of ['build', 'deploy', 'uptime', 'intel', 'chat']) {
      expect(categoryOf(id).minIntervalSeconds).toBe(0);
    }
  });
});
