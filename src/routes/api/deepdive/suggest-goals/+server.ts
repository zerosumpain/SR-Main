import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jsonCompletion } from '$lib/deepdive/ai';

export const POST: RequestHandler = async ({ request }) => {
  const { topic } = await request.json();

  if (!topic || typeof topic !== 'string') {
    return json({ error: 'Topic is required' }, { status: 400 });
  }

  try {
    const result = await jsonCompletion<{ goals: string[] }>(
      'You are a research planning assistant.',
      `Generate 4-6 focused research goals for investigating this topic: "${topic}"\n\nEach goal should be specific, actionable, and help guide a comprehensive research investigation. Cover different angles: factual understanding, historical context, key players/entities, controversies, and future implications.\n\nRespond with JSON: { "goals": ["goal1", "goal2", ...] }`,
    );

    return json({ goals: result.goals ?? [] });
  } catch (err: any) {
    return json({ error: err.message ?? 'Failed to generate goals' }, { status: 500 });
  }
};
