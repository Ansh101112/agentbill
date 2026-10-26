// Installs and runs a prepare-commit-msg hook that records agent spend as an
// "Agent-Cost:" trailer for the session active in this repository.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeSession } from './analyze.ts';
import { loadPriceBook, Pricer } from './pricing.ts';
import { loadSessions } from './sources/index.ts';

export function repoRoot(cwd = process.cwd()): string | null {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  return r.status === 0 && out ? out : null;
}

const MARK_START = '# >>> agentbill >>>';
const MARK_END = '# <<< agentbill <<<';

function hookBlock(cliPath: string): string {
  // Git hooks run under sh; forward slashes keep the path portable.
  const p = cliPath.replace(/\\/g, '/');
  return [
    MARK_START,
    '# Record the agent spend of this repo session as an "Agent-Cost:" trailer.',
    `node "${p}" hook prepare-commit-msg "$1" "$2" "$3" || true`,
    MARK_END,
  ].join('\n');
}

export function installHook(cliPath: string, cwd = process.cwd()): string {
  const root = repoRoot(cwd);
  if (!root) throw new Error('not inside a git repository');
  const rel = spawnSync('git', ['rev-parse', '--git-path', 'hooks/prepare-commit-msg'], { cwd, encoding: 'utf8' });
  const relPath = (rel.stdout ?? '').trim();
  // --git-path is relative to cwd (e.g. ../../.git/hooks/...), not to the toplevel.
  const hookPath = relPath
    ? isAbsolute(relPath)
      ? relPath
      : resolve(cwd, relPath)
    : resolve(root, '.git', 'hooks', 'prepare-commit-msg');
  mkdirSync(dirname(hookPath), { recursive: true });

  const block = hookBlock(cliPath);
  let content = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '#!/bin/sh\n';
  const start = content.indexOf(MARK_START);
  const end = content.indexOf(MARK_END);
  if (start >= 0 && end > start) {
    content = content.slice(0, start) + block + content.slice(end + MARK_END.length);
  } else {
    content = content.replace(/\s*$/, '') + '\n\n' + block + '\n';
  }
  writeFileSync(hookPath, content);
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows may not honour the mode; git still runs the hook through sh.
  }
  return hookPath;
}

export interface AgentSummary {
  cost: number;
  model: string;
  calls: number;
  sessionId: string;
}

/** Cost of the most recently active session whose cwd is inside this repo. */
export async function repoAgentSummary(root: string): Promise<AgentSummary | null> {
  const book = await loadPriceBook({ offline: true });
  const pricer = new Pricer(book);
  const sessions = await loadSessions({ project: root });
  const withCalls = sessions.filter((s) => s.calls.length > 0);
  if (!withCalls.length) return null;
  const active = [...withCalls].sort((a, b) => b.endedAt - a.endedAt)[0]!;
  const report = analyzeSession(active, pricer);

  let model = 'unknown';
  let best = -1;
  for (const [name, m] of Object.entries(report.byModel)) {
    if (m.calls > best) {
      best = m.calls;
      model = name;
    }
  }
  return { cost: report.cost, model, calls: active.calls.length, sessionId: active.id };
}

export interface TrailerResult {
  added: boolean;
  trailer?: string;
  reason?: string;
}

/** Appends one trailer to the commit message file, if there is a priced session. */
export async function appendTrailer(
  msgFile: string,
  source?: string,
  cwd = process.cwd(),
): Promise<TrailerResult> {
  if (source === 'merge' || source === 'squash') return { added: false, reason: `${source} commit` };
  const root = repoRoot(cwd);
  if (!root) return { added: false, reason: 'not a git repository' };

  let text: string;
  try {
    text = readFileSync(msgFile, 'utf8');
  } catch {
    return { added: false, reason: 'unreadable commit message file' };
  }
  if (/^\s*Agent-Cost:/im.test(text)) return { added: false, reason: 'trailer already present' };

  const summary = await repoAgentSummary(root);
  if (!summary || summary.calls <= 0 || summary.cost <= 0) {
    return { added: false, reason: 'no priced agent session for this repo' };
  }

  const trailer = `Agent-Cost: $${summary.cost.toFixed(2)} (${summary.model}, ${summary.calls} calls)`;
  writeFileSync(msgFile, text.replace(/\s*$/, '') + '\n\n' + trailer + '\n');
  return { added: true, trailer };
}