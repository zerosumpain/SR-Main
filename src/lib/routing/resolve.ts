// Request-path entry point used by /api/jkai/routing/resolve. Classifies the
// query, resolves the profile's model, records the decision, and returns the
// pick for the client to apply (via the existing switchModel path). Cheap and
// best-effort — never blocks the chat on a failure.
import { classifyQuery, type ClassifyInput } from './classify';
import { isRoutingEnabled, resolveModelForProfile, recordRoutingDecision } from './events';
import { PROFILE_LABEL, type ModelProfile } from './types';

export interface ResolveResult {
  enabled: boolean;
  profile: ModelProfile;
  profileLabel: string;
  provider: 'openrouter';
  modelId: string | null;
  reason: string;
}

export async function resolveRouting(
  input: ClassifyInput & { conversationId?: string | null },
): Promise<ResolveResult> {
  const { profile, reason } = classifyQuery(input);
  const base = { profile, profileLabel: PROFILE_LABEL[profile], provider: 'openrouter' as const, reason };

  if (!(await isRoutingEnabled())) {
    return { ...base, enabled: false, modelId: null };
  }

  const ctx = await resolveModelForProfile(profile);
  if (input.conversationId) {
    try {
      await recordRoutingDecision({ conversationId: input.conversationId, profile, modelId: ctx.modelId });
    } catch {
      /* recording is best-effort — never fail the resolve */
    }
  }
  return { ...base, enabled: true, modelId: ctx.modelId };
}
