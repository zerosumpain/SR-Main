// MCP server — exposes the workflows-domain site-tools (22 tools registered in
// src/lib/workflows/site-tools/tools/workflows.ts) to Hermes over HTTP.
//
// Auth model: every tool call must carry a bridge token (HMAC over JSON-encoded
// {sessionId, kind, kindId, expiresAt}). The token's `kindId` MUST match the
// `workflow_id` argument on the call. The token's `sessionId` is NOT pinned at
// the MCP layer — multiple browser tabs / processes can share a workflow_id
// and they each mint their own session-scoped token.

import { peekTokenPayload, verifyBridgeToken, type TokenScope } from './auth';
import {
  getToolsByToolset,
  executeTool,
} from '$lib/workflows/site-tools/registry';
import type { ToolDefinition } from '$lib/workflows/site-tools/registry-internal';

const WORKFLOWS_TOOLSET = 'workflows';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  bridgeToken: string;
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function toolToMcp(def: ToolDefinition): McpTool {
  return {
    name: def.name,
    description: def.description ?? '',
    inputSchema: (def.parameters as unknown as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
  };
}

export async function listMcpTools(): Promise<McpTool[]> {
  const tools = getToolsByToolset(WORKFLOWS_TOOLSET);
  return tools.map(toolToMcp);
}

/**
 * Accept either `workflow_id` (plan-spec name) or `workflowId` (actual tool
 * schema name). The MCP server uses it for scope binding only; arguments pass
 * through to the handler untouched.
 */
function resolveWorkflowId(args: Record<string, unknown>): string {
  return String(args.workflow_id ?? args.workflowId ?? '');
}

export function createMcpToolHandler() {
  return async function handler(req: McpCallRequest): Promise<McpCallResult> {
    if (!req.bridgeToken) {
      throw new Error('missing bridge token');
    }

    const secret = process.env.HERMES_BRIDGE_SECRET;
    if (!secret) {
      throw new Error('HERMES_BRIDGE_SECRET not configured');
    }

    const workflowId = resolveWorkflowId(req.arguments);
    if (!workflowId) {
      throw new Error(
        'workflow_id argument required for workflows-domain MCP calls (it binds the bridge-token scope)',
      );
    }

    const tokenPayload = peekTokenPayload(req.bridgeToken);
    if (!tokenPayload) {
      throw new Error('malformed bridge token payload');
    }

    // Don't pin sessionId — use whatever sessionId the token claims. The
    // signature check below proves the claim wasn't forged. We DO pin
    // kind=canvas_chat and kindId=workflowId.
    const expected: TokenScope = {
      sessionId: tokenPayload.sessionId,
      kind: 'canvas_chat',
      kindId: workflowId,
      expiresAt: tokenPayload.expiresAt,
    };

    const result = verifyBridgeToken(req.bridgeToken, expected, secret);
    if (!result.ok) {
      // Surface 'scope_mismatch' as a /scope/i-matching error so HTTP callers
      // can return 403; other reasons (signature, expired, malformed) map the
      // same way at the route layer.
      throw new Error(`bridge token rejected: ${result.reason}`);
    }

    const out = await executeTool(req.name, req.arguments, {
      // ToolExecContext requires `emit`; for MCP calls we have no SSE stream to
      // dispatch progress events onto, so this is a no-op. jobId/conversationId
      // are optional — leave them undefined.
      emit: () => {},
    });

    return {
      content: [
        {
          type: 'text',
          text: typeof out === 'string' ? out : JSON.stringify(out),
        },
      ],
    };
  };
}
