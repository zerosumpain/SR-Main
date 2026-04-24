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
import { postitDef, postitExecutor } from './nodes/postit';
import { annotationDef, annotationExecutor } from './nodes/annotation';
import { getWhatsAppService } from './whatsapp/service';
import { OrchestratorBridge } from './whatsapp/orchestrator-bridge';
import { syncPrompts } from './prompts/loader';
import { loadCustomTools } from './site-tools/custom-tool-loader';
import { startMemoryReview } from './chat/memory-review';
import { startScheduler } from './scheduler';
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

// Boot WhatsApp service if enabled
async function bootWhatsApp() {
  try {
    const [config] = await db
      .select()
      .from(whatsappConfig)
      .where(eq(whatsappConfig.id, 'default'))
      .limit(1);

    if (!config?.enabled) {
      console.log('[whatsapp] Not enabled — skipping boot');
      return;
    }

    const service = getWhatsAppService();
    service.setAllowedNumbers((config.allowedNumbers as string[]) || []);

    const bridge = new OrchestratorBridge(
      (to, text) => service.sendMessage(to, text),
      {
        sendAttachmentFn: (to, att, caption) => service.sendAttachment(to, att, caption),
        typingFn: (to) => service.sendTyping(to),
        typingDoneFn: (to) => service.sendTypingDone(to),
      },
    );

    service.onMessage((msg) => bridge.handleMessage(msg));
    await service.connect(config.authDir || 'data/whatsapp-auth');

    console.log('[whatsapp] Service booted');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[whatsapp] Boot failed:', msg);
  }
}

bootWhatsApp();

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

bootHomeAssistant();

syncPrompts().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[prompts] Sync failed:', msg);
});

loadCustomTools().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[custom-tools] Load failed:', msg);
});

startMemoryReview();

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

startScheduler().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[scheduler] Boot failed:', msg);
});

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
