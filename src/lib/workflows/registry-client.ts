/**
 * Client-safe registry module with definitions only (no executors).
 * Does NOT import engine, events, or sandbox (Node.js-only modules).
 * Use this from page components. Use '$lib/workflows' from +server.ts routes.
 */
import { manualTriggerDef } from './nodes/manual-trigger';
import { transformDef } from './nodes/transform';
import { delayDef } from './nodes/delay';
import { httpRequestDef } from './nodes/http-request';
import { conditionalDef } from './nodes/conditional';
import { switchDef } from './nodes/switch.def';
import { approvalDef } from './nodes/approval.def';
import { textParserDef } from './nodes/text-parser';
import { validatorDef } from './nodes/validator';
import { mergeDef } from './nodes/merge';
import { accumulatorDef } from './nodes/accumulator';
import { subWorkflowDef } from './nodes/sub-workflow.def';
import { codeExecuteDef } from './nodes/code-execute.def';
import { llmCallDef } from './nodes/llm-call.def';
import { dataStoreDef } from './nodes/data-store.def';
import { databaseDef } from './nodes/database.def';
import { dedupeDef } from './nodes/dedupe.def';
import { emailDef } from './nodes/email.def';
import { loopDef } from './nodes/loop.def';
import { stravaDef } from './nodes/strava.def';
import { whoopDef } from './nodes/whoop.def';
import { errorHandlerDef } from './nodes/error-handler.def';
import { openrouterDef } from './nodes/openrouter.def';
import { thinkDef } from './nodes/think.def';
import { llmRouterDef } from './nodes/llm-router.def';
import { llmAgentDef } from './nodes/llm-agent.def';
import { whatsappDef } from './nodes/whatsapp.def';
import { homeAssistantDef } from './nodes/home-assistant.def';
import { healthQueryDef } from './nodes/health-query.def';
import { briefingComposeDef } from './nodes/briefing-compose.def';
import { locationContextDef } from './nodes/location-context.def';
import { weatherBriefDef } from './nodes/weather-brief.def';
import { blogDef } from './nodes/blog.def';
import { jkaiDef } from './nodes/jkai.def';
import { siteToolDef } from './nodes/site-tool.def';
import { fileSearchDef } from './nodes/file-search.def';
import { researchSearchDef } from './nodes/research-search.def';
import { deckBuildDef } from './nodes/deck-build.def';
import { apiCallDef } from './nodes/api-call.def';
import { apiIntegrationDef } from './nodes/api-integration.def';
import { delegateAgentDef } from './nodes/delegate-agent.def';
import { deepDiveDef } from './nodes/deep-dive.def';
import { webScrapeDef } from './nodes/web-scrape.def';
import { stealthScrapeDef } from './nodes/stealth-scrape.def';
import { stealthScrapeLlmDef } from './nodes/stealth-scrape-llm.def';
import { gmailTriggerDef } from './nodes/gmail-trigger.def';
import { whatsappTriggerDef } from './nodes/whatsapp-trigger.def';
import { gmailFetchDef } from './nodes/gmail-fetch.def';
import { gmailSendDef } from './nodes/gmail-send.def';
import { gmailReplyDef } from './nodes/gmail-reply.def';
import { gmailLabelDef } from './nodes/gmail-label.def';
import { gmailSearchDef } from './nodes/gmail-search.def';
import { tavilySearchDef } from './nodes/tavily-search.def';
import { intelWriteDef } from './nodes/intel-write.def';
import { interactiveStepDef } from './nodes/interactive-step.def';
// Client-safe `.def.ts` files (type-only imports) for nodes whose main `.ts`
// executor file pulls in server-only modules — same pattern as the imports
// above.
import { siteMapperDef } from './nodes/site-mapper.def';
import { fileStoreDef } from './nodes/file-store.def';
import { fileExtractDef } from './nodes/file-extract.def';
import { appleCalendarDef } from './nodes/apple-calendar.def';
import { infrastructureStatusDef } from './nodes/infrastructure-status.def';
import { infrastructureUpdateDef } from './nodes/infrastructure-update.def';
// Client-safe node files (type-only / template-only imports, no $lib server
// deps) imported directly for their definition.
import { triggerDef } from './nodes/trigger';
import { inspectorDef } from './nodes/inspector';
import { postitDef } from './nodes/postit';
import { annotationDef } from './nodes/annotation';
import type { NodeDefinition } from './types';
import { intelligenceDef } from './nodes/intelligence.def';
import { quickAnswerDef } from './nodes/quick-answer.def';
import { deepResearchDef } from './nodes/deep-research.def';
import { intelQueryDef } from './nodes/intel-query.def';
import { chatDef } from './nodes/chat.def';
import { builderChatDef, builderPiDef, buildViewDef } from './nodes/builder-canvas.def';
import { fileReadDef, fileWriteDef, fileDeleteDef, fileListDef } from './nodes/file-ops.def';
import { fileTextExtractDef } from './nodes/file-text-extract.def';
import { fileBuildDef } from './nodes/file-build.def';
import { blogListDef, blogGetDef, blogCreateDef, blogUpdateDef } from './nodes/blog-ops.def';
import { deepDiveStartDef, deepDiveStatusDef, deepDiveReportDef, deepDiveListDef, deepDiveControlDef } from './nodes/deep-dive-ops.def';
import { researchResultDef } from './nodes/research-result.def';

