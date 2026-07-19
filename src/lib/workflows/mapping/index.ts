// Edge auto-mapping — isomorphic surface (client + server safe). The LLM-backed
// proposer lives in `propose.server.ts` and must be imported directly by server
// code only; it is intentionally NOT re-exported here.
export * from './types';
export { edgeCompatibility, validateWorkflowCompatibility, heuristicMapping, primaryDataPath } from './compatibility';
