import { describe, it, expect } from 'vitest';
import { hermesModelCommand } from './hermes-model-command';

describe('hermesModelCommand', () => {
  it('sends Codex picks to Hermes native openai-codex provider, not the bridge', () => {
    // The bridge cannot forward tool schemas; Hermes' native Responses path
    // can. Pointing chat at the bridge would silently cost Hermes its tools.
    expect(hermesModelCommand('codex', 'codex/gpt-5.6-terra')).toBe(
      '/model gpt-5.6-terra --provider openai-codex',
    );
  });

  it('strips our codex/ prefix — Hermes wants the bare slug', () => {
    expect(hermesModelCommand('codex', 'codex/gpt-5.6-luna')).not.toContain('codex/gpt');
  });

  it('tolerates an already-bare codex slug', () => {
    expect(hermesModelCommand('codex', 'gpt-5.6-luna')).toBe(
      '/model gpt-5.6-luna --provider openai-codex',
    );
  });

  it('leaves OpenRouter picks on openrouter with the full slug', () => {
    // The regression this guards: --provider was hardcoded to openrouter, so a
    // Codex pick told Hermes "openrouter" alongside an id it has never heard of.
    expect(hermesModelCommand('openrouter', 'deepseek/deepseek-v4-flash')).toBe(
      '/model deepseek/deepseek-v4-flash --provider openrouter',
    );
  });
});
