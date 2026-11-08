import { setReplyCodeToolRuntime } from '$lib/integrations/whatsapp/reply-code-port';
import { callTier } from './declared-tier';
import { executeSiteTool } from './executor';
import { unattendedPrincipal } from './in-process-principal';
import { loadToolRegistry } from './load-registry';

/**
 * The tool catalogue's half of the WhatsApp reply-code port
 * (`$lib/integrations/whatsapp/reply-code-port`), registered from
 * `src/hooks.server.ts` so the integration never imports the tools back.
 */
export function registerReplyCodeToolRuntime(): void {
  setReplyCodeToolRuntime({
    async tierOf(tool, args) {
      const def = (await loadToolRegistry()).getTool(tool);
      return def ? callTier(def, args) : null;
    },
    run(tool, args, conversationId) {
      return executeSiteTool(tool, args, {
        emit: () => {},
        conversationId,
        principal: unattendedPrincipal('whatsapp-reply-code', [tool], 'whatsapp'),
      });
    },
  });
}
