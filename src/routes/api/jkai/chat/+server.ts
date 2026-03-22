import type { RequestHandler } from './$types';
import { collectResponse, extractCodeBlock } from '$lib/jkai/client';
import { execInSandbox, getSandboxStatus } from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { jkaiConversations, jkaiMessages } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ChatMessage } from '$lib/jkai/types';
import { validateSession } from '$lib/auth';

const MAX_EXEC_ROUNDS = 10;

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!validateSession(cookies.get('admin_session'))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json();
  const {
    messages: inputMessages,
    conversationId: inputConvId,
  }: {
    messages: ChatMessage[];
    conversationId?: string;
  } = body;

  if (!inputMessages?.length) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, any>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Create or get conversation
        let convId = inputConvId;
        if (!convId) {
          const [conv] = await db
            .insert(jkaiConversations)
            .values({ title: inputMessages[0].content.slice(0, 100) })
            .returning();
          convId = conv.id;
        }

        send({ type: 'meta', conversationId: convId });

        // Save the user message
        const lastUserMsg = inputMessages[inputMessages.length - 1];
        if (lastUserMsg.role === 'user') {
          await db.insert(jkaiMessages).values({
            conversationId: convId,
            role: 'user',
            content: lastUserMsg.content,
            attachments: lastUserMsg.attachments ?? [],
          });
        }

        // Build working conversation (what we send to the LLM each round)
        const conversation: ChatMessage[] = [...inputMessages];
        // Accumulate all assistant content across rounds for saving
        let savedContent = '';
        let round = 0;

        while (round < MAX_EXEC_ROUNDS) {
          round++;

          // Get one LLM turn (will stop at end of first code block if present)
          let turnContent: string;
          try {
            turnContent = await collectResponse(conversation, (token) => {
              send({ type: 'text', content: token });
            });
          } catch (err: any) {
            send({ type: 'error', content: err.message || 'LLM call failed' });
            break;
          }

          // Check for a code block in this turn
          const block = extractCodeBlock(turnContent);

          if (!block) {
            // No code — this is a plain text response. We're done.
            savedContent += turnContent;
            break;
          }

          // There's a code block. Record the text before it + the block itself.
          savedContent += turnContent;

          // Check sandbox
          const status = await getSandboxStatus();
          if (!status.running) {
            send({ type: 'exec_status', content: 'Sandbox is not running. Start it from /jkai/admin.' });
            savedContent += '\n[Sandbox not running]';
            break;
          }

          // Execute
          send({ type: 'exec_start', lang: block.lang, code: block.code });

          let command: string;
          if (block.lang === 'python') {
            command = `python3 << 'JKAI_EOF'\n${block.code}\nJKAI_EOF`;
          } else if (['javascript', 'typescript', 'node'].includes(block.lang)) {
            command = `node -e ${JSON.stringify(block.code)}`;
          } else {
            command = block.code;
          }

          const result = await execInSandbox(command, 60000);

          const output = [
            result.stdout ? result.stdout.trim() : '',
            result.stderr ? result.stderr.trim() : '',
            result.exitCode !== 0 ? `[exit code: ${result.exitCode}]` : '',
          ]
            .filter(Boolean)
            .join('\n')
            || '(no output)';

          send({ type: 'exec_result', output, exitCode: result.exitCode });

          // Add this turn + execution result to the conversation for next round
          conversation.push({ role: 'assistant', content: turnContent });
          conversation.push({
            role: 'user',
            content: `[EXECUTION RESULT]\n\`\`\`\n${output}\n\`\`\``,
          });

          // Continue the loop — LLM will see the result and respond with next step
        }

        // Save the full assistant response
        if (savedContent) {
          await db.insert(jkaiMessages).values({
            conversationId: convId!,
            role: 'assistant',
            content: savedContent,
          });
        }

        await db
          .update(jkaiConversations)
          .set({ updatedAt: new Date() })
          .where(eq(jkaiConversations.id, convId!));

        send({ type: 'done', content: '' });
      } catch (err: any) {
        send({ type: 'error', content: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
