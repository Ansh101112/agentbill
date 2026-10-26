// The replay judge: asks an open model to take the same step a frontier model took, then judges whether it matched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionReport } from '../analyze.ts';
import { costWith, type Pricer } from '../pricing.ts';
import type { Call } from '../types.ts';
import { chat, llmConfigFromEnv, parseJsonReply, type LlmConfig } from './llm.ts';
import { claudeStep, fitTurns, type Action, type Step } from './transcript.ts';

export type Verdict = 'same' | 'equivalent' | 'different' | 'error';

export interface ReplayCase {
  sessionId: string;
  sessionTitle: string;
  callId: string;
  ts: number;
  originalModel: string;
  originalCost: number;
  kind: string;
  lastRequest: string;
  actual: Action[];
  proposed?: { tool: string; target: string; why: string };
  verdict: Verdict;
  reason: string;
  replayCost: number;
  ms: number;
}

export interface ReplayResult {
  model: string;
  judgeModel: string;
  createdAt: number;
  cases: ReplayCase[];
  /** Share of steps where the open model's move matched (same or equivalent). */
  agreement: number;
  byKind: { kind: string; n: number; agreement: number; spend: number; openCost: number }[];
  /** Spend on step kinds where agreement >= threshold, and what the open model would charge for it. */
  routable: { threshold: number; spend: number; openCost: number; saved: number; shareOfSpend: number };
  replaySpend: number;
}

export interface ReplayOptions {
  model: string;
  judgeModel?: string;
  steps: number;
  threshold: number;
  concurrency: number;
  llm?: LlmConfig;
  onProgress?: (done: number, total: number, c: ReplayCase) => void;
}

export const REPLAY_DIR = join(homedir(), '.agentbill', 'replay');
export const latestReplayPath = () => join(REPLAY_DIR, 'latest.json');

export function loadLatestReplay(): ReplayResult | null {
  try {
    return existsSync(latestReplayPath()) ? (JSON.parse(readFileSync(latestReplayPath(), 'utf8')) as ReplayResult) : null;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ').replace(/\s*\[.*\]$/, '').trim();
const cmdHead = (s: string) => norm(s).split(' ').slice(0, 2).join(' ');

/** Cheap deterministic check before paying for a judge call. */
function quickMatch(actual: Action[], p: { tool: string; target: string }): boolean {
  return actual.some((a) => {
    if (a.tool.toLowerCase() !== p.tool.toLowerCase()) return false;
    const at = norm(a.target);
    const pt = norm(p.target);
    if (!at || !pt) return false;
    if (a.kind === 'exec') return cmdHead(a.target) === cmdHead(p.target);
    return at === pt || at.endsWith(pt) || pt.endsWith(at);
  });
}

/** Picks expensive decision steps, spread across the costliest sessions. */
export function pickSteps(reports: SessionReport[], n: number): { r: SessionReport; call: Call }[] {
  const sessions = reports
    .filter((r) => r.session.agent === 'claude-code')
    .sort((a, b) => b.cost - a.cost)
    .slice(0, Math.max(3, Math.ceil(n / 4)));
  const pools = sessions.map((r) => {
    const tools = new Map(r.session.toolCalls.map((t) => [t.id, t]));
    return r.session.calls
      .filter((c, i) => !c.sidechain && i > 2 && c.toolCallIds.length >= 1 && tools.has(c.toolCallIds[0]!))
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, n * 3)
      // Spread through the session rather than one burst: keep every k-th of the expensive ones.
      .filter((_, i) => i % 3 === 0)
      .map((call) => ({ r, call }));
  });
  const picked: { r: SessionReport; call: Call }[] = [];
  for (let round = 0; picked.length < n && pools.some((p) => p.length > round); round++) {
    for (const p of pools) if (p[round] && picked.length < n) picked.push(p[round]!);
  }
  return picked;
}

function render(step: Step, budget: number): string {
  return fitTurns(step.turns, budget)
    .map((t) => `### ${t.role === 'tool' ? 'Tool result' : t.role === 'user' ? 'User' : 'Agent'}\n${t.text}`)
    .join('\n\n');
}

const ACTOR_SYSTEM = (tools: string[]) => `You are the coding agent in the session below, working in the user's repository.
Decide the single next action you would take now.
Tools you can call: ${tools.join(', ') || 'Read, Edit, Write, Bash, Grep, Glob'}.
Reply with JSON only: {"tool": "<tool name>", "target": "<file path, shell command, or search pattern>", "why": "<one short sentence>"}`;

const JUDGE_SYSTEM = `You compare two coding-agent actions taken at the same point in a session.
"same": same tool on the same target.
"equivalent": a different call that gets the same information or makes the same change, so the session would progress the same way.
"different": a different move (other file, other goal, or a step that would not help).
Reply with JSON only: {"verdict": "same" | "equivalent" | "different", "reason": "<one sentence>"}`;

export async function runReplay(reports: SessionReport[], pricer: Pricer, opts: ReplayOptions): Promise<ReplayResult> {
  const llm = opts.llm ?? llmConfigFromEnv();
  const judgeModel = opts.judgeModel ?? opts.model;
  const targets = pickSteps(reports, opts.steps);
  const openPrice = pricer.resolve(opts.model)?.price;
  const judgePrice = pricer.resolve(judgeModel)?.price;
  const cases: ReplayCase[] = [];
  let done = 0;

  const priceOf = (price: typeof openPrice, inTok: number, outTok: number, reported?: number) =>
    reported ?? (price ? costWith(price, { input: inTok, output: outTok, cacheRead: 0, cacheWrite: 0, reasoning: 0 }) : 0);

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: opts.concurrency }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { r, call } = item;
        const s = r.session;
        const firstTool = s.toolCalls.find((t) => t.id === call.toolCallIds[0]);
        const base: ReplayCase = {
          sessionId: s.id,
          sessionTitle: s.title ?? s.cwd,
          callId: call.id,
          ts: call.ts,
          originalModel: call.model,
          originalCost: call.cost ?? 0,
          kind: firstTool?.kind ?? 'other',
          lastRequest: '',
          actual: [],
          verdict: 'error',
          reason: '',
          replayCost: 0,
          ms: 0,
        };
        try {
          const step = await claudeStep(s.file, call.id);
          if (!step) throw new Error('could not rebuild this step from the log');
          base.actual = step.actual;
          base.lastRequest = [...step.turns].reverse().find((t) => t.role === 'user')?.text.slice(0, 300) ?? '';
          const act = await chat(llm, opts.model, [
            { role: 'system', content: ACTOR_SYSTEM(step.tools) },
            { role: 'user', content: render(step, 60000) },
          ], { json: true, maxTokens: 300 });
          base.replayCost += priceOf(openPrice, act.inputTokens, act.outputTokens, act.cost);
          base.ms += act.ms;
          const proposed = parseJsonReply<{ tool: string; target: string; why: string }>(act.text);
          if (!proposed?.tool) throw new Error(`no action in reply: ${act.text.slice(0, 120)}`);
          base.proposed = { tool: String(proposed.tool), target: String(proposed.target ?? ''), why: String(proposed.why ?? '') };

          if (quickMatch(step.actual, base.proposed)) {
            base.verdict = 'same';
            base.reason = 'Same tool on the same target.';
          } else {
            const recent = fitTurns(step.turns, 6000).map((t) => `${t.role}: ${t.text}`).join('\n');
            const judged = await chat(llm, judgeModel, [
              { role: 'system', content: JUDGE_SYSTEM },
              {
                role: 'user',
                content: `Recent context:\n${recent}\n\nAction A (original):\n${step.actual.map((a) => `${a.tool} ${a.input}`).join('\n')}\n\nAction B (replay):\n${base.proposed.tool} ${base.proposed.target}\nWhy: ${base.proposed.why}`,
              },
            ], { json: true, maxTokens: 200 });
            base.replayCost += priceOf(judgePrice, judged.inputTokens, judged.outputTokens, judged.cost);
            base.ms += judged.ms;
            const v = parseJsonReply<{ verdict: string; reason: string }>(judged.text);
            base.verdict = v?.verdict === 'same' || v?.verdict === 'equivalent' ? v.verdict : 'different';
            base.reason = v?.reason ?? judged.text.slice(0, 200);
          }
        } catch (e) {
          base.verdict = 'error';
          base.reason = (e as Error).message;
        }
        cases.push(base);
        opts.onProgress?.(++done, targets.length, base);
      }
    }),
  );

  return summarise(reports, pricer, opts.model, judgeModel, cases, opts.threshold);
}

