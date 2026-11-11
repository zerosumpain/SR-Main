import { describe, expect, it } from 'vitest';
import {
  EVENT_CATALOGUE,
  PLATFORM_EVENT_TYPES,
  canonicalEventType,
  eventEntry,
  isKnownEventType,
} from '$lib/events/catalogue';

describe('event catalogue', () => {
  it('names every event once, with a label, description, source and example payload', () => {
    const types = EVENT_CATALOGUE.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    for (const e of EVENT_CATALOGUE) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.source.length).toBeGreaterThan(0);
      expect(typeof e.payloadExample).toBe('object');
    }
  });

  it('covers every producer this programme wires', () => {
    expect([...PLATFORM_EVENT_TYPES].sort()).toEqual(
      [
        'alexa.utterance',
        'capture.ready',
        'connector.broken',
        'connector.recovered',
        'daydream.acted',
        'family.alert',
        'game.finished',
        'health.summary_changed',
        'news.item',
        'notification.raised',
        'pull.opened',
        'release.live',
        'share.opened',
        'trip.needs_you',
        'whatsapp.inbound',
        'wishlist.offer',
        'workflow.completed',
      ].sort(),
    );
  });

  it('reads the old workflow_completed name as workflow.completed', () => {
    expect(canonicalEventType('workflow_completed')).toBe('workflow.completed');
    expect(isKnownEventType('workflow_completed')).toBe(true);
    expect(eventEntry('workflow_completed')?.type).toBe('workflow.completed');
  });

  it('lets a schedule that names a removed event keep resolving, to nothing', () => {
    for (const gone of ['intel.alert', 'whoop_recovery_updated']) {
      expect(isKnownEventType(gone)).toBe(false);
      expect(canonicalEventType(gone)).toBe(gone);
    }
  });

  it('keeps every example payload flat enough to filter on and free of positions', () => {
    const banned = /^(lat|lon|lng|latitude|longitude|coords?|accuracy|address|email|phone|ip|userAgent)$/i;
    for (const e of EVENT_CATALOGUE.filter((x) => /^(family|wishlist|trip|share|capture|release|pull|game|daydream)\./.test(x.type))) {
      for (const [key, value] of Object.entries(e.payloadExample)) {
        expect(key, e.type).not.toMatch(banned);
        expect(typeof value === 'object', `${e.type}.${key}`).toBe(false);
      }
    }
  });

  it('does not invent an unknown type', () => {
    expect(isKnownEventType('made.up')).toBe(false);
    expect(eventEntry('made.up')).toBeNull();
  });
});
