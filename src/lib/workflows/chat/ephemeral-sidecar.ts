// src/lib/workflows/chat/ephemeral-sidecar.ts
// Helper to lift an ephemeral tool's sidecar out of result.data into a
// dedicated `ephemeral` property on the stored tool step. Keeps the LLM's
// view of tool results free of implementation-detail fields when rehydrating
// history, and gives promote_ephemeral_tool a stable path to find the
// handler code later.

type EphemeralSidecar = {
  handlerCode: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  proposedName?: string;
  proposedDescription?: string;
};

export type StoredToolStep = {
  id?: string;
  tool: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  status?: 'running' | 'done' | 'error';
  result?: { success?: boolean; data?: Record<string, unknown>; error?: string };
  ephemeral?: EphemeralSidecar;
};

export function extractEphemeralSidecar(step: StoredToolStep): StoredToolStep {
  const data = step.result?.data;
  if (!data || typeof data !== 'object') return step;
  const sidecar = data.__ephemeral__ as EphemeralSidecar | undefined;
  if (!sidecar) return step;

  const { __ephemeral__: _drop, ...cleanedData } = data;
  void _drop;
  return {
    ...step,
    result: { ...step.result, data: cleanedData },
    ephemeral: sidecar,
  };
}
