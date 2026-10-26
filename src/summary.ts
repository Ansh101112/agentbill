// Shapes analysis results into the JSON the dashboard, the CLI --json flag and the MCP server share.
import { basename } from 'node:path';
import { whatIf, type Finding, type SessionReport, type WhatIf } from './analyze.ts';
import type { Pricer } from './pricing.ts';
import { addUsage, contextTokens, emptyUsage, type Usage } from './types.ts';

export const OPEN_MODELS = [
  'deepseek/deepseek-v4.1-flash',
  'z-ai/glm-5.3',
  'qwen/qwen3.8-27b',
  'moonshotai/kimi-k3',
];

export interface SessionRow {
  id: string;
  agent: string;
  title: string;
  project: string;
  cwd: string;
  branch?: string;
  startedAt: number;
  endedAt: number;
  cost: number;
  waste: number;
  calls: number;
  toolCalls: number;
  prompts: number;
  peakContext: number;
  models: string[];
  findings: number;
}

export interface Summary {
  generatedAt: number;
  priceSource: string;
  priceDate: number;
  range: { from: number; to: number };
  totals: { cost: number; waste: number; sessions: number; calls: number; toolCalls: number; usage: Usage };
  byAgent: { agent: string; cost: number; sessions: number }[];
  byModel: { model: string; pricedAs: string | null; cost: number; calls: number; usage: Usage }[];
  byDay: { day: string; cost: number; waste: number }[];
  byProject: { project: string; cost: number; sessions: number }[];
  findingsByKind: { kind: string; count: number; cost: number; advisory: boolean }[];
  topFindings: (Finding & { sessionTitle: string })[];
  whatIf: WhatIf[];
  sessions: SessionRow[];
  unpriced: string[];
}

export const projectName = (cwd: string) => basename(cwd.replace(/[\\/]+$/, '')) || cwd || 'unknown';
const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function buildSummary(reports: SessionReport[], pricer: Pricer): Summary {
  let usage = emptyUsage();
  const byAgent = new Map<string, { cost: number; sessions: number }>();
  const byModel = new Map<string, Summary['byModel'][number]>();
  const byDay = new Map<string, { cost: number; waste: number }>();
  const byProject = new Map<string, { cost: number; sessions: number }>();
  const kinds = new Map<string, { count: number; cost: number; advisory: boolean }>();
  const unpriced = new Set<string>();
  let calls = 0;
  let toolCalls = 0;

  for (const r of reports) {
    const s = r.session;
    usage = addUsage(usage, r.usage);
    calls += s.calls.length;
    toolCalls += s.toolCalls.length;
    const a = byAgent.get(s.agent) ?? { cost: 0, sessions: 0 };
    a.cost += r.cost;
    a.sessions++;
    byAgent.set(s.agent, a);
    const p = byProject.get(projectName(s.cwd)) ?? { cost: 0, sessions: 0 };
    p.cost += r.cost;
    p.sessions++;
    byProject.set(projectName(s.cwd), p);
    for (const [model, m] of Object.entries(r.byModel)) {
      if (!m.pricedAs) unpriced.add(model);
      const e = byModel.get(model) ?? { model, pricedAs: m.pricedAs, cost: 0, calls: 0, usage: emptyUsage() };
      e.cost += m.cost;
      e.calls += m.calls;
      e.usage = addUsage(e.usage, m.usage);
      byModel.set(model, e);
    }
    for (const c of s.calls) {
      const d = byDay.get(dayOf(c.ts)) ?? { cost: 0, waste: 0 };
      d.cost += c.cost ?? 0;
      byDay.set(dayOf(c.ts), d);
    }
    for (const f of r.findings) {
      const k = kinds.get(f.kind) ?? { count: 0, cost: 0, advisory: !!f.advisory };
      k.count++;
      k.cost += f.cost;
      kinds.set(f.kind, k);
      if (!f.advisory) {
        const d = byDay.get(dayOf(f.ts));
        if (d) d.waste += f.cost;
      }
    }
  }

  const titles = new Map(reports.map((r) => [r.session.id, r.session.title ?? projectName(r.session.cwd)]));
  const starts = reports.map((r) => r.session.startedAt).filter(Boolean);
  const sorted = <T extends { cost: number }>(xs: T[]) => xs.sort((a, b) => b.cost - a.cost);

  return {
    generatedAt: Date.now(),
    priceSource: pricer.book.source,
    priceDate: pricer.book.fetchedAt,
    range: { from: Math.min(...starts), to: Math.max(...reports.map((r) => r.session.endedAt)) },
    totals: {
      cost: reports.reduce((n, r) => n + r.cost, 0),
      waste: reports.reduce((n, r) => n + r.wasteCost, 0),
      sessions: reports.length,
      calls,
      toolCalls,
      usage,
    },
    byAgent: sorted([...byAgent].map(([agent, v]) => ({ agent, ...v }))),
    byModel: sorted([...byModel.values()]),
    byDay: [...byDay].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    byProject: sorted([...byProject].map(([project, v]) => ({ project, ...v }))),
    findingsByKind: sorted([...kinds].map(([kind, v]) => ({ kind, ...v }))),
    topFindings: reports
      .flatMap((r) => r.findings.filter((f) => !f.advisory))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 40)
      .map((f) => ({ ...f, sessionTitle: titles.get(f.sessionId) ?? '' })),
    whatIf: whatIf(reports, pricer, OPEN_MODELS),
    sessions: reports.map(sessionRow).sort((a, b) => b.startedAt - a.startedAt),
    unpriced: [...unpriced],
  };
}

