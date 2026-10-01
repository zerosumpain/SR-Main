import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Lets a test make the next file-handle write fail the way a full disk does.
const failNextWrite = { on: false };
vi.mock('fs/promises', async (importOriginal) => {
	const real = await importOriginal<typeof import('fs/promises')>();
	return {
		...real,
		open: async (...args: Parameters<typeof real.open>) => {
			const fh = await real.open(...args);
			if (!failNextWrite.on) return fh;
			failNextWrite.on = false;
			return {
				writeFile: async () => {
					throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
				},
				sync: () => fh.sync(),
				close: () => fh.close()
			} as unknown as typeof fh;
		}
	};
});

const { useAtomicMultiFileAuthState } = await import('./auth-state');

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'wa-auth-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('useAtomicMultiFileAuthState', () => {
	it('keeps the previous creds.json whole when a save hits a full disk', async () => {
		const { state, saveCreds } = await useAtomicMultiFileAuthState(dir);
		state.creds.registered = true;
		await saveCreds();
		const before = readFileSync(join(dir, 'creds.json'), 'utf-8');

		state.creds.registrationId = 42;
		failNextWrite.on = true;
		await expect(saveCreds()).rejects.toThrow('ENOSPC');

		expect(readFileSync(join(dir, 'creds.json'), 'utf-8')).toBe(before);
		expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('restores from creds.json.bak when creds.json was left empty', async () => {
		const first = await useAtomicMultiFileAuthState(dir);
		first.state.creds.registrationId = 1234;
		await first.saveCreds();

		writeFileSync(join(dir, 'creds.json'), ''); // what the 2026-09-29 outage left behind

		const second = await useAtomicMultiFileAuthState(dir);
		expect(second.state.creds.registrationId).toBe(1234);
	});

	it('writes key files 0600 and round-trips them', async () => {
		const { state } = await useAtomicMultiFileAuthState(dir);
		await state.keys.set({ 'sender-key-memory': { 'abc@g.us': { me: true } } });
		const got = await state.keys.get('sender-key-memory', ['abc@g.us']);
		expect(got['abc@g.us']).toEqual({ me: true });
		expect(statSync(join(dir, 'sender-key-memory-abc@g.us.json')).mode & 0o777).toBe(0o600);

		await state.keys.set({ 'sender-key-memory': { 'abc@g.us': null } });
		expect(readdirSync(dir)).not.toContain('sender-key-memory-abc@g.us.json');
	});
});
