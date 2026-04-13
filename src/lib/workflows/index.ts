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

export const registry = new NodeRegistry();

registry.register(manualTriggerDef, manualTriggerExecutor);
registry.register(transformDef, transformExecutor);
registry.register(codeExecuteDef, codeExecuteExecutor);
registry.register(delayDef, delayExecutor);
registry.register(httpRequestDef, httpRequestExecutor);
registry.register(llmCallDef, llmCallExecutor);
registry.register(emailDef, emailExecutor);
registry.register(dataStoreDef, dataStoreExecutor);

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
