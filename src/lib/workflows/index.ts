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
import { databaseDef, databaseExecutor } from './nodes/database';
import { dedupeDef, dedupeExecutor } from './nodes/dedupe';
import { loopDef, loopExecutor } from './nodes/loop';
import { conditionalDef, conditionalExecutor } from './nodes/conditional';
import { switchDef, switchExecutor } from './nodes/switch';
import { approvalDef, approvalExecutor } from './nodes/approval';
import { whoopDef, whoopExecutor } from './nodes/whoop';
import { openrouterDef, openrouterExecutor } from './nodes/openrouter';
import { infrastructureStatusDef, infrastructureStatusExecutor } from './nodes/infrastructure-status';
import { infrastructureUpdateDef, infrastructureUpdateExecutor } from './nodes/infrastructure-update';
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
import { briefingComposeDef, briefingComposeExecutor } from './nodes/briefing-compose';
import { locationContextDef, locationContextExecutor } from './nodes/location-context';
import { weatherBriefDef, weatherBriefExecutor } from './nodes/weather-brief';
import { blogDef, blogExecutor } from './nodes/blog';
import { jkaiDef, jkaiExecutor } from './nodes/jkai';
import { siteToolDef, siteToolExecutor } from './nodes/site-tool';
import { fileSearchDef, fileSearchExecutor } from './nodes/file-search';
import { researchSearchDef, researchSearchExecutor } from './nodes/research-search';
import { deckBuildDef, deckBuildExecutor } from './nodes/deck-build';
import { apiCallDef, apiCallExecutor } from './nodes/api-call';
import { apiIntegrationDef, apiIntegrationExecutor } from './nodes/api-integration';
import { delegateAgentDef, delegateAgentExecutor } from './nodes/delegate-agent';
import {
  builderChatDef, builderChatExecutor,
  builderPiDef, builderPiExecutor,
  buildViewDef, buildViewExecutor,
} from './nodes/builder-canvas';
import { deepDiveDef, deepDiveExecutor } from './nodes/deep-dive';
import { researchResultDef, researchResultExecutor } from './nodes/research-result';
import { quickAnswerDef, quickAnswerExecutor } from './nodes/quick-answer';
import { deepResearchDef, deepResearchExecutor } from './nodes/deep-research';
import { webScrapeDef, webScrapeExecutor } from './nodes/web-scrape';
import { stealthScrapeDef, stealthScrapeExecutor } from './nodes/stealth-scrape';
import { siteMapperDef, siteMapperExecutor } from './nodes/site-mapper';
import { stealthScrapeLlmDef, stealthScrapeLlmExecutor } from './nodes/stealth-scrape-llm';
import { whatsappTriggerDef, whatsappTriggerExecutor } from './nodes/whatsapp-trigger';
import { gmailFetchDef, gmailFetchExecutor } from './nodes/gmail-fetch';
import { gmailSendDef, gmailSendExecutor } from './nodes/gmail-send';
import { gmailReplyDef, gmailReplyExecutor } from './nodes/gmail-reply';
import { gmailLabelDef, gmailLabelExecutor } from './nodes/gmail-label';
import { gmailSearchDef, gmailSearchExecutor } from './nodes/gmail-search';
import { tavilySearchDef, tavilySearchExecutor } from './nodes/tavily-search';
import { notifyDef, notifyExecutor } from './nodes/notify';
import { interactiveStepDef, interactiveStepExecutor } from './nodes/interactive-step';
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
import { appleCalendarDef, appleCalendarExecutor } from './nodes/apple-calendar';
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
registry.register(databaseDef, databaseExecutor);
registry.register(dedupeDef, dedupeExecutor);
registry.register(loopDef, loopExecutor);
registry.register(conditionalDef, conditionalExecutor);
registry.register(switchDef, switchExecutor);
registry.register(approvalDef, approvalExecutor);
registry.register(whoopDef, whoopExecutor);
registry.register(openrouterDef, openrouterExecutor);
registry.register(infrastructureStatusDef, infrastructureStatusExecutor);
registry.register(infrastructureUpdateDef, infrastructureUpdateExecutor);
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
registry.register(briefingComposeDef, briefingComposeExecutor);
registry.register(locationContextDef, locationContextExecutor);
registry.register(weatherBriefDef, weatherBriefExecutor);
registry.register(blogDef, blogExecutor);
registry.register(jkaiDef, jkaiExecutor);
registry.register(siteToolDef, siteToolExecutor);
registry.register(fileSearchDef, fileSearchExecutor);
registry.register(researchSearchDef, researchSearchExecutor);
registry.register(deckBuildDef, deckBuildExecutor);
registry.register(apiCallDef, apiCallExecutor);
registry.register(apiIntegrationDef, apiIntegrationExecutor);
registry.register(delegateAgentDef, delegateAgentExecutor);
registry.register(builderChatDef, builderChatExecutor);
registry.register(builderPiDef, builderPiExecutor);
registry.register(buildViewDef, buildViewExecutor);
registry.register(deepDiveDef, deepDiveExecutor);
registry.register(researchResultDef, researchResultExecutor);
registry.register(quickAnswerDef, quickAnswerExecutor);
registry.register(deepResearchDef, deepResearchExecutor);
registry.register(webScrapeDef, webScrapeExecutor);
registry.register(stealthScrapeDef, stealthScrapeExecutor);
registry.register(stealthScrapeLlmDef, stealthScrapeLlmExecutor);
registry.register(siteMapperDef, siteMapperExecutor);
registry.register(whatsappTriggerDef, whatsappTriggerExecutor);
registry.register(gmailFetchDef, gmailFetchExecutor);
registry.register(gmailSendDef, gmailSendExecutor);
registry.register(gmailReplyDef, gmailReplyExecutor);
registry.register(gmailLabelDef, gmailLabelExecutor);
registry.register(gmailSearchDef, gmailSearchExecutor);
registry.register(tavilySearchDef, tavilySearchExecutor);
registry.register(notifyDef, notifyExecutor);
registry.register(interactiveStepDef, interactiveStepExecutor);
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
registry.register(appleCalendarDef, appleCalendarExecutor);

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

// SR-Workflows owns workflow migration, scheduling and queue execution.

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
