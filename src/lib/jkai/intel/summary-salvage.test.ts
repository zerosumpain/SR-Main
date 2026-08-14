import { describe, it, expect } from 'vitest';
import { salvageSummaries } from './summary-salvage';

describe('salvageSummaries', () => {
  it('reads a well-formed response', () => {
    const raw = JSON.stringify({
      summaries: [
        { id: 'a', summary: 'First.' },
        { id: 'b', summary: 'Second.' },
      ],
    });
    expect(salvageSummaries(raw)).toEqual([
      { id: 'a', summary: 'First.' },
      { id: 'b', summary: 'Second.' },
    ]);
  });

  it('recovers the completed entries from a response cut off mid-string', () => {
    // The production failure: finish_reason=length, so the JSON simply stops.
    // Everything before the cut is perfectly good and was being thrown away.
    const raw =
      '{"summaries":[{"id":"a","summary":"First one, complete."},' +
      '{"id":"b","summary":"Second one, complete."},' +
      '{"id":"c","summary":"Third one, cut off half way thro';
    expect(salvageSummaries(raw)).toEqual([
      { id: 'a', summary: 'First one, complete.' },
      { id: 'b', summary: 'Second one, complete.' },
    ]);
  });

  it('is not fooled by braces or brackets inside a summary', () => {
    const raw = JSON.stringify({
      summaries: [
        { id: 'a', summary: 'Mentions {braces} and [brackets] and a "quote".' },
        { id: 'b', summary: 'Plain.' },
      ],
    });
    expect(salvageSummaries(raw)).toEqual([
      { id: 'a', summary: 'Mentions {braces} and [brackets] and a "quote".' },
      { id: 'b', summary: 'Plain.' },
    ]);
  });

  it('handles an escaped backslash at the end of a summary', () => {
    const raw = JSON.stringify({ summaries: [{ id: 'a', summary: 'ends with a backslash \\' }] });
    expect(salvageSummaries(raw)).toEqual([{ id: 'a', summary: 'ends with a backslash \\' }]);
  });

  it('strips a fenced code block', () => {
    const raw = '```json\n{"summaries":[{"id":"a","summary":"Fenced."}]}\n```';
    expect(salvageSummaries(raw)).toEqual([{ id: 'a', summary: 'Fenced.' }]);
  });

  it('ignores a preamble before the object', () => {
    const raw = 'Here you go:\n{"summaries":[{"id":"a","summary":"After a preamble."}]}';
    expect(salvageSummaries(raw)).toEqual([{ id: 'a', summary: 'After a preamble.' }]);
  });

  it('drops entries missing an id or a summary', () => {
    const raw = '{"summaries":[{"id":"a"},{"summary":"no id"},{"id":"b","summary":"Good."}]}';
    expect(salvageSummaries(raw)).toEqual([{ id: 'b', summary: 'Good.' }]);
  });

  it('drops an entry whose summary is only whitespace', () => {
    const raw = '{"summaries":[{"id":"a","summary":"   "},{"id":"b","summary":"Good."}]}';
    expect(salvageSummaries(raw)).toEqual([{ id: 'b', summary: 'Good.' }]);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(salvageSummaries('not json at all')).toEqual([]);
    expect(salvageSummaries('')).toEqual([]);
    expect(salvageSummaries('{"summaries":')).toEqual([]);
  });

  it('returns nothing when the very first entry is incomplete', () => {
    expect(salvageSummaries('{"summaries":[{"id":"a","summary":"cut')).toEqual([]);
  });

  it('trims surrounding whitespace off a summary', () => {
    const raw = '{"summaries":[{"id":"a","summary":"  padded  "}]}';
    expect(salvageSummaries(raw)).toEqual([{ id: 'a', summary: 'padded' }]);
  });

  it('copes with the array under a different key order', () => {
    const raw = '{"model":"x","summaries":[{"summary":"Reversed fields.","id":"a"}]}';
    expect(salvageSummaries(raw)).toEqual([{ id: 'a', summary: 'Reversed fields.' }]);
  });
});
