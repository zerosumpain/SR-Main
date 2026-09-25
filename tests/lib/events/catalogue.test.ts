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
        'connector.broken',
        'connector.recovered',
        'gmail.inbound',
        'health.summary_changed',
        'intel.alert',
        'news.item',
        'notification.raised',
        'whatsapp.inbound',
        'whoop_recovery_updated',
        'workflow.completed',
      ].sort(),
    );
  });

  it('reads the old workflow_completed name as workflow.completed', () => {
    expect(canonicalEventType('workflow_completed')).toBe('workflow.completed');
    expect(isKnownEventType('workflow_completed')).toBe(true);
    expect(eventEntry('workflow_completed')?.type).toBe('workflow.completed');
  });

  it('does not invent an unknown type', () => {
    expect(isKnownEventType('made.up')).toBe(false);
    expect(eventEntry('made.up')).toBeNull();
  });
});
