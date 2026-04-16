import type { QuickAnswerSource } from '$lib/db/schema';

export function systemPrompt(topic: string, goals: string[]): string {
  let prompt = `You are a research assistant. The topic is: "${topic}"`;
  if (goals.length > 0) {
    prompt += `\nResearch goals: ${goals.join('; ')}`;
  }
  return prompt;
}

export const QUERY_GEN_PROMPT = `Generate 3-5 diverse search queries to cover different angles of this topic. Vary phrasing to minimise result overlap.

Respond with JSON: { "queries": ["query1", "query2", ...] }`;

export function synthesisSystemPrompt(): string {
  return `You are a research analyst who writes clear, factual, well-sourced answers.

Rules:
- Write a 200-500 word answer in clear prose
- Use inline [N] citations referencing the numbered source list
- Cite at least 3 different sources
- Note conflicting information where sources disagree
- Do not fabricate claims beyond what the sources support
- Use markdown formatting (headings, bold, lists) where it improves clarity`;
}

export function synthesisUserPrompt(
  topic: string,
  goals: string[],
  sources: QuickAnswerSource[],
): string {
  let prompt = `**Topic:** ${topic}`;
  if (goals.length > 0) {
    prompt += `\n**Goals:** ${goals.join('; ')}`;
  }
  prompt += `\n\n**Sources:**\n`;
  for (const s of sources) {
    prompt += `\n[${s.citationIndex}] ${s.title} (${s.domain}, credibility: ${s.credibilityScore.toFixed(2)})\n${s.snippet}\n`;
  }
  prompt += `\nWrite a synthesised answer with inline [N] citations.`;
  return prompt;
}
