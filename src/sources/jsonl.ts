import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Streams a JSONL file, skipping lines that don't parse (agents append while running). */
export async function* readJsonl(file: string): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Partial last line from a session still being written.
    }
  }
}

export interface FoundFile {
  path: string;
  size: number;
  mtime: number;
}

export function findFiles(root: string, ext: string, maxDepth = 6): FoundFile[] {
  const out: FoundFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith(ext)) {
        const s = statSync(p);
        out.push({ path: p, size: s.size, mtime: s.mtimeMs });
      }
    }
  };
  walk(root, 0);
  return out;
}

export const ms = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) || 0 : 0);
