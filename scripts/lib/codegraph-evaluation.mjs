/** Offline, deterministic retrieval evaluation; never claims model/build savings. */
/** @param {{expected: string[], retrieved: string[], durationMs?: number, stale?: string[]}} input */
export function evaluateRetrieval({ expected, retrieved, durationMs = 0, stale = [] }) {
  const wanted = new Set(expected); const actual = [...new Set(retrieved)];
  const hits = actual.filter(id => wanted.has(id)).length;
  return { expected: wanted.size, retrieved: actual.length, hits,
    precision: actual.length ? hits / actual.length : null,
    recall: wanted.size ? hits / wanted.size : null,
    staleCount: actual.filter(id => stale.includes(id)).length, durationMs };
}
/** @param {any[]} cases @param {(task: any) => string[]} retrieve */
export function replayCases(cases, retrieve) {
  return cases.map(task => {
    if (!task.id || !task.snapshotRevision || !task.availableAt || !Number.isFinite(Date.parse(task.availableAt)) || !Number.isFinite(Date.parse(task.taskAt)) || Date.parse(task.availableAt) > Date.parse(task.taskAt)) throw new Error('Replay requires a snapshot available before the task');
    const start = performance.now(); const retrieved = retrieve(task);
    return { id: task.id, kind: task.kind, revision: task.snapshotRevision, ...evaluateRetrieval({ expected: task.expected, retrieved, stale: task.stale ?? [], durationMs: performance.now() - start }) };
  });
}
/** @param {Array<Record<string, any>>} runs */
export function compareBuildOutcomes(runs) {
  /** @type {Map<string, {taskKind: string, model: string, budget: number, policy: string, count: number, metrics: Record<string, number[]>}>} */
  const groups = new Map();
  for (const run of runs) {
    const key = [run.taskKind, run.model, run.budget, run.policy].join('|');
    const group = groups.get(key) ?? { taskKind: run.taskKind, model: run.model, budget: run.budget, policy: run.policy, count: 0, metrics: /** @type {Record<string, number[]>} */ ({}) };
    group.count++;
    for (const metric of ['firstPreviewMs', 'acceptedMs', 'tokens', 'costUsd', 'repairs', 'regressions', 'discoveryActions']) {
      const value = run[metric]; if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const values = group.metrics[metric] ?? []; values.push(value); group.metrics[metric] = values;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, metrics: Object.fromEntries(Object.entries(g.metrics).map(([k, values]) => [k, { samples: values.length, mean: values.reduce((a,b) => a+b,0) / values.length }])) }));
}
