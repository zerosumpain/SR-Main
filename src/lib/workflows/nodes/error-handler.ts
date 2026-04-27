import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';

export { errorHandlerDef } from './error-handler.def';

export const errorHandlerExecutor: NodeExecutor = {
  type: 'error-handler',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    // Detect errors from multiple sources:
    // 1. Explicit error field (from nodes that set output.error)
    // 2. HTTP error status codes (from http-request node returning {status, body, headers})
    const hasExplicitError = input.error !== undefined;
    const httpStatus = typeof input.status === 'number' ? input.status : undefined;
    const hasHttpError = httpStatus !== undefined && httpStatus >= 400;

    const hasError = hasExplicitError || hasHttpError;

    // When routing to error, ensure there's a usable error message
    const output = { ...input };
    if (hasError && !hasExplicitError) {
      output.error = hasHttpError
        ? `HTTP ${httpStatus} error`
        : 'Unknown error';
    }

    return {
      output,
      metadata: { _selectedHandle: hasError ? 'error' : 'success' },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input data, optionally containing an error field' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Input passed through to selected branch' };
  },
};