// Server-backed nodes expose their metadata from client-safe definition modules.
const builtInDefinitions: NodeDefinition[] = [
  manualTriggerDef,
  transformDef,
  codeExecuteDef,
  delayDef,
  httpRequestDef,
  llmCallDef,
  emailDef,
  dataStoreDef,
  databaseDef,
  dedupeDef,
  loopDef,
  conditionalDef,
  switchDef,
  approvalDef,
  whoopDef,
  stravaDef,
  openrouterDef,
  errorHandlerDef,
  textParserDef,
  validatorDef,
  thinkDef,
  llmRouterDef,
  mergeDef,
  accumulatorDef,
  subWorkflowDef,
  llmAgentDef,
  whatsappDef,
  homeAssistantDef,
  healthQueryDef,
  briefingComposeDef,
  locationContextDef,
  weatherBriefDef,
  blogDef,
  jkaiDef,
  siteToolDef,
  fileSearchDef,
  researchSearchDef,
  deckBuildDef,
  apiCallDef,
  apiIntegrationDef,
  delegateAgentDef,
  deepDiveDef,
  webScrapeDef,
  stealthScrapeDef,
  stealthScrapeLlmDef,
  gmailTriggerDef,
  whatsappTriggerDef,
  gmailFetchDef,
  gmailSendDef,
  gmailReplyDef,
  gmailLabelDef,
  gmailSearchDef,
  tavilySearchDef,
  intelWriteDef,
  interactiveStepDef,
  // Reconciled with registered executors (see registry-parity.test.ts).
  builderChatDef,
  builderPiDef,
  buildViewDef,
  intelligenceDef,
  researchResultDef,
  quickAnswerDef,
  deepResearchDef,
  siteMapperDef,
  intelQueryDef,
  chatDef,
  triggerDef,
  inspectorDef,
  fileStoreDef,
  fileExtractDef,
  fileReadDef,
  fileWriteDef,
  fileDeleteDef,
  fileListDef,
  fileTextExtractDef,
  fileBuildDef,
  blogListDef,
  blogGetDef,
  blogCreateDef,
  blogUpdateDef,
  deepDiveStartDef,
  deepDiveStatusDef,
  deepDiveReportDef,
  deepDiveListDef,
  deepDiveControlDef,
  postitDef,
  annotationDef,
  appleCalendarDef,
  infrastructureStatusDef,
  infrastructureUpdateDef,
];

export const nodeDefinitions: NodeDefinition[] = builtInDefinitions;

export function getDefinition(type: string): NodeDefinition | undefined {
  return nodeDefinitions.find((d) => d.type === type);
}

export type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  NodeDefinition,
  Position,
  PortDefinition,
  JsonSchema,
} from './types';
