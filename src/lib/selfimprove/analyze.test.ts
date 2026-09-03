import { describe, expect, it } from 'vitest';
import { coerceInsights } from './analyze';

describe('capability portfolio insight coercion', () => {
  it('keeps source, service and site opportunities as first-class work', () => {
    const result = coerceInsights(
      {
        summary: 'Broaden the intelligence portfolio.',
        intents: [],
        topUnmet: [],
        opportunities: [
          {
            title: 'Local transport disruption feed',
            need: 'Daydream cannot relate journeys to live disruption.',
            kind: 'data_source',
            consumer: 'daydream',
            value: 'Explains anomalous travel time.',
            integrationHint: 'Ingest a stable official feed into observations.',
          },
          {
            title: 'Bad shape',
            need: 'Missing a valid kind.',
            kind: 'widget',
            consumer: 'jkai',
            value: 'None',
          },
        ],
      },
      '2026-36',
    );

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities?.[0]).toMatchObject({
      kind: 'data_source',
      consumer: 'daydream',
    });
  });
});
