import { describe, it, expect } from 'vitest';
import { stripCodeFences } from './ai';

// jsonCompletion tells the model "no markdown, no code blocks" and models ignore
// it often enough that a fenced reply is routine. Before this, a fenced reply
// died in JSON.parse and repairJson (which only balances brackets) could not
// recover it — so the whole call failed. Observed live on a release summary.
describe('stripCodeFences', () => {
  it('unwraps a ```json fence', () => {
    const text = '```json\n{"a":1}\n```';
    expect(JSON.parse(stripCodeFences(text))).toEqual({ a: 1 });
  });

  it('unwraps a bare ``` fence', () => {
    expect(JSON.parse(stripCodeFences('```\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it('tolerates leading and trailing whitespace around the fence', () => {
    expect(JSON.parse(stripCodeFences('\n  ```json\n{"a":1}\n```  \n'))).toEqual({ a: 1 });
  });

  it('leaves unfenced JSON exactly as it was', () => {
    const text = '{"a":1}';
    expect(stripCodeFences(text)).toBe(text);
  });

  it('does not mangle a fence-like sequence inside a JSON string value', () => {
    const text = '{"code":"```js"}';
    expect(JSON.parse(stripCodeFences(text))).toEqual({ code: '```js' });
  });

  it('leaves a truncated fence open for repairJson to close', () => {
    // max_tokens cutoff: opening fence present, closing fence never emitted.
    expect(stripCodeFences('```json\n{"a":1,"b":')).toBe('{"a":1,"b":');
  });
});
