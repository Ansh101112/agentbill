// `agentbill mcp`: a stdio MCP server so a coding agent can check its own spend while it works.
import { createInterface } from 'node:readline';
import { analyzeSession, usd, fmtTokens, type SessionReport } from './analyze.ts';
import { loadPriceBook, Pricer } from './pricing.ts';
import { loadSessions } from './sources/index.ts';
import { buildSummary } from './summary.ts';
import { loadLatestReplay } from './replay/run.ts';

const TOOLS = [
  {
    name: 'agentbill_current_session',
    description:
      'Cost so far of the agent session running in a folder: spend, leaked spend, context size and the biggest avoidable patterns. Call it before long or repetitive work to decide whether to compact, trim outputs or hand off to a cheaper model.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Working directory of the session. Defaults to the server process directory.' } },
    },
  },
  {
    name: 'agentbill_budget_check',
    description: 'Compares the current session spend with a budget in US dollars and says whether to keep going, compact, or stop.',
    inputSchema: {
      type: 'object',
      properties: {
        budget_usd: { type: 'number', description: 'Budget for this session in USD.' },
        cwd: { type: 'string' },
      },
      required: ['budget_usd'],
    },
  },
  {
    name: 'agentbill_report',
    description: 'Spend and top leaks across all local agent sessions over the last N days, plus the latest open-model replay result if one exists.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Look-back window in days (default 7).' } } },
  },
];

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

async function current(cwd: string): Promise<{ r: SessionReport | undefined; pricer: Pricer }> {
  const pricer = new Pricer(await loadPriceBook());
  const sessions = await loadSessions({ since: Date.now() - 2 * 86400000 });
  const match = sessions.find((s) => norm(s.cwd) === norm(cwd)) ?? sessions.find((s) => norm(cwd).startsWith(norm(s.cwd)));
  const s = match ?? sessions[0];
  return { r: s ? analyzeSession(s, pricer) : undefined, pricer };
}

function describe(r: SessionReport): string {
  const s = r.session;
  const findings = r.findings
    .filter((f) => !f.advisory)
    .slice(0, 5)
    .map((f) => `- ${usd(f.cost)} ${f.title}. ${f.detail}`)
    .join('\n');
  const last = s.calls[s.calls.length - 1];
  const ctx = last ? last.usage.input + last.usage.cacheRead + last.usage.cacheWrite : 0;
  return [
    `Session "${s.title ?? s.id}" (${s.agent}) in ${s.cwd}`,
    `Spent ${usd(r.cost)} over ${s.calls.length} model calls; ${usd(r.wasteCost)} of it leaked to avoidable patterns.`,
    `Current context ${fmtTokens(ctx)} tokens (peak ${fmtTokens(r.peakContext)}). Each call now costs about ${usd(last?.cost ?? 0)}.`,
    findings ? `Biggest leaks:\n${findings}` : 'No avoidable patterns found so far.',
  ].join('\n');
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const cwd = typeof args.cwd === 'string' ? args.cwd : process.cwd();
  if (name === 'agentbill_current_session') {
    const { r } = await current(cwd);
    return r ? describe(r) : 'No agent session found in the last two days.';
  }
  if (name === 'agentbill_budget_check') {
    const budget = Number(args.budget_usd);
    const { r } = await current(cwd);
    if (!r) return 'No agent session found in the last two days.';
    const last = r.session.calls[r.session.calls.length - 1];
    const perCall = last?.cost ?? 0;
    const left = budget - r.cost;
    const callsLeft = perCall > 0 ? Math.floor(left / perCall) : Infinity;
    const verdict =
      left <= 0
        ? 'OVER BUDGET: stop and summarise progress for the user before doing more.'
        : left < budget * 0.2
          ? `Close to budget: about ${callsLeft} calls left at the current context size. Compact the context or finish the current step and stop.`
          : `Within budget: ${usd(left)} left, about ${Number.isFinite(callsLeft) ? callsLeft : 'many'} calls at the current context size.`;
    return `${verdict}\n\n${describe(r)}`;
  }
  if (name === 'agentbill_report') {
    const days = Number(args.days ?? 7);
    const pricer = new Pricer(await loadPriceBook());
    const reports = (await loadSessions({ since: Date.now() - days * 86400000 })).map((s) => analyzeSession(s, pricer));
    if (!reports.length) return `No agent sessions in the last ${days} days.`;
    const sum = buildSummary(reports, pricer);
    const replay = loadLatestReplay();
    return [
      `Last ${days} days: ${usd(sum.totals.cost)} across ${sum.totals.sessions} sessions; ${usd(sum.totals.waste)} leaked.`,
      'Top leaks:',
      ...sum.topFindings.slice(0, 5).map((f) => `- ${usd(f.cost)} ${f.title} (${f.sessionTitle})`),
      replay
        ? `Latest replay: ${replay.model} matched the frontier model on ${Math.round(replay.agreement * 100)}% of ${replay.cases.length} steps.`
        : 'No replay has been run yet (agentbill replay).',
    ].join('\n');
  }
  throw new Error(`Unknown tool ${name}`);
}

export async function runMcp() {
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: { id?: number | string; method?: string; params?: any };
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (req.id === undefined) continue; // notifications
    try {
      switch (req.method) {
        case 'initialize':
          send({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: req.params?.protocolVersion ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'agentbill', version: '0.1.0' },
              instructions: 'Use agentbill_current_session or agentbill_budget_check before long or repetitive work to keep agent spend in check.',
            },
          });
          break;
        case 'ping':
          send({ jsonrpc: '2.0', id: req.id, result: {} });
          break;
        case 'tools/list':
          send({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
          break;
        case 'tools/call': {
          const text = await callTool(req.params?.name, req.params?.arguments ?? {});
          send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
          break;
        }
        default:
          send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: (e as Error).message }], isError: true } });
    }
  }
}
