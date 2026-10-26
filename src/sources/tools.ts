// Turns an agent-specific tool call into a kind, a readable target and a repeat key.
import type { ToolCall } from '../types.ts';

type Classified = Pick<ToolCall, 'kind' | 'target' | 'path'>;

const READ_CMD = /^(?:cat|type|head|tail|less|more|bat|nl|Get-Content|gc|sed\s+-n\s+'[^']*')\s+(?:-\S+\s+)*["']?([^\s"'|;&>]+)/i;

function shorten(s: string, n = 160): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function fromCommand(cmd: string): Classified {
  const first = cmd.trim().split(/\s*(?:&&|\|\||;|\n)\s*/)[0] ?? cmd;
  const m = READ_CMD.exec(first.trim());
  if (m?.[1]) return { kind: 'read', target: m[1], path: m[1] };
  if (/^(?:rg|grep|findstr|Select-String|find|fd|ls|dir|Get-ChildItem|tree)\b/i.test(first.trim())) {
    return { kind: 'search', target: shorten(cmd) };
  }
  return { kind: 'exec', target: shorten(cmd) };
}

function patchPath(patch: string): string | undefined {
  return /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(patch)?.[1]?.trim();
}

export function classifyTool(name: string, input: unknown): Classified {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);

  switch (name) {
    case 'Read':
    case 'NotebookRead':
    case 'read_file':
    case 'view_image': {
      const p = str('file_path') ?? str('path') ?? str('notebook_path') ?? '';
      const range = i.offset != null || i.limit != null ? ` [${i.offset ?? 0}+${i.limit ?? ''}]` : '';
      return { kind: 'read', target: p + range, path: p };
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const p = str('file_path') ?? str('notebook_path') ?? '';
      return { kind: 'write', target: p, path: p };
    }
    case 'apply_patch': {
      const text = typeof input === 'string' ? input : str('input') ?? str('patch') ?? '';
      const p = patchPath(text) ?? '';
      return { kind: 'write', target: p, path: p };
    }
    case 'Bash':
    case 'PowerShell':
    case 'shell':
    case 'exec_command':
    case 'local_shell': {
      const raw = i.cmd ?? i.command;
      const cmd = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : '';
      return fromCommand(cmd.replace(/^(?:bash|powershell(?:\.exe)?|pwsh)\s+(?:-lc|-c|-Command)\s+/i, ''));
    }
    case 'Grep':
    case 'Glob':
    case 'LS':
      return { kind: 'search', target: shorten(`${str('pattern') ?? str('path') ?? ''} ${str('path') ?? ''}`) };
    case 'WebFetch':
    case 'WebSearch':
    case 'web_search':
      return { kind: 'web', target: shorten(str('url') ?? str('query') ?? '') };
    case 'Agent':
    case 'Task':
      return { kind: 'agent', target: shorten(str('description') ?? str('prompt') ?? '') };
    default:
      return { kind: 'other', target: shorten(JSON.stringify(input ?? '')) };
  }
}

export function toolKey(name: string, target: string): string {
  return `${name}::${target.toLowerCase().replace(/\\/g, '/')}`;
}

/** Length of a tool result in characters, whatever shape it came in. */
export function resultLength(content: unknown): number {
  if (content == null) return 0;
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    return content.reduce<number>((n, part) => {
      if (typeof part === 'string') return n + part.length;
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') return n + p.text.length;
        // Images are billed by size, not text length; count a flat ~1.5k tokens.
        if (p.type === 'image') return n + 6000;
      }
      return n;
    }, 0);
  }
  return JSON.stringify(content).length;
}
