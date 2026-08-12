// JKAI tools — pi extension
//
// Bridges every JKAI registry tool into pi as a first-class tool.
// Reads JKAI_API_URL and JKAI_BRIDGE_TOKEN from the environment, fetches the
// per-build manifest, and registers each tool with a handler that POSTs back
// to /api/jkai/tools/invoke. Tool calls show up natively in pi's stream.
//
// REGISTRATION CONTRACT — this is what was wrong for months:
//
// pi's extension loader does `await factory(api)` and DISCARDS the return
// value. This file used to end with `return { tools: piTools }`, so not one of
// the 174 tools ever reached pi. The agent ran on read/bash/edit/write/grep/
// find/ls and nothing else, while this file logged "registered 174 JKAI tools"
// — its own console line about its own array, which pi never saw.
//
// Tools reach pi ONLY through `api.registerTool(tool)`, which writes into the
// extension's tool map and calls refreshTools(). And the tool shape is pi's,
// not ours:
//
//   { name, label, description, parameters,
//     execute(toolCallId, params, signal, onUpdate, ctx) -> AgentToolResult }
//
// `label` is required. The executor is `execute` with that five-arg signature,
// NOT `handler(args)`. It must resolve to `{ content: [{type:'text',text}],
// details }`, not a bare string. Getting any of that wrong is silent: the tool
// simply is not there.
//
// Do not "simplify" this back into a returned array.

module.exports = async function register(api) {
  const apiUrl = process.env.JKAI_API_URL;
  const token = process.env.JKAI_BRIDGE_TOKEN;
  const log = (msg) => {
    if (api && typeof api.log === 'function') api.log(msg);
    else console.error('[jkai-tools]', msg);
  };

  // Fail LOUDLY on an incompatible pi rather than registering nothing and
  // saying it went fine — that is the exact failure this file is recovering
  // from. A build with no site tools should be diagnosable from its first log
  // line, not sixty days later.
  if (!api || typeof api.registerTool !== 'function') {
    log('FATAL: this pi has no api.registerTool — NO site tools are available to the agent');
    return;
  }

  if (!apiUrl || !token) {
    log('JKAI_API_URL or JKAI_BRIDGE_TOKEN missing — NO site tools registered');
    return;
  }

  let manifest;
  try {
    const res = await fetch(`${apiUrl}/api/jkai/tools/manifest`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log(`manifest fetch failed: ${res.status} — NO site tools registered`);
      return;
    }
    manifest = await res.json();
  } catch (e) {
    log(`manifest fetch error: ${(e && e.message) || e} — NO site tools registered`);
    return;
  }

  const invoke = async (name, args, signal) => {
    const r = await fetch(`${apiUrl}/api/jkai/tools/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, args: args || {} }),
      // Honour the turn's abort signal so an interrupted build stops its
      // in-flight tool calls instead of leaving them running against the site.
      signal,
    });
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`tool ${name} failed: ${r.status} ${text.slice(0, 500)}`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return text;
    }
    if (body && body.ok === false) {
      throw new Error(body.error || `tool ${name} error`);
    }
    const result =
      body && Object.prototype.hasOwnProperty.call(body, 'result') ? body.result : body;
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  };

  const defs = Array.isArray(manifest.tools) ? manifest.tools : [];
  let registered = 0;
  const failed = [];

  for (const def of defs) {
    if (!def || typeof def.name !== 'string' || !def.name) continue;
    try {
      api.registerTool({
        name: def.name,
        // Required by pi's ToolDefinition. The registry has no separate display
        // name, so the tool name doubles as the label.
        label: def.name,
        description: def.description || def.name,
        parameters: def.parameters || { type: 'object', properties: {} },
        async execute(_toolCallId, params, signal) {
          // Thrown errors are the idiomatic signal: pi's agent-loop catches
          // them and hands the model an isError tool result, which is what we
          // want — the agent can read the failure and adapt.
          const text = await invoke(def.name, params, signal);
          return {
            content: [{ type: 'text', text }],
            details: { tool: def.name },
          };
        },
      });
      registered += 1;
    } catch (e) {
      failed.push(`${def.name}: ${(e && e.message) || e}`);
    }
  }

  // Report what pi ACCEPTED, not what we intended to send it. The previous
  // wording ("registered N JKAI tools") was true of our own array and false of
  // reality; anything that reads like success here has to be earned.
  if (registered === 0) {
    log(`NO site tools registered (manifest had ${defs.length})`);
  } else {
    log(`api.registerTool accepted ${registered}/${defs.length} JKAI tools`);
  }
  if (failed.length) {
    log(`registerTool rejected ${failed.length}: ${failed.slice(0, 5).join('; ')}`);
  }
};
