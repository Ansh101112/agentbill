// Alan Code: %LOCALAPPDATA%\Alan\production\
//   conversations\<conversationId>\  (turn index / coverage)
//   runs\<runId>\run.json            (run metadata: conversation, user + assistant turn)
//   runs\<runId>\log.jsonl           (streamed session updates incl. _alan/turn_usage)
//
// One conversation is one Session. Each run is one user turn; a run's log holds
// one or more model calls. Never touches credential.json, local-api.json or s/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Call, Session, ToolCall, Usage } from '../types.ts';
import { readJsonl, type FoundFile } from './jsonl.ts';
import { classifyTool, toolKey } from './tools.ts';

export const alanRoot = (): string => {
  if (process.env.ALAN_HOME) return process.env.ALAN_HOME;
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return join(localAppData, 'Alan', 'production');
};

const conversationsRoot = (root: string) => join(root, 'conversations');
const runsRoot = (root: string) => join(root, 'runs');

interface RunMeta {
  runId: string;
  conversationId: string;
  ordinal: number;
  userText: string;
  userCreatedAt: number;
  assistantCreatedAt: number;
}

function readRunMeta(runDir: string): RunMeta | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as Record<string, any>;
    return {
      runId: String(raw.runId ?? ''),
      conversationId: String(raw.conversationId ?? ''),
      ordinal: Number(raw.userMessage?.turnOrdinal ?? 0),
      userText: typeof raw.userMessage?.content === 'string' ? raw.userMessage.content : '',
      userCreatedAt: Date.parse(String(raw.userMessage?.createdAt ?? '')) || 0,
      assistantCreatedAt: Date.parse(String(raw.assistantMessage?.createdAt ?? '')) || 0,
    };
  } catch {
    return undefined;
  }
}

/** All runs belonging to one conversation, in user-turn order. */
function runsFor(root: string, conversationId: string): { dir: string; meta: RunMeta }[] {
  const dir = runsRoot(root);
  if (!existsSync(dir)) return [];
  const out: { dir: string; meta: RunMeta }[] = [];
  for (const name of readdirSync(dir)) {
    const runDir = join(dir, name);
    const meta = readRunMeta(runDir);
    if (meta && meta.conversationId === conversationId) out.push({ dir: runDir, meta });
  }
  return out.sort((a, b) => a.meta.ordinal - b.meta.ordinal);
}

export function listAlanFiles(root = alanRoot()): FoundFile[] {
  const dir = runsRoot(root);
  if (!existsSync(dir)) return [];
  // One entry per conversation; mtime/size come from its run logs.
  const byConv = new Map<string, { size: number; mtime: number }>();
  for (const name of readdirSync(dir)) {
    const runDir = join(dir, name);
    const meta = readRunMeta(runDir);
    if (!meta?.conversationId) continue;
    let size = 0;
    let mtime = 0;
    try {
      const st = statSync(join(runDir, 'log.jsonl'));
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      continue;
    }
    const cur = byConv.get(meta.conversationId);
    if (cur) {
      cur.size += size;
      if (mtime > cur.mtime) cur.mtime = mtime;
    } else {
      byConv.set(meta.conversationId, { size, mtime });
    }
  }
  return [...byConv.entries()].map(([convId, v]) => ({
    path: join(conversationsRoot(root), convId),
    size: v.size,
    mtime: v.mtime,
  }));
}

const zeroUsage = (): Usage => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 });

const firstLine = (s: string): string =>
  s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? s.trim();

function bump(s: Session, ts: number) {
  if (!ts) return;
  if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
  if (ts > s.endedAt) s.endedAt = ts;
}

/** Result text length; Alan reports it as rawOutput or a content block list. */
function resultLengthOf(u: Record<string, any>): number {
  if (typeof u.rawOutput === 'string') return u.rawOutput.length;
  const content = u.content;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const part of content) {
    const p = part as Record<string, any>;
    const text = p?.content?.text ?? p?.text;
    if (typeof text === 'string') n += text.length;
    else if (typeof p?.content === 'string') n += p.content.length;
  }
  return n;
}

/** Alan has no error status; a non-zero exit or error metadata is the signal. */
function isErrorOf(u: Record<string, any>): boolean {
  const status = String(u.status ?? '');
  if (status === 'error' || status === 'failed') return true;
  const meta = u._meta?.['alan.dev/providerEvent']?.state?.metadata;
  if (meta?.error === true) return true;
  return typeof meta?.exit === 'number' && meta.exit !== 0;
}

