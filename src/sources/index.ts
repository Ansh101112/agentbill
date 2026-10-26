import type { AgentKind, Session } from '../types.ts';
import { listClaudeFiles, parseClaudeSession } from './claude.ts';
import { listCodexFiles, parseCodexSession } from './codex.ts';
import { listOpenCodeFiles, parseOpenCodeSession } from './opencode.ts';
import type { FoundFile } from './jsonl.ts';

export interface LoadOptions {
  agents?: AgentKind[];
  /** Only sessions whose log changed after this time (ms). */
  since?: number;
  /** Only sessions whose working directory starts with this path. */
  project?: string;
  limit?: number;
}

const sources: { agent: AgentKind; list: () => FoundFile[]; parse: (f: string) => Promise<Session> }[] = [
  { agent: 'claude-code', list: listClaudeFiles, parse: parseClaudeSession },
  { agent: 'codex', list: listCodexFiles, parse: parseCodexSession },
  { agent: 'opencode', list: listOpenCodeFiles, parse: parseOpenCodeSession },
];

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export async function loadSessions(opts: LoadOptions = {}): Promise<Session[]> {
  const files: { f: FoundFile; parse: (f: string) => Promise<Session> }[] = [];
  for (const src of sources) {
    if (opts.agents && !opts.agents.includes(src.agent)) continue;
    for (const f of src.list()) {
      if (opts.since && f.mtime < opts.since) continue;
      files.push({ f, parse: src.parse });
    }
  }
  files.sort((a, b) => b.f.mtime - a.f.mtime);
  const picked = opts.limit ? files.slice(0, opts.limit) : files;

  const sessions: Session[] = [];
  // Parse a few files at a time: big logs are tens of MB.
  const queue = [...picked];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const s = await item.parse(item.f.path);
          if (s.calls.length) sessions.push(s);
        } catch (e) {
          process.stderr.write(`agentbill: skipped ${item.f.path}: ${(e as Error).message}\n`);
        }
      }
    }),
  );
  const project = opts.project ? norm(opts.project) : undefined;
  return sessions
    .filter((s) => !project || norm(s.cwd).startsWith(project))
    .sort((a, b) => b.startedAt - a.startedAt);
}
