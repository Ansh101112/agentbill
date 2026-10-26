// Minimal OpenAI-compatible chat client: OpenRouter by default, or any base URL (DeepSeek, Fireworks, Ollama, vLLM).
export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** USD, when the provider reports it (OpenRouter does). */
  cost?: number;
  ms: number;
}

export function llmConfigFromEnv(): LlmConfig {
  const baseUrl = process.env.AGENTBILL_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const apiKey = process.env.AGENTBILL_API_KEY ?? process.env.OPENROUTER_API_KEY;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

export async function chat(
  cfg: LlmConfig,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<LlmResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    max_tokens: opts.maxTokens ?? 400,
    usage: { include: true },
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        'x-title': 'AgentBill replay',
        'http-referer': 'https://github.com/Ansh101112/agentbill',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as any;
    return {
      text: j.choices?.[0]?.message?.content ?? '',
      inputTokens: j.usage?.prompt_tokens ?? 0,
      outputTokens: j.usage?.completion_tokens ?? 0,
      cost: typeof j.usage?.cost === 'number' ? j.usage.cost : undefined,
      ms: Date.now() - started,
    };
  }
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseJsonReply<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
