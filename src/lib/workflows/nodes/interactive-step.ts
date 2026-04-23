import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { startInteractiveSession } from '$lib/workflows/scraper/interactive';
import { createInteraction } from '$lib/workflows/engine-interactions';

export { interactiveStepDef } from './interactive-step.def';

type Mode = 'vnc' | 'confirm' | 'both';

export const interactiveStepExecutor: NodeExecutor = {
  type: 'interactive-step',

  async execute(input, config, context): Promise<NodeResult> {
    // Reject unknown modes up-front: a typo like "browse" used to slip
    // through, skip the VNC branch, and then pause the run with an
    // interaction record that had no session to connect to — a zombie.
    const rawMode = config.mode;
    const validModes: Mode[] = ['vnc', 'confirm', 'both'];
    if (typeof rawMode !== 'string' || !(validModes as string[]).includes(rawMode)) {
      throw new Error(
        `interactive-step: mode must be one of ${validModes.join(', ')} (got ${JSON.stringify(rawMode)}). For CAPTCHA/login use mode="vnc" with profile + url.`,
      );
    }
    const mode = rawMode as Mode;
    const prompt = (config.prompt as string) || 'Please complete the required action';
    const timeoutMinutes = (config.timeoutMinutes as number) || 60;

    // VNC launch (if needed)
    let vncSessionId: string | undefined;
    let resolvedUrl = '';
    if (mode === 'vnc' || mode === 'both') {
      const profile = (config.profile as string) || '';
      if (!profile) throw new Error('interactive-step: profile is required for vnc / both mode');
      resolvedUrl = interpolateTemplateStrict((config.url as string) || '', input as Record<string, unknown>).result;
      if (!resolvedUrl) {
        throw new Error(
          `interactive-step: url is required for mode="${mode}". Without a url the headed browser opens on about:blank and the human has no CAPTCHA to solve.`,
        );
      }
      const session = await startInteractiveSession(profile, resolvedUrl);
      if (!session?.sessionId) {
        throw new Error(
          `interactive-step: startInteractiveSession returned no sessionId for profile=${profile}. Refusing to pause without a VNC session the human can connect to.`,
        );
      }
      vncSessionId = session.sessionId;
    }

    // Interpolate defaultValueTemplate on each field (for confirm / both) so the form
    // can pre-populate from upstream input.
    const fields = ((config.fields as any[]) || []).map((f) => {
      const defaultValueTemplate = (f.defaultValueTemplate as string) || '';
      const defaultValue = defaultValueTemplate
        ? interpolateTemplateStrict(defaultValueTemplate, input as Record<string, unknown>).result
        : '';
      return { ...f, defaultValue };
    });

    const interactionId = await createInteraction({
      runId: (context as any).runId,
      nodeId: (context as any)._currentNodeId ?? '',
      mode,
      prompt,
      configSnapshot: { url: resolvedUrl, fields },
      vncSessionId,
      timeoutMinutes,
    });

    return {
      output: {},
      pause: { reason: 'awaiting_human', interactionId },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in url and field defaults' };
  },
  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        completed: { type: 'boolean' },
        completedAt: { type: 'string' },
        formValues: { type: 'object' },
        durationMs: { type: 'number' },
      },
    };
  },
};
