import { describe, it, expect } from 'vitest';
import { inferToolsets } from './keyword-classifier';

/**
 * The classifier is what decides which toolsets are pre-loaded for a turn on
 * the in-process loop. A toolset with no pattern here is not "harder to reach"
 * — it is effectively unreachable, because the model only discovers it by
 * choosing to call `activate_toolset` off its own bat, which it rarely does.
 *
 * `intel-graph`, `decks`, `presentations` and `capabilities` were all in that
 * state: registered, listed in the prompt, never auto-activated.
 */
describe('inferToolsets', () => {
  describe('intel-graph — the entity graph', () => {
    // The turn that exposed this: John asked for a story from "the knowledge
    // graph" and got invented fiction. `knowledge` matched (bare word), so
    // knowledge_search loaded — but the graph walkers never did.
    it('activates on the phrasing that originally failed', () => {
      const got = inferToolsets('tell me something interesting, a short story based on knowledge you already have in the knowledge graph. in rap form.');
      expect(got).toContain('intel-graph');
    });

    // Both, deliberately: the flat recall and the graph walk answer different
    // halves of "what do I know about X".
    it('activates alongside knowledge, not instead of it', () => {
      expect(inferToolsets('what is in my knowledge graph about the Broads?')).toEqual(
        expect.arrayContaining(['knowledge', 'intel-graph']),
      );
    });

    it.each([
      'how are these two entities connected?',
      'show me the dossiers you hold',
      'what relationships have you spotted',
      'find an unlikely connection in the graph',
      'is there a path between Ofsted and the Broads pilot',
    ])('activates on %j', (msg) => {
      expect(inferToolsets(msg)).toContain('intel-graph');
    });
  });

  describe('decks', () => {
    // Both toolsets or neither: the builders take a spec whose vocabulary only
    // presentation_describe_vocabulary can explain.
    it.each(['build me a deck', 'add a slide about funding', 'turn this into a presentation'])(
      'loads both deck toolsets on %j',
      (msg) => {
        expect(inferToolsets(msg)).toEqual(expect.arrayContaining(['decks', 'presentations']));
      },
    );
  });

  describe('capabilities', () => {
    it.each(['what can you do?', 'what are you able to do', 'tell me your capabilities'])(
      'activates on %j',
      (msg) => {
        expect(inferToolsets(msg)).toContain('capabilities');
      },
    );
  });

  // Guard on the other side: these patterns are broad, and a classifier that
  // fires on everything just pays for tool schemas it never uses.
  it('stays quiet on an unrelated message', () => {
    const got = inferToolsets('thanks, that looks great');
    for (const ts of ['intel-graph', 'decks', 'presentations', 'capabilities']) {
      expect(got).not.toContain(ts);
    }
  });

  it('does not regress the patterns that already worked', () => {
    expect(inferToolsets('how did I sleep last night')).toContain('health');
    expect(inferToolsets('turn the kitchen lights off')).toContain('home');
    expect(inferToolsets('check my inbox')).toContain('gmail');
  });
});
