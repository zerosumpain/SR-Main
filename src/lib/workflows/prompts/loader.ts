import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { db } from '$lib/db';
import { promptCache } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_PROMPTS_DIR = join(process.cwd(), 'data', 'prompts');

interface FileManifestEntry {
  name: string;
  size: number;
  lastModified: string;
}

interface CompileResult {
  compiled: string;
  manifest: FileManifestEntry[];
}

export function compilePromptFiles(dir: string = DEFAULT_PROMPTS_DIR): CompileResult {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return { compiled: '', manifest: [] };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    return { compiled: '', manifest: [] };
  }

  const manifest: FileManifestEntry[] = [];
  const contents: string[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf-8');
    contents.push(content);
    manifest.push({
      name: file,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
    });
  }

  return {
    compiled: contents.join('\n\n---\n\n'),
    manifest,
  };
}

/** One prompt file on disk, as the workbench and the compiler both see it. */
export interface PromptFileEntry {
  name: string;
  content: string;
  size: number;
  lastModified: string;
}

export function getPromptFiles(dir: string = DEFAULT_PROMPTS_DIR): PromptFileEntry[] {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return [];
  }

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      return {
        name: file,
        content: readFileSync(filePath, 'utf-8'),
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
      };
    });
}

export function savePromptFile(name: string, content: string, dir: string = DEFAULT_PROMPTS_DIR): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, name), content, 'utf-8');
}

export async function syncPrompts(dir: string = DEFAULT_PROMPTS_DIR): Promise<string> {
  const { compiled, manifest } = compilePromptFiles(dir);

  await db
    .insert(promptCache)
    .values({
      id: 'default',
      compiledPrompt: compiled,
      fileManifest: manifest,
      lastSynced: new Date(),
    })
    .onConflictDoUpdate({
      target: promptCache.id,
      set: {
        compiledPrompt: compiled,
        fileManifest: manifest,
        lastSynced: new Date(),
      },
    });

  console.log(`[prompts] Synced ${manifest.length} files (${compiled.length} chars)`);
  return compiled;
}

export async function getCompiledPrompt(dir: string = DEFAULT_PROMPTS_DIR): Promise<string> {
  try {
    const [cached] = await db
      .select()
      .from(promptCache)
      .where(eq(promptCache.id, 'default'))
      .limit(1);

    if (cached?.compiledPrompt) {
      return cached.compiledPrompt;
    }
  } catch {}

  return syncPrompts(dir);
}
