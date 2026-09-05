import type { AnswerAssessment } from '$lib/constants/grounding';
export type { AnswerAssessment } from '$lib/constants/grounding';
export interface AnswerContract { depth: 'brief' | 'detailed'; requestedItems?: number; needsReview: boolean }
export function answerContract(request: string): AnswerContract {
  const count = request.match(/\b(\d{1,2})\s+(?:improvements|options|reasons|recommendations|examples|steps)\b/i);
  const detailed = /\breview\b|\bresearch\b|\binvestigat|\bcompar|\bexplain\b|\bdetailed\b|\bthorough\b/i.test(request) || !!count;
  return { depth: detailed ? 'detailed' : 'brief', requestedItems: count ? Number(count[1]) : undefined, needsReview: detailed };
}
export function renderAnswerContract(contract: AnswerContract): string {
  return `\n--- Answer contract ---\nDepth: ${contract.depth}. ${contract.requestedItems ? `Address all ${contract.requestedItems} requested items.` : 'Address each requested subquestion.'} Give the answer, supporting evidence inline, interpretation and material unknowns. Distinguish observed events, remembered facts and inferences. Partial retrieval never establishes absence. Before finishing, check every requested part and each externally verifiable claim against evidence.\n`;
}

export function parseAssessment(text: string): AnswerAssessment {
  try {
    const obj = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (typeof obj.supported !== 'boolean' || typeof obj.complete !== 'boolean' || !Array.isArray(obj.issues)) throw new Error();
    return { supported: obj.supported, complete: obj.complete, issues: obj.issues.filter((x: unknown) => typeof x === 'string').slice(0, 10), revisedAnswer: typeof obj.revisedAnswer === 'string' ? obj.revisedAnswer : undefined };
  } catch { return { supported: null, complete: null, issues: ['Answer verification unavailable'] }; }
}
