import type { ModelProvider } from '$lib/server/models/types';

/**
 * The `/model` command that tells Hermes which model to use for a chat session.
 *
 * Hermes owns the actual chat turn — the site's conversation row is for cost
 * accounting — so this string is what genuinely switches the model the user is
 * talking to. Lives here rather than inline in ChatArea so the contract with
 * Hermes is unit-testable; getting either half wrong fails silently, with the
 * picker appearing to work while chat answers on the old model.
 *
 * THE PROVIDER. Chat reaches Codex through Hermes' own native `openai-codex`
 * profile — the Responses API, authenticated by the Codex OAuth login — and
 * NOT through our jkai-codex-bridge. That distinction is the whole reason chat
 * can use Codex at all: the native path forwards tool schemas
 * (`agent/transports/codex.py::convert_tools`), while the bridge drives the
 * Codex CLI, which has no way to accept them. Hermes without tools is not
 * Hermes, so chat must never be pointed at the bridge.
 *
 * THE MODEL ID. Our ids carry a `codex/` prefix so the provider is recoverable
 * from the id alone; Hermes wants the bare slug.
 */
export function hermesModelCommand(provider: ModelProvider, modelId: string): string {
  if (provider === 'codex') {
    return `/model ${modelId.replace(/^codex\//, '')} --provider openai-codex`;
  }
  return `/model ${modelId} --provider openrouter`;
}
