import { CONCURRENCY_OPTIONS, DEFAULT_CONCURRENCY, DEPTH_LIMITS, PATTERNS, PERSONA_STAGE, REPORT_SECTIONS, RESULT_KINDS, SCENARIOS, SYNTHESIS_STAGE, type Artefact, type Concurrency, type StageInput, type StageOutput } from './contracts';
import { scoreExploits } from './exposure';
import { clampWarnings, PolicyError, triageArtefacts, triageOutput } from './validation';
import { modelApplicability } from './models';
import { crossIdentityHints, preserveAmbiguity } from './entities';
import { runPolicyTests } from './tests';
import { documentShingles, quotesDocument } from './query-guard';
import { partitionFrontMatter, skippedNote } from './front-matter';
import type { ModelCall } from './server/provider';
import type { Research } from './server/research';
import type { PersonaPrior } from './personas';

/** Compact summaries of this reader's OTHER completed assessments, for stage 11. */
export type Neighbour = { id: string; title: string; policyArea: string | null; jurisdiction: string | null; completedAt: string | null; artefacts: { id: string; kind: string; label: string; statement: string; entityType?: string; aliases?: string[] }[] };
export type Neighbours = () => Promise<Neighbour[]>;
/** What this reader's persona library already holds about the actors in this run. */
export type Personas = (actors: Artefact[]) => Promise<PersonaPrior[]>;
/**
 * `concurrency` lives HERE and not on `StageInput`, and that is load-bearing.
 *
 * `StageInput` is spread into the model-call payload, and `provider.ts` hashes
 * that payload verbatim to key the response cache. A new field on it changes
 * every hash, so every completed call in an in-flight assessment would miss its
 * cache and be paid for again — which is exactly what a resumed run must not do.
 * How many agents a stage uses is how it is EXECUTED, never what the model is
 * asked, so it belongs beside `signal` with the other execution concerns.
 */
export type PipelineDeps = { model: ModelCall; research: Research; signal: AbortSignal; neighbours?: Neighbours; personas?: Personas; concurrency?: Concurrency | null; onProgress?: (phase: string) => void };

/**
 * Stages that fan out over a list — one call per passage, actor, pattern or
 * scenario — no longer let a single bad call end the stage.
 *
 * The first production run died this way: passage 1 of 20 succeeded, passage 10
 * failed, and the other eighteen were never attempted. A unit of fan-out that
 * fails is now recorded as a gap and the sweep continues; the coverage rules at
 * the bottom of `executeStage` decide whether what came back is an assessment or
 * a failure. `CONSECUTIVE_LIMIT` stops a dead provider burning through the whole
 * list to reach the same conclusion twenty calls later.
 */
const CONSECUTIVE_LIMIT = 3;

/**
 * A slow provider is not a dead one, and must not be reported as one.
 *
 * A provider that is down refuses the connection in milliseconds; three of those
 * in a row genuinely means stop. A model that is merely too slow fails at the
 * per-call deadline, minutes apart, and each failure is about ONE unit of work —
 * so three of them said "the provider is unavailable" about a bridge that was
 * healthy, and ended a 72-page assessment at page 5. Timeouts get their own,
 * longer count and their own message.
 */
const CONSECUTIVE_TIMEOUT_LIMIT = 6;

/** Ceilings on a stage's assembled output, which no envelope bounds. */
const MAX_STAGE_ARTEFACTS = 4000;
const MAX_REFS = 200;

