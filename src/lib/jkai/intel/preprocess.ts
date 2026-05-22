import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { readBuffer } from '$lib/jkai/media/storage';
import type { JkaiAttachment } from '$lib/db/schema';

export async function ocrHandwriting(attachment: JkaiAttachment): Promise<string> {
  const buffer = await readBuffer(attachment.diskPath);
  const base64 = buffer.toString('base64');
  const mimeType = attachment.mimeType || 'image/jpeg';

  const modelCtx = await resolveDefaultModel('builder');
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

export async function transcribeAudio(attachment: JkaiAttachment): Promise<string> {
  const buffer = await readBuffer(attachment.diskPath);

  const modelCtx = await resolveDefaultModel('builder');
  const { client } = await getLLMClient(modelCtx);

  try {
    const file = new File([new Uint8Array(buffer)], attachment.originalName ?? 'audio.webm', {
      type: attachment.mimeType,
    });
    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });
    return transcription.text;
  } catch (err) {
    console.error('[intel] Audio transcription failed:', err);
    return `[Audio note — transcription failed: ${attachment.originalName ?? 'unknown'}]`;
  }
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
