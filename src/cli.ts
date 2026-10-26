#!/usr/bin/env node
// agentbill: what your coding agents really cost, and where the tokens leak.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeSession, fmtTokens, usd, type SessionReport } from './analyze.ts';
import { loadPriceBook, Pricer } from './pricing.ts';
import { loadSessions, type LoadOptions } from './sources/index.ts';
import { buildSummary, sessionDetail } from './summary.ts';
import type { AgentKind } from './types.ts';

const HELP = `agentbill — see what your coding agents really cost

Usage
  agentbill [report]          Spend, top sessions and top waste across all local agent logs
  agentbill sessions          One line per session
  agentbill session <id>      Timeline, heaviest outputs and findings for one session
  agentbill serve             Open the dashboard (http://localhost:4477)
  agentbill replay            Have an open model redo your expensive steps and judge whether it matched
  agentbill mcp               Run as an MCP server so agents can check their own spend
  agentbill export <file>     Write the dashboard data as JSON (add --anonymize to share it)
  agentbill pr-cost           Summarise "Agent-Cost:" commit trailers and comment on the PR
  agentbill hook install      Install a prepare-commit-msg hook that records agent spend

Options
  --days <n>        Only sessions active in the last n days
  --project <path>  Only sessions started under this folder
  --agent <list>    claude-code,codex,opencode,alan-code
  --limit <n>       Only the n most recent sessions
  --json            Machine-readable output
  --offline         Don't fetch live prices; use the cached or bundled list
  --port <n>        Dashboard port (default 4477)

PR cost options
  --base <ref>      Base ref for the commit range (default: origin/HEAD, main or master)
  --head <ref>      Head ref (default: HEAD)
  --pr <n>          Pull request to comment on (default: the current branch's PR)
  --dry-run         Print the comment instead of posting it

Replay options (needs OPENROUTER_API_KEY, or AGENTBILL_BASE_URL + AGENTBILL_API_KEY for any OpenAI-compatible API)
  --model <id>      Open model that replays the steps (default deepseek/deepseek-v4.1-flash)
  --judge <id>      Model that judges equivalence (default z-ai/glm-5.3)
  --steps <n>       How many expensive steps to replay (default 24)
  --threshold <x>   Agreement needed before a step kind counts as routable (default 0.8)
  --dry-run         Rebuild the steps and show them without calling any model
`;

