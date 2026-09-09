import { z } from 'zod';
export const FIRST_LOOK_VERSION = 'policy-first-look-1.0.0';
const prose = z.string().trim().min(1).max(1200);
export const firstLookItemSchema = z.object({ title: prose, hypothesis: prose, quotation: prose, location: prose, question: prose }).strict();
export const firstLookContentSchema = z.object({
  actors: z.array(firstLookItemSchema).max(12), avenues: z.array(firstLookItemSchema).max(12),
  effects: z.array(firstLookItemSchema).max(12), safeguards: z.array(firstLookItemSchema).max(12),
  questions: z.array(prose).min(1).max(12),
}).strict();
export type FirstLookContent = z.infer<typeof firstLookContentSchema>;
export interface FirstLook {
  source_hash: string; version: string; generated_at: string;
  method: 'model-assisted' | 'source-scan'; status: 'unreviewed';
  notice: string; content: FirstLookContent;
}
export const FIRST_LOOK_RUBRIC = `Conduct a low-fidelity red-team first look, in plain English for someone who has never studied game theory.
Look for: people and organisations who can choose; who benefits or pays; what rules reward; practical response avenues; gaming of measurements; shifting costs or risks onto others; unequal information or ability to participate; delivery bottlenecks; and safeguards worth testing.
Return possible actors, response avenues, fiscal/resource/distributional/operational effects, safeguards, and unanswered questions. Each card needs an exact quotation and supplied location. The quotation supports the topic, NOT proof of the hypothesised behaviour. Phrase hypotheses conditionally and give a concrete question to investigate. Do not assert likelihood or wrongdoing. If there is no evidence, omit the card and ask what is missing. Include at least one question about missing actors or contradictory evidence.
No invented numbers, payoffs, forecasts, confidence scores or approvals. Do not build or run a simulation. Do not treat a metadata title as policy evidence.`;
export const FIRST_LOOK_GROUPS = [['actors', 'Who may be involved'], ['avenues', 'What they might do'], ['effects', 'Who might bear the costs or consequences'], ['safeguards', 'Safeguards to investigate']] as const;
/** Escape untrusted text in Markdown, including embedded newlines. */
const escape = (v: string) => v.replace(/[<>&`*_[\]#]/g, c => `&#${c.charCodeAt(0)};`).replace(/\n/g, '\n> ');
export function firstLookMarkdown(title: string, synthetic: boolean, report: FirstLook): string {
  return `# First look — ${escape(title)}\n\n${synthetic ? 'SYNTHETIC EXAMPLE' : 'Public policy source'}\n\nUNREVIEWED HYPOTHESES — not findings, forecasts or simulation results.\n\n${escape(report.notice)}\n\nSource hash: ${report.source_hash}\n\nMethod: ${report.method}; rubric: ${report.version}; generated: ${report.generated_at}\n\n${FIRST_LOOK_GROUPS.map(([key, label]) => `## ${label}\n\n${report.content[key].map(c => `### ${escape(c.title)}\n\nHypothesis: ${escape(c.hypothesis)}\n\nSource passage (${escape(c.location)}):\n> ${escape(c.quotation)}\n\nQuestion to check: ${escape(c.question)}\n`).join('\n') || 'Not identified; this does not establish that none exist.'}`).join('\n\n')}\n\n## Questions before modelling\n\n${report.content.questions.map(q => `- ${escape(q)}`).join('\n')}\n\nNo items have been approved and no numerical results have been calculated by this first look. Policy, analytical, legal, financial and operational review is required.\n`;
}
