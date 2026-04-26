export interface Milestone {
  id: string;
  title: string;
  done: boolean;
  iter?: number;
}

export function parsePlanMilestones(plan: string | null | undefined): Milestone[] {
  if (!plan) return [];
  const out: Milestone[] = [];
  const re = /###\s*Iteration\s+(\d+)\s*:[^\n]*\n([\s\S]*?)(?=\n###\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plan)) !== null) {
    const num = parseInt(m[1], 10);
    const body = m[2];
    const milestoneMatch = body.match(/-\s*Milestone:\s*([^\n]+)/i);
    if (milestoneMatch) {
      out.push({
        id: `iter-${num}`,
        title: milestoneMatch[1].trim(),
        done: false,
        iter: num,
      });
    }
  }
  return out;
}
