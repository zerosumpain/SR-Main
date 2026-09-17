import type { ToolExecContext, ToolResult } from './registry-internal';
import { loadToolRegistry } from './load-registry';
import { invokeRemoteTool, remoteCatalogue, remoteInvokeTarget } from './remote';

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
 * Every function here is async. `isRegisteredTool` was synchronous and had four
 * call sites; two of them already dynamically imported this module and so were
 * paying for the static edge without benefiting from it.
 *
 * ## The other process
 *
 * "Replacing this file's body with a call to another process" is no longer
 * hypothetical: when `JKAI_TOOL_INVOKE_URL` and `JKAI_TOOL_INVOKE_TOKEN` are
 * both set, the catalogue lives over the wire — see `./remote.ts` and
 * `docs/superpowers/specs/2026-09-17-jkai-tool-invoke-contract.md`.
 *
 * **Main does not set them**, and unset means in-process: the path every call
 * takes today, byte for byte. They exist for SR-JKAI, where this file will run
 * with the catalogue on the far side of a boundary. Setting them in Main would
 * route workflow nodes, canvas routes and the build bridge over loopback HTTP
 * to Main itself — which is why both endpoints at the other end refuse to serve
 * at all when they see this configured.
 *
 * ## All THREE predicates cross, not just execution
 *
 * `executeSiteTool` is not the only thing that asks the catalogue a question.
 * `isRegisteredTool` decides whether chat calls a tool at all
 * (`general-chat.ts`), and `isDestructiveTool` decides whether a confirmation
 * card is raised first (`chat/confirmation-gate.ts`). Converting only execution
 * would have failed twice over — every Main tool answering "Unknown function"
 * and never reaching the wire at all, and then, once that was fixed, every
 * destructive tool reporting `false` so the confirmation quietly stopped
 * appearing. The second is why the catalogue endpoint exists.
 */
export async function executeSiteTool(
	name: string,
	args: Record<string, unknown>,
	ctx?: ToolExecContext,
): Promise<ToolResult> {
	const target = remoteInvokeTarget();
	if (!target) {
		const { executeTool } = await loadToolRegistry();
		return executeTool(name, args, ctx);
	}
	/**
	 * A transport failure comes back as a failed ToolResult, never as a throw.
	 *
	 * In-process this function cannot reject: `registry.executeTool` catches a
	 * handler's exception and returns `{success:false,error}`. Every caller was
	 * written against that, and two of them would break badly otherwise —
	 * `general-chat` calls this bare inside a `Promise.all` over a turn's tool
	 * calls, so one blip on one tool would reject the whole batch and kill the
	 * turn rather than handing the model one failed result it can talk about.
	 *
	 * Moving the catalogue across a boundary must not change the contract of the
	 * seam in front of it.
	 */
	try {
		return await invokeRemoteTool(name, args, ctx, target);
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'tool invoke failed' };
	}
}

export async function isRegisteredTool(name: string): Promise<boolean> {
	const target = remoteInvokeTarget();
	if (target) return (await remoteCatalogue(target)).has(name);
	const { isRegisteredTool: check } = await loadToolRegistry();
	return check(name);
}

/**
 * Whether a tool must ask the user before it runs.
 *
 * Lives on the seam rather than in `chat/confirmation-gate.ts`, which is where
 * it used to read the registry directly. It is the same question
 * `isRegisteredTool` asks — what does the catalogue say about this name — and a
 * second reader of the catalogue is a second thing to remember to move.
 *
 * **Across the wire it fails CLOSED.** A name the catalogue does not carry, or
 * a catalogue that could not be read at all, is treated as destructive: the
 * direction of a wrong answer is not symmetric here, because a needless
 * confirmation is an annoyance and a skipped one sends the email.
 */
export async function isDestructiveTool(name: string): Promise<boolean> {
	const target = remoteInvokeTarget();
	if (!target) {
		const { getTool } = await loadToolRegistry();
		return getTool(name)?.destructive === true;
	}
	try {
		return (await remoteCatalogue(target)).get(name) ?? true;
	} catch {
		return true;
	}
}
