import type { ToolExecContext, ToolResult } from './registry-internal';
import { loadToolRegistry } from './load-registry';

/**
 * The seam between chat and the tool catalogue.
 *
 * This used to be a static re-export of `./registry`, which imports all 52 tool
 * modules for their `register()` side effects. That single edge put the whole
 * catalogue — and, through a cycle back via `general-chat`, the workflow engine
 * — inside the import closure of anything that could run a tool. Measured at 696
 * files for the chat endpoint.
 *
 * Loading it dynamically costs nothing at runtime (the first tool call pays what
 * the module load always cost, once) and takes the catalogue off every caller's
 * STATIC graph. That is what makes chat extractable: the boundary becomes one
 * function rather than 52 imports, and replacing this file's body with a call to
 * another process is then a local change.
 *
 * Both functions are async now. `isRegisteredTool` was synchronous and had four
 * call sites; two of them already dynamically imported this module and so were
 * paying for the static edge without benefiting from it.
 */
export async function executeSiteTool(
	name: string,
	args: Record<string, unknown>,
	ctx?: ToolExecContext,
): Promise<ToolResult> {
	const { executeTool } = await loadToolRegistry();
	return executeTool(name, args, ctx);
}

export async function isRegisteredTool(name: string): Promise<boolean> {
	const { isRegisteredTool: check } = await loadToolRegistry();
	return check(name);
}
