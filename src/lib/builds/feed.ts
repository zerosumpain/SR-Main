export type FeedEvent =
  | {
      kind: 'log';
      id: number;
      type: string;
      content: string;
      iterationId: string | null;
    }
  | {
      kind: 'live';
      type: string;
      iterationId: string | null;
      streamId: string;
      delta?: string;
      full?: string;
      toolName?: string;
    };

export interface ToolEntry {
  id: string;
  name: string;
  argsRaw: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface IterationCardData {
  id: string;
  lanes: { thinking: string; output: string; tools: ToolEntry[] };
  systemLogs: string[];
}

export interface FeedState {
  iterations: IterationCardData[];
  proposedPlan: string | null;
}

export function reduceFeed(events: FeedEvent[]): FeedState {
  const byIter = new Map<string, IterationCardData>();
  const order: string[] = [];
  let proposedPlan: string | null = null;

  function ensure(iterId: string | null): IterationCardData {
    const id = iterId ?? '__unscoped__';
    let it = byIter.get(id);
    if (!it) {
      it = { id, lanes: { thinking: '', output: '', tools: [] }, systemLogs: [] };
      byIter.set(id, it);
      order.push(id);
    }
    return it;
  }

  for (const ev of events) {
    if (ev.kind === 'log') {
      const it = ensure(ev.iterationId);
      if (ev.type === 'thinking') {
        it.lanes.thinking += (it.lanes.thinking ? '\n' : '') + ev.content;
      } else if (ev.type === 'text') {
        it.lanes.output += (it.lanes.output ? '\n' : '') + ev.content;
      } else if (ev.type === 'system' || ev.type === 'error' || ev.type === 'lint') {
        it.systemLogs.push(ev.content);
      } else if (ev.type === 'output') {
        const last = it.lanes.tools[it.lanes.tools.length - 1];
        if (last) {
          last.result = ev.content;
          last.status = 'done';
        }
      } else if (ev.type === 'code') {
        // Persisted "code" log row — fenced markdown. Keep as a synthetic tool entry
        // so a replay shows the same shape as the live stream.
        const fenceMatch = ev.content.match(/^```(\w+)\n([\s\S]*?)```/);
        if (fenceMatch) {
          it.lanes.tools.push({
            id: `log-${ev.id}`,
            name: fenceMatch[1],
            argsRaw: fenceMatch[2].trim(),
            status: 'done',
          });
        }
      }
      continue;
    }
    if (ev.type === 'plan_proposed') {
      proposedPlan = ev.full ?? proposedPlan;
      continue;
    }
    const it = ensure(ev.iterationId);
    if (ev.type === 'stream_text' && ev.delta) {
      it.lanes.output += ev.delta;
    } else if (ev.type === 'stream_thinking' && ev.delta) {
      it.lanes.thinking += ev.delta;
    } else if (ev.type === 'stream_tool_start') {
      it.lanes.tools.push({
        id: ev.streamId,
        name: ev.toolName ?? 'tool',
        argsRaw: '',
        status: 'running',
      });
    } else if (ev.type === 'stream_tool_delta' && ev.delta) {
      const last =
        it.lanes.tools.find((t) => t.id === ev.streamId) ??
        it.lanes.tools[it.lanes.tools.length - 1];
      if (last) last.argsRaw += ev.delta;
    } else if (ev.type === 'stream_tool_end') {
      const last =
        it.lanes.tools.find((t) => t.id === ev.streamId) ??
        it.lanes.tools[it.lanes.tools.length - 1];
      if (last) {
        last.status = 'done';
        if (ev.full) last.argsRaw = ev.full;
      }
    }
  }

  return {
    iterations: order.map((id) => byIter.get(id)!).filter(Boolean),
    proposedPlan,
  };
}
