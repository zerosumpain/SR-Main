import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { readBuffer } from '$lib/jkai/media/storage';
import type { JkaiAttachment } from '$lib/db/schema';

export async function ocrHandwriting(attachment: JkaiAttachment): Promise<string> {
  const buffer = await readBuffer(attachment.diskPath);
  const base64 = buffer.toString('base64');
  const mimeType = attachment.mimeType || 'image/jpeg';

  const modelCtx = await resolveDefaultModel();
  const { client, model } = await getLLMClient(modelCtx);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This is a photo of handwritten notes. Transcribe all the text you can see, preserving the structure as much as possible. If there are diagrams, describe them briefly. Return only the transcribed text.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

/**
 * Transcribe a voice note. Returns null when it cannot be done.
 *
 * This used to POST to the `whisper-1` transcriptions endpoint through the
 * OpenRouter gateway. OpenRouter does not serve that endpoint, so the call
 * ALWAYS threw, and the catch stored `"[Audio note — transcription failed: …]"`
 * as the note body — which was then handed to the entity extractor, so every
 * voice note quietly contributed a placeholder string to the knowledge graph
 * instead of its contents.
 *
 * The codebase already had a working path: /drive's file indexer transcribes
 * audio with OpenRouter's multimodal `input_audio` content part on a chat
 * completion. Reusing it means one transcription implementation, one model
 * choice, and one place to fix.
 *
 * Returning null rather than a placeholder is the important half — the caller
 * must be able to tell "no transcript" from "a transcript that happens to read
 * like an error", and must not extract entities from either.
 */
export async function transcribeAudio(attachment: JkaiAttachment): Promise<string | null> {
  const buffer = await readBuffer(attachment.diskPath);
  const { transcribeAudioBestEffort } = await import('$lib/file-index/describe');
  const text = await transcribeAudioBestEffort(buffer, attachment.mimeType ?? 'audio/webm');
  if (!text) {
    console.error('[intel] Audio transcription produced nothing for', attachment.originalName);
    return null;
  }
  return text;
}

export function parseEmail(rawText: string): { subject: string; from: string; body: string } {
  const lines = rawText.split('\n');
  let subject = '';
  let from = '';
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];
    if (line.toLowerCase().startsWith('subject:')) {
      subject = line.slice(8).trim();
    } else if (line.toLowerCase().startsWith('from:')) {
      from = line.slice(5).trim();
    } else if (line.trim() === '' && (subject || from)) {
      bodyStart = i + 1;
      break;
    }
  }

  let body = lines.slice(bodyStart).join('\n');

  const sigPatterns = [/^--\s*$/m, /^Sent from my /m, /^Get Outlook for /m];
  for (const pat of sigPatterns) {
    const match = body.search(pat);
    if (match > 0) {
      body = body.slice(0, match).trim();
    }
  }

  return { subject, from, body: body.trim() };
}
