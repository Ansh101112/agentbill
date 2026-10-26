// Reads "Agent-Cost:" commit trailers and turns them into one PR summary comment.
import { spawnSync } from 'node:child_process';

/** One trailer: `Agent-Cost: $1.23 (model, 12 calls)`. */
export interface CostTrailer {
  amount: number;
  model: string;
  calls: number;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
}

export interface CommitCost extends CostTrailer {
  sha: string;
  subject: string;
}

export interface CostSummary {
  total: number;
  calls: number;
  /** Commits that carried at least one trailer. */
  commits: number;
  byModel: { model: string; calls: number; amount: number }[];
  entries: CommitCost[];
}

const TRAILER = /^\s*Agent-Cost:\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*\(\s*(.+?)\s*,\s*([0-9]+)\s*calls?\s*\)\s*$/i;

/** Parses a single line; returns null unless it is a well-formed trailer. */
export function parseCostTrailer(line: string): CostTrailer | null {
  const m = TRAILER.exec(line);
  if (!m) return null;
  const amount = Number(m[1]);
  const calls = Number(m[3]);
  const model = (m[2] ?? '').trim();
  if (!Number.isFinite(amount) || !Number.isFinite(calls) || !model) return null;
  return { amount, model, calls };
}

/** Walks commit bodies and collects every trailer line. */
export function extractCommitCosts(commits: CommitInfo[]): CommitCost[] {
  const out: CommitCost[] = [];
  for (const c of commits) {
    for (const line of c.body.split(/\r?\n/)) {
      const t = parseCostTrailer(line);
      if (t) out.push({ sha: c.sha, subject: c.subject, ...t });
    }
  }
  return out;
}

export function summariseCosts(costs: CommitCost[]): CostSummary {
  const byModel = new Map<string, { model: string; calls: number; amount: number }>();
  let total = 0;
  let calls = 0;
  const commitShas = new Set<string>();
  for (const c of costs) {
    total += c.amount;
    calls += c.calls;
    commitShas.add(c.sha);
    const m = byModel.get(c.model) ?? { model: c.model, calls: 0, amount: 0 };
    m.calls += c.calls;
    m.amount += c.amount;
    byModel.set(c.model, m);
  }
  return {
    total,
    calls,
    commits: commitShas.size,
    byModel: [...byModel.values()].sort((a, b) => b.amount - a.amount),
    entries: costs,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const shortSha = (sha: string) => sha.slice(0, 7);

/** Markdown comment body for a pull request. */
export function renderComment(s: CostSummary): string {
  if (!s.entries.length) {
    return [
      '### Agent cost',
      '',
      'No `Agent-Cost:` trailers found in this pull request range.',
      '',
      '_Install the hook with `agentbill hook install` so each commit records the agent spend that produced it._',
    ].join('\n');
  }
  const rows = s.entries.map(
    (e) => `| \`${shortSha(e.sha)}\` ${e.subject.replace(/\|/g, '\\|')} | ${money(e.amount)} | ${e.model} | ${e.calls} |`,
  );
  return [
    '### Agent cost',
    '',
    `**${money(s.total)}** of agent spend across ${s.commits} ${s.commits === 1 ? 'commit' : 'commits'} · ${s.calls} model calls`,
    '',
    '| Commit | Cost | Model | Calls |',
    '| --- | ---: | --- | ---: |',
    ...rows,
    '',
    '_Recorded from `Agent-Cost:` commit trailers. Run `agentbill hook install` to add one to each commit._',
  ].join('\n');
}

function run(cwd: string, file: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Picks a base ref: explicit one, else the repo's default branch, else the previous commit. */
export function resolveBaseRef(cwd = process.cwd(), explicit?: string): string {
  if (explicit) return explicit;
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    if (run(cwd, 'git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  }
  return 'HEAD~1';
}

/** Commits reachable from `head` but not `base`, newest first. */
export function commitsInRange(cwd: string, base: string, head = 'HEAD'): CommitInfo[] {
  const fmt = '--format=%H%x1f%s%x1f%B%x1e';
  const r = run(cwd, 'git', ['log', `${base}..${head}`, fmt]);
  if (!r.ok) throw new Error(r.stderr.trim() || `git log failed for ${base}..${head}`);
  return r.stdout
    .split('\x1e')
    .map((block) => block.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((block) => {
      const parts = block.split('\x1f');
      return {
        sha: (parts[0] ?? '').trim(),
        subject: (parts[1] ?? '').trim(),
        body: parts.slice(2).join('\x1f'),
      };
    })
    .filter((c) => c.sha);
}

/** PR number for the current branch via the GitHub CLI, or null. */
export function findPrNumber(cwd = process.cwd()): number | null {
  const r = run(cwd, 'gh', ['pr', 'view', '--json', 'number', '-q', '.number']);
  if (!r.ok) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Posts one comment; body is passed on stdin to avoid shell quoting issues. */
export function postPrComment(cwd: string, pr: number, body: string): boolean {
  const r = spawnSync('gh', ['pr', 'comment', String(pr), '--body-file', '-'], { cwd, input: body, encoding: 'utf8' });
  return r.status === 0;
}