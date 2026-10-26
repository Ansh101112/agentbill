// OpenCode: ~/.local/share/opencode/opencode.db (SQLite).
// Reads both layouts OpenCode has shipped:
//   - message + part tables: one row per message with its own token usage (preferred)
//   - session_message table: typed rows; uses per-message tokens when present, otherwise
//     splits the session's aggregate tokens evenly across its model calls (marked as estimated)
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Call, Session, ToolCall, Usage } from '../types.ts';
import type { FoundFile } from './jsonl.ts';
import { classifyTool, resultLength, toolKey } from './tools.ts';

export const opencodeRoot = (): string => {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return process.env.OPENCODE_DB ?? join(base, 'opencode', 'opencode.db');
};

/** Separator between db path and session id in the FoundFile.path. */
const SEP = '::';

// node:sqlite prints an ExperimentalWarning on load, so only load it when an OpenCode database exists.
function openDb(path: string): DatabaseSync {
  const { DatabaseSync: Db } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  // Read-only: OpenCode (or Alan) may be writing to this database while we read it.
  return new Db(path, { readOnly: true });
}

const hasTable = (db: DatabaseSync, name: string) =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

export function listOpenCodeFiles(root = opencodeRoot()): FoundFile[] {
  if (!existsSync(root)) return [];
  const db = openDb(root);
  try {
    const sources = [
      hasTable(db, 'session_message') ? 'SELECT 1 FROM session_message m WHERE m.session_id = s.id' : '',
      hasTable(db, 'message') ? 'SELECT 1 FROM message m WHERE m.session_id = s.id' : '',
    ].filter(Boolean);
    if (!sources.length) return [];
    const rows = db
      .prepare(`SELECT s.id, s.time_updated FROM session s WHERE ${sources.map((q) => `EXISTS (${q})`).join(' OR ')} ORDER BY s.time_created DESC`)
      .all() as { id: string; time_updated: number }[];
    return rows.map((r) => ({ path: `${root}${SEP}${r.id}`, size: 0, mtime: r.time_updated ?? 0 }));
  } finally {
    db.close();
  }
}

/** OpenCode token object: { input, output, reasoning, cache: { read, write } }. */
function toUsage(t: any): Usage | null {
  if (!t || typeof t !== 'object' || typeof t.input !== 'number') return null;
  return {
    input: t.input ?? 0,
    cacheRead: t.cache?.read ?? 0,
    cacheWrite: t.cache?.write ?? 0,
    output: (t.output ?? 0) + (t.reasoning ?? 0),
    reasoning: t.reasoning ?? 0,
  };
}

function toolCall(name: string, state: any, id: string, callId: string, ts: number): ToolCall {
  const c = classifyTool(name, state?.input ?? {});
  const exit = state?.metadata?.exit;
  return {
    id,
    callId,
    ts: state?.time?.start ?? state?.time?.created ?? ts,
    name,
    ...c,
    key: toolKey(name, c.target),
    isError: state?.status === 'error' || (typeof exit === 'number' && exit !== 0),
    resultChars: resultLength(state?.output ?? state?.content ?? state?.error),
  };
}

function emptySession(row: Record<string, any>, dbPath: string): Session {
  return {
    id: row.id,
    agent: 'opencode',
    title: row.title,
    cwd: row.directory ?? '',
    file: dbPath,
    startedAt: row.time_created ?? 0,
    endedAt: row.time_updated ?? 0,
    userPrompts: 0,
    calls: [],
    toolCalls: [],
    compactions: [],
  };
}

const touch = (s: Session, ts: number) => {
  if (!ts) return;
  if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
  if (ts > s.endedAt) s.endedAt = ts;
};

const parse = (data: string): Record<string, any> | null => {
  try {
    return JSON.parse(data) as Record<string, any>;
  } catch {
    return null;
  }
};

