import { describe, expect, it } from 'vitest';
import { OBSERVATION_LIMITS, boundObservation, parseCheckOutput, pushBounded, reviewScreenshotChoice } from '../../scripts/development-preview-check.mjs';

// What the broker's browser check adds beyond page text, and the bounds that
// keep it inside the 8MB stdout the broker buffers and the reviewer's prompt.
describe('preview observations', () => {
  it('caps console and request lists at source, collapsing whitespace', () => {
    const list: string[] = [];
    for (let i = 0; i < 25; i++) pushBounded(list, `Error ${i}\n   at somewhere ${'x'.repeat(400)}`);
    pushBounded([], '   ');
    expect(list).toHaveLength(OBSERVATION_LIMITS.messages);
    expect(list[0]).toMatch(/^Error 0 at somewhere x+$/);
    expect(list[0].length).toBe(OBSERVATION_LIMITS.message);
  });

  it('bounds the outline and keeps only a well-formed JPEG or one of our own file names', () => {
    const shot = { mediaType: 'image/jpeg', base64: Buffer.from('jpeg bytes').toString('base64') };
    const o = boundObservation({ width: 390, route: '/feature', text: 'Saved', outline: '- heading "A"\n'.repeat(400), consoleErrors: ['boom'], failedRequests: 'not a list', screenshot: shot });
    expect(o.outline.length).toBeLessThan(OBSERVATION_LIMITS.outline + 40);
    expect(o.outline).toMatch(/outline truncated/);
    expect(o).toMatchObject({ width: 390, consoleErrors: ['boom'], failedRequests: [], screenshot: shot });
    expect(boundObservation({ screenshot: '0-390.jpg' }).screenshot).toBe('0-390.jpg');
    for (const screenshot of ['../../etc/passwd', { mediaType: 'image/svg+xml', base64: 'PHN2Zz4=' }, { mediaType: 'image/jpeg', base64: 'not base64!' },
      { mediaType: 'image/jpeg', base64: 'A'.repeat(OBSERVATION_LIMITS.screenshotBytes * 2) }]) {
      expect(boundObservation({ screenshot }).screenshot).toBeUndefined();
    }
  });

  it('reads the old bare-array output as evidence with no observations', () => {
    expect(parseCheckOutput('["1440px: /a — passed"]')).toEqual({ evidence: ['1440px: /a — passed'], observations: [] });
    const parsed = parseCheckOutput(JSON.stringify({ evidence: ['e'], observations: Array.from({ length: 40 }, (_, i) => ({ width: 1440, route: `/r${i}`, text: 't', consoleErrors: [], failedRequests: [], outline: '' })) }));
    expect(parsed.observations).toHaveLength(24);
    expect(() => parseCheckOutput('{"observations":[]}')).toThrow(/no evidence/);
  });

  it('gives the reviewer the first screenshot at each width, at most two', () => {
    const at = (width: number, route: string, screenshot?: string) => ({ width, route, text: 't', screenshot });
    const chosen = reviewScreenshotChoice([at(1440, '/a'), at(1440, '/b', '1.jpg'), at(1440, '/c', '2.jpg'), at(390, '/a', '3.jpg'), at(390, '/b', '4.jpg')]);
    expect(chosen.map(o => o.route)).toEqual(['/b', '/a']);
    expect(chosen.map(o => o.width)).toEqual([1440, 390]);
    expect(reviewScreenshotChoice([at(1440, '/a', '1.jpg')], 0)).toEqual([]);
  });
});
