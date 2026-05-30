import { NodeRegistry } from './registry';
import { WorkflowEngine } from './engine';
import { manualTriggerDef, manualTriggerExecutor } from './nodes/manual-trigger';
import { transformDef, transformExecutor } from './nodes/transform';
import { codeExecuteDef, codeExecuteExecutor } from './nodes/code-execute';
import { delayDef, delayExecutor } from './nodes/delay';
import { httpRequestDef, httpRequestExecutor } from './nodes/http-request';
import { llmCallDef, llmCallExecutor } from './nodes/llm-call';
import { emailDef, emailExecutor } from './nodes/email';
import { dataStoreDef, dataStoreExecutor } from './nodes/data-store';
import { loopDef, loopExecutor } from './nodes/loop';
import { conditionalDef, conditionalExecutor } from './nodes/conditional';
import { whoopDef, whoopExecutor } from './nodes/whoop';
import { stravaDef, stravaExecutor } from './nodes/strava';
import { openrouterDef, openrouterExecutor } from './nodes/openrouter';
import { errorHandlerDef, errorHandlerExecutor } from './nodes/error-handler';
import { textParserDef, textParserExecutor } from './nodes/text-parser';
import { validatorDef, validatorExecutor } from './nodes/validator';
import { thinkDef, thinkExecutor } from './nodes/think';
import { llmRouterDef, llmRouterExecutor } from './nodes/llm-router';
import { mergeDef, mergeExecutor } from './nodes/merge';
import { accumulatorDef, accumulatorExecutor } from './nodes/accumulator';
import { subWorkflowDef, subWorkflowExecutor } from './nodes/sub-workflow';
import { llmAgentDef, llmAgentExecutor } from './nodes/llm-agent';
import { whatsappDef, whatsappExecutor } from './nodes/whatsapp';
import { homeAssistantDef, homeAssistantExecutor } from './nodes/home-assistant';
import { healthQueryDef, healthQueryExecutor } from './nodes/health-query';
import { blogDef, blogExecutor } from './nodes/blog';
import { jkaiDef, jkaiExecutor } from './nodes/jkai';
import {
  builderChatDef, builderChatExecutor,
  builderPiDef, builderPiExecutor,
  buildViewDef, buildViewExecutor,
} from './nodes/builder-canvas';
import { deepDiveDef, deepDiveExecutor } from './nodes/deep-dive';
import { intelligenceDef, intelligenceExecutor } from './nodes/intelligence';
import { researchResultDef, researchResultExecutor } from './nodes/research-result';
import { quickAnswerDef, quickAnswerExecutor } from './nodes/quick-answer';
import { deepResearchDef, deepResearchExecutor } from './nodes/deep-research';
import { webScrapeDef, webScrapeExecutor } from './nodes/web-scrape';
import { stealthScrapeDef, stealthScrapeExecutor } from './nodes/stealth-scrape';
import { siteMapperDef, siteMapperExecutor } from './nodes/site-mapper';
import { stealthScrapeLlmDef, stealthScrapeLlmExecutor } from './nodes/stealth-scrape-llm';
import { gmailTriggerDef, gmailTriggerExecutor } from './nodes/gmail-trigger';
import { gmailFetchDef, gmailFetchExecutor } from './nodes/gmail-fetch';
import { gmailSendDef, gmailSendExecutor } from './nodes/gmail-send';
import { gmailReplyDef, gmailReplyExecutor } from './nodes/gmail-reply';
import { gmailLabelDef, gmailLabelExecutor } from './nodes/gmail-label';
import { gmailSearchDef, gmailSearchExecutor } from './nodes/gmail-search';
import { tavilySearchDef, tavilySearchExecutor } from './nodes/tavily-search';
import { intelWriteDef, intelWriteExecutor } from './nodes/intel-write';
import { interactiveStepDef, interactiveStepExecutor } from './nodes/interactive-step';
import { intelQueryDef, intelQueryExecutor } from './nodes/intel-query';
import { chatDef, chatExecutor } from './nodes/chat';
import { triggerDef, triggerExecutor } from './nodes/trigger';
import { inspectorDef, inspectorExecutor } from './nodes/inspector';
import { fileStoreDef, fileStoreExecutor } from './nodes/file-store';
import { fileExtractDef, fileExtractExecutor } from './nodes/file-extract';
import { fileTextExtractDef, fileTextExtractExecutor } from './nodes/file-text-extract';
import { fileBuildDef, fileBuildExecutor } from './nodes/file-build';
import {
  fileReadDef, fileReadExecutor,
  fileWriteDef, fileWriteExecutor,
  fileDeleteDef, fileDeleteExecutor,
  fileListDef, fileListExecutor,
} from './nodes/file-ops';
import {
  blogListDef, blogListExecutor,
  blogGetDef, blogGetExecutor,
  blogCreateDef, blogCreateExecutor,
  blogUpdateDef, blogUpdateExecutor,
} from './nodes/blog-ops';
import {
  deepDiveStartDef, deepDiveStartExecutor,
  deepDiveStatusDef, deepDiveStatusExecutor,
  deepDiveReportDef, deepDiveReportExecutor,
  deepDiveListDef, deepDiveListExecutor,
  deepDiveControlDef, deepDiveControlExecutor,
} from './nodes/deep-dive-ops';
import { postitDef, postitExecutor } from './nodes/postit';
import { annotationDef, annotationExecutor } from './nodes/annotation';
import { getWhatsAppService } from './whatsapp/service';
import { OrchestratorBridge } from './whatsapp/orchestrator-bridge';
import { syncPrompts } from './prompts/loader';
import { loadCustomTools } from './site-tools/custom-tool-loader';
import { startMemoryReview } from './chat/memory-review';
import { startScheduler } from './scheduler';
import { startReaper, initEventLoopMonitor } from './engine-runtime';
import { db } from '$lib/db';
import { whatsappConfig, homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { initHomeAssistantService } from './homeassistant/service';
import {
  DYNAMIC_NODES_DIR,
  loadDynamicNodeDefinitions,
  loadDynamicNodeExecutor,
  ensureDynamicNodesDir,
} from './orchestrator/dynamic-nodes';

export const registry = new NodeRegistry();

registry.register(manualTriggerDef, manualTriggerExecutor);
registry.register(transformDef, transformExecutor);
registry.register(codeExecuteDef, codeExecuteExecutor);
registry.register(delayDef, delayExecutor);
registry.register(httpRequestDef, httpRequestExecutor);
registry.register(llmCallDef, llmCallExecutor);
registry.register(emailDef, emailExecutor);
registry.register(dataStoreDef, dataStoreExecutor);
registry.register(loopDef, loopExecutor);
registry.register(conditionalDef, conditionalExecutor);
registry.register(whoopDef, whoopExecutor);
registry.register(stravaDef, stravaExecutor);
registry.register(openrouterDef, openrouterExecutor);
registry.register(errorHandlerDef, errorHandlerExecutor);
registry.register(textParserDef, textParserExecutor);
registry.register(validatorDef, validatorExecutor);
registry.register(thinkDef, thinkExecutor);
registry.register(llmRouterDef, llmRouterExecutor);
registry.register(mergeDef, mergeExecutor);
registry.register(accumulatorDef, accumulatorExecutor);
registry.register(subWorkflowDef, subWorkflowExecutor);
registry.register(llmAgentDef, llmAgentExecutor);
registry.register(whatsappDef, whatsappExecutor);
registry.register(homeAssistantDef, homeAssistantExecutor);
registry.register(healthQueryDef, healthQueryExecutor);
registry.register(blogDef, blogExecutor);
registry.register(jkaiDef, jkaiExecutor);
registry.register(builderChatDef, builderChatExecutor);
registry.register(builderPiDef, builderPiExecutor);
registry.register(buildViewDef, buildViewExecutor);
registry.register(deepDiveDef, deepDiveExecutor);
registry.register(intelligenceDef, intelligenceExecutor);
registry.register(researchResultDef, researchResultExecutor);
registry.register(quickAnswerDef, quickAnswerExecutor);
registry.register(deepResearchDef, deepResearchExecutor);
registry.register(webScrapeDef, webScrapeExecutor);
registry.register(stealthScrapeDef, stealthScrapeExecutor);
registry.register(stealthScrapeLlmDef, stealthScrapeLlmExecutor);
registry.register(siteMapperDef, siteMapperExecutor);
registry.register(gmailTriggerDef, gmailTriggerExecutor);
registry.register(gmailFetchDef, gmailFetchExecutor);
registry.register(gmailSendDef, gmailSendExecutor);
registry.register(gmailReplyDef, gmailReplyExecutor);
registry.register(gmailLabelDef, gmailLabelExecutor);
registry.register(gmailSearchDef, gmailSearchExecutor);
registry.register(tavilySearchDef, tavilySearchExecutor);
registry.register(intelWriteDef, intelWriteExecutor);
registry.register(interactiveStepDef, interactiveStepExecutor);
registry.register(intelQueryDef, intelQueryExecutor);
registry.register(chatDef, chatExecutor);
registry.register(triggerDef, triggerExecutor);
registry.register(inspectorDef, inspectorExecutor);
registry.register(fileStoreDef, fileStoreExecutor);
registry.register(fileExtractDef, fileExtractExecutor);
// Per-operation file primitives (replace fileStore + fileExtract for new canvases)
registry.register(fileReadDef, fileReadExecutor);
registry.register(fileWriteDef, fileWriteExecutor);
registry.register(fileDeleteDef, fileDeleteExecutor);
registry.register(fileListDef, fileListExecutor);
registry.register(fileTextExtractDef, fileTextExtractExecutor);
registry.register(fileBuildDef, fileBuildExecutor);
// Per-operation blog primitives (replace blog)
registry.register(blogListDef, blogListExecutor);
registry.register(blogGetDef, blogGetExecutor);
registry.register(blogCreateDef, blogCreateExecutor);
registry.register(blogUpdateDef, blogUpdateExecutor);
// Per-operation deep-dive primitives (replace deepDive)
registry.register(deepDiveStartDef, deepDiveStartExecutor);
registry.register(deepDiveStatusDef, deepDiveStatusExecutor);
registry.register(deepDiveReportDef, deepDiveReportExecutor);
registry.register(deepDiveListDef, deepDiveListExecutor);
registry.register(deepDiveControlDef, deepDiveControlExecutor);
registry.register(postitDef, postitExecutor);
registry.register(annotationDef, annotationExecutor);

// Load dynamic nodes from ~/.strange-rambling/workflow-nodes/
ensureDynamicNodesDir();
const dynamicDefs = loadDynamicNodeDefinitions(DYNAMIC_NODES_DIR);

// Use an IIFE to await all dynamic executors before they're needed
(async () => {
  for (const def of dynamicDefs) {
    if (registry.getDefinition(def.type)) {
      console.warn(`[dynamic-nodes] Skipping ${def.type} — conflicts with built-in node`);
      continue;
    }
    const executor = await loadDynamicNodeExecutor(DYNAMIC_NODES_DIR, def.type);
    if (executor) {
      registry.register(def, executor);
      console.log(`[dynamic-nodes] Registered: ${def.type}`);
    } else {
      console.warn(`[dynamic-nodes] Failed to load executor for: ${def.type}`);
    }
  }
})();

// Boot WhatsApp service if enabled.
//
// Delegated mode: when WHATSAPP_HERMES_BRIDGE_URL is set, every outbound send
// POSTs to the Hermes WA bridge instead of running our own Baileys. We don't
// wire the OrchestratorBridge — inbound WhatsApp is Hermes-owned (the platform
// plugin handles DMs + home channel). That was already how things worked in
// practice; only outbound was duplicated, which is what kept failing.
async function bootWhatsApp() {
  const delegated = !!process.env.WHATSAPP_HERMES_BRIDGE_URL;

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

    console.log(`[whatsapp] Service booted${delegated ? ' (delegated → Hermes bridge)' : ''}`);
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
const RUN_PLATFORM_SERVICES = process.env.JKAI_BUILDER_PROCESS !== '1';

if (RUN_PLATFORM_SERVICES) bootWhatsApp();

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
        const { entities, entityCount } = await service.syncRegistries();
        await db.update(homeAssistantConfig).set({
          entityRegistry: entities,
          lastSynced: new Date(),
          updatedAt: new Date(),
        }).where(eq(homeAssistantConfig.id, 'default'));
        console.log(`[ha] Synced ${entityCount} entities`);
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

if (RUN_PLATFORM_SERVICES) bootHomeAssistant();

if (RUN_PLATFORM_SERVICES) {
  syncPrompts().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[prompts] Sync failed:', msg);
  });

  loadCustomTools().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[custom-tools] Load failed:', msg);
  });

  startMemoryReview();
}

// Bring every workflow into canvas shape before the scheduler takes
// a fresh snapshot. Idempotent — no-ops on a clean DB.
(async () => {
  try {
    const { migrateWorkflowsToCanvas } = await import('$lib/canvas/migrate');
    await migrateWorkflowsToCanvas();
  } catch (err) {
    console.error('[canvas-migrate] Boot migration failed:', err);
  }
})();

if (RUN_PLATFORM_SERVICES) {
  startScheduler().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[scheduler] Boot failed:', msg);
  });

  // Boot stale-run reaper (clears orphaned `running` rows from previous process
  // + sweeps every 5 min) and start the event-loop delay histogram so the
  // /api/health/workflow-engine probe can report blockage.
  startReaper();
  initEventLoopMonitor();
}

export const engine = new WorkflowEngine(registry);

export { NodeRegistry } from './registry';
export { WorkflowEngine } from './engine';
export type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowEvent,
  NodeDefinition,
  NodeExecutor,
  NodeResult,
  ExecutionContext,
  RunStatus,
  NodeExecutionStatus,
  Position,
  PortDefinition,
  JsonSchema,
} from './types';
