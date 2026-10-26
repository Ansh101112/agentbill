// Claude Code: ~/.claude/projects/<project>/<session>.jsonl, subagents in <session>/subagents/*.jsonl
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Call, Session, ToolCall } from '../types.ts';
import { findFiles, ms, readJsonl, type FoundFile } from './jsonl.ts';
import { classifyTool, resultLength, toolKey } from './tools.ts';

export const claudeRoot = () => process.env.CLAUDE_CONFIG_DIR
  ? join(process.env.CLAUDE_CONFIG_DIR, 'projects')
  : join(homedir(), '.claude', 'projects');

export function listClaudeFiles(root = claudeRoot()): FoundFile[] {
  if (!existsSync(root)) return [];
  // Subagent transcripts are folded into their parent session.
  return findFiles(root, '.jsonl', 2).filter((f) => !/[\\/]subagents[\\/]/.test(f.path));
}

interface Acc {
  calls: Map<string, Call>;
  tools: Map<string, ToolCall>;
  session: Session;
}

async function ingest(file: string, acc: Acc, sidechainFile: boolean) {
  const s = acc.session;
  for await (const r of readJsonl(file)) {
    const ts = ms(r.timestamp);
    if (ts) {
      if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
      if (ts > s.endedAt) s.endedAt = ts;
    }
    if (!sidechainFile) {
      if (typeof r.cwd === 'string' && !s.cwd) s.cwd = r.cwd;
      if (typeof r.gitBranch === 'string' && r.gitBranch !== 'HEAD') s.gitBranch = r.gitBranch;
      if (r.type === 'custom-title' && typeof r.customTitle === 'string') s.title = r.customTitle;
      if (r.type === 'summary' && typeof r.summary === 'string' && !s.title) s.title = r.summary;
      if (r.type === 'system' && r.subtype === 'compact_boundary') s.compactions.push(ts);
    }

    const msg = r.message as Record<string, any> | undefined;
    if (!msg) continue;

    if (r.type === 'assistant' && msg.id && msg.usage && msg.model !== '<synthetic>') {
      // One line per content block, each repeating the same usage: count the response once.
      let call = acc.calls.get(msg.id);
      if (!call) {
        const u = msg.usage;
        call = {
          id: msg.id,
          ts,
          model: String(msg.model ?? 'unknown'),
          usage: {
            input: u.input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            reasoning: u.output_tokens_details?.thinking_tokens ?? 0,
          },
          toolCallIds: [],
          sidechain: sidechainFile || r.isSidechain === true,
        };
        acc.calls.set(msg.id, call);
      }
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type !== 'tool_use' || acc.tools.has(block.id)) continue;
        const c = classifyTool(block.name, block.input);
        acc.tools.set(block.id, {
          id: block.id,
          callId: call.id,
          ts,
          name: block.name,
          ...c,
          key: toolKey(block.name, c.target),
          isError: false,
          resultChars: 0,
        });
        call.toolCallIds.push(block.id);
      }
    } else if (r.type === 'user') {
      const content = msg.content;
      if (typeof content === 'string') {
        if (!r.isMeta && !sidechainFile && !content.startsWith('<')) {
          s.userPrompts++;
          if (!s.title) s.title = content.slice(0, 80);
        }
        continue;
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'tool_result') {
          const t = acc.tools.get(block.tool_use_id);
          if (t) {
            t.resultChars = resultLength(block.content);
            t.isError = block.is_error === true;
          }
        } else if (block?.type === 'text' && !r.isMeta && !sidechainFile && !String(block.text).startsWith('<')) {
          s.userPrompts++;
          if (!s.title) s.title = String(block.text).slice(0, 80);
        }
      }
    }
  }
}

export async function parseClaudeSession(file: string): Promise<Session> {
  const id = basename(file, '.jsonl');
  const acc: Acc = {
    calls: new Map(),
    tools: new Map(),
    session: {
      id,
      agent: 'claude-code',
      cwd: '',
      file,
      startedAt: 0,
      endedAt: 0,
      userPrompts: 0,
      calls: [],
      toolCalls: [],
      compactions: [],
    },
  };
  await ingest(file, acc, false);
  const subDir = join(dirname(file), id, 'subagents');
  if (existsSync(subDir)) {
    for (const f of findFiles(subDir, '.jsonl', 0)) await ingest(f.path, acc, true);
  }
  const s = acc.session;
  s.calls = [...acc.calls.values()].sort((a, b) => a.ts - b.ts);
  s.toolCalls = [...acc.tools.values()].sort((a, b) => a.ts - b.ts);
  return s;
}
