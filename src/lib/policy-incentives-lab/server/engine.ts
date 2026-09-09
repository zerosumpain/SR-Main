import { mulberry32 } from '../../simulation/random';
import { runConfigSchema, sensitivitySchema, type PolicyGame, type RunConfig, type PolicySource, type EvidenceItem } from '../schemas';
import { profileKey, profiles, validateModel } from '../validation';

export const ENGINE_VERSION = '1.0.0';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export interface Calculation { profile: Record<string, string>; outcomes: Record<string, number>; payoffs: Record<string, number>; terms: { actor: string; metric: string; value: number; weight: number; product: number }[] }
export interface Result {
  engine_version: string; simulation_type: RunConfig['simulation_type']; parameters: Record<string, number>;
  equilibria: Calculation[]; rounds: (Calculation & { round: number })[]; terminal_outcomes: Calculation[];
  notices: string[];
}
export function resolveParameters(game: PolicyGame, config: RunConfig): Record<string, number> {
  const params: Record<string, number> = {};
  for (const a of game.assumptions) {
    if (a.type !== 'numerical' || a.value_or_range === null) continue;
    const v = a.value_or_range;
    params[a.id] = typeof v === 'number' ? v : v.central;
  }
  for (const [key, value] of Object.entries(config.parameters)) {
    const a = game.assumptions.find(a => a.id === key);
    if (!a || a.type !== 'numerical' || a.value_or_range === null) throw new Error(`Unknown parameter: ${key}`);
    const range = a.value_or_range;
    if (typeof range === 'number' ? value !== range : value < range.low || value > range.high) throw new Error(`Parameter outside approved value/range: ${key}`);
    params[key] = value;
  }
  return params;
}
export function calculate(game: PolicyGame, profile: Record<string, string>, parameters: Record<string, number>): Calculation {
  const row = game.payoff_table.find(r => profileKey(r.profile) === profileKey(profile));
  if (!row) throw new Error('Missing payoff profile');
  const outcomes = Object.fromEntries(Object.entries(row.outcome_values).map(([m, a]) => [m, parameters[a]]));
  const payoffs = Object.fromEntries(game.actors.map(a => [a.id, 0]));
  const terms = game.payoff_components.map(p => {
    const value = outcomes[p.outcome_metric_id]; const weight = parameters[p.weight_or_range];
    const product = value * weight;
    payoffs[p.actor_id] += product;
    return { actor: p.actor_id, metric: p.outcome_metric_id, value, weight, product };
  });
  if ([...Object.values(outcomes), ...Object.values(payoffs)].some(v => !Number.isFinite(v))) throw new Error('Non-finite calculation');
  return { profile: { ...profile }, outcomes, payoffs, terms };
}
export function runSimulation(game: PolicyGame, evidence: EvidenceItem[], source: PolicySource, input: RunConfig): Result {
  const config = runConfigSchema.parse(input);
  const errors = validateModel(game, evidence, source);
  if (errors.length) throw new Error(errors.join('\n'));
  const parameters = resolveParameters(game, config);
  const all = profiles(game).map(p => calculate(game, p, parameters));
  if (all.length * game.actors.length * config.rounds > 2_000_000) throw new Error('Run exceeds synchronous computation budget; reduce strategies or rounds');
  const calculated = new Map(all.map(r => [profileKey(r.profile), r]));
  const lookup = (profile: Record<string, string>) => {
    const row = calculated.get(profileKey(profile));
    if (!row) throw new Error('Missing payoff profile');
    return row;
  };
  const choices = (actor: string) => game.strategies.filter(s => s.actor_id === actor).map(s => s.id).sort();
  const result: Result = { engine_version: ENGINE_VERSION, simulation_type: config.simulation_type, parameters, equilibria: [], rounds: [], terminal_outcomes: [], notices: ['Exploratory scenarios, not forecasts. Artificial agents do not reproduce real human behaviour.', 'Payoffs use only approved numerical assumptions. Qualitative preconditions and causal statements document the table; they are not executable code. All listed strategies must be feasible in this normal-form representation.'] };
  if (config.simulation_type === 'normal-form') {
    result.equilibria = all.filter(row => game.actors.every(a => choices(a.id).every(s => lookup({ ...row.profile, [a.id]: s }).payoffs[a.id] <= row.payoffs[a.id])));
    result.terminal_outcomes = result.equilibria;
    result.notices.push(result.equilibria.length === 0 ? 'No pure-strategy Nash equilibrium exists. Mixed equilibria are not calculated.' : `${result.equilibria.length} pure-strategy Nash equilibrium/equilibria. Existence does not predict selection.`);
  } else if (config.simulation_type === 'sequential') {
    if (game.actors.some(a => a.information_hidden.length > 0) || game.interactions.length !== 1 || game.interactions[0].information_structure !== 'observable' || game.interactions[0].actor_ids.length !== game.actors.length) {
      result.notices.push('Backward induction is not supported for hidden information, incomplete orders or multiple interaction sequences. No sequential result calculated.');
      return result;
    }
    const order = game.interactions[0].actor_ids;
    const solve = (depth: number, p: Record<string, string>): Calculation[] => {
      if (depth === order.length) return [lookup(p)];
      const actor = order[depth];
      const branches = choices(actor).map(s => solve(depth + 1, { ...p, [actor]: s }));
      // A branch outcome can be optimal for some equilibrium continuation iff
      // it beats the minimum available continuation payoff in every alternative.
      return branches.flatMap((branch, i) => branch.filter(outcome => branches.every((other, j) => i === j || outcome.payoffs[actor] >= Math.min(...other.map(o => o.payoffs[actor])))));
    };
    result.terminal_outcomes = solve(0, {});
    result.notices.push(`Backward induction: ${result.terminal_outcomes.length} possible equilibrium terminal profiles, including tied continuations. Finite perfect-information game; each actor moves once in the approved order.`);
  } else {
    const rng = mulberry32(config.seed);
    let previous = Object.fromEntries(game.actors.map(a => { const c = choices(a.id); return [a.id, c[Math.floor(rng() * c.length)]]; }));
    const history: Calculation[] = [];
    const pickBest = (ranked: { s: string; value: number }[]) => {
      const max = Math.max(...ranked.map(r => r.value)); const tied = ranked.filter(r => r.value === max);
      return tied[Math.floor(rng() * tied.length)].s;
    };
    for (let round = 1; round <= config.rounds; round++) {
      const profile: Record<string, string> = {};
      for (const actor of game.actors) {
        const rule = game.decision_rules.find(r => r.actor_id === actor.id)!;
        const ranked = choices(actor.id).map(s => ({ s, value: lookup({ ...previous, [actor.id]: s }).payoffs[actor.id] }));
        let selected: string;
        if (rule.rule === 'risk-averse') selected = pickBest(choices(actor.id).map(s => ({ s, value: Math.min(...all.filter(r => r.profile[actor.id] === s).map(r => r.payoffs[actor.id])) })));
        else if (rule.rule === 'satisfice') selected = ranked.find(r => r.value >= parameters[rule.threshold_assumption!])?.s ?? pickBest(ranked);
        else if (rule.rule === 'imitate' && history.length) selected = history.reduce((best, r) => r.payoffs[actor.id] > best.payoffs[actor.id] ? r : best).profile[actor.id];
        else if (rule.rule === 'rule-based') {
          const entry = rule.schedule.find(s => round <= s.through_round);
          if (!entry) throw new Error(`Approved rule schedule does not cover round ${round}`);
          selected = entry.strategy_id;
        } else selected = pickBest(ranked);
        profile[actor.id] = selected;
      }
      const row = lookup(profile);
      history.push(row); result.rounds.push({ ...row, round }); previous = profile;
    }
    result.terminal_outcomes = history.slice(-1);
    result.notices.push('Simultaneous updates: maximise/satisfice use the previous profile as the expected next state; risk-averse uses worst-case payoff; imitation repeats this actor’s best observed strategy. Initial strategies and payoff ties use the stored seed.');
  }
  return result;
}
export function sensitivity(game: PolicyGame, evidence: EvidenceItem[], source: PolicySource, input: unknown) {
  const { config, ranges } = sensitivitySchema.parse(input);
  if (new Set(ranges.map(r => r.assumption_id)).size !== ranges.length) throw new Error('Duplicate sensitivity parameter');
  if (profiles(game).length * game.actors.length * config.rounds * (1 + ranges.reduce((n, r) => n + r.steps, 0)) > 2_000_000) throw new Error('Sensitivity exceeds synchronous computation budget; reduce ranges or rounds');
  const base = runSimulation(game, evidence, source, config);
  const samples = ranges.map(range => {
    const a = game.assumptions.find(a => a.id === range.assumption_id);
    const v = a?.value_or_range;
    if (!v || typeof v === 'number' || range.low < v.low || range.high > v.high) throw new Error('Sensitivity range must be inside an approved uncertain range');
    const points = Array.from({ length: range.steps }, (_, i) => {
      const value = i === range.steps - 1 ? range.high : range.low + (range.high - range.low) * i / (range.steps - 1);
      return { value, result: runSimulation(game, evidence, source, { ...config, parameters: { ...config.parameters, [range.assumption_id]: value } }) };
    });
    const terminal = points.flatMap(p => p.result.terminal_outcomes);
    const outcome_ranges = Object.fromEntries(game.outcome_metrics.map(m => [m.id, terminal.length ? { low: Math.min(...terminal.map(r => r.outcomes[m.id])), high: Math.max(...terminal.map(r => r.outcomes[m.id])) } : null]));
    return { assumption_id: a!.id, points, outcome_ranges, changes_terminal_profiles: points.some(p => canonical(p.result.terminal_outcomes.map(r => r.profile)) !== canonical(base.terminal_outcomes.map(r => r.profile))) };
  });
  return { engine_version: ENGINE_VERSION, method: 'One parameter at a time; no probability interpretation. A structural change means a different terminal strategy profile. Numeric ranges are reported without an arbitrary materiality score.', base, samples };
}