export async function executeStage(input: StageInput, deps: PipelineDeps): Promise<StageOutput & { rejected: number }> {
  const { stage } = input;
  const limits = DEPTH_LIMITS[input.depth ?? 'standard'];
  // A concurrency nobody offers is a request the run cannot honour; take the
  // default rather than failing a stage over it, exactly as model and effort do.
  const lanes: number = (CONCURRENCY_OPTIONS as readonly number[]).includes(deps.concurrency as Concurrency) ? (deps.concurrency as Concurrency) : DEFAULT_CONCURRENCY;
  const output: StageOutput = { artefacts: [], warnings: [] };
  let consecutive = 0;
  let rejected = 0;
  // A holder, not a bare `let`: control-flow narrowing pins a `let` initialised
  // to null at `null` for the outer scope, so every read after the closure that
  // assigns it types as `never`.
  const fault: { last: PolicyError | null } = { last: null };

  // Identifiers are capped at 100 characters, and a fan-out key can be a resolved
  // actor id that is nearly that long on its own. The prefix is therefore a short
  // sequence number, stable because every fan-out below iterates in sorted order
  // — and, when those units overlap, because `fanOut` reserves every slot in that
  // order BEFORE it dispatches anything.
  let seq = 0;
  const reserve = (key: string) => (key === 'main' ? 'main' : String(seq++).padStart(3, '0'));

  /**
   * The model call on its own.
   *
   * Nothing here reads `output`. That is the property the whole fan-out rests on:
   * a unit's request is built from `input.artefacts` and its own context, never
   * from what another unit produced, so overlapping them cannot change what any
   * one of them is asked.
   */
  const send = async (key: string, context: Artefact[], slot: string, extra: Record<string, unknown> = {}) => {
    deps.signal.throwIfAborted();
    return deps.model(stage, key, { ...input, artefacts: context, idPrefix: `s${stage}_${slot}_`, targetActorId: stage === 3 || stage === 4 || stage === 10 || stage === PERSONA_STAGE ? key : null, targetPattern: stage === 7 ? key : null, targetScenario: stage === 9 ? key : null, modelLibrary: stage === 7 ? modelApplicability(input.artefacts) : undefined, ...extra });
  };

  /**
   * Triage one response and fold it into the stage.
   *
   * ORDER-DEPENDENT, deliberately: triage validates a unit against everything
   * accumulated so far, so a reference to an earlier unit's artefact resolves and
   * the same reference from an earlier unit does not. Callers must absorb in unit
   * order or they change which artefacts are quarantined.
   */
  const absorb = (raw: unknown) => {
    const result = triageOutput(raw, stage, [...input.artefacts, ...output.artefacts]);
    // Retrieved sources are minted by the retrieval adapter and nowhere else. The
    // kind is permitted at this stage so the server's own rows validate, which
    // would otherwise let a model hand back a source — and a URL — of its own.
    rejected += result.rejected.length;
    const authored = result.artefacts.filter((a) => a.kind === 'research_source');
    if (authored.length) {
      result.artefacts = result.artefacts.filter((a) => a.kind !== 'research_source');
      result.warnings.push(`${authored.length} model-authored source${authored.length === 1 ? '' : 's'} were discarded: evidence comes from retrieval, never from the model.`);
    }
    output.artefacts.push(...result.artefacts); output.warnings.push(...result.warnings);
    return result;
  };

  const request = async (key: string, context: Artefact[], extra: Record<string, unknown> = {}) =>
    absorb(await send(key, context, reserve(key), extra));

  /** A failed unit becomes a recorded gap — until too many in a row fail. */
  const gap = (describe: string, err: unknown) => {
    deps.signal.throwIfAborted();
    if (!(err instanceof PolicyError)) throw err;
    fault.last = err;
    consecutive++;
    output.warnings.push(`${describe} could not be assessed: ${err.message} It is missing from this stage.`);
    const limit = err.code === 'timeout' ? CONSECUTIVE_TIMEOUT_LIMIT : CONSECUTIVE_LIMIT;
    if (consecutive >= limit) {
      throw new PolicyError(err.code, err.code === 'timeout'
        ? `${limit} parts of this stage in a row ran out of time. The model chosen for this assessment is too slow for this document, not unavailable — re-run it on a faster one. ${err.message}`
        : `${limit} consecutive parts of this stage failed for the same reason. ${err.message}`);
    }
    return null;
  };

  /** `request`, but a failure becomes a recorded gap instead of a dead stage. */
  const attempt = async (key: string, context: Artefact[], describe: string, extra: Record<string, unknown> = {}) => {
    try {
      const result = await request(key, context, extra);
      consecutive = 0;
      return result;
    } catch (err) {
      return gap(describe, err);
    }
  };

  /** One unit of a fan-out: the arguments `attempt` would have been given. */
  type Unit = { key: string; context: Artefact[]; describe: string; extra?: Record<string, unknown> };

  /**
   * Run a fan-out with `lanes` units in flight, and fold the results in order.
   *
   * The calls may overlap because they are independent (see `send`). Everything
   * after the response is not: slots number the artefact ids and triage sees the
   * running total, so slots are reserved in unit order before dispatch and the
   * responses are absorbed in unit order afterwards. A stage run at any number of
   * agents therefore yields the same artefacts, the same ids and the same
   * warnings as a serial one — `pipeline.test.ts` asserts that directly.
   *
   * Batched rather than a rolling pool so a dead provider is still caught
   * promptly: `CONSECUTIVE_LIMIT` is checked as each batch is folded, so at most
   * `lanes - 1` calls can already have been spent when it trips.
   */
  const fanOut = async (units: Unit[], onResult?: (unit: Unit, result: ReturnType<typeof absorb> | null) => void) => {
    for (let i = 0; i < units.length; i += lanes) {
      const batch = units.slice(i, i + lanes);
      const slots = batch.map((u) => reserve(u.key));
      const settled = await Promise.all(batch.map((u, k) =>
        send(u.key, u.context, slots[k], u.extra ?? {}).then(
          (raw) => ({ raw, err: null as unknown }),
          (err: unknown) => ({ raw: null as unknown, err }),
        )));
      // Real progress, reported as each batch lands. The worker turns this into a
      // liveness beat, so a stage that is working says so — and one that has
      // stopped working stops saying so, which is the case the probe exists for.
      deps.onProgress?.(`${Math.min(i + batch.length, units.length)} of ${units.length}`);
      for (let k = 0; k < batch.length; k++) {
        const { raw, err } = settled[k];
        let result: ReturnType<typeof absorb> | null;
        try {
          if (err) throw err;
          result = absorb(raw);
          consecutive = 0;
        } catch (e) {
          result = gap(batch[k].describe, e);
        }
        onResult?.(batch[k], result);
      }
    }
  };

  /**
   * The assumptions a stage's own output is obliged to cite.
   *
   * A model's `assumptions`, a scenario's `assumptions`, an exploitation play's
   * `preconditions` and a finding's `hypothesisIds` all name assumption records,
   * and every one of them must also appear in `refs`. The model can only name an
   * identifier it was shown, so an assumption shed from the context is an
   * assumption the stage cannot cite — it invents one and the artefact is
   * quarantined, or it reaches for whatever it did see. Assumptions are the
   * connective tissue of the whole red-team argument and they are produced early,
   * which puts them below the conclusions in the shed order; pinning is what
   * keeps them. Seen live on 2026-09-10: the exploitation playbook ran with 24
   * results and ZERO assumptions in context.
   */
  const hypotheses = input.artefacts.filter((a) => a.kind === 'assumption').map((a) => a.id);

  /**
   * What the reader's persona library already holds about the bodies in this run.
   *
   * A prior is CONTEXT, never evidence. It was drawn from other papers about
   * other policies, and a red team that imports last month's conclusion about a
   * department has stopped reading this one. The provenance rules do the
   * enforcing — a persona is neither a passage nor a retrieved source, so
   * nothing resting on it alone can reach `hasSource` — and the prompt says so
   * in words as well.
   *
   * Failing to READ the library must not cost a stage. The assessment is
   * complete without it; it is merely less informed.
   */
  const priors = new Map<string, PersonaPrior>();
  if (deps.personas && [4, 10, PERSONA_STAGE].includes(stage)) {
    try {
      const resolved = input.artefacts.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'));
      for (const prior of await deps.personas(resolved)) priors.set(prior.actorId, prior);
    } catch {
      output.warnings.push('The persona library could not be read, so this stage ran without what earlier assessments established about these bodies.');
    }
  }

  if (stage === 1) {
    const passages = input.artefacts.filter((a) => a.kind === 'passage');
    // A cover, a copyright notice and a contents list are not policy, and asking
    // this stage's contract of them is what ended the first real white-paper
    // assessment. They stay in the document record; they are simply not sent,
    // and every one of them is named below.
    const { analyse, skipped, distrusted } = partitionFrontMatter(passages);
    if (skipped.length) output.warnings.push(skippedNote(skipped, passages.length));
    if (distrusted) output.warnings.push('Almost every page looked like front matter, which is far more likely to be a fault in the extraction than a document with no policy in it, so every page was analysed.');
    await fanOut(analyse.map((passage) => ({ key: passage.id, context: [passage], describe: `Passage “${passage.label}”`, extra: { protect: [passage.id] } })));
  } else if (stage === 3) {
    /**
     * ONE CALL PER BODY, not one call for the entire policy.
     *
     * This stage used to make a SINGLE call carrying the whole assessment and
     * asked it to return the complete relationship graph in one response. On the
     * 72-page white paper of 2026-09-10 that call carried 1,120,463 characters and
     * came back with 4,004 output tokens: **10 nodes and 8 edges for 347 resolved
     * actors**. Every other heavy stage already fans out — 72 calls for 72 pages,
     * one per body for the profiles — and this one did not.
     *
     * The input was never the constraint. Raising the context ceiling let the
     * stage see everything and shed nothing, and it produced 18 artefacts anyway,
     * because one response cannot carry a policy's structure however much it is
     * shown. The output is the constraint, and a fan-out is the only thing that
     * moves it.
     *
     * Grouped by canonical label for the same reason stage 4 is: the resolution
     * stage deliberately refuses to merge rows sharing a name, and asking the same
     * question of 42 Skills England rows separately is 42 times the cost for a
     * worse answer than asking once with all 42 rows' evidence.
     */
    const resolved = input.artefacts.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'));
    const groups = new Map<string, Artefact[]>();
    for (const a of resolved) {
      const key = a.label.trim().toLowerCase();
      const bucket = groups.get(key);
      if (bucket) bucket.push(a); else groups.set(key, [a]);
    }
    // Everything an edge is allowed to point AT. Shared by every call because a
    // relationship needs both of its endpoints present to be assertable at all.
    const endpoints = input.artefacts.filter((a) => ['mechanism', 'claim'].includes(a.kind) || (a.kind === 'actor' && a.id.startsWith('s2_')));
    const mentionsOf = (a: Artefact) => (Array.isArray(a.data.mentions) ? a.data.mentions.length : 0);
    await fanOut([...groups.values()].map((members) => {
      const primary = [...members].sort((x, y) => mentionsOf(y) - mentionsOf(x) || x.id.localeCompare(y.id))[0];
      const own = input.artefacts.filter((a) => members.some((m) => a.id === m.id || a.refs.includes(m.id)));
      return {
        key: primary.id,
        context: [...new Set([...own, ...endpoints])],
        describe: `Relationships for ${primary.label}`,
        extra: { protect: members.map((m) => m.id) },
      };
    }));
  } else if (stage === 4) {
    const toProfile = input.artefacts.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'));
    /**
     * ONE CALL PER BODY, not per row.
     *
     * Entity resolution refuses to merge rows that merely share a label, and it
     * is right to — a shared name is not a shared body. But it left 352 rows for
     * 135 labels on the 72-page white paper (Skills England 42 times, Employers
     * 26, Government 21), and this stage asked the same question of each one,
     * separately, each seeing only its own row's evidence. That is 2.6x the calls
     * for WORSE profiles: a profile of Employers drawn from 26 mentions beats 26
     * profiles drawn from one each.
     *
     * So the CALL is shared and the IDENTITY is not. The rows stay distinct
     * artefacts with their own ids and provenance; the profile records which of
     * them it was drawn for in `coversActorIds`, and nothing anywhere claims they
     * are one entity.
     */
    const mentionsOf = (a: Artefact) => (Array.isArray(a.data.mentions) ? a.data.mentions.length : 0);
    const groups = new Map<string, Artefact[]>();
    // Insertion order follows `input.artefacts`, which loads ordered by id, so
    // the group sequence — and therefore every `idPrefix` — stays deterministic.
    for (const a of toProfile) {
      const key = a.label.trim().toLowerCase();
      const bucket = groups.get(key);
      if (bucket) bucket.push(a); else groups.set(key, [a]);
    }
    const units = [...groups.values()].map((members) => {
      // The best-evidenced row speaks for the group, so the call is pinned to an
      // id that genuinely exists and carries the most to reason from.
      const primary = [...members].sort((x, y) => mentionsOf(y) - mentionsOf(x) || x.id.localeCompare(y.id))[0];
      const related = new Set(members.flatMap((m) => [m.id, ...m.refs, ...input.artefacts.filter((a) => a.fromId === m.id || a.toId === m.id || a.refs.includes(m.id)).flatMap((a) => [a.id, ...a.refs, a.fromId ?? '', a.toId ?? ''])]));
      const context = input.artefacts.filter((a) => related.has(a.id));
      const missing = members.filter((m) => !context.includes(m));
      return {
        key: primary.id,
        members,
        context: [...context, ...missing],
        describe: members.length === 1
          ? `The incentive profile for ${primary.label}`
          : `The incentive profile for ${primary.label} (${members.length} source rows)`,
        extra: { protect: [primary.id], priorPersona: priors.get(primary.id) ?? null },
      };
    });
    const coveredBy = new Map<string, Artefact[]>(units.map((u) => [u.key, u.members]));
    await fanOut(units, (unit, result) => {
      const members = coveredBy.get(unit.key) ?? [];
      const produced = result?.artefacts.filter((a) => a.kind === 'profile') ?? [];
      // Stamped here, by the server, from what it already knows — never asked of
      // the model, which cannot be trusted to enumerate a grouping it did not do.
      for (const profile of produced) profile.data.coversActorIds = members.map((m) => m.id);
      if (result && !produced.length) {
        const label = members[0]?.label ?? unit.key;
        output.warnings.push(members.length === 1
          ? `${label} has no incentive profile in this assessment; its motivations were not modelled.`
          : `${label} has no incentive profile in this assessment, covering ${members.length} source rows; its motivations were not modelled.`);
      }
    });
  } else if (stage === 7 || stage === 9) {
    const context = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    // `modelApplicability` counts the graph assertions that trigger each pattern
    // and the result was read only as prose. A pattern with no trigger at all is
    // a fact about the policy, worth saying in the assessment.
    if (stage === 7) {
      const unsupported = modelApplicability(input.artefacts).filter((p) => !p.triggerEvidence.length).map((p) => p.pattern.replaceAll('_', ' '));
      if (unsupported.length) output.warnings.push(`${unsupported.length} of ${PATTERNS.length} interaction patterns have no supporting relationship in the policy graph and were assessed on inference alone: ${unsupported.join(', ')}.`);
    }
    await fanOut((stage === 7 ? PATTERNS : SCENARIOS).map((key) => ({ key, context, describe: `The ${key.replaceAll('_', ' ')} ${stage === 7 ? 'interaction model' : 'scenario'}`, extra: { protect: hypotheses } })));
  } else if (stage === 6) {
    // One evidence pass per research question, so retrieved sources are read
    // against the question they answer rather than all at once. Both the depth
    // and the size of a single call improve; the shipped code sent everything in
    // one request and hit the context ceiling as soon as research succeeded.
    const inventory = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    // Evidence is evidence FOR OR AGAINST a claim, so this is the one stage whose
    // output is about the material the shed order calls superseded. Shed the
    // claims and the model, asked for evidence and shown none of them, emits the
    // claims instead: three consecutive responses with nothing usable in them,
    // and a dead stage. Measured live on 2026-09-10, questions 6, 7 and 8.
    const claims = inventory.filter((a) => a.kind === 'claim').map((a) => a.id);
    const answerable = input.artefacts.filter((a) => a.kind === 'research_question')
      .map((question) => ({ question, sources: input.artefacts.filter((a) => a.kind === 'research_source' && a.data.questionId === question.id) }))
      .filter(({ sources }) => sources.length);
    await fanOut(answerable.map(({ question, sources }) => ({ key: question.id, context: [...inventory, question, ...sources], describe: `Evidence for “${question.label}”`, extra: { protect: [question.id, ...sources.map((a) => a.id), ...claims] } })));
    // The document's own evidence pass runs last and alone: its key is `main`, so
    // it takes no sequence number and cannot be reordered by the fan-out above.
    await attempt('main', inventory, 'Evidence drawn from the policy document itself', { protect: claims });
  } else if (stage === 8) {
    output.artefacts = runPolicyTests(input.artefacts, { discarded: input.graphLoss ?? 0, uncovered: graphUncovered(input.artefacts) });
  } else if (stage === 10) {
    // Every resolved actor with a profile is a candidate for the red team, and
    // `limits.actors` bounds how many get one. The most connected go first —
    // an actor nothing depends on has little to exploit — and the rest are named
    // in a warning rather than dropped silently.
    const profiles = input.artefacts.filter((a) => a.kind === 'profile');
    const { actors: ranked, basis } = rankActors(input.artefacts, profiles);
    // Which signal chose them is part of the finding, not a footnote: on a thin
    // graph this is "who the paper talks about most", not "who the policy runs
    // through", and those are different claims.
    const order = basis === 'connectivity'
      ? 'They are the least connected in the policy graph, not the least important.'
      : 'The policy graph recorded too few relationships to rank on, so these were ordered by how often the document names them rather than by how much of the policy runs through them.';
    if (basis === 'prominence') output.warnings.push('The policy graph held no relationships for the profiled actors, so the red team selected its actors by how prominently the document names them rather than by connectivity. Treat the choice of who was red-teamed as a reflection of the document, not of the policy structure.');
    if (ranked.length > limits.actors) output.warnings.push(`${ranked.length - limits.actors} of ${ranked.length} profiled actors were not red-teamed in this pass: ${ranked.slice(limits.actors).map((a) => a.label).join(', ')}. ${order} A deep run covers more of them.`);
    const base = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node', 'profile'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
    await fanOut(ranked.slice(0, limits.actors).map((actor) => ({
      key: actor.id,
      context: [...base, ...profiles.filter((p) => p.data.actorId === actor.id)],
      describe: `Exploitation plays for ${actor.label}`,
      extra: { protect: [actor.id, ...profiles.filter((p) => p.data.actorId === actor.id).map((p) => p.id), ...hypotheses], priorPersona: priors.get(actor.id) ?? null },
    })));
    scoreExploits(output.artefacts);
  } else if (stage === PERSONA_STAGE) {
    // The library is a bonus, and it must never cost a completed assessment. The
    // report was written at the previous stage; a dead provider here is a warning
    // about the library, not a failed run — so every failure is caught, and the
    // stage is exempt from the "produced nothing" rule at the bottom.
    const profiles = input.artefacts.filter((a) => a.kind === 'profile');
    const ranked = rankActors(input.artefacts, profiles).actors.slice(0, limits.actors);
    for (const actor of ranked) {
      const own = profiles.filter((p) => p.data.actorId === actor.id);
      const plays = input.artefacts.filter((a) => a.kind === 'exploit' && a.data.actorId === actor.id);
      const context = [actor, ...own, ...plays];
      try {
        await request(actor.id, context, { protect: context.map((a) => a.id), priorPersona: priors.get(actor.id) ?? null });
      } catch (err) {
        deps.signal.throwIfAborted();
        if (!(err instanceof PolicyError)) throw err;
        output.warnings.push(`${actor.label} was not written to the persona library: ${err.message} The assessment itself is unaffected.`);
      }
    }
    if (!output.artefacts.length && ranked.length) output.warnings.push('No actor could be written to the persona library on this run. Nothing in the assessment above depends on it.');
  } else if (stage === 11) {
    // Failing to LOAD the comparison must not cost the assessment its stage; the
    // rest of this run is unaffected by whether the other papers could be read.
    let neighbours: Neighbour[] = [];
    try { neighbours = (await deps.neighbours?.()) ?? []; }
    catch { output.warnings.push('The other assessments on this account could not be read, so cross-policy exposure was not examined.'); }
    if (!neighbours.length) {
      output.warnings.push('No other completed policy assessment was available to compare, so cross-policy exposure could not be examined. Weaknesses that only appear when policies coexist are outside this assessment.');
    } else {
      const context = input.artefacts.filter((a) => !['passage', 'research_source', 'alias', 'node'].includes(a.kind) && (a.kind !== 'actor' || a.id.startsWith('s2_')));
      const identity = crossIdentityHints(input.artefacts, neighbours);
      await attempt('main', context, `Cross-policy exposure against ${neighbours.length} other assessment${neighbours.length === 1 ? '' : 's'}`, { neighbours, identity });
      const known = new Set(neighbours.map((n) => n.id));
      const invented = output.artefacts.filter((a) => a.kind === 'cross_policy' && !known.has(String(a.data.otherAnalysisId)));
      if (invented.length) {
        output.artefacts = output.artefacts.filter((a) => !invented.includes(a));
        output.warnings.push(`${invented.length} cross-policy claim${invented.length === 1 ? '' : 's'} named an assessment that was not supplied and ${invented.length === 1 ? 'was' : 'were'} discarded.`);
      }
    }
  } else {
    // Full source text was inspected passage by passage. Later stages receive the
    // structured inventory plus source quotes, not a silently truncated paper.
    const context = input.artefacts.filter((a) => a.kind !== 'passage' && (stage !== 2 || a.kind === 'actor') && (stage < 3 || a.kind !== 'actor' || a.id.startsWith('s2_')));
    // A finding must cite a test, model, scenario, exploitation play or
    // cross-policy exposure, so synthesis pins every one of them into the call.
    // Without that the context budget shed the lot — they are the last things
    // produced and carry the lowest confidence — and the model, still required
    // to cite a result, invented identifiers for results it had never seen.
    const protect = stage === SYNTHESIS_STAGE ? [...context.filter((a) => (RESULT_KINDS as readonly string[]).includes(a.kind)).map((a) => a.id), ...hypotheses] : [];
    await request('main', context, protect.length ? { protect } : {});
  }

  const pursue = async (questions: Artefact[], round: number) => {
    for (const question of questions) question.data.priority = Number(priority(question).toFixed(4));
    questions.sort((a, b) => priority(b) - priority(a));
    // A query that reproduces the paper verbatim would put an unpublished policy
    // into a third party's query logs. The prompt asks for a bounded public
    // query; this is what enforces it.
    const corpus = documentShingles(input.artefacts);
    const safe = questions.filter((q) => !quotesDocument(String(q.data.searchStrategy ?? ''), corpus));
    if (safe.length < questions.length) output.warnings.push(`${questions.length - safe.length} research question${questions.length - safe.length === 1 ? ' was' : 's were'} not searched because the query quoted the policy document; the document is not sent to a search provider.`);
    if (!safe.length) return;
    const researched = await deps.research(safe, deps.signal, limits.results);
    output.artefacts.push(...researched.artefacts);
    output.warnings.push(...researched.warnings.map((w) => round > 1 ? `Enquiry round ${round}: ${w}` : w));
  };

  const kinds = (...wanted: string[]) => wanted.filter((k) => !output.artefacts.some((a) => a.kind === k));
  if (stage === 1) {
    // The model scores every assumption on importance, uncertainty and consequence.
    // Stamp the product so the research planner, the report's high-risk chapter and
    // the dashboard all rank by the same reproducible figure.
    for (const a of output.artefacts) if (a.kind === 'assumption') a.data.priority = Number(priority(a).toFixed(4));
    const missing = kinds('claim', 'mechanism', 'assumption', 'actor');
    if (missing.length) throw new PolicyError(fault.last?.code ?? 'coverage', `The document did not yield the required claim, mechanism, assumption and actor inventory.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  }
  if (stage === 2) {
    // A real 20-page policy yields ~50 source mentions, and asking one call to
    // claim every last one of them is the all-or-nothing rule again: on
    // 2026-09-09 a live run reached this stage with 224 artefacts and died here.
    // So: name what was missed and ask for JUST those, twice, then require a
    // strict majority and record the rest as a gap the reader can see.
    const mentions = input.artefacts.filter((a) => a.kind === 'actor');
    const unclaimed = () => mentions.filter((m) => !output.artefacts.some((a) => a.kind === 'actor' && ((a.data.mentions as string[]) ?? []).includes(m.id)));
    for (let round = 1; round <= 2; round++) {
      const missed = unclaimed();
      if (!missed.length) break;
      await attempt(`unclaimed${round}`, [...input.artefacts.filter((a) => a.kind === 'actor'), ...output.artefacts.filter((a) => a.kind === 'actor')], `${missed.length} unresolved source mention${missed.length === 1 ? '' : 's'}`, { unclaimedMentions: missed.map((m) => ({ id: m.id, label: m.label })) });
    }
    output.artefacts = preserveAmbiguity(output.artefacts, input.artefacts);
    const missed = unclaimed();
    if (missed.length * 2 >= mentions.length) throw new PolicyError('coverage', `Entity resolution claimed only ${mentions.length - missed.length} of ${mentions.length} source mentions.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
    if (missed.length) output.warnings.push(`${missed.length} of ${mentions.length} source mentions were never resolved into a named body: ${missed.slice(0, 8).map((m) => m.label).join(', ')}${missed.length > 8 ? `, and ${missed.length - 8} more` : ''}. Those actors are absent from the graph, the profiles and the red team.`);
  }
  if (stage === 3) {
    if (kinds('edge').length) throw new PolicyError('coverage', 'The graph stage did not produce any inspectable relationships.');
    // "One node and one edge survived" is not a graph. Every later structural
    // check reads this stage's output, so losing the majority of it here would be
    // laundered into confident-looking verdicts drawn from almost nothing.
    if (rejected > output.artefacts.length) throw new PolicyError('coverage', `More of the policy graph was discarded than kept (${rejected} discarded, ${output.artefacts.length} retained). The structural checks would have been drawn from a fragment.`);
  }
  if (stage === 4 && !output.artefacts.some((a) => a.kind === 'profile')) throw new PolicyError(fault.last?.code ?? 'coverage', `No actor could be profiled, so there are no incentives to reason about.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  if (stage === 5) {
    const questions = output.artefacts.filter((a) => a.kind === 'research_question');
    if (!questions.length || questions.length > limits.questions || questions.length !== output.artefacts.length) throw new PolicyError('coverage', `Research planning must produce between one and ${limits.questions} targeted questions.`);
    await pursue(questions, 1);
    // Rounds beyond the first are the line of enquiry: each one is planned from
    // what the last one actually found, not from the policy document again. A
    // round that raises no new question ends the enquiry rather than padding it.
    for (let round = 2; round <= limits.rounds; round++) {
      const asked = output.artefacts.filter((a) => a.kind === 'research_question');
      const sources = output.artefacts.filter((a) => a.kind === 'research_source');
      const before = output.artefacts.length;
      const context = input.artefacts.filter((a) => a.kind !== 'passage' && (a.kind !== 'actor' || a.id.startsWith('s2_')));
      await attempt(`round${round}`, [...context, ...asked, ...sources], `Follow-up enquiry round ${round}`, { enquiryRound: round, remainingQuestions: limits.questions, protect: sources.map((a) => a.id) });
      const followUps = output.artefacts.slice(before).filter((a) => a.kind === 'research_question');
      if (!followUps.length) { output.warnings.push(`Enquiry round ${round} raised no further question, so the enquiry stopped there.`); break; }
      await pursue(followUps, round);
    }
  }
  if (stage === 7) requireMajority(output, PATTERNS, (a) => String(a.data.pattern), 'interaction model', fault.last);
  if (stage === 9) requireMajority(output, SCENARIOS, (a) => String(a.data.scenario), 'scenario', fault.last);
  if (stage === 10 && !output.artefacts.some((a) => a.kind === 'exploit')) throw new PolicyError(fault.last?.code ?? 'coverage', `No actor could be red-teamed, so the assessment has no exploitation playbook.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
  if (stage === SYNTHESIS_STAGE) {
    // A missing chapter is a gap the reader should see named, not a reason to
    // throw away a whole assessment. Only the headline, the exploitation
    // chapter and the redesign options are load-bearing.
    const missing = REPORT_SECTIONS.filter((section) => !output.artefacts.some((a) => a.data.section === section));
    const core = missing.filter((m) => (['executive_assessment', 'high_risk_assumptions', 'exploitation'] as string[]).includes(m));
    if (core.length || !output.artefacts.some((a) => a.kind === 'recommendation')) {
      // Naming the missing chapters describes the symptom. What a reader needs is
      // why they are missing, which is always the reason the findings themselves
      // were quarantined — and that reason is already recorded.
      throw new PolicyError('coverage', `The final assessment omitted ${core.length ? core.join(', ').replaceAll('_', ' ') : 'its redesign options'}.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);
    }
    if (missing.length) output.warnings.push(`The final assessment has no ${missing.map((m) => m.replaceAll('_', ' ')).join(', ')} section. Read it as incomplete on those grounds.`);
  }
  // Two stages may legitimately produce nothing. A reader with a single policy
  // has no cross-policy exposure, and saying so is the answer; and the persona
  // library is written after the report, so an empty one costs the assessment
  // nothing that was not already delivered.
  if (!output.artefacts.length && stage !== 11 && stage !== PERSONA_STAGE) throw new PolicyError(fault.last?.code ?? 'coverage', `This stage produced no artefacts.${fault.last ? ` Last reason: ${fault.last.message}` : ''}`);

  // Quarantining is what keeps a run alive, and it is also how a thin assessment
  // could pass as a complete one: a stage whose graph was half discarded still
  // satisfies its coverage rule, and the deterministic checks then read the
  // gutted graph. So say what was lost, in the assessment, in figures.
  const discarded = output.warnings.filter((w) => w.includes('discarded and are not part of this assessment')).length;
  if (discarded) output.warnings.unshift(`${discarded} group${discarded === 1 ? '' : 's'} of model output were discarded in this stage. What follows is drawn from what survived; treat structural checks over this stage's relationships as a floor, not a verdict.`);
  const final = triageArtefacts(output, stage, input.artefacts);
  rejected += final.rejected.length;
  // A single response is bounded by its envelope; the assembled stage was not,
  // and `policy_provenance` grows with the square of a runaway fan-out.
  const kept = final.artefacts.slice(0, MAX_STAGE_ARTEFACTS);
  const warnings = [...final.warnings];
  if (final.artefacts.length > kept.length) warnings.push(`This stage produced ${final.artefacts.length} items and only the first ${MAX_STAGE_ARTEFACTS} were kept. The assessment is incomplete for this stage.`);
  for (const a of kept) {
    if (a.refs.length <= MAX_REFS) continue;
    warnings.push(`“${a.label}” cited ${a.refs.length} sources; only the first ${MAX_REFS} are recorded.`);
    a.refs = a.refs.slice(0, MAX_REFS);
  }
  return { artefacts: kept, warnings: clampWarnings(warnings), rejected };
}

/**
 * A fixed library is only a guarantee if most of it actually ran. Without a strict
 * majority the stage has not done its job; with one, the absences are named in the
 * assessment and the run continues as `completed_with_gaps`.
 */
function requireMajority(output: StageOutput, library: readonly string[], of: (a: Artefact) => string, noun: string, last: PolicyError | null) {
  const covered = new Set(output.artefacts.map(of));
  const assessed = library.length - library.filter((key) => !covered.has(key)).length;
  const missing = library.filter((key) => !covered.has(key));
  if (assessed * 2 <= library.length) throw new PolicyError(last?.code ?? 'coverage', `Only ${assessed} of ${library.length} ${noun}s could be assessed.${last ? ` Last reason: ${last.message}` : ''}`);
  if (missing.length) output.warnings.push(`${missing.length} of ${library.length} ${noun}s were not assessed: ${missing.map((m) => m.replaceAll('_', ' ')).join(', ')}. Treat the assessment as incomplete on those grounds.`);
}

/**
 * Profiled actors, most prominent first — and HONEST about which signal ordered
 * them.
 *
 * Degree in the policy graph is the signal we want: it is a crude proxy for how
 * much of the policy runs through an actor. The problem is what happened when it
 * was absent. On the 72-page white paper of 2026-09-10 the knowledge graph
 * produced FOUR edges, so degree was zero for every actor and the sort fell
 * through to its tie-break — `id.localeCompare` — which is alphabetical order.
 * The red team's twelve slots were filled alphabetically and the report presented
 * them as the most connected actors in the policy.
 *
 * A tie-break silently becoming the entire ranking is the failure. So there is
 * now a real second signal between them: how many source mentions the resolution
 * stage attributed to an actor, and how many rows share its label. Both say
 * "this body is all over the document", which is what degree was standing in for,
 * and neither needs a graph. `basis` tells the caller which one actually did the
 * ordering so the assessment can say so.
 */
export function rankActors(all: Artefact[], profiles: Artefact[]): { actors: Artefact[]; basis: 'connectivity' | 'prominence' } {
  const degree = new Map<string, number>();
  for (const edge of all) {
    if (edge.kind !== 'edge') continue;
    for (const end of [edge.fromId, edge.toId]) if (end) degree.set(end, (degree.get(end) ?? 0) + 1);
  }
  // How many actor rows carry each label: a body the document names forty times
  // is prominent in it, whatever the graph managed to record.
  const byLabel = new Map<string, number>();
  for (const a of all) {
    if (a.kind !== 'actor') continue;
    const key = a.label.trim().toLowerCase();
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
  }
  const mentions = (a: Artefact) => (Array.isArray(a.data.mentions) ? a.data.mentions.length : 0);
  const rows = (a: Artefact) => byLabel.get(a.label.trim().toLowerCase()) ?? 1;

  const actors = profiles
    .map((p) => all.find((a) => a.kind === 'actor' && a.id === p.data.actorId))
    .filter((a): a is Artefact => !!a)
    .sort((a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      mentions(b) - mentions(a) ||
      rows(b) - rows(a) ||
      a.id.localeCompare(b.id));

  return { actors, basis: actors.some((a) => (degree.get(a.id) ?? 0) > 0) ? 'connectivity' : 'prominence' };
}

/**
 * The share of resolved actors the graph never said anything ABOUT.
 *
 * MEASURED FROM EDGES, and it used to be measured from `node` artefacts —
 * records the graph stage was asked to emit alongside its edges, one per entity
 * it touched, which nothing in the application ever rendered. Two things were
 * wrong with counting them:
 *
 *   THEY COUNTED THE WRONG POPULATION. A node was emitted for a mechanism and a
 *   claim as readily as for an actor, and the ratio was taken against the actor
 *   count alone, then clamped at 1. Best Start in Life held 712 nodes for 511
 *   resolved actors, so the ratio was 1.39, the clamp made it 1, and this
 *   returned ZERO uncovered — perfect coverage — for a graph whose edges reached
 *   267 of those 511 bodies. The synthetic library assessment reported zero the
 *   same way on 4 of 11.
 *
 *   A NODE WAS NEVER COVERAGE. The checks read EDGES. A record saying "this
 *   entity is in the graph", with no relationship attached, tells a structural
 *   check about authority, funding or accountability precisely nothing.
 *
 * So the guard written to stop a verdict being drawn from a fragment was being
 * fed the one number that could not see the fragment, and on two of five live
 * assessments it reported full coverage while half the policy's bodies had no
 * stated relationship at all. Best Start's twelve checks returned four
 * `high_risk` and six `moderate_risk` verdicts from that graph.
 *
 * COUNTED PER CANONICAL LABEL GROUP, not per row, because that is the unit this
 * stage works in: it makes one call per group and hands that call every member's
 * evidence. Entity resolution deliberately refuses to merge rows that merely
 * share a name, so one body arrives here as several candidate rows — 479 of Best
 * Start in Life's 511 were `_candidate_` splits — and a graph that wires the body
 * once has covered it. Per row that same graph reads as 47.7% uncovered and
 * would gut its own checks; per group it is 14.2%, which is what actually
 * happened: 248 of 289 groups carry a relationship.
 *
 * The population that matters is unchanged for the case this guard exists for.
 * The Post-16 white paper's graph reached three bodies out of 352 rows, and it is
 * still far past the ceiling however they are grouped.
 *
 * Exported because the worker needs the same number before the stage runs, and
 * it used to carry its own copy of the arithmetic.
 */
export function graphUncovered(all: Artefact[]): number {
  const actors = all.filter((a) => a.kind === 'actor' && a.id.startsWith('s2_'));
  if (!actors.length) return 0;
  const reached = new Set<string>();
  for (const edge of all) {
    if (edge.kind !== 'edge') continue;
    for (const end of [edge.fromId, edge.toId]) if (end) reached.add(end);
  }
  // The same key the stage groups its fan-out by, so the two cannot drift.
  const groups = new Map<string, boolean>();
  for (const actor of actors) {
    const key = actor.label.trim().toLowerCase();
    groups.set(key, (groups.get(key) ?? false) || reached.has(actor.id));
  }
  const covered = [...groups.values()].filter(Boolean).length;
  return 1 - covered / groups.size;
}

export function priority(a: Artefact): number {
  return Number(a.data.importance) * Number(a.data.uncertainty) * Number(a.data.consequence);
}
