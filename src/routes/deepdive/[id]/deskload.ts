export type DeskSessionRow = {
  id: string;
  topic: string;
  status: string;
  goals: unknown;
  shareToken: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type DeskLoad = {
  session: {
    id: string;
    topic: string;
    status: string;
    goals: string[];
    shareToken: string | null;
    createdAt: string;
    completedAt: string | null;
  };
  mode: 'deep';
};

export function buildDeskLoad(row: DeskSessionRow): DeskLoad {
  return {
    session: {
      id: row.id,
      topic: row.topic,
      status: row.status,
      goals: Array.isArray(row.goals) ? (row.goals as string[]) : [],
      shareToken: row.shareToken ?? null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    },
    mode: 'deep',
  };
}
