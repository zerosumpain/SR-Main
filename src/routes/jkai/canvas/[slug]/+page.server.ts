import type { PageServerLoad } from './$types';

export type NodeKind = 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent';
export type NodeStatus = 'idle' | 'running' | 'ok' | 'failed';

export type CanvasNode = {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  status?: NodeStatus;
};

export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  active?: boolean;
};

export type Canvas = {
  slug: string;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

const COL = [320, 540, 760, 980] as const;

const SAMPLE: Canvas = {
  slug: 'sample',
  title: 'self-healing json retry',
  nodes: [
    { id: 'user',  kind: 'input',  name: 'User message',     x: COL[0], y: 120 },
    { id: 'intel', kind: 'intel',  name: 'Intel · scope',    x: COL[0], y: 240 },
    { id: 'llm1',  kind: 'llm',    name: 'glm-4-flash',      x: COL[1], y: 120, status: 'ok' },
    { id: 'par',   kind: 'parse',  name: 'JSON.parse',       x: COL[1], y: 240, status: 'failed' },
    { id: 'rtr',   kind: 'llm',    name: 'claude-haiku-4-5', x: COL[2], y: 240, status: 'running' },
    { id: 'out',   kind: 'output', name: 'Reply',            x: COL[3], y: 240 },
  ],
  edges: [
    { id: 'e1', from: 'user',  to: 'llm1' },
    { id: 'e2', from: 'llm1',  to: 'par' },
    { id: 'e3', from: 'intel', to: 'rtr' },
    { id: 'e4', from: 'par',   to: 'rtr', active: true },
    { id: 'e5', from: 'rtr',   to: 'out', active: true },
  ],
};

export const load: PageServerLoad = async ({ params }) => {
  return { canvas: { ...SAMPLE, slug: params.slug } };
};
