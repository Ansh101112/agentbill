// Prices every call and finds where the money leaked.
import { costWith, type Pricer } from './pricing.ts';
import { addUsage, contextTokens, emptyUsage, type Call, type Session, type ToolCall, type Usage } from './types.ts';

/** Rough chars-per-token for code and logs. */
export const CHARS_PER_TOKEN = 3.6;

export type FindingKind = 'carry' | 'reread' | 'cache-rebuild' | 'retry-loop' | 'context-bloat';

export interface Finding {
  kind: FindingKind;
  sessionId: string;
  ts: number;
  title: string;
  detail: string;
  /** Money this pattern cost beyond what the work needed. */
  cost: number;
  tokens: number;
  /** Shown as advice but not counted as waste: a big context is sometimes what the task needs. */
  advisory?: boolean;
}

export interface ToolCost {
  toolId: string;
  name: string;
  target: string;
  kind: ToolCall['kind'];
  ts: number;
  tokens: number;
  /** Number of later calls that re-sent this output. */
  carriedBy: number;
  carryCost: number;
}

export interface SessionReport {
  session: Session;
  cost: number;
  usage: Usage;
  byModel: Record<string, { calls: number; cost: number; usage: Usage; pricedAs: string | null }>;
  tools: ToolCost[];
  findings: Finding[];
  wasteCost: number;
  peakContext: number;
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);
const mins = (ms: number) => `${Math.round(ms / 60000)} min`;
const short = (p: string) => p.replace(/\\/g, '/').split('/').slice(-2).join('/');

/** Price per context token actually paid on this call (blend of fresh, cache-read and cache-write). */
function contextRate(pricer: Pricer, c: Call): number {
  const ctx = contextTokens(c.usage);
  if (!ctx) return 0;
  const p = pricer.resolve(c.model)?.price;
  if (!p) return 0;
  return costWith(p, { ...c.usage, output: 0 }) / ctx;
}

