/** Shared JSON contracts for saved operations; no credentials or provider calls. */
export interface ParamContract {
  name: string; in: 'path' | 'query' | 'body' | 'header'; required?: boolean;
  description?: string; example?: string; default?: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'; enum?: Array<string | number | boolean>;
}
export interface OutputContract {
  name: string; required?: boolean; type?: 'string' | 'number' | 'boolean' | 'object' | 'array'; emptyWhenMissing?: boolean;
}
export function parameterSchema(params: ParamContract[]) {
  return { type: 'object', additionalProperties: false,
    properties: Object.fromEntries(params.map(p => [p.name, {
      ...(p.type ? { type: p.type } : p.in !== 'body' ? { type: ['string', 'number', 'boolean'] } : {}),
      ...(p.enum ? { enum: p.enum } : {}), description: p.description ?? '',
    }])), required: params.filter(p => p.required && (p.default == null || p.default === '')).map(p => p.name),
  };
}
export function resolveParameters(params: ParamContract[], supplied: Record<string, unknown>) {
  if (!supplied || Array.isArray(supplied) || typeof supplied !== 'object') throw new Error('params must be an object');
  const unknown = Object.keys(supplied).filter(k => !params.some(p => p.name === k));
  if (unknown.length) throw new Error(`Unknown integration parameter(s): ${unknown.join(', ')}. Allowed: ${params.map(p => p.name).join(', ') || '(none)'}`);
  const values: Record<string, unknown> = Object.create(null); const defaultsApplied: string[] = [];
  for (const p of params) {
    let value = Object.hasOwn(supplied, p.name) ? supplied[p.name] : undefined;
    if (value == null && p.default != null && p.default !== '') { value = p.default; defaultsApplied.push(p.name);
      if (p.type === 'number' || p.type === 'integer') value = Number(value);
      else if (p.type === 'boolean' && ['true', 'false'].includes(String(value))) value = value === 'true';
    }
    if (value == null || value === '') { if (p.required) throw new Error(`Missing required integration parameter: ${p.name}`); continue; }
    if (p.type && !(p.type === 'array' ? Array.isArray(value) : p.type === 'integer' ? Number.isInteger(value) : p.type === 'object' ? typeof value === 'object' && !Array.isArray(value) : typeof value === p.type)) throw new Error(`Integration parameter ${p.name} must be ${p.type}`);
    if (!p.type && p.in !== 'body' && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Integration parameter ${p.name} must be a scalar`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Integration parameter ${p.name} must be finite`);
    if (p.enum && !p.enum.includes(value as string)) throw new Error(`Integration parameter ${p.name} must be one of ${p.enum.join(', ')}`);
    values[p.name] = value;
  }
  const scope = Object.fromEntries(params.filter(p => p.in !== 'header' && !/secret|token|password|auth|key/i.test(p.name) && p.name in values).map(p => [p.name, values[p.name]]));
  return { values, defaultsApplied, scope };
}
export function assessOutputs(outputs: OutputContract[], values: Record<string, unknown>, json: unknown) {
  const missingOutputs: string[] = []; const invalidOutputs: string[] = []; let arrays = 0; let records = 0;
  for (const output of outputs) {
    let value = values[output.name];
    if (value == null && output.type === 'array' && output.emptyWhenMissing && !values[`${output.name}_error`]) value = values[output.name] = [];
    if (value == null) { values[output.name] = null; if (output.required !== false || values[`${output.name}_error`]) missingOutputs.push(output.name); }
    else if (output.type && !(output.type === 'array' ? Array.isArray(value) : output.type === 'object' ? typeof value === 'object' && !Array.isArray(value) : typeof value === output.type)) invalidOutputs.push(output.name);
    if (Array.isArray(value)) { arrays++; records += value.length; }
  }
  if (!outputs.length && Array.isArray(json)) { arrays++; records += json.length; }
  return { outcome: missingOutputs.length || invalidOutputs.length ? 'incomplete' : arrays && !records ? 'empty' : 'data', missingOutputs, invalidOutputs, emptyOutputs: outputs.filter(o => Array.isArray(values[o.name]) && !(values[o.name] as unknown[]).length).map(o => o.name),
    interpretation: 'Empty or missing outputs do not establish an outage or global absence. HTTP success confirms this request, not the completeness of the answer. Use the declared scope and documented fallbacks; do not guess endpoints or retry unchanged scope.' };
}
