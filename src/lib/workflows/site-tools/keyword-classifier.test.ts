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

  describe('money words route to the API register, not the inbox', () => {
    // 2026-08-16: "i recently paid for vpn services through paypal, what was
    // the company called?" matched NOTHING money-shaped, so `apis` never
    // pre-loaded. `gmail` did (via \\bemails?\\b on later turns), and the turn
    // spent fourteen Gmail searches answering from a 2018 receipt — wrongly —
    // while `api_integration_call('paypal-transactions')` sat one call away.
    it('activates on the question that originally failed', () => {
      expect(inferToolsets('i recently paid for vpn services through paypal, what was the company called?')).toContain('apis');
    });

    it('activates on the vocabulary of a payment question', () => {
      for (const q of [
        'find the receipt for that',
        'what subscriptions am I paying for',
        'show me the transactions from last week',
        'did I get a refund',
        'which invoices are outstanding',
        'what direct debits go out this month',
        'pull my bank statements',
        'what was that charge for',
        'check my billing',
      ]) {
        expect(inferToolsets(q), q).toContain('apis');
      }
    });

    it('does not fire on the ordinary English that shares those stems', () => {
      // `\\bpay\\b` is deliberately not in the pattern: these are prose, and
      // loading a toolset on them is a tax on every unrelated turn.
      for (const q of [
        'pay attention to the spacing on that page',
        'it pays to check the logs first',
        'can you pay off the technical debt in this module',
      ]) {
        expect(inferToolsets(q), q).not.toContain('apis');
      }
    });
  });

  it('does not regress the patterns that already worked', () => {
    expect(inferToolsets('how did I sleep last night')).toContain('health');
    expect(inferToolsets('turn the kitchen lights off')).toContain('home');
    expect(inferToolsets('check my inbox')).toContain('gmail');
  });
});
