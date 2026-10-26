// Rebuilds what the agent had seen right before a given model call, and what it then did.
import { classifyTool } from '../sources/tools.ts';
import { readJsonl } from '../sources/jsonl.ts';

export interface Turn {
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

export interface Action {
  tool: string;
  kind: string;
  target: string;
  input: string;
}

export interface Step {
  /** Conversation before the call, oldest first. */
  turns: Turn[];
  /** Tool calls the original model made on this call. */
  actual: Action[];
  /** Tool names seen anywhere in the session up to this point. */
  tools: string[];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n…[${s.length - n} more chars]` : s);

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : p?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

export function toAction(name: string, input: unknown): Action {
  const c = classifyTool(name, input);
  return { tool: name, kind: c.kind, target: c.target, input: clip(typeof input === 'string' ? input : JSON.stringify(input), 600) };
}

/** Claude Code: context before the assistant response with this message id. */
export async function claudeStep(file: string, messageId: string, maxResultChars = 2500): Promise<Step | null> {
  const turns: Turn[] = [];
  const tools = new Set<string>();
  const seen = new Set<string>();
  let found = false;
  const actual: Action[] = [];
  for await (const r of readJsonl(file)) {
    if (r.isSidechain) continue;
    const msg = r.message as Record<string, any> | undefined;
    if (!msg) continue;
    if (r.type === 'assistant') {
      if (msg.id === messageId) {
        found = true;
        for (const b of Array.isArray(msg.content) ? msg.content : []) {
          if (b?.type === 'tool_use') actual.push(toAction(b.name, b.input));
        }
        continue;
      }
      if (found) break;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === 'text' && b.text) turns.push({ role: 'assistant', text: b.text });
        else if (b?.type === 'tool_use' && !seen.has(b.id)) {
          seen.add(b.id);
          tools.add(b.name);
          const a = toAction(b.name, b.input);
          turns.push({ role: 'assistant', text: `[called ${a.tool}] ${a.input}` });
        }
      }
    } else if (r.type === 'user' && !found) {
      if (r.isMeta) continue;
      if (typeof msg.content === 'string') {
        turns.push({ role: 'user', text: msg.content });
        continue;
      }
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === 'tool_result') {
          turns.push({ role: 'tool', text: `${b.is_error ? '[error] ' : ''}${clip(textOf(b.content), maxResultChars)}` });
        } else if (b?.type === 'text') {
          turns.push({ role: 'user', text: b.text });
        }
      }
    } else if (r.type === 'system' && r.subtype === 'compact_boundary' && !found) {
      // Everything before a compaction was replaced by its summary.
      turns.length = 0;
    }
  }
  return found && actual.length ? { turns, actual, tools: [...tools] } : null;
}

/** Keeps the first user request and the most recent history within a character budget. */
export function fitTurns(turns: Turn[], budget: number): Turn[] {
  const firstUser = turns.find((t) => t.role === 'user');
  const out: Turn[] = [];
  let used = firstUser ? firstUser.text.length : 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t === firstUser) continue;
    if (used + t.text.length > budget) break;
    out.unshift(t);
    used += t.text.length;
  }
  if (firstUser && !out.includes(firstUser)) out.unshift(firstUser, { role: 'user', text: '[…earlier conversation omitted…]' });
  return out;
}
