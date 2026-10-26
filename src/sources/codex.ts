// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Call, Session, ToolCall, Usage } from '../types.ts';
import { findFiles, ms, readJsonl, type FoundFile } from './jsonl.ts';
import { classifyTool, resultLength, toolKey } from './tools.ts';

export const codexRoot = () => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');

export function listCodexFiles(root = codexRoot()): FoundFile[] {
  return existsSync(root) ? findFiles(root, '.jsonl', 4) : [];
}

// OpenAI-style usage: input_tokens already includes cached and cache-write tokens.
function toUsage(u: Record<string, number> | undefined): Usage {
  const input = u?.input_tokens ?? 0;
  const cacheRead = u?.cached_input_tokens ?? 0;
  const cacheWrite = u?.cache_write_input_tokens ?? 0;
  return {
    input: Math.max(0, input - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: u?.output_tokens ?? 0,
    reasoning: u?.reasoning_output_tokens ?? 0,
  };
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function parseCodexSession(file: string): Promise<Session> {
  const s: Session = {
    id: '',
    agent: 'codex',
    cwd: '',
    file,
    startedAt: 0,
    endedAt: 0,
    userPrompts: 0,
    calls: [],
    toolCalls: [],
    compactions: [],
  };
  const tools = new Map<string, ToolCall>();
  let model = 'unknown';
  let pending: ToolCall[] = [];
  let sawUsageRecords = false;
  let callSeq = 0;

  const pushCall = (ts: number, usage: Usage, id?: string) => {
    const call: Call = {
      id: id ?? `${s.id}:${callSeq++}`,
      ts,
      model,
      usage,
      toolCallIds: pending.map((t) => t.id),
      sidechain: false,
    };
    for (const t of pending) t.callId = call.id;
    pending = [];
    s.calls.push(call);
  };

  for await (const r of readJsonl(file)) {
    const ts = ms(r.timestamp);
    if (ts) {
      if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
      if (ts > s.endedAt) s.endedAt = ts;
    }
    const p = (r.payload ?? {}) as Record<string, any>;

    switch (r.type) {
      case 'session_meta':
        s.id = p.id ?? p.session_id ?? s.id;
        s.cwd = p.cwd ?? s.cwd;
        if (p.git?.branch) s.gitBranch = p.git.branch;
        break;
      case 'turn_context':
        model = p.model ?? p.collaboration_mode?.settings?.model ?? model;
        if (p.cwd) s.cwd = p.cwd;
        break;
      case 'compacted':
        s.compactions.push(ts);
        break;
      case 'token_usage_record':
        sawUsageRecords = true;
        pushCall(ts, toUsage(p.usage), p.response_id);
        break;
      case 'event_msg':
        if (p.type === 'user_message' && typeof p.message === 'string') {
          s.userPrompts++;
          if (!s.title) s.title = p.message.slice(0, 80);
        } else if (p.type === 'token_count' && !sawUsageRecords && p.info?.last_token_usage) {
          // Older Codex builds only emit running counters.
          pushCall(ts, toUsage(p.info.last_token_usage));
        }
        break;
      case 'response_item': {
        if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
          const input = p.type === 'custom_tool_call' ? p.input : p.type === 'local_shell_call' ? p.action : parseArgs(p.arguments);
          const name = p.type === 'local_shell_call' ? 'local_shell' : p.name;
          const c = classifyTool(name, input);
          const t: ToolCall = {
            id: p.call_id ?? p.id,
            callId: '',
            ts,
            name,
            ...c,
            key: toolKey(name, c.target),
            isError: false,
            resultChars: 0,
          };
          tools.set(t.id, t);
          pending.push(t);
        } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
          const t = tools.get(p.call_id);
          if (t) {
            const out = typeof p.output === 'string' ? p.output : p.output?.content ?? p.output;
            t.resultChars = resultLength(out);
            const code = /Exit code: (\d+)|exited with code (\d+)/i.exec(typeof out === 'string' ? out : '');
            t.isError = !!code && (code[1] ?? code[2]) !== '0';
          }
        } else if (p.type === 'web_search_call') {
          const q = p.action?.query ?? '';
          tools.set(p.id, {
            id: p.id, callId: '', ts, name: 'web_search', kind: 'web', target: q,
            key: toolKey('web_search', q), isError: false, resultChars: 0,
          });
          pending.push(tools.get(p.id)!);
        }
        break;
      }
    }
  }
  // Tool calls are logged before the usage record of the response that made them;
  // anything left belongs to the final response.
  if (pending.length && s.calls.length) {
    const last = s.calls[s.calls.length - 1]!;
    for (const t of pending) {
      t.callId = last.id;
      last.toolCallIds.push(t.id);
    }
  }
  if (!s.id) s.id = file;
  s.toolCalls = [...tools.values()].sort((a, b) => a.ts - b.ts);
  return s;
}
