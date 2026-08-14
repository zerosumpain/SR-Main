/**
 * Questions worth asking jkai about a finished run, and the prompt that carries
 * one over.
 *
 * "Ask jkai about it" used to hand the composer the fragment
 * `About my research on "<topic>" — ` and stop. That is not a question, so the
 * button did not ask anything: it opened a chat and left you to write the thing
 * you had pressed a button to avoid writing.
 *
 * Two changes here. The suggestions are built FROM the report — its gaps,
 * contradictions, hypotheses and follow-ups — so they are questions this
 * particular run actually raised, not a generic menu. And the prompt names the
 * session id and the tools that can read it, so jkai answers from the run's own
 * facts and sources instead of from whatever it happens to know.
 */

export interface AskReport {
  knowledge_gaps?: { gap: string; severity?: string }[];
  hypotheses?: { hypothesis: string; suggested_queries?: string[] }[];
  contradictions_map?: { tension: string }[];
  suggested_followups?: { question: string; context?: string }[];
}

export interface AskContext {
  sessionId: string;
  topic: string;
  /** Resolved entity names, most central first. */
  topEntities?: string[];
  report?: AskReport | null;
}

export interface SuggestedQuestion {
  /** Stable per session — used as the `{#each}` key. */
  id: string;
  /** What the chip says. Short enough to read at a glance. */
  label: string;
  /** What actually gets asked. */
  question: string;
}

/** Trim to a chip-sized label without cutting mid-word. */
function shorten(text: string, max = 58): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 20 ? lastSpace : max)}…`;
}

/**
 * The questions this run raised.
 *
 * Ordered by how often they are the thing someone actually wants: the summary
 * judgement first, then what the run failed to establish, then the specific
 * disputes and leads. Capped at eight — a wall of chips is a menu nobody reads.
 */
export function suggestQuestions(ctx: AskContext): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const report = ctx.report ?? {};
  const topic = ctx.topic;

  out.push({
    id: 'verdict',
    label: 'So what? Give me the judgement',
    question:
      `Read my research session ${ctx.sessionId} on "${topic}". ` +
      'Give me the bottom line in plain English: what does the evidence actually support, ' +
      'how confident should I be, and what would change your mind?',
  });

  out.push({
    id: 'holes',
    label: 'Where is this weakest?',
    question:
      `Look at my research session ${ctx.sessionId} on "${topic}" and tell me where it is weakest — ` +
      'thin sourcing, claims resting on a single source, anything the sources do not actually establish. ' +
      'Be blunt about what I should not rely on.',
  });

  for (const [i, c] of (report.contradictions_map ?? []).slice(0, 2).entries()) {
    out.push({
      id: `tension-${i}`,
      label: shorten(`Settle: ${c.tension}`),
      question:
        `In my research session ${ctx.sessionId} on "${topic}", the sources disagree: ${c.tension}. ` +
        'Work out which account is better supported and why, using the session\'s own sources.',
    });
  }

  for (const [i, f] of (report.suggested_followups ?? []).slice(0, 2).entries()) {
    out.push({
      id: `followup-${i}`,
      label: shorten(f.question),
      question:
        `${f.question}\n\nThis follows on from my research session ${ctx.sessionId} on "${topic}"` +
        `${f.context ? `, which noted: ${f.context}` : ''}.`,
    });
  }

  const worstGap = (report.knowledge_gaps ?? []).find((g) => g.severity === 'high')
    ?? (report.knowledge_gaps ?? [])[0];
  if (worstGap) {
    out.push({
      id: 'gap',
      label: shorten(`Close the gap: ${worstGap.gap}`),
      question:
        `My research session ${ctx.sessionId} on "${topic}" left this unanswered: ${worstGap.gap}. ` +
        'What would it take to answer it, and can you make a start now?',
    });
  }

  const hypothesis = (report.hypotheses ?? [])[0];
  if (hypothesis) {
    out.push({
      id: 'hypothesis',
      label: shorten(`Test: ${hypothesis.hypothesis}`),
      question:
        `Test this hypothesis from my research session ${ctx.sessionId} on "${topic}": ` +
        `${hypothesis.hypothesis}. Say what evidence would confirm or kill it, and check what the session already has.`,
    });
  }

  const entity = (ctx.topEntities ?? [])[0];
  if (entity) {
    out.push({
      id: 'entity',
      label: shorten(`Who is ${entity}, and why do they matter?`),
      question:
        `In my research session ${ctx.sessionId} on "${topic}", ${entity} is the most central entity. ` +
        'Explain who or what that is, why it sits at the centre, and what it connects.',
    });
  }

  return out.slice(0, 8);
}

/**
 * Wrap a question with the context jkai needs to answer it from the run.
 *
 * The session id and the tool names are both stated. Without the id the tools
 * cannot be pointed anywhere; without the nudge to use them the model answers
 * from general knowledge and the reply has nothing to do with the research
 * sitting on the screen behind it.
 */
export function buildAskPrompt(question: string, ctx: AskContext): string {
  const trimmed = question.trim();
  // A question that already names the session (every suggestion above does)
  // must not have the reference stapled on twice.
  const needsAnchor = !trimmed.includes(ctx.sessionId);
  const anchor = needsAnchor
    ? `\n\nThis is about my research session ${ctx.sessionId} — "${ctx.topic}".`
    : '';
  return (
    `${trimmed}${anchor}\n\n` +
    `Use research_query (id: ${ctx.sessionId}) and research_get_report to answer from that session's ` +
    'own facts and sources. Cite the sources you rely on. If the session does not settle it, say so ' +
    'plainly rather than filling the gap from general knowledge.'
  );
}

/**
 * The `/jkai` URL that opens a fresh thread and sends the question.
 *
 * `new=1` forces a new conversation — without it the prompt lands in whatever
 * thread was last open and inherits its context. `send=1` is what makes the
 * button ask rather than merely type.
 */
export function askUrl(question: string, ctx: AskContext): string {
  const prompt = buildAskPrompt(question, ctx);
  return `/jkai?new=1&send=1&q=${encodeURIComponent(prompt)}`;
}
