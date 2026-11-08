import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { intakeIdeas, type IdeaInput } from '$lib/selfimprove/backlog';
import type { RequestHandler } from './$types';

/**
 * The build backlog's one intake, for producers that live outside this process.
 *
 * SR-Jkai-Core's trace page sends tool-chain findings to the backlog. It used to
 * call `addIdeas` on its own copy of `selfimprove/backlog.ts` — the writer from
 * before `intakeIdeas`, with no twin search and no citations — so a finding seen
 * on five traces became five rows. There is one backlog and one intake; the
 * other process hands its ideas here.
 *
 * The workflow doctor escalates here too since it moved to SR-Workflows
 * (2026-10-02): a finding that needs repo code becomes a `feature` item from
 * source `doctor`, deduped and cited by the same `intakeIdeas`.
 *
 * Narrow on purpose: only the `trace` and `doctor` sources are accepted, so
 * this lane cannot stand in for the engine's own nightly producers. Same
 * credential as the tool catalogue.
 *
 * `outcomes` is one entry per accepted idea, in order (`added`, `merged`,
 * `capped`, …), so a producer can say what actually landed.
 */
const ACCEPTED_SOURCES = new Set(['trace', 'doctor']);
const MAX_IDEAS = 20;
const KINDS = new Set(['tool', 'feature']);

function coerce(raw: unknown): IdeaInput | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.title !== 'string' || !r.title.trim()) return null;
	if (typeof r.detail !== 'string') return null;
	if (typeof r.kind !== 'string' || !KINDS.has(r.kind)) return null;
	if (typeof r.source !== 'string' || !ACCEPTED_SOURCES.has(r.source)) return null;
	const priority = Number(r.priority);
	return {
		title: r.title.trim(),
		detail: r.detail,
		kind: r.kind as IdeaInput['kind'],
		source: r.source as IdeaInput['source'],
		...(Number.isFinite(priority) ? { priority } : {}),
		...(typeof r.ref === 'string' && r.ref ? { ref: r.ref } : {}),
	};
}

export const POST: RequestHandler = async ({ request }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	const body = (await request.json().catch(() => null)) as { ideas?: unknown } | null;
	const raw = Array.isArray(body?.ideas) ? body.ideas : [];
	if (raw.length > MAX_IDEAS) throw error(400, `at most ${MAX_IDEAS} ideas per call`);
	const ideas = raw.map(coerce).filter((i): i is IdeaInput => i !== null);
	if (!ideas.length) throw error(400, 'no usable ideas');
	const result = await intakeIdeas(ideas);
	return json({ added: result.added, considered: ideas.length, outcomes: result.outcomes });
};
