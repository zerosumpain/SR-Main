import http from 'node:http';

/**
 * Calling an extracted application on this machine's behalf.
 *
 * A browser arrives at an extracted app with Main's session cookie; Main does
 * not have one. When Main needs something from Health or Drive it is acting as
 * itself, and their gateway deliberately refuses a client-supplied identity —
 * right for the internet, wrong for the process next to it. So each app can
 * declare a service lane: a bearer token, and on a match the gateway signs an
 * identity for a configured principal and applies its ordinary owner check.
 *
 * Two things about this are not obvious and both cost time to find:
 *
 * 1. **It cannot use fetch.** The gateway answers only for its canonical Host
 *    and 400s anything else, so a loopback call has to set that header — and
 *    undici silently DROPS a `Host` header, sending the socket's instead.
 *    Measured: a fetch with `Host: strangeramblings.com` to 127.0.0.1 arrives as
 *    `host: 127.0.0.1:<port>`. node:http sends what it is given.
 *
 * 2. **It is loopback, not the public URL.** The gateways bind 127.0.0.1, so
 *    this never leaves the machine — no Cloudflare round trip, and no dependency
 *    on the edge being up for one process to ask another a question.
 *
 * The token authenticates; it does not widen what the app will serve. A lane
 * with no token configured is closed, and this throws rather than falling back
 * to an unauthenticated call that would only 401 anyway.
 */
const CANONICAL_HOST = 'strangeramblings.com';

const APPS = {
	health: { port: 5320, tokenEnv: 'HEALTH_SERVICE_TOKEN' },
} as const satisfies Record<string, { port: number; tokenEnv: string }>;

export type ExtractedApp = keyof typeof APPS;

export class ExtractedAppError extends Error {}

async function call<T>(
	app: ExtractedApp,
	method: 'GET' | 'POST',
	path: string,
	payload: unknown,
	{ timeoutMs = 4000, port = APPS[app].port }: { timeoutMs?: number; port?: number },
): Promise<T> {
	const token = process.env[APPS[app].tokenEnv];
	if (!token) {
		throw new ExtractedAppError(
			`${APPS[app].tokenEnv} is not set, so the ${app} service lane is closed`,
		);
	}
	const encoded = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));

	const body = await new Promise<string>((resolve, reject) => {
		const request = http.request(
			{
				host: '127.0.0.1',
				port,
				path,
				method,
				// Host is set explicitly, and it is the reason node:http is used at
				// all — see the note at the top of this file.
				headers: {
					Host: CANONICAL_HOST,
					Authorization: `Bearer ${token}`,
					...(encoded
						? { 'content-type': 'application/json', 'content-length': encoded.length }
						: {}),
				},
				timeout: timeoutMs,
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					if (response.statusCode === 200) resolve(text);
					else reject(new ExtractedAppError(`${app}${path} returned ${response.statusCode}`));
				});
			},
		);
		request.on('timeout', () => {
			// destroy() does not itself reject; the 'error' handler below does.
			request.destroy(new ExtractedAppError(`${app}${path} timed out after ${timeoutMs}ms`));
		});
		request.on('error', (error) =>
			reject(error instanceof ExtractedAppError ? error : new ExtractedAppError(String(error))),
		);
		if (encoded) request.write(encoded);
		request.end();
	});

	try {
		return JSON.parse(body) as T;
	} catch {
		throw new ExtractedAppError(`${app}${path} did not return JSON`);
	}
}

export function getFromExtracted<T>(
	app: ExtractedApp,
	path: string,
	options: { timeoutMs?: number; port?: number } = {},
): Promise<T> {
	return call<T>(app, 'GET', path, undefined, options);
}

export function postToExtracted<T>(
	app: ExtractedApp,
	path: string,
	payload: unknown,
	options: { timeoutMs?: number; port?: number } = {},
): Promise<T> {
	return call<T>(app, 'POST', path, payload, options);
}
