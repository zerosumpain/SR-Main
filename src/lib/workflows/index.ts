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
import { getWhatsAppService } from './whatsapp/service';
import { OrchestratorBridge } from './whatsapp/orchestrator-bridge';
import { syncPrompts } from './prompts/loader';
import { loadCustomTools } from './site-tools/custom-tool-loader';
import { startMemoryReview } from './chat/memory-review';
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

// Load dynamic nodes from ~/.strange-rambling/workflow-nodes/
ensureDynamicNodesDir();
const dynamicDefs = loadDynamicNodeDefinitions(DYNAMIC_NODES_DIR);
for (const def of dynamicDefs) {
  if (registry.getDefinition(def.type)) {
    console.warn(`[dynamic-nodes] Skipping ${def.type} — conflicts with built-in node`);
    continue;
  }
  loadDynamicNodeExecutor(DYNAMIC_NODES_DIR, def.type).then((executor) => {
    if (executor) {
      registry.register(def, executor);
      console.log(`[dynamic-nodes] Registered: ${def.type}`);
    } else {
      console.warn(`[dynamic-nodes] Failed to load executor for: ${def.type}`);
    }
  });
}

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
      (to) => service.sendTyping(to),
      (to) => service.sendTypingDone(to),
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