/** message + part tables: the layout with per-message token usage. */
function fromMessageParts(db: DatabaseSync, row: Record<string, any>, dbPath: string): Session {
  const s = emptySession(row, dbPath);
  const sidechain = row.parent_id != null;
  const msgs = db.prepare(`SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id`).all(row.id) as {
    id: string;
    time_created: number;
    data: string;
  }[];
  const partsOf = db.prepare(`SELECT id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created, id`);
  for (const m of msgs) {
    const info = parse(m.data);
    if (!info) continue;
    const ts = info.time?.created ?? m.time_created ?? 0;
    touch(s, ts);
    const parts = (partsOf.all(m.id) as { id: string; time_created: number; data: string }[])
      .map((p) => ({ id: p.id, ts: p.time_created, d: parse(p.data) }))
      .filter((p) => p.d);
    if (info.role === 'user') {
      if (parts.some((p) => p.d!.type === 'compaction')) {
        s.compactions.push(ts);
        continue;
      }
      if (info.summary !== true) s.userPrompts++;
      if (!s.title) s.title = String(parts.find((p) => p.d!.type === 'text')?.d!.text ?? '').slice(0, 80);
      continue;
    }
    if (info.role !== 'assistant') continue;
    if (info.summary === true) s.compactions.push(ts);
    const call: Call = {
      id: m.id,
      ts,
      model: info.providerID && info.modelID ? `${info.providerID}/${info.modelID}` : info.modelID ?? row.model ?? 'unknown',
      usage: toUsage(info.tokens) ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      toolCallIds: [],
      sidechain,
    };
    for (const p of parts) {
      if (p.d!.type !== 'tool') continue;
      const tc = toolCall(p.d!.tool, p.d!.state, p.d!.callID ?? p.id, call.id, p.ts);
      s.toolCalls.push(tc);
      call.toolCallIds.push(tc.id);
    }
    s.calls.push(call);
  }
  return s;
}

/** session_message table: typed rows. */
function fromSessionMessages(db: DatabaseSync, row: Record<string, any>, dbPath: string): Session {
  const s = emptySession(row, dbPath);
  const sidechain = row.parent_id != null;
  const msgs = db.prepare(`SELECT id, type, seq, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq`).all(row.id) as {
    id: string;
    type: string;
    time_created: number;
    data: string;
  }[];

  // Fallback when messages carry no usage of their own: the session's totals, split evenly.
  const agg = {
    input: row.tokens_input ?? 0,
    output: (row.tokens_output ?? 0) + (row.tokens_reasoning ?? 0),
    reasoning: row.tokens_reasoning ?? 0,
    cacheRead: row.tokens_cache_read ?? 0,
    cacheWrite: row.tokens_cache_write ?? 0,
  };
  const n = msgs.filter((m) => m.type === 'assistant').length || 1;
  const split = (total: number, i: number) => (i < n - 1 ? Math.floor(total / n) : total - Math.floor(total / n) * (n - 1));
  let callIdx = 0;

  for (const msg of msgs) {
    const ts = msg.time_created ?? 0;
    touch(s, ts);
    const d = parse(msg.data);
    if (!d) continue;
    if (msg.type === 'user') {
      s.userPrompts++;
      if (!s.title && typeof d.text === 'string') s.title = d.text.slice(0, 80);
    } else if (msg.type === 'compaction') {
      s.compactions.push(ts);
    } else if (msg.type === 'assistant') {
      const call: Call = {
        id: msg.id,
        ts,
        model: d.model ?? row.model ?? 'unknown',
        usage: toUsage(d.tokens) ?? {
          input: split(agg.input, callIdx),
          cacheRead: split(agg.cacheRead, callIdx),
          cacheWrite: split(agg.cacheWrite, callIdx),
          output: split(agg.output, callIdx),
          reasoning: split(agg.reasoning, callIdx),
        },
        toolCallIds: [],
        sidechain,
      };
      const content = Array.isArray(d.content) ? d.content : [];
      for (const block of content) {
        if (block?.type !== 'tool') continue;
        const tc = toolCall(block.name, block.state ?? {}, block.id ?? `${msg.id}:t${call.toolCallIds.length}`, call.id, block.time?.created ?? ts);
        s.toolCalls.push(tc);
        call.toolCallIds.push(tc.id);
      }
      s.calls.push(call);
      callIdx++;
    }
  }
  return s;
}

export async function parseOpenCodeSession(file: string): Promise<Session> {
  const idx = file.lastIndexOf(SEP);
  const dbPath = idx >= 0 ? file.slice(0, idx) : file;
  const sessionId = idx >= 0 ? file.slice(idx + SEP.length) : '';
  const db = openDb(dbPath);
  try {
    const row = db.prepare(`SELECT * FROM session WHERE id = ?`).get(sessionId) as Record<string, any> | undefined;
    if (!row) throw new Error(`session ${sessionId} not found in ${dbPath}`);
    const useParts = hasTable(db, 'message') && !!db.prepare(`SELECT 1 FROM message WHERE session_id = ? LIMIT 1`).get(sessionId);
    return useParts ? fromMessageParts(db, row, dbPath) : fromSessionMessages(db, row, dbPath);
  } finally {
    db.close();
  }
}
