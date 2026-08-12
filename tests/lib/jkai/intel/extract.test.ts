import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: vi.fn(),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'test' }),
}));
// Extraction resolves its own model — a deliberate carve-out from the site-wide
// single default, now declared in $lib/models/workloads and resolved here.
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveExtractionModel: vi.fn().mockResolvedValue({ provider: 'openrouter', modelId: 'test' }),
}));
vi.mock('$lib/db', () => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({
    then: (resolve: (v: unknown[]) => void) => resolve([]),
    where: mockWhere,
  });
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
    },
  };
});
vi.mock('$lib/db/schema', () => ({
  intelEntities: { id: 'id', name: 'name', typeId: 'type_id', mergedIntoId: 'merged_into_id' },
  intelEntityTypes: { name: 'name' },
}));

import { extractFromNote } from '$lib/jkai/intel/extract';
import { getLLMClient } from '$lib/jkai/llm-client';

const MOCK_EXTRACTION = {
  summary: 'Met with Sarah to discuss platform migration timeline.',
  entities: [
    { name: 'Sarah Chen', type: 'person', confidence: 'high', properties: { role: 'Engineering Lead' }, possibleMatchId: null },
    { name: 'Platform Migration', type: 'project', confidence: 'high', properties: {}, possibleMatchId: null },
  ],
  relationships: [
    { source: 'Sarah Chen', target: 'Platform Migration', type: 'stakeholder_in', label: 'Key stakeholder', confidence: 'high' },
  ],
  timelineEvents: [
    { date: '2026-05-01', type: 'deadline', title: 'Q3 planning kickoff', linkedEntity: 'Platform Migration' },
  ],
  proposedNewTypes: [],
};

let lastCreate: ReturnType<typeof vi.fn>;

function mockLLMResponse(content: string) {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  lastCreate = mockCreate;
  vi.mocked(getLLMClient).mockResolvedValue({
    client: { chat: { completions: { create: mockCreate } } } as any,
    model: 'test-model',
  });
}

/** Successive responses, for exercising the parse-failure retry. The last entry
 *  is reused if the code asks for more attempts than were supplied. */
function mockLLMResponses(contents: string[]) {
  const mockCreate = vi.fn();
  for (const content of contents) {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
  }
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: contents[contents.length - 1] ?? '' } }],
  });
  lastCreate = mockCreate;
  vi.mocked(getLLMClient).mockResolvedValue({
    client: { chat: { completions: { create: mockCreate } } } as any,
    model: 'test-model',
  });
}

describe('extractFromNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid LLM extraction response', async () => {
    mockLLMResponse(JSON.stringify(MOCK_EXTRACTION));

    const result = await extractFromNote('Met with Sarah Chen about the platform migration.', 'text');

    expect(result.summary).toBe('Met with Sarah to discuss platform migration timeline.');
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('Sarah Chen');
    expect(result.relationships).toHaveLength(1);
    expect(result.timelineEvents).toHaveLength(1);
    expect(result.timelineEvents[0].date).toBe('2026-05-01');
  });

  it('throws on unparseable output rather than returning an empty extraction', async () => {
    // This used to resolve to `{summary:'', entities:[], relationships:[]}`,
    // which the caller could not tell apart from "this note contains nothing" —
    // so the note was marked `processed` and the thread silently learned
    // nothing. Two of six production extractions hit this on 2026-07-27.
    // Failing loudly is what lets extractIntoIntel mark the note `failed`.
    mockLLMResponse('not json at all');

    await expect(extractFromNote('some note', 'text')).rejects.toThrow(/unparseable/i);
  });

  it('retries once before giving up, and uses the retry when it parses', async () => {
    mockLLMResponses(['not json at all', JSON.stringify(MOCK_EXTRACTION)]);

    const result = await extractFromNote('some note', 'text');

    expect(lastCreate).toHaveBeenCalledTimes(2);
    expect(result.entities).toHaveLength(2);
  });

  it('strips markdown fences from response', async () => {
    mockLLMResponse('```json\n' + JSON.stringify(MOCK_EXTRACTION) + '\n```');

    const result = await extractFromNote('test note', 'text');
    expect(result.entities).toHaveLength(2);
  });

  it('recovers the object when the model adds a preamble before the fence', async () => {
    // The exact production failure: the old cleanup stripped the fence and left
    // the prose, so JSON.parse threw on otherwise perfect output.
    mockLLMResponse('Here is the JSON:\n```json\n' + JSON.stringify(MOCK_EXTRACTION) + '\n```');

    const result = await extractFromNote('test note', 'text');
    expect(result.entities).toHaveLength(2);
    expect(lastCreate).toHaveBeenCalledTimes(1); // recovered by parsing, no retry needed
  });
});

describe('extraction request shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks OpenRouter to route on throughput, not price', async () => {
    // ER is the one call a user waits on with no output on screen. Default
    // routing picks the cheapest endpoint; measured, that cost ~2x the latency
    // of the throughput-sorted one for identical extraction quality.
    mockLLMResponse(JSON.stringify(MOCK_EXTRACTION));
    await extractFromNote('Some note text', 'markdown');

    const body = lastCreate.mock.calls[0][0] as { provider?: { sort?: string } };
    expect(body.provider).toEqual({ sort: 'throughput' });
  });

  it('still sends JSON mode and both prompt roles', async () => {
    mockLLMResponse(JSON.stringify(MOCK_EXTRACTION));
    await extractFromNote('Some note text', 'markdown');

    const body = lastCreate.mock.calls[0][0] as {
      response_format?: { type?: string };
      messages?: Array<{ role: string }>;
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages?.map((m) => m.role)).toEqual(['system', 'user']);
  });
});
