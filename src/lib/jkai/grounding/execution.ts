import { AsyncLocalStorage } from 'node:async_hooks';
import type { ToolExecContext } from '$lib/workflows/site-tools/registry-internal';
const execution = new AsyncLocalStorage<ToolExecContext>();
export function currentExecution(): ToolExecContext | undefined { return execution.getStore(); }
export function withExecution<T>(ctx: ToolExecContext, run: () => Promise<T>): Promise<T> { return execution.run(ctx, run); }