export function sessionRow(r: SessionReport): SessionRow {
  const s = r.session;
  return {
    id: s.id,
    agent: s.agent,
    title: s.title ?? projectName(s.cwd),
    project: projectName(s.cwd),
    cwd: s.cwd,
    branch: s.gitBranch,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    cost: r.cost,
    waste: r.wasteCost,
    calls: s.calls.length,
    toolCalls: s.toolCalls.length,
    prompts: s.userPrompts,
    peakContext: r.peakContext,
    models: Object.keys(r.byModel),
    findings: r.findings.filter((f) => !f.advisory).length,
  };
}

export interface SessionDetail {
  row: SessionRow;
  byModel: SessionReport['byModel'];
  timeline: { ts: number; model: string; context: number; output: number; cost: number; sidechain: boolean; tools: string[] }[];
  compactions: number[];
  topCarried: SessionReport['tools'];
  findings: Finding[];
  toolMix: { kind: string; count: number; tokens: number; carryCost: number }[];
  /** Main-loop call index range each heavy output rode along for (the session chart's bands). */
  bands: { label: string; tool: string; tokens: number; from: number; to: number; cost: number }[];
  /** Findings placed on the main-loop call index axis. */
  markers: { index: number; kind: string; title: string; cost: number }[];
  /** Main-loop call indexes where the context was compacted. */
  compactionIndex: number[];
}

function indexAfter(main: { ts: number }[], ts: number): number {
  let lo = 0;
  let hi = main.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (main[mid]!.ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sessionDetail(r: SessionReport): SessionDetail {
  const toolsById = new Map(r.session.toolCalls.map((t) => [t.id, t]));
  const mix = new Map<string, { count: number; tokens: number; carryCost: number }>();
  for (const t of r.tools) {
    const m = mix.get(t.kind) ?? { count: 0, tokens: 0, carryCost: 0 };
    m.count++;
    m.tokens += t.tokens;
    m.carryCost += t.carryCost;
    mix.set(t.kind, m);
  }
  const main = r.session.calls.filter((c) => !c.sidechain);
  const topCarried = [...r.tools].sort((a, b) => b.carryCost - a.carryCost).slice(0, 15);
  const bands = topCarried
    .filter((t) => t.carriedBy > 0 && t.tokens > 0)
    .slice(0, 8)
    .map((t) => {
      const from = indexAfter(main, t.ts);
      return {
        label: t.target.replace(/\\/g, '/').split('/').slice(-2).join('/'),
        tool: t.name,
        tokens: t.tokens,
        from,
        to: Math.min(main.length, from + t.carriedBy),
        cost: t.carryCost,
      };
    });
  const markers = r.findings
    .filter((f) => !f.advisory && f.kind !== 'carry')
    .map((f) => ({ index: Math.min(main.length - 1, indexAfter(main, f.ts - 1)), kind: f.kind, title: f.title, cost: f.cost }));
  return {
    bands,
    markers,
    compactionIndex: r.session.compactions.map((ts) => indexAfter(main, ts)),
    row: sessionRow(r),
    byModel: r.byModel,
    timeline: main.map((c) => ({
      ts: c.ts,
      model: c.model,
      context: contextTokens(c.usage),
      output: c.usage.output,
      cost: c.cost ?? 0,
      sidechain: c.sidechain,
      tools: c.toolCallIds.map((id) => toolsById.get(id)?.name ?? '?'),
    })),
    compactions: r.session.compactions,
    topCarried,
    findings: r.findings,
    toolMix: [...mix].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.carryCost - a.carryCost),
  };
}
