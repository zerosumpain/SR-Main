import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { join } from 'path';

/**
 * Baileys' `useMultiFileAuthState`, but every write is crash- and disk-full-safe.
 *
 * The upstream version calls `writeFile` straight over the live file, which
 * truncates first. On 2026-09-29 the VPS disk filled mid-save and left
 * `creds.json` at 0 bytes — the session was unrecoverable and WhatsApp stayed
 * dark for two days. Here a write goes to a temp file, is fsynced, and only
 * then renamed over the old one, so a failed write leaves the previous file
 * whole. `creds.json` also keeps a last-good `creds.json.bak` that loading
 * falls back to if the primary is ever unreadable.
 *
 * Same on-disk layout and file names as upstream, so an existing session dir
 * loads unchanged.
 */

const CREDS = 'creds.json';
const CREDS_BAK = 'creds.json.bak';

let tmpCounter = 0;

/** Write `contents` to `filePath` atomically, mode 0600. Throws on failure, old file untouched. */
export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
	const tmp = `${filePath}.${process.pid}.${++tmpCounter}.tmp`;
	try {
		const fh = await open(tmp, 'w', 0o600);
		try {
			await fh.writeFile(contents);
			await fh.sync();
		} finally {
			await fh.close();
		}
		await rename(tmp, filePath);
	} catch (err) {
		// Free the partial temp file — on ENOSPC it is the space we need back.
		await unlink(tmp).catch(() => {});
		throw err;
	}
}

const fixFileName = (file: string) => file.replace(/\//g, '__').replace(/:/g, '-');

export async function useAtomicMultiFileAuthState(
	folder: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
	await mkdir(folder, { recursive: true });

	const writeData = (data: unknown, file: string) =>
		atomicWriteFile(join(folder, fixFileName(file)), JSON.stringify(data, BufferJSON.replacer));

	const readData = async (file: string) => {
		try {
			const raw = await readFile(join(folder, fixFileName(file)), { encoding: 'utf-8' });
			return JSON.parse(raw, BufferJSON.reviver);
		} catch {
			return null;
		}
	};

	const removeData = (file: string) => unlink(join(folder, fixFileName(file))).catch(() => {});

	let creds = await readData(CREDS);
	if (!creds) {
		creds = await readData(CREDS_BAK);
		if (creds) console.warn(`[whatsapp] ${CREDS} unreadable — restored session from ${CREDS_BAK}`);
	}
	creds ??= initAuthCreds();

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
					await Promise.all(
						ids.map(async (id) => {
							let value = await readData(`${type}-${id}.json`);
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value);
							}
							data[id] = value;
						})
					);
					return data;
				},
				set: async (data) => {
					const tasks: Promise<void>[] = [];
					for (const category in data) {
						const entries = data[category as keyof SignalDataTypeMap]!;
						for (const id in entries) {
							const value = entries[id];
							const file = `${category}-${id}.json`;
							tasks.push(value ? writeData(value, file) : removeData(file));
						}
					}
					await Promise.all(tasks);
				}
			}
		},
		saveCreds: async () => {
			await writeData(creds, CREDS);
			// Only reached once the primary is safely on disk.
			await writeData(creds, CREDS_BAK);
		}
	};
}
