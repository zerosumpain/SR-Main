import type { NodeExecutor, NodeResult, JsonSchema } from '../types';
import { resolveLLMClient } from './llm-helpers';

export { stealthScrapeLlmDef } from './stealth-scrape-llm.def';

function getByPath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return parts.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

async function extractOne(
  client: any,
  model: string,
  text: string,
  schema: unknown,
  instructions?: string,
): Promise<Record<string, unknown>> {
  const systemPrompt =
    `You extract structured data from web pages. Return JSON matching this schema and nothing else:\n${JSON.stringify(schema)}\n${instructions ?? ''}`.trim();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text.slice(0, 200_000) },
    ],
    response_format: { type: 'json_object' },
  });
  const content = res.choices?.[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

export const stealthScrapeLlmExecutor: NodeExecutor = {
  type: 'stealth-scrape-llm',

  async execute(input, config): Promise<NodeResult> {
    const sourcePath = (config.sourcePath as string) || '';
    const itemTextPath = config.itemTextPath as string | undefined;
    const schema = config.schema;
    const instructions = config.instructions as string | undefined;

    const { client, model } = await resolveLLMClient(config.model as string | undefined);

    const raw = sourcePath.startsWith('input')
      ? getByPath({ input }, sourcePath)
      : getByPath(input, sourcePath);

    if (Array.isArray(raw)) {
      const out: Record<string, unknown>[] = [];
      for (const item of raw) {
        const text = itemTextPath ? String(getByPath(item, itemTextPath) ?? '') : JSON.stringify(item);
        out.push(await extractOne(client, model, text, schema, instructions));
      }
      return { output: { extracted: out }, metadata: { _selectedHandle: 'output' }, rowCount: out.length };
    } else {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      const extracted = await extractOne(client, model, text, schema, instructions);
      return { output: { extracted }, metadata: { _selectedHandle: 'output' }, rowCount: 1 };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Pass through from upstream; sourcePath pulls fields from here' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    return {
      type: 'object',
      properties: {
        extracted: {
          oneOf: [
            (config.schema as JsonSchema) ?? { type: 'object' },
            { type: 'array', items: (config.schema as JsonSchema) ?? { type: 'object' } },
          ],
        },
      },
    };
  },
};
