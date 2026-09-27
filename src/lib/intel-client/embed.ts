// Text embeddings through the LLM gateway — the one call Main's memory store,
// intel recall search and mail search need. Nothing intel-specific: the note
// and entity embedding writers live in SR-Jkai-Core, which owns those rows.
//
// Same model as Core's, or a vector Main computes would not be comparable with
// the ones Core stored.
import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Characters sent per input, before any retry.
 *
 * The model's real limit is 8,192 TOKENS, and there is no honest constant that
 * converts one into the other: English prose runs about 4 chars a token, while
 * an email full of headers, URLs and quoted signatures runs closer to 2. This
 * module used to cut at 32,000 chars on the prose assumption and a 23,999-char
 * thread still overflowed — nine notes failed the backfill on 2026-08-27 with
 * `maximum context length is 8192 tokens`, and would have failed every night
 * afterwards.
 *
 * So the cut is conservative AND `shrinkToFit` below retries on overflow. The
 * guess gets the common case cheaply; the retry makes it correct.
 */
const MAX_INPUT_CHARS = 16_000;

/** How many times to halve an input that the model still says is too long. */
const SHRINK_ATTEMPTS = 3;

/** Does this error mean "your input was too long", as opposed to anything else? */
function isContextOverflow(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /maximum context length|context_length_exceeded|too many tokens|reduce the length/i.test(msg);
}

/**
 * Run an embedding call, halving the inputs each time the model says they are
 * too long.
 *
 * Truncating harder is safe here in a way it would not be for a chat call: an
 * embedding of the first half of a thread is a slightly worse vector, whereas
 * no embedding at all means the note is invisible to every similarity search
 * for ever. A worse answer beats an absent one.
 */
async function shrinkToFit<T>(
  inputs: string[],
  call: (inputs: string[]) => Promise<T>,
): Promise<T> {
  let cut = MAX_INPUT_CHARS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= SHRINK_ATTEMPTS; attempt += 1) {
    try {
      return await call(inputs.map((t) => t.slice(0, cut)));
    } catch (err) {
      if (!isContextOverflow(err)) throw err;
      lastError = err;
      cut = Math.floor(cut / 2);
      console.warn(`[intel:embed] input too long — retrying at ${cut} chars`);
    }
  }
  throw lastError;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: EMBEDDING_MODEL });

  const response = await shrinkToFit([text], (inputs) =>
    withActivity('embeddings', () =>
      client.embeddings.create({ model: EMBEDDING_MODEL, input: inputs[0] }),
    ),
  );

  return response.data[0].embedding;
}

/** Embeddings for several texts in one API call, in the order given. */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { client } = await getLLMClient({ provider: 'openrouter', modelId: EMBEDDING_MODEL });
  const response = await shrinkToFit(texts, (inputs) =>
    withActivity('embeddings', () =>
      client.embeddings.create({ model: EMBEDDING_MODEL, input: inputs }),
    ),
  );
  // The API may return results out of order; `index` is authoritative.
  const out: number[][] = new Array(texts.length);
  for (const item of response.data) out[item.index] = item.embedding;
  return out;
}