export function analyzeSession(s: Session, pricer: Pricer): SessionReport {
  const byModel: SessionReport['byModel'] = {};
  let usage = emptyUsage();
  let cost = 0;
  let peakContext = 0;
  for (const c of s.calls) {
    c.cost = pricer.cost(c.model, c.usage);
    cost += c.cost;
    usage = addUsage(usage, c.usage);
    peakContext = Math.max(peakContext, contextTokens(c.usage));
    const m = (byModel[c.model] ??= { calls: 0, cost: 0, usage: emptyUsage(), pricedAs: pricer.resolve(c.model)?.id ?? null });
    m.calls++;
    m.cost += c.cost;
    m.usage = addUsage(m.usage, c.usage);
  }

  const main = s.calls.filter((c) => !c.sidechain);
  const rates = main.map((c) => contextRate(pricer, c));
  // suffix[i] = sum of context rates of main calls i..end, cut at compactions below.
  const callIndexAfter = (ts: number) => {
    let lo = 0;
    let hi = main.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (main[mid]!.ts <= ts) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const compactIdx = s.compactions.map(callIndexAfter).sort((a, b) => a - b);
  const prefix = [0];
  for (const r of rates) prefix.push(prefix[prefix.length - 1]! + r);

  const callById = new Map(s.calls.map((c) => [c.id, c]));
  const tools: ToolCost[] = [];
  for (const t of s.toolCalls) {
    const tokens = Math.round(t.resultChars / CHARS_PER_TOKEN);
    let carryCost = 0;
    let carriedBy = 0;
    if (tokens && !callById.get(t.callId)?.sidechain) {
      const from = callIndexAfter(t.ts);
      const to = compactIdx.find((i) => i > from) ?? main.length;
      carriedBy = Math.max(0, to - from);
      carryCost = tokens * (prefix[to]! - prefix[from]!);
    }
    tools.push({ toolId: t.id, name: t.name, target: t.target, kind: t.kind, ts: t.ts, tokens, carriedBy, carryCost });
  }
  const toolCost = new Map(tools.map((t) => [t.toolId, t]));

  const findings: Finding[] = [];

  // 1. Heavy outputs that rode along for many calls.
  for (const t of tools) {
    if (t.tokens >= 2500 && t.carryCost >= 0.05) {
      findings.push({
        kind: 'carry',
        sessionId: s.id,
        ts: t.ts,
        title: `${fmtTokens(t.tokens)}-token ${t.name} output re-sent ${t.carriedBy}×`,
        detail: `${t.target} — re-sent on ${t.carriedBy} later calls. Trim it (head, --quiet, a line range) or run it in a subagent.`,
        cost: t.carryCost,
        tokens: t.tokens * t.carriedBy,
      });
    }
  }

  // 2. Reading a file again when it has not changed since the last read.
  const lastRead = new Map<string, ToolCall>();
  for (const t of s.toolCalls) {
    if (!t.path) continue;
    const key = t.path.toLowerCase().replace(/\\/g, '/');
    if (t.kind === 'write') {
      lastRead.delete(key);
    } else if (t.kind === 'read') {
      const prev = lastRead.get(key);
      const tc = toolCost.get(t.id);
      if (prev && tc && tc.tokens > 300 && !/\[\d+\+/.test(t.target)) {
        findings.push({
          kind: 'reread',
          sessionId: s.id,
          ts: t.ts,
          title: `Re-read unchanged ${short(t.path)}`,
          detail: `Read again ${mins(t.ts - prev.ts)} after the last read with no edit in between. The copy already in context was enough.`,
          cost: tc.carryCost,
          tokens: tc.tokens,
        });
      }
      lastRead.set(key, t);
    }
  }

  // 3. Prompt cache rebuilt from scratch, usually after an idle gap longer than the cache TTL.
  for (let i = 1; i < main.length; i++) {
    const c = main[i]!;
    const prev = main[i - 1]!;
    const ctx = contextTokens(c.usage);
    const afterCompaction = s.compactions.some((t) => t > prev.ts && t <= c.ts);
    if (afterCompaction || ctx < 20000 || c.usage.cacheWrite < ctx * 0.6) continue;
    const p = pricer.resolve(c.model)?.price;
    if (!p) continue;
    const extra = c.usage.cacheWrite * ((p.cacheWrite ?? p.input) - (p.cacheRead ?? p.input));
    if (extra < 0.02) continue;
    findings.push({
      kind: 'cache-rebuild',
      sessionId: s.id,
      ts: c.ts,
      ...(c.ts - prev.ts >= 5 * 60000
        ? {
            title: `Prompt cache expired: ${fmtTokens(c.usage.cacheWrite)} tokens rewritten after ${mins(c.ts - prev.ts)} idle`,
            detail: `The cache outlived its TTL, so the whole context was written again instead of read. Compact or /clear before a break, or resume sooner.`,
          }
        : {
            title: `Prompt cache invalidated: ${fmtTokens(c.usage.cacheWrite)} tokens rewritten mid-session`,
            detail: `Something early in the prompt changed (model switch, tool list, system prompt, rewind or fork), so nothing after it could be read from cache.`,
          }),
      cost: extra,
      tokens: c.usage.cacheWrite,
    });
  }

  // 4. Retry loops: the same failing tool call three or more times in a row.
  let run: ToolCall[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const callIds = new Set(run.map((t) => t.callId));
      const loopCost = [...callIds].reduce((n, id) => n + (callById.get(id)?.cost ?? 0), 0);
      findings.push({
        kind: 'retry-loop',
        sessionId: s.id,
        ts: run[0]!.ts,
        title: `${run.length} failed ${run[0]!.name} calls in a row`,
        detail: `${run[0]!.target} — the agent kept retrying a failing step. A clearer error, a skill, or a hook that stops after two failures would save these calls.`,
        cost: loopCost,
        tokens: [...callIds].reduce((n, id) => n + contextTokens(callById.get(id)?.usage ?? emptyUsage()), 0),
      });
    }
    run = [];
  };
  for (const t of s.toolCalls) {
    if (t.isError && (!run.length || run[0]!.name === t.name)) run.push(t);
    else {
      flush();
      if (t.isError) run.push(t);
    }
  }
  flush();

  // 5. Context bloat: long stretches far above what the work needed.
  const BLOAT = 150000;
  const KEEP = 60000;
  let bloatCost = 0;
  let bloatCalls = 0;
  let firstBloat = 0;
  main.forEach((c, i) => {
    const ctx = contextTokens(c.usage);
    if (ctx > BLOAT) {
      bloatCost += (ctx - KEEP) * rates[i]!;
      bloatCalls++;
      firstBloat ||= c.ts;
    }
  });
  if (bloatCalls >= 5 && bloatCost >= 0.1) {
    findings.push({
      kind: 'context-bloat',
      sessionId: s.id,
      ts: firstBloat,
      title: `${bloatCalls} calls ran with more than ${fmtTokens(BLOAT)} tokens of context`,
      detail: `Compacting to ~${fmtTokens(KEEP)} or starting a fresh session for the next task would have cut up to this much. Not counted as waste: some tasks need the context.`,
      advisory: true,
      cost: bloatCost,
      tokens: Math.round(bloatCost / (rates.find((r) => r > 0) || 1)),
    });
  }

  findings.sort((a, b) => b.cost - a.cost);
  // Overlapping patterns (a re-read is also a carry) are not double-counted in the total.
  const counted = new Set<string>();
  let wasteCost = 0;
  for (const f of findings) {
    if (f.advisory) continue;
    const k = `${f.kind === 'reread' ? 'carry' : f.kind}:${f.ts}`;
    if (counted.has(k)) continue;
    counted.add(k);
    wasteCost += f.cost;
  }
  wasteCost = Math.min(wasteCost, cost);

  return { session: s, cost, usage, byModel, tools, findings, wasteCost, peakContext };
}

export interface WhatIf {
  model: string;
  priceId: string;
  cost: number;
  saved: number;
}

/** Same tokens, different model: what the sessions would have cost. */
export function whatIf(reports: SessionReport[], pricer: Pricer, models: string[]): WhatIf[] {
  const actual = reports.reduce((n, r) => n + r.cost, 0);
  return models.flatMap((m) => {
    const res = pricer.resolve(m);
    if (!res) return [];
    const cost = reports.reduce((n, r) => n + r.session.calls.reduce((k, c) => k + costWith(res.price, c.usage), 0), 0);
    return [{ model: m, priceId: res.id, cost, saved: actual - cost }];
  });
}

export { usd, fmtTokens };