export function summarise(
  reports: SessionReport[],
  pricer: Pricer,
  model: string,
  judgeModel: string,
  cases: ReplayCase[],
  threshold: number,
): ReplayResult {
  const scored = cases.filter((c) => c.verdict !== 'error');
  const ok = (c: ReplayCase) => c.verdict === 'same' || c.verdict === 'equivalent';
  const price = pricer.resolve(model)?.price;

  // Spend by the kind of the first tool each call asked for, across all sessions.
  const spendByKind = new Map<string, { spend: number; openCost: number }>();
  for (const r of reports) {
    const kindOf = new Map(r.session.toolCalls.map((t) => [t.id, t.kind]));
    for (const c of r.session.calls) {
      const kind = (c.toolCallIds[0] && kindOf.get(c.toolCallIds[0])) || 'reply';
      const e = spendByKind.get(kind) ?? { spend: 0, openCost: 0 };
      e.spend += c.cost ?? 0;
      e.openCost += price ? costWith(price, c.usage) : 0;
      spendByKind.set(kind, e);
    }
  }
  const kinds = [...new Set(scored.map((c) => c.kind))];
  const byKind = kinds
    .map((kind) => {
      const xs = scored.filter((c) => c.kind === kind);
      const e = spendByKind.get(kind) ?? { spend: 0, openCost: 0 };
      return { kind, n: xs.length, agreement: xs.filter(ok).length / xs.length, spend: e.spend, openCost: e.openCost };
    })
    .sort((a, b) => b.spend - a.spend);
  const routableKinds = byKind.filter((k) => k.n >= 3 && k.agreement >= threshold);
  const spend = routableKinds.reduce((n, k) => n + k.spend, 0);
  const openCost = routableKinds.reduce((n, k) => n + k.openCost, 0);
  const total = reports.reduce((n, r) => n + r.cost, 0);

  return {
    model,
    judgeModel,
    createdAt: Date.now(),
    cases: cases.sort((a, b) => b.originalCost - a.originalCost),
    agreement: scored.length ? scored.filter(ok).length / scored.length : 0,
    byKind,
    routable: { threshold, spend, openCost, saved: spend - openCost, shareOfSpend: total ? spend / total : 0 },
    replaySpend: cases.reduce((n, c) => n + c.replayCost, 0),
  };
}

export function saveReplay(result: ReplayResult) {
  mkdirSync(REPLAY_DIR, { recursive: true });
  const stamp = new Date(result.createdAt).toISOString().replace(/[:.]/g, '-');
  const body = JSON.stringify(result, null, 1);
  writeFileSync(join(REPLAY_DIR, `${stamp}.json`), body);
  writeFileSync(latestReplayPath(), body);
}
