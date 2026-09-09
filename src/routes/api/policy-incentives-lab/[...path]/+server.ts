import { error, isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { requireLabOwner } from '$lib/policy-incentives-lab/server/access';
import { candidateSchema, gameSchema, runConfigSchema, sensitivitySchema } from '$lib/policy-incentives-lab/schemas';
import { reviewItems, resetApprovals, validateModel } from '$lib/policy-incentives-lab/validation';
import { syntheticSource } from '$lib/policy-incentives-lab/synthetic';
import { createProject, getProject, hash, listProjects, loadVersion, runs, saveDraft, saveRun, sealVersion, versions } from '$lib/policy-incentives-lab/server/store';
import { ENGINE_VERSION, canonical, runSimulation, sensitivity } from '$lib/policy-incentives-lab/server/engine';
import { makeSource, MAX_UPLOAD_BYTES, parseUpload } from '$lib/policy-incentives-lab/server/input';
import { ProposalError, propose, taskSchema } from '$lib/policy-incentives-lab/server/extraction';
import { proposalTransport } from '$lib/policy-incentives-lab/server/provider';
import { reportMarkdown } from '$lib/policy-incentives-lab/server/report';
import { newDiskPath, saveBuffer } from '$lib/file-store/storage';

import { guidedModel } from '$lib/policy-incentives-lab/guided-model';
import { generateFirstLook } from '$lib/policy-incentives-lab/server/first-look';
import { firstLookMarkdown } from '$lib/policy-incentives-lab/first-look';

const uuid = z.uuid();
const revisionSchema = z.number().int().min(0);
const noCache = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
async function limitedRequest(request: Request): Promise<Request> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body required');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length;
      if (length > MAX_UPLOAD_BYTES + 65536) { await reader.cancel(); error(413, 'Request too large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return new Request(request.url, { method: request.method, headers: request.headers, body: Buffer.concat(chunks) });
}
async function handle(event: RequestEvent) {
  event.setHeaders(noCache);
  const owner = await requireLabOwner(event.locals);
  if (event.request.method !== 'GET' && event.request.headers.get('origin') && event.request.headers.get('origin') !== event.url.origin) error(403, 'Cross-origin write refused');
  const parts = (event.params.path ?? '').split('/').filter(Boolean);
  if (parts[0] !== 'projects') error(404, 'Not found');
  try {
    let body: Record<string, unknown> = {};
    let form: FormData | null = null;
    if (event.request.method !== 'GET') {
      const request = await limitedRequest(event.request);
      if (request.headers.get('content-type')?.includes('multipart/form-data')) form = await request.formData();
      else body = z.record(z.string(), z.unknown()).parse(await request.json());
    }
    if (parts.length === 1) {
      if (event.request.method === 'GET') return json(await listProjects(owner));
      if (event.request.method !== 'POST') error(405, 'Method not allowed');
      return json(await createProject(owner, z.string().trim().min(1).max(200).parse(body.title)), { status: 201 });
    }
    const id = uuid.parse(parts[1]); const resource = parts[2] ?? '';
    if (parts.length > 3) error(404, 'Not found');
    const project = await getProject(owner, id);
    const draft = structuredClone(project.payload);
    if (event.request.method === 'GET') {
      if (resource === '') return json({ ...project, versions: await versions(owner, id), runs: await runs(owner, id) });
      if (resource === 'first-look-report') {
        if (!draft.first_look || !draft.source) error(404, 'No first look saved');
        if (event.url.searchParams.get('format') === 'markdown') return new Response(firstLookMarkdown(project.title, draft.source.synthetic, draft.first_look), { headers: { ...noCache, 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename=policy-first-look.md' } });
        return json({ source: draft.source, first_look: draft.first_look });
      }
      if (resource === 'versions') return json(await versions(owner, id));
      if (resource === 'runs' || resource === 'sensitivity') return json(await runs(owner, id));
      if (resource === 'validation') return json({ errors: draft.source && draft.candidate ? validateModel(draft.candidate.game, draft.candidate.evidence, draft.source) : ['Add a source and candidate model'] });
      if (resource === 'reports') {
        const runId = uuid.parse(event.url.searchParams.get('run'));
        const run = (await runs(owner, id)).find(r => r.id === runId);
        if (!run) error(404, 'Run not found');
        const version = await loadVersion(owner, id, run.versionId);
        const reportSnapshot = structuredClone(version.payload);
        const runPayload = run.payload as { hypotheses?: typeof draft.hypotheses; attempts?: typeof draft.attempts };
        if (runPayload.hypotheses) reportSnapshot.hypotheses = runPayload.hypotheses;
        if (runPayload.attempts) reportSnapshot.attempts.push(...runPayload.attempts);
        if (event.url.searchParams.get('format') === 'markdown') return new Response(reportMarkdown(project.title, reportSnapshot, run), { headers: { ...noCache, 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="policy-analysis.md"' } });
        return new Response(JSON.stringify({ synthetic: version.payload.source?.synthetic, title: project.title, version, run }, null, 2), { headers: { ...noCache, 'content-type': 'application/json', 'content-disposition': 'attachment; filename="policy-analysis.json"' } });
      }
      const fields: Record<string, unknown> = { sources: draft.source, evidence: draft.candidate?.evidence, actors: draft.candidate?.game.actors, strategies: draft.candidate?.game.strategies, assumptions: draft.candidate?.game.assumptions, 'extraction-jobs': draft.attempts };
      if (resource in fields) return json(fields[resource] ?? null);
      error(404, 'Not found');
    }
    if (!['POST', 'PATCH'].includes(event.request.method)) error(405, 'Method not allowed');
    const revision = revisionSchema.parse(form ? Number(form.get('revision')) : body.revision);
    if (revision !== project.revision) error(409, 'Revision conflict; reload before editing');
    const record = (action: string, item_ids: string[] = []) => draft.activity.push({ at: new Date().toISOString(), action, item_ids });
    if (resource === 'sources' || resource === 'uploads') {
      delete draft.attachment_path;
      let source;
      if (body.synthetic === true) source = { ...syntheticSource, document_hash: hash(syntheticSource.text_sections[0].text) };
      else {
        if ((form ? form.get('public_material') : body.public_material) !== (form ? 'true' : true)) throw new Error('Confirm public or synthetic material only');
        const metadata = form ? JSON.parse(String(form.get('metadata'))) : body.metadata;
        if (form) {
          const file = form.get('file');
          if (!(file instanceof File)) throw new Error('File required');
          const bytes = Buffer.from(await file.arrayBuffer());
          source = makeSource(metadata, await parseUpload(bytes, file.name, file.type), bytes);
          const path = newDiskPath(file.name); await saveBuffer(path, bytes);
          draft.attachment_path = path;
        } else {
          const text = z.string().min(1).max(250000).parse(body.text);
          source = makeSource(metadata, [{ id: 'section-1', location: 'Section 1', text }], Buffer.from(text));
        }
      }
      draft.source = source; draft.candidate = null; draft.hypotheses = [];
      const firstLook = await generateFirstLook(source, proposalTransport(true));
      draft.first_look = firstLook.report; draft.attempts.push(...firstLook.attempts);
      record('Source revised; draft model cleared; unreviewed first look saved');
    } else if (resource === 'guided-model') {
      if (!draft.source) throw new Error('Add a source first');
      if (draft.candidate) throw new Error('An outline already exists; amend its items instead of replacing it');
      draft.candidate = guidedModel(body.outline, owner); record('Reviewer created an unapproved qualitative outline; numerical values unknown');
    } else if (resource === 'first-look') {
      if (!draft.source) throw new Error('Add a source first');
      const firstLook = await generateFirstLook(draft.source, proposalTransport(true));
      draft.first_look = firstLook.report; draft.attempts.push(...firstLook.attempts); record('Unreviewed first look refreshed');
    } else if (resource === 'extraction-jobs') {
      if (!draft.source) throw new Error('Add a source first');
      const task = taskSchema.parse(body.task);
      if (task === 'explain-results' || (task === 'red-team' && body.run_id)) {
        const selected = (await runs(owner, id)).find(r => r.id === body.run_id);
        if (!selected) throw new Error('Select a saved deterministic run');
        const version = await loadVersion(owner, id, selected.versionId);
        try {
          const proposal = await propose(version.payload.source!, task, version.payload.candidate, proposalTransport(), selected.payload);
          if (!('hypotheses' in proposal.output)) throw new Error('Expected narrative hypotheses');
          return json(await saveRun(id, version.id, selected.engineVersion, {
            ...(selected.payload as object), source_run_id: selected.id,
            annotation_timestamp: new Date().toISOString(), hypotheses: proposal.output.hypotheses, attempts: proposal.attempts,
          }), { status: 201 });
        } catch (e) {
          if (e instanceof ProposalError) { draft.attempts.push(...e.attempts); record(`Narrative failed for saved run ${selected.id}`); await saveDraft(owner, id, revision, draft); }
          throw e;
        }
      }
      try {
        const proposal = await propose(draft.source, task, draft.candidate, proposalTransport());
        draft.attempts.push(...proposal.attempts);
        if ('game' in proposal.output) { draft.candidate = proposal.output; draft.hypotheses = []; }
        else draft.hypotheses = proposal.output.hypotheses;
        record(`Proposal completed: ${task}`);
      } catch (e) {
        if (e instanceof ProposalError) { draft.attempts.push(...e.attempts); record(`Proposal failed: ${task}`); await saveDraft(owner, id, revision, draft); }
        throw e;
      }
    } else if (['model', 'evidence', 'actors', 'strategies', 'assumptions'].includes(resource)) {
      if (!draft.source) throw new Error('Add a source first');
      let candidate;
      if (resource === 'model') candidate = candidateSchema.parse(body.candidate);
      else {
        if (!draft.candidate) throw new Error('Add a model first');
        candidate = candidateSchema.parse(resource === 'evidence' ? { ...draft.candidate, evidence: body.items } : { ...draft.candidate, game: { ...draft.candidate.game, [resource]: body.items } });
      }
      candidate.game = resetApprovals(candidate.game);
      draft.candidate = candidate; draft.hypotheses = []; record('Model edited; all dependent approvals invalidated');
    } else if (resource === 'approvals') {
      if (!draft.candidate) throw new Error('Add a model first');
      const ids = z.array(z.string()).min(1).max(2000).parse(body.item_ids);
      const items = reviewItems(draft.candidate.game);
      if (ids.some(id => !items.some(item => item.id === id))) throw new Error('Unknown approval item');
      for (const item of items.filter(i => ids.includes(i.id))) {
        item.approval_status = { status: 'approved', approved_by: owner, approved_at: new Date().toISOString() };
        if ('approved_by_user' in item) item.approved_by_user = true;
      }
      record('User approved specified items', ids);
    } else if (resource === 'versions') {
      if (!draft.source || !draft.candidate) throw new Error('Source and model required');
      const errors = validateModel(draft.candidate.game, draft.candidate.evidence, draft.source);
      if (errors.length) return json({ error: 'Model is not ready', errors }, { status: 422 });
      return json(await sealVersion(owner, id, revision), { status: 201 });
    } else if (resource === 'runs' || resource === 'sensitivity') {
      const version = await loadVersion(owner, id, uuid.parse(body.version_id));
      const source = version.payload.source!; const { game, evidence } = version.payload.candidate!;
      gameSchema.parse(game);
      const config = resource === 'runs' ? runConfigSchema.parse(body.config) : sensitivitySchema.parse(body.sensitivity);
      const result = resource === 'runs' ? runSimulation(game, evidence, source, runConfigSchema.parse(config)) : sensitivity(game, evidence, source, config);
      return json(await saveRun(id, version.id, ENGINE_VERSION, { policy_version: source.document_hash, approved_model_version: version.version, model_hash: version.modelHash, config, engine_version: ENGINE_VERSION, timestamp: new Date().toISOString(), result, result_hash: hash(canonical(result)) }), { status: 201 });
    } else error(404, 'Not found');
    return json(await saveDraft(owner, id, revision, draft));
  } catch (e) {
    if (isHttpError(e)) throw e;
    const message = e instanceof Error ? e.message : 'Request failed';
    const status = message.includes('not found') ? 404 : message.includes('Revision conflict') ? 409 : 400;
    return json({ error: message }, { status });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
