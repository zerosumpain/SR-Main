import { describe, expect, it } from 'vitest';
import { composeHeuristic } from './compose-heuristic';
import { validateBlocks } from './registry';
import { isLayout } from './layouts';

function assertValid(slide: { layout: string; blocks: unknown }) {
  expect(isLayout(slide.layout), `layout ${slide.layout}`).toBe(true);
  const res = validateBlocks(slide.blocks);
  expect(res.issues).toEqual([]);
}

describe('composeHeuristic', () => {
  it('short punchy line → statement quote', () => {
    const s = composeHeuristic({ text: 'Move the questions, not the records.', mediaUrls: [] });
    expect(s.layout).toBe('statement');
    expect(s.blocks[0]).toMatchObject({ type: 'quote' });
    assertValid(s);
  });

  it('number-led one-liner → statement bigNumber', () => {
    const s = composeHeuristic({ text: '24,000 schools connected to the spine', mediaUrls: [] });
    expect(s.layout).toBe('statement');
    expect(s.blocks[0]).toMatchObject({ type: 'bigNumber', value: 24000 });
    assertValid(s);
  });

  it('stat lines → statRow grid', () => {
    const s = composeHeuristic({
      text: 'The estate\n15 — MIS suppliers\n24,000 — state schools\n28m — people in the NPD\nEvery school already keeps its register in a management information system, and the question is custody.',
      mediaUrls: [],
    });
    expect(s.title).toBe('The estate');
    const statRow = s.blocks.find((b) => (b as { type: string }).type === 'statRow');
    expect(statRow).toBeTruthy();
    expect((statRow as { stats: unknown[] }).stats).toHaveLength(3);
    assertValid(s);
  });

  it('image + long text → split with image', () => {
    const s = composeHeuristic({
      text: 'The federation answers questions without moving records. Each supplier estate holds its own data and returns aggregates to the exchange, which stamps every ask on the audit ledger for anyone to read.',
      mediaUrls: ['https://example.com/diagram.png'],
    });
    expect(s.layout).toBe('split');
    expect(s.blocks.some((b) => (b as { type: string }).type === 'image')).toBe(true);
    assertValid(s);
  });

  it('image only → full-bleed', () => {
    const s = composeHeuristic({ text: '', mediaUrls: ['/api/files/media/shot.png'] });
    expect(s.layout).toBe('full-bleed');
    expect(s.blocks[0]).toMatchObject({ type: 'image' });
    assertValid(s);
  });

  it('one image + short statement → poster', () => {
    const s = composeHeuristic({
      text: 'The exchange at dawn — records asleep in their estates.',
      mediaUrls: ['https://example.com/hero.jpg'],
    });
    expect(s.layout).toBe('poster');
    expect(s.blocks[0]).toMatchObject({ type: 'image' });
    assertValid(s);
  });

  it('site-relative page link → iframe block', () => {
    const s = composeHeuristic({
      text: 'The live monitor tracks the model against real DfE data, updating as new releases land through the ingest workflows.',
      mediaUrls: ['/projects/policy-engine/monitor'],
    });
    expect(s.blocks.some((b) => (b as { type: string }).type === 'iframe')).toBe(true);
    assertValid(s);
  });

  it('long prose → lede + prose, default layout', () => {
    const s = composeHeuristic({
      text: 'Custody is the question the consultation must answer, and it decides everything downstream.\n\nConnect the estates with a query fabric and refusals stay local; collect them into a store and every future breach is national. The history of ContactPoint says which way the public leans.',
      mediaUrls: [],
    });
    expect(s.layout).toBe('default');
    expect(s.blocks[0]).toMatchObject({ type: 'prose', lede: true });
    assertValid(s);
  });
});