// Keys can live in ./.env or ~/.agentbill/.env.
for (const f of ['.env', join(homedir(), '.agentbill', '.env')]) {
  try {
    if (existsSync(f)) process.loadEnvFile(f);
  } catch {
    // Unreadable .env: ignore, the env may already be set.
  }
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c(1);
const dim = c(2);
const red = c(31);
const green = c(32);
const yellow = c(33);
const cyan = c(36);

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const lpad = (s: string, n: number) => s.padStart(n);
const date = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');

async function load(values: Record<string, unknown>): Promise<{ reports: SessionReport[]; pricer: Pricer }> {
  const opts: LoadOptions = {};
  if (values.days) opts.since = Date.now() - Number(values.days) * 86400000;
  if (values.project) opts.project = String(values.project);
  if (values.agent) opts.agents = String(values.agent).split(',') as AgentKind[];
  if (values.limit) opts.limit = Number(values.limit);
  const [book, sessions] = await Promise.all([loadPriceBook({ offline: !!values.offline }), loadSessions(opts)]);
  const pricer = new Pricer(book);
  return { reports: sessions.map((s) => analyzeSession(s, pricer)), pricer };
}

function printReport(reports: SessionReport[], pricer: Pricer) {
  const sum = buildSummary(reports, pricer);
  const t = sum.totals;
  const wastePct = t.cost ? (t.waste / t.cost) * 100 : 0;
  console.log();
  console.log(`${bold('AgentBill')} ${dim(`· ${t.sessions} sessions · ${date(sum.range.from)} → ${date(sum.range.to)} · prices: ${sum.priceSource}`)}`);
  console.log();
  console.log(`  Spend        ${bold(usd(t.cost))}  ${dim(`${fmtTokens(t.calls)} model calls, ${fmtTokens(t.toolCalls)} tool calls`)}`);
  console.log(`  Leaked       ${red(bold(usd(t.waste)))}  ${dim(`${wastePct.toFixed(0)}% of spend went to avoidable patterns`)}`);
  const cache = t.usage.cacheRead / Math.max(1, t.usage.cacheRead + t.usage.input + t.usage.cacheWrite);
  console.log(`  Cache hits   ${bold(`${(cache * 100).toFixed(0)}%`)}  ${dim('of input tokens were served from the prompt cache')}`);
  console.log();

  console.log(bold('  By model'));
  for (const m of sum.byModel.slice(0, 6)) {
    console.log(`    ${pad(m.model, 26)} ${lpad(usd(m.cost), 10)}  ${dim(`${m.calls} calls${m.pricedAs ? '' : ' · no price found'}`)}`);
  }
  console.log();

  console.log(bold('  Where it leaked'));
  const names: Record<string, string> = {
    carry: 'Heavy outputs re-sent on later calls',
    'cache-rebuild': 'Prompt cache rebuilt after idle gaps',
    reread: 'Unchanged files read again',
    'retry-loop': 'Retry loops on failing steps',
    'context-bloat': 'Very long contexts (advice, not counted)',
  };
  for (const k of sum.findingsByKind) {
    const label = names[k.kind] ?? k.kind;
    console.log(`    ${pad(label, 44)} ${lpad(usd(k.cost), 10)}  ${dim(`${k.count}×`)}`);
  }
  console.log();

  console.log(bold('  Top findings'));
  for (const f of sum.topFindings.slice(0, 6)) {
    console.log(`    ${red(lpad(usd(f.cost), 8))}  ${f.title}`);
    console.log(`              ${dim(pad(`${f.sessionTitle} — ${f.detail}`, 110))}`);
  }
  console.log();

  console.log(bold('  Same tokens on an open model'));
  for (const w of sum.whatIf) {
    console.log(`    ${pad(w.priceId, 34)} ${lpad(usd(w.cost), 10)}  ${green(`−${usd(w.saved)}`)}`);
  }
  console.log(dim('    Upper bound: same tokens, cheaper price. `agentbill replay` checks whether the open model makes the same moves.'));
  console.log();

  console.log(bold('  Most expensive sessions'));
  for (const r of [...reports].sort((a, b) => b.cost - a.cost).slice(0, 5)) {
    const s = r.session;
    console.log(`    ${lpad(usd(r.cost), 9)} ${dim(lpad(usd(r.wasteCost), 8) + ' leaked')}  ${pad(s.title ?? s.cwd, 52)} ${dim(s.id.slice(0, 8))}`);
  }
  console.log();
  if (sum.unpriced.length) console.log(yellow(`  No price found for: ${sum.unpriced.join(', ')}\n`));
  console.log(dim(`  agentbill session <id> for a timeline · agentbill serve for the dashboard\n`));
}

function printSessions(reports: SessionReport[]) {
  for (const r of reports) {
    const s = r.session;
    console.log(
      `${dim(s.id.slice(0, 8))}  ${date(s.startedAt)}  ${pad(s.agent, 11)} ${lpad(usd(r.cost), 9)} ${red(lpad(usd(r.wasteCost), 8))}  ${pad(s.title ?? '', 60)}`,
    );
  }
}

function printSession(r: SessionReport) {
  const d = sessionDetail(r);
  const row = d.row;
  console.log();
  console.log(`${bold(row.title)} ${dim(`· ${row.agent} · ${row.project}${row.branch ? ` @ ${row.branch}` : ''}`)}`);
  console.log(dim(`  ${date(row.startedAt)} → ${date(row.endedAt)} · ${row.prompts} prompts · ${row.calls} model calls · ${row.toolCalls} tool calls · peak context ${fmtTokens(row.peakContext)}`));
  console.log();
  console.log(`  Spend ${bold(usd(row.cost))}   Leaked ${red(bold(usd(row.waste)))}`);
  console.log();
  // Context over time, as a sparkline: this is where the money goes.
  const blocks = '▁▂▃▄▅▆▇█';
  const main = d.timeline.filter((t) => !t.sidechain);
  const step = Math.max(1, Math.ceil(main.length / 80));
  const peak = Math.max(...main.map((t) => t.context), 1);
  let line = '';
  for (let i = 0; i < main.length; i += step) {
    line += blocks[Math.min(7, Math.floor((main[i]!.context / peak) * 7.99))];
  }
  console.log(`  Context ${cyan(line)} ${dim(fmtTokens(peak))}`);
  console.log();
  console.log(bold('  Heaviest outputs (cost of carrying them)'));
  for (const t of d.topCarried.slice(0, 8)) {
    console.log(`    ${red(lpad(usd(t.carryCost), 8))}  ${dim(lpad(fmtTokens(t.tokens), 5) + ' tok × ' + lpad(String(t.carriedBy), 4))}  ${pad(`${t.name}: ${t.target}`, 80)}`);
  }
  console.log();
  console.log(bold('  Findings'));
  for (const f of d.findings.slice(0, 12)) {
    console.log(`    ${(f.advisory ? yellow : red)(lpad(usd(f.cost), 8))}  ${f.title}${f.advisory ? dim(' (advice)') : ''}`);
    console.log(`              ${dim(pad(f.detail, 110))}`);
  }
  console.log();
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string' },
      project: { type: 'string' },
      agent: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      offline: { type: 'boolean' },
      port: { type: 'string' },
      anonymize: { type: 'boolean' },
      base: { type: 'string' },
      head: { type: 'string' },
      pr: { type: 'string' },
      model: { type: 'string' },
      judge: { type: 'string' },
      steps: { type: 'string' },
      threshold: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0] ?? 'report';
  if (values.help || cmd === 'help') return void console.log(HELP);

  if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp.ts');
    return runMcp();
  }
  if (cmd === 'serve') {
    const { serve } = await import('./server.ts');
    return serve({ port: Number(values.port ?? 4477), load: () => load(values) });
  }

  if (cmd === 'pr-cost') {
    const { commitsInRange, resolveBaseRef, extractCommitCosts, summariseCosts, renderComment, findPrNumber, postPrComment } =
      await import('./pr.ts');
    const cwd = process.cwd();
    const base = resolveBaseRef(cwd, values.base as string | undefined);
    const head = (values.head as string) ?? 'HEAD';
    const summary = summariseCosts(extractCommitCosts(commitsInRange(cwd, base, head)));
    if (values.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    const body = renderComment(summary);
    const pr = values.pr ? Number(values.pr) : findPrNumber(cwd);
    if (values['dry-run'] || !pr) {
      if (!values['dry-run']) console.error('agentbill: no pull request detected; printing the comment instead');
      console.log(body);
      return;
    }
    const ok = postPrComment(cwd, pr, body);
    console.log(ok ? `agentbill: posted the cost summary to PR #${pr}` : `agentbill: failed to post to PR #${pr}`);
    if (!ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'hook') {
    const { installHook, appendTrailer } = await import('./hook.ts');
    const sub = positionals[1];
    if (sub === 'install') {
      const cliPath = resolve(process.argv[1] ?? 'dist/cli.js');
      console.log(`Installed prepare-commit-msg hook at ${installHook(cliPath)}`);
      return;
    }
    if (sub === 'prepare-commit-msg') {
      const file = positionals[2];
      if (!file) throw new Error('hook prepare-commit-msg needs the commit message file');
      const res = await appendTrailer(file, positionals[3]);
      if (res.added) console.error(`agentbill: added ${res.trailer}`);
      else if (process.env.AGENTBILL_HOOK_DEBUG) console.error(`agentbill: skipped trailer (${res.reason})`);
      return;
    }
    throw new Error('usage: agentbill hook install | agentbill hook prepare-commit-msg <file> [source] [sha]');
  }

  const { reports, pricer } = await load(values);
  if (!reports.length) {
    console.log('No agent sessions found. AgentBill reads ~/.claude/projects, ~/.codex/sessions, OpenCode and Alan Code logs.');
    return;
  }

  switch (cmd) {
    case 'report':
      if (values.json) console.log(JSON.stringify(buildSummary(reports, pricer), null, 2));
      else printReport(reports, pricer);
      break;
    case 'sessions':
      if (values.json) console.log(JSON.stringify(buildSummary(reports, pricer).sessions, null, 2));
      else printSessions(reports);
      break;
    case 'session': {
      const id = positionals[1] ?? '';
      const r = reports.find((x) => x.session.id.startsWith(id)) ?? (id ? undefined : reports[0]);
      if (!r) throw new Error(`No session starting with "${id}". Run agentbill sessions to list them.`);
      if (values.json) console.log(JSON.stringify(sessionDetail(r), null, 2));
      else printSession(r);
      break;
    }
    case 'replay': {
      const { runReplayCommand } = await import('./replay/command.ts');
      await runReplayCommand(reports, pricer, {
        model: (values.model as string) ?? 'deepseek/deepseek-v4.1-flash',
        judgeModel: (values.judge as string) ?? 'z-ai/glm-5.3',
        steps: Number(values.steps ?? 24),
        threshold: Number(values.threshold ?? 0.8),
        dryRun: !!values['dry-run'],
        json: !!values.json,
      });
      break;
    }
    case 'export': {
      const { exportData } = await import('./export.ts');
      const file = positionals[1] ?? 'agentbill-data.json';
      exportData(reports, pricer, file, !!values.anonymize);
      console.log(`Wrote ${file}${values.anonymize ? ' (anonymised)' : ''}`);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`agentbill: ${(e as Error).message}`);
  process.exitCode = 1;
});
