/**
 * The platform services this process boots: the WhatsApp service (delegated to
 * the worker unless this IS the worker), the owner-notification channel it
 * fills, and Home Assistant.
 *
 * Imported for its side effects by hooks.server.ts (the web process) and by
 * packages/jkai-wa-worker. It used to live in the workflows barrel, which meant
 * booting WhatsApp also registered every workflow node executor in a process
 * that runs no workflows; SR-Workflows owns those.
 */
import { getWhatsAppService } from './whatsapp/service';
import { ownerPhone } from '$lib/config/owner';
import { registerNotificationChannel } from '$lib/server/notify';
import { registerFollowupWhatsAppSender } from '$lib/jkai/chat/whatsapp-sender';
import { OrchestratorBridge } from './whatsapp/orchestrator-bridge';
import { db } from '$lib/db';
import { whatsappConfig, homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { initHomeAssistantService } from './homeassistant/service';
import { runsService, ownsWhatsAppSession } from '$lib/server/service-role';
import { whatsappBridgeUrl } from '$lib/config/whatsapp-bridge';

// Boot WhatsApp service if enabled.
//
// Delegated mode: when a bridge URL is set, every outbound send POSTs to the
// process that owns the session (packages/jkai-wa-worker on the VPS) instead of
// running our own Baileys.
async function bootWhatsApp() {
  // Delegation is ONE rule, and it lives in service-role. Reading the env var
  // directly here is what broke the cutover: the WhatsApp worker owns the
  // session, so `WhatsAppService` correctly refused to delegate and paired —
  // but this line still said "delegated", so the OrchestratorBridge was never
  // wired and inbound messages went nowhere. Outbound worked, which made it
  // look fine.
  const delegated = !!whatsappBridgeUrl() && !ownsWhatsAppSession();

  try {
    const [config] = await db
      .select()
      .from(whatsappConfig)
      .where(eq(whatsappConfig.id, 'default'))
      .limit(1);

    // In delegated mode we always boot the service (with no Baileys) so that
    // outbound sends route through the bridge regardless of the legacy
    // `enabled` flag. Otherwise honour the flag.
    if (!delegated && !config?.enabled) {
      console.log('[whatsapp] Not enabled — skipping boot');
      return;
    }

    const service = getWhatsAppService();
    if (config?.allowedNumbers) {
      service.setAllowedNumbers(config.allowedNumbers as string[]);
    }

    if (!delegated) {
      const bridge = new OrchestratorBridge(
        (to, text) => service.sendMessage(to, text),
        {
          sendAttachmentFn: (to, att, caption) => service.sendAttachment(to, att, caption),
          typingFn: (to) => service.sendTyping(to),
          typingDoneFn: (to) => service.sendTypingDone(to),
        },
      );
      service.onMessage((msg) => bridge.handleMessage(msg));
    }

    await service.connect(config?.authDir || 'data/whatsapp-auth');

    console.log(`[whatsapp] Service booted${delegated ? ' (delegated → WhatsApp worker)' : ''}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[whatsapp] Boot failed:', msg);
  }
}

// Network-/timer-side-effect boots only run in the SvelteKit web app, not
// the jkai-builder sidecar. Both processes import this module (the builder
// pulls $lib/workflows transitively via the orchestrator's planner +
// site-tools deps), but only one process should hold the WhatsApp socket,
// the workflow scheduler, the engine reaper, etc. The builder sets
// JKAI_BUILDER_PROCESS=1 in its systemd unit; the SvelteKit web app does
// not, so it picks these up.
// Which of these this process owns is now a ROLE rather than a boolean — see
// $lib/server/service-role. The old flag could only answer "am I the
// builder?", so a process wanting the WhatsApp socket and nothing else would
// also have started the scheduler, and two schedulers on one database fires
// every cron twice.
if (runsService('whatsapp')) bootWhatsApp();

// Fill the notifier's WhatsApp slot.
//
// `$lib/server/notify` is the platform layer and may not know what a WhatsApp
// service is; this module is a domain and may. So the dependency points down,
// which is the direction `check-module-boundaries` requires and also the one
// that makes the notifier testable without a Baileys client.
//
// Registered UNCONDITIONALLY, not behind `runsService('whatsapp')`. The service
// delegates to the worker when this process does not hold the socket, and that
// delegation is the whole point — gating registration on owning the socket
// would silence WhatsApp everywhere except the one process that happens to be
// paired.
//
// No `state.status` check. In delegated mode that value is a boot-time probe
// that is never refreshed, so any VPS restart during an outage — a CI deploy
// counts — pinned the channel off permanently. Attempt the send; the result is
// the truth.
// The follow-up queue's direct sends (to the number a follow-up names) go the
// same way: registered here, so chat does not import the WhatsApp integration.
registerFollowupWhatsAppSender((to, text) => getWhatsAppService().sendMessage(to, text));

registerNotificationChannel('whatsapp', async (text) => {
  const to = ownerPhone();
  if (!to) return false;
  try {
    const result = await getWhatsAppService().sendMessage(to, text);
    if (!result.sent) console.error(`[notify] WhatsApp refused a send: ${result.error}`);
    return result.sent;
  } catch (error) {
    console.error('[notify] WhatsApp send threw', error);
    return false;
  }
});

// Boot Home Assistant service if configured
async function bootHomeAssistant() {
  try {
    const [config] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);

    if (!config?.token) {
      console.log('[ha] No token configured — skipping boot');
      return;
    }

    const service = initHomeAssistantService(config.url, config.token);

    // Sync registries if stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    if (!config.lastSynced || new Date(config.lastSynced) < oneHourAgo) {
      try {
        const { entities, areas, entityCount } = await service.syncRegistries();
        await db.update(homeAssistantConfig).set({
          entityRegistry: entities,
          areaRegistry: areas,
          lastSynced: new Date(),
          updatedAt: new Date(),
        }).where(eq(homeAssistantConfig.id, 'default'));
        console.log(`[ha] Synced ${entityCount} entities, ${areas.length} areas`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[ha] Registry sync failed:', msg);
      }
    }

    console.log('[ha] Service booted');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ha] Boot failed:', msg);
  }
}

if (runsService('homeassistant')) bootHomeAssistant();
