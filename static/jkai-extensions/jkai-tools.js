// JKAI tools — pi extension
//
// Bridges every JKAI registry tool into pi as a first-class tool.
// Reads JKAI_API_URL and JKAI_BRIDGE_TOKEN from the environment, fetches the
// per-build manifest, and registers each tool with a handler that POSTs back
// to /api/jkai/tools/invoke. Tool calls show up natively in pi's stream.

module.exports = async function register(api) {
  const apiUrl = process.env.JKAI_API_URL;
  const token = process.env.JKAI_BRIDGE_TOKEN;
  const log = (msg) => {
    if (api && typeof api.log === 'function') api.log(msg);
    else console.error('[jkai-tools]', msg);
  };

  if (!apiUrl || !token) {
    log('JKAI_API_URL or JKAI_BRIDGE_TOKEN missing — skipping registration');
    return { tools: [] };
  }

  let manifest;
  try {
    const res = await fetch(`${apiUrl}/api/jkai/tools/manifest`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log(`manifest fetch failed: ${res.status}`);
      return { tools: [] };
    }
    manifest = await res.json();
  } catch (e) {
    log(`manifest fetch error: ${(e && e.message) || e}`);
    return { tools: [] };
  }

  const piTools = (manifest.tools || []).map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters || { type: 'object', properties: {} },
    async handler(args) {
      try {
        const r = await fetch(`${apiUrl}/api/jkai/tools/invoke`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: def.name, args: args || {} }),
        });
        const text = await r.text();
        if (!r.ok) {
          throw new Error(`tool ${def.name} failed: ${r.status} ${text.slice(0, 500)}`);
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return text;
        }
        if (body && body.ok === false) {
          throw new Error(body.error || `tool ${def.name} error`);
        }
        const result = body && Object.prototype.hasOwnProperty.call(body, 'result') ? body.result : body;
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      } catch (e) {
        throw new Error(`jkai-tools.${def.name}: ${(e && e.message) || e}`);
      }
    },
  }));

  log(`registered ${piTools.length} JKAI tools`);
  return { tools: piTools };
};
