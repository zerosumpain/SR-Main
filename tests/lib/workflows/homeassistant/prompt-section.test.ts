import { describe, it, expect } from 'vitest';
import { buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';

/**
 * The entity summary carries NAMES ONLY — `buildEntitySummary` pushes
 * `friendly_name` and nothing else. The model was reading that list and
 * answering questions about current readings from it, without ever calling a
 * tool: "the House Temperature data source is marked operational" is a sentence
 * about an entity NAME, not a temperature.
 *
 * So the section has to say, in the prompt itself, that the list has no values.
 */
const entities = [
  { entity_id: 'sensor.hallway_temperature', friendly_name: 'Hallway Temperature', domain: 'sensor', area_name: 'Hall', state: 'unavailable' },
  { entity_id: 'sensor.echo_temperature', friendly_name: 'Echo Temperature', domain: 'sensor', area_name: 'Study', state: '20.8' },
] as never[];

describe('buildHASystemPromptSection', () => {
  const section = buildHASystemPromptSection(entities);

  it('is empty when there are no entities', () => {
    expect(buildHASystemPromptSection([] as never[])).toBe('');
  });

  it('states plainly that the index carries no readings', () => {
    expect(section).toMatch(/INDEX OF NAMES ONLY/);
    expect(section).toMatch(/no readings|no states|no values/i);
  });

  it('requires a tool call for any current value', () => {
    expect(section).toMatch(/MUST call ha_query_state/);
    expect(section).toMatch(/[Nn]ever infer a reading/);
  });

  it('tells it to look for an alternative when an entity is unavailable', () => {
    // Two of John's four temperature sensors are dead; two read fine. Reporting
    // only the dead one is technically true and useless.
    expect(section).toMatch(/another entity covers the same thing/);
  });

  it('still carries the entity names and the exact-id instruction', () => {
    expect(section).toContain('Hallway Temperature');
    expect(section).toContain('Echo Temperature');
    expect(section).toMatch(/exact entity_id/);
  });

  it('does NOT leak cached states into the prompt', () => {
    // If it ever did, the model would answer from a snapshot instead of querying.
    expect(section).not.toContain('20.8');
    expect(section).not.toMatch(/state.*unavailable/i);
  });
});