export async function parseAlanSession(file: string): Promise<Session> {
  const conversationId = basename(file);
  // <root>/conversations/<convId> → <root>
  let root = resolve(file, '..', '..');
  let runs = runsFor(root, conversationId);
  if (!runs.length) {
    root = alanRoot();
    runs = runsFor(root, conversationId);
  }
  if (!runs.length) throw new Error(`no runs for Alan conversation ${conversationId}`);

  const session: Session = {
    id: conversationId,
    agent: 'alan-code',
    cwd: '',
    file,
    startedAt: 0,
    endedAt: 0,
    userPrompts: 0,
    calls: [],
    toolCalls: [],
    compactions: [],
  };

  const workdirs = new Map<string, number>();

  for (const { dir: runDir, meta } of runs) {
    const runId = meta.runId || basename(runDir);
    session.userPrompts++;
    if (session.title == null && meta.userText) session.title = firstLine(meta.userText).slice(0, 80);
    bump(session, meta.userCreatedAt);
    bump(session, meta.assistantCreatedAt);

    // _alan/turn_usage is cumulative per run; per-call usage is the delta.
    let prev = zeroUsage();
    let prevCalls = 0;
    let model = 'unknown';
    let currentMessageId: string | undefined;
    let lastTs = meta.userCreatedAt;
    let contextUsed = 0;
    let pending: ToolCall[] = [];
    const pendingById = new Map<string, ToolCall>();

    for await (const rec of readJsonl(join(runDir, 'log.jsonl'))) {
      const ts = typeof rec.at === 'number' ? rec.at : lastTs;
      lastTs = ts;
      bump(session, ts);

      const u = (rec.update ?? {}) as Record<string, any>;
      const kind = u.sessionUpdate as string | undefined;

      if (kind === 'tool_call_update') {
        const id = String(u.toolCallId ?? '');
        if (!id) continue;
        let tc = pendingById.get(id);
        if (!tc) {
          const name = String(u.name ?? 'tool');
          const input = (u.rawInput ?? {}) as Record<string, any>;
          const c = classifyTool(name, input);
          tc = {
            id,
            callId: '',
            ts,
            name,
            ...c,
            key: toolKey(name, c.target),
            isError: false,
            resultChars: 0,
          };
          pendingById.set(id, tc);
          pending.push(tc);
          if (typeof input.workdir === 'string' && input.workdir) {
            workdirs.set(input.workdir, (workdirs.get(input.workdir) ?? 0) + 1);
          }
        }
        if (u.status === 'completed' || u.status === 'error' || u.status === 'failed') {
          tc.resultChars = resultLengthOf(u);
          tc.isError = isErrorOf(u);
        }
        continue;
      }

      if (kind === 'agent_message' || kind === 'agent_thought') {
        if (typeof u.messageId === 'string') currentMessageId = u.messageId.replace(/:reasoning$/, '');
        continue;
      }

      if (kind === '_alan/turn_usage') {
        const usage = (u.usage ?? {}) as Record<string, any>;
        const calls = Number(usage.modelCalls ?? 0);
        if (!calls || calls <= prevCalls) continue; // not a new model call
        const snap: Usage = {
          input: Number(usage.inputTokens ?? 0),
          cacheRead: Number(usage.cacheReadTokens ?? 0),
          cacheWrite: Number(usage.cacheWriteTokens ?? 0),
          output: Number(usage.outputTokens ?? 0),
          reasoning: Number(usage.reasoningTokens ?? 0),
        };
        const delta: Usage = {
          input: Math.max(0, snap.input - prev.input),
          cacheRead: Math.max(0, snap.cacheRead - prev.cacheRead),
          cacheWrite: Math.max(0, snap.cacheWrite - prev.cacheWrite),
          output: Math.max(0, snap.output - prev.output),
          reasoning: Math.max(0, snap.reasoning - prev.reasoning),
        };
        prev = snap;
        prevCalls = calls;
        model = String(usage.model ?? model);

        const call: Call = {
          id: currentMessageId ?? `${runId}:${calls}`,
          ts,
          model,
          usage: delta,
          toolCallIds: [],
          sidechain: false,
        };
        for (const t of pending) {
          t.callId = call.id;
          call.toolCallIds.push(t.id);
          session.toolCalls.push(t);
        }
        pending = [];
        pendingById.clear();
        currentMessageId = undefined;
        session.calls.push(call);
        continue;
      }

      if (kind === 'usage_update') {
        const used = Number(u.used ?? 0);
        // A large context drop is the only compaction signal Alan exposes.
        if (contextUsed && used > 0 && used < contextUsed * 0.5) session.compactions.push(ts);
        // Compare with the latest size, not the peak, so one compaction is counted once.
        if (used > 0) contextUsed = used;
      }
    }

    // Tool calls from a run that ended without a usage record.
    if (pending.length) {
      const call: Call = {
        id: `${runId}:tail`,
        ts: lastTs,
        model,
        usage: zeroUsage(),
        toolCallIds: [],
        sidechain: false,
      };
      for (const t of pending) {
        t.callId = call.id;
        call.toolCallIds.push(t.id);
        session.toolCalls.push(t);
      }
      session.calls.push(call);
    }
  }

  const topWorkdir = [...workdirs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topWorkdir) session.cwd = topWorkdir[0].replace(/[\\/]+$/, '');

  session.calls.sort((a, b) => a.ts - b.ts);
  session.toolCalls.sort((a, b) => a.ts - b.ts);
  return session;
}