// The normalised model every agent log is parsed into.

export type AgentKind = 'claude-code' | 'codex' | 'opencode' | 'alan-code';

export interface Usage {
  /** Input tokens billed at the full input price (not served from cache). */
  input: number;
  /** Input tokens served from the prompt cache. */
  cacheRead: number;
  /** Input tokens written to the prompt cache. */
  cacheWrite: number;
  /** Output tokens, including reasoning. */
  output: number;
  /** Reasoning tokens (already counted in output). */
  reasoning: number;
}

/** One model API response. */
export interface Call {
  id: string;
  ts: number;
  model: string;
  usage: Usage;
  /** Tool calls this response asked for. */
  toolCallIds: string[];
  /** True when made by a subagent rather than the main loop. */
  sidechain: boolean;
  /** Filled in by the cost engine. */
  cost?: number;
}

export interface ToolCall {
  id: string;
  callId: string;
  ts: number;
  name: string;
  /** Short, human-readable target: a file path, a command, a query. */
  target: string;
  /** Normalised key used to spot repeats (tool + target). */
  key: string;
  kind: 'read' | 'write' | 'exec' | 'search' | 'web' | 'agent' | 'other';
  /** File path for reads and writes, when known. */
  path?: string;
  isError: boolean;
  /** Size of the result that went back into the context. */
  resultChars: number;
}

export interface Session {
  id: string;
  agent: AgentKind;
  title?: string;
  cwd: string;
  gitBranch?: string;
  file: string;
  startedAt: number;
  endedAt: number;
  userPrompts: number;
  calls: Call[];
  toolCalls: ToolCall[];
  /** Timestamps where the context was compacted (summarised and reset). */
  compactions: number[];
}

export const emptyUsage = (): Usage => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

/** Total tokens the model saw as context on this call. */
export const contextTokens = (u: Usage) => u.input + u.cacheRead + u.cacheWrite;
