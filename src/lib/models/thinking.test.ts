import { describe, it, expect } from 'vitest';
import {
  THINKING_LEVELS,
  isThinkingLevel,
  thinkingLevelsFor,
  supportsThinking,
  thinkingRequestParams,
} from './thinking';

describe('thinking levels', () => {
  it('only accepts levels from the ladder', () => {
    for (const lv of THINKING_LEVELS) expect(isThinkingLevel(lv)).toBe(true);
    for (const junk of ['HIGH', 'auto', '', null, undefined, 3]) {
      expect(isThinkingLevel(junk)).toBe(false);
    }
  });

  it('offers each provider only the levels it honours', () => {
    // No "off" for Codex (its agent always reasons) and no "minimal" (the
    // GPT-5.6 line 400s on it); no OpenAI-only spellings for OpenRouter.
    expect(thinkingLevelsFor('codex')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(thinkingLevelsFor('openrouter')).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('offers the deep rungs only on the Codex models that have them', () => {
    // Astra reasons to `ultra`, Luna stops at `max`, and 5.5 predates both.
    expect(thinkingLevelsFor('codex', 'codex/gpt-6-astra')).toContain('ultra');
    expect(thinkingLevelsFor('codex', 'codex/gpt-5.6-luna')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(thinkingLevelsFor('codex', 'codex/gpt-5.5')).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('takes a bare slug as readily as a prefixed id', () => {
    expect(thinkingLevelsFor('codex', 'gpt-6-astra')).toEqual(
      thinkingLevelsFor('codex', 'codex/gpt-6-astra'),
    );
  });

  it('is conservative about a model it has never heard of', () => {
    // An uncatalogued slug must not be offered an effort that 400s, and the
    // no-modelId call is every caller that predates the per-model ceiling.
    const conservative = ['low', 'medium', 'high', 'xhigh'];
    expect(thinkingLevelsFor('codex', 'codex/gpt-9-nova')).toEqual(conservative);
    expect(thinkingLevelsFor('codex', null)).toEqual(conservative);
  });

  it('never offers the deep rungs on OpenRouter, model or no model', () => {
    expect(thinkingLevelsFor('openrouter', 'codex/gpt-6-astra')).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });
});

describe('supportsThinking', () => {
  it('gates OpenRouter models on the catalogue, not a hand-kept list', () => {
    expect(supportsThinking('openrouter', { supported_parameters: ['tools', 'reasoning'] })).toBe(true);
    expect(supportsThinking('openrouter', { supported_parameters: ['tools', 'temperature'] })).toBe(false);
  });

  it('does not read reasoning_effort as the gate', () => {
    // 83 catalogue rows advertise `reasoning_effort` against 206 that advertise
    // `reasoning` — and Claude is in the second group only. Gating on the
    // narrow field would hide the chip on every Anthropic model.
    expect(supportsThinking('openrouter', { supported_parameters: ['reasoning_effort'] })).toBe(false);
  });

  it('survives a model the catalogue has never heard of', () => {
    expect(supportsThinking('openrouter', null)).toBe(false);
    expect(supportsThinking('openrouter', {})).toBe(false);
    expect(supportsThinking('openrouter', { supported_parameters: 'reasoning' })).toBe(false);
  });

  it('needs no catalogue row for Codex', () => {
    expect(supportsThinking('codex', null)).toBe(true);
  });
});

describe('thinkingRequestParams', () => {
  it('sends nothing when no level is set', () => {
    expect(thinkingRequestParams('openrouter', null)).toEqual({});
    expect(thinkingRequestParams('codex', undefined)).toEqual({});
  });

  it('uses OpenRouter’s unified reasoning object', () => {
    expect(thinkingRequestParams('openrouter', 'high')).toEqual({ reasoning: { effort: 'high' } });
    expect(thinkingRequestParams('openrouter', 'low')).toEqual({ reasoning: { effort: 'low' } });
  });

  it('turns reasoning off rather than sending an effort of nothing', () => {
    expect(thinkingRequestParams('openrouter', 'off')).toEqual({ reasoning: { enabled: false } });
  });

  it('clamps the OpenAI-only spellings onto OpenRouter’s enum', () => {
    expect(thinkingRequestParams('openrouter', 'minimal')).toEqual({ reasoning: { effort: 'low' } });
    expect(thinkingRequestParams('openrouter', 'xhigh')).toEqual({ reasoning: { effort: 'high' } });
    // The OpenAI-only rungs above xhigh collapse the same way rather than
    // reaching OpenRouter as an effort its unified enum has never heard of.
    expect(thinkingRequestParams('openrouter', 'max')).toEqual({ reasoning: { effort: 'high' } });
    expect(thinkingRequestParams('openrouter', 'ultra')).toEqual({ reasoning: { effort: 'high' } });
  });

  it('speaks reasoning_effort to the Codex bridge', () => {
    expect(thinkingRequestParams('codex', 'xhigh')).toEqual({ reasoning_effort: 'xhigh' });
    expect(thinkingRequestParams('codex', 'medium')).toEqual({ reasoning_effort: 'medium' });
  });

  it('keeps a Codex turn off the two efforts GPT-5.6 rejects', () => {
    // A thread pinned to an OpenRouter model at "off" and then switched to
    // Codex must not 400 every turn with "Unsupported value: 'minimal'".
    expect(thinkingRequestParams('codex', 'off')).toEqual({ reasoning_effort: 'low' });
    expect(thinkingRequestParams('codex', 'minimal')).toEqual({ reasoning_effort: 'low' });
  });

  it('sends the deep rungs through when the model has them', () => {
    expect(thinkingRequestParams('codex', 'ultra', 'codex/gpt-6-astra')).toEqual({
      reasoning_effort: 'ultra',
    });
    expect(thinkingRequestParams('codex', 'max', 'codex/gpt-5.6-luna')).toEqual({
      reasoning_effort: 'max',
    });
  });

  it('clamps a level the chosen Codex model cannot reach', () => {
    // The failure this exists for: a thread set to `ultra` on Astra and then
    // pointed at Luna, which answers `ultra` with a 400 rather than with less
    // thinking. Same for a model that predates both rungs.
    expect(thinkingRequestParams('codex', 'ultra', 'codex/gpt-5.6-luna')).toEqual({
      reasoning_effort: 'max',
    });
    expect(thinkingRequestParams('codex', 'ultra', 'codex/gpt-5.5')).toEqual({
      reasoning_effort: 'xhigh',
    });
    // No model named: the conservative ceiling, as for every caller that has
    // not been taught to pass one.
    expect(thinkingRequestParams('codex', 'ultra')).toEqual({ reasoning_effort: 'xhigh' });
  });
});
