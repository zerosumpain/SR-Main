export type HandleKind =
  | 'text'
  | 'url'
  | 'image'
  | 'json'
  | 'dataset'
  | 'research-result'
  | 'intel-session'
  | 'trigger-signal'
  | 'any';

export type HandleSpec = {
  id: string;
  kinds: HandleKind[];
  label?: string;
  required?: boolean;
};

export type NodeHandles = {
  inputs: HandleSpec[];
  outputs: HandleSpec[];
};

export type CandidateType = {
  type: string;
  handles: NodeHandles;
  defaultWeight: number;
};

const MAX_WORKFLOW_SAMPLE = 50;
const USAGE_BOOST_CAP = 3;

export function compatibility(outputs: HandleSpec[], inputs: HandleSpec[]): 0 | 1 {
  if (outputs.length === 0 || inputs.length === 0) return 0;
  const outKinds = new Set(outputs.flatMap((o) => o.kinds));
  const inKinds = new Set(inputs.flatMap((i) => i.kinds));
  if (outKinds.has('any') || inKinds.has('any')) return 1;
  for (const k of outKinds) if (inKinds.has(k)) return 1;
  return 0;
}

export function scoreCandidate(
  candidate: NodeHandles,
  canvasNodes: NodeHandles[],
  recentUsageCount: number,
  defaultWeight: number
): number {
  const sample =
    canvasNodes.length > MAX_WORKFLOW_SAMPLE
      ? canvasNodes.slice(-MAX_WORKFLOW_SAMPLE)
      : canvasNodes;
  const compatSum = sample.reduce(
    (sum, n) => sum + compatibility(n.outputs, candidate.inputs),
    0
  );
  const boost = Math.min(recentUsageCount, USAGE_BOOST_CAP);
  return compatSum + boost + defaultWeight;
}

export function rankForWorkflow(
  candidates: CandidateType[],
  canvasNodes: NodeHandles[],
  recents: Record<string, number>,
  topN: number
): CandidateType[] {
  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidate(c.handles, canvasNodes, recents[c.type] ?? 0, c.defaultWeight),
  }));
  scored.sort((a, b) => b.score - a.score || a.candidate.type.localeCompare(b.candidate.type));
  return scored.slice(0, topN).map((s) => s.candidate);
}

export function filterDownstream(
  candidates: CandidateType[],
  sourceOutputs: HandleSpec[]
): CandidateType[] {
  return candidates.filter(
    (c) => compatibility(sourceOutputs, c.handles.inputs) === 1
  );
}
