// Re-exports from the tool registry for backwards compatibility.
// All tool handlers live in registry.ts.
import { executeTool, isRegisteredTool } from './registry';

export { executeTool as executeSiteTool, isRegisteredTool };
