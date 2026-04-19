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
import { textParserDef } from './nodes/text-parser';
import { validatorDef } from './nodes/validator';
import { mergeDef } from './nodes/merge';
import { accumulatorDef } from './nodes/accumulator';
import { subWorkflowDef } from './nodes/sub-workflow.def';
import { codeExecuteDef } from './nodes/code-execute.def';
import { llmCallDef } from './nodes/llm-call.def';
import { dataStoreDef } from './nodes/data-store.def';
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
import { blogDef } from './nodes/blog.def';
import { jkaiDef } from './nodes/jkai.def';
import { deepDiveDef } from './nodes/deep-dive.def';
import { webScrapeDef } from './nodes/web-scrape.def';
import { tavilySearchDef } from './nodes/tavily-search.def';
import type { NodeDefinition } from './types';
// Dynamic node definitions are loaded server-side only (in index.ts).
// This file must stay client-safe — no Node.js imports (fs, path, etc).

const builtInDefinitions: NodeDefinition[] = [
  manualTriggerDef,
  transformDef,
  codeExecuteDef,
  delayDef,
  httpRequestDef,
  llmCallDef,
  emailDef,
  dataStoreDef,
  loopDef,
  conditionalDef,
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
  blogDef,
  jkaiDef,
  deepDiveDef,
  webScrapeDef,
  tavilySearchDef,
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
