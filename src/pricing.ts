// Live model prices from OpenRouter's public list, cached for a day, with an offline snapshot.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Usage } from './types.ts';

/** USD per token. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PriceBook {
  prices: Record<string, Price>;
  source: 'live' | 'cache' | 'snapshot';
  fetchedAt: number;
}

const CACHE_DIR = join(homedir(), '.agentbill');
const CACHE_FILE = join(CACHE_DIR, 'prices.json');
const DAY = 24 * 3600 * 1000;

export async function fetchOpenRouterPrices(): Promise<Record<string, Price>> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  const body = (await res.json()) as { data: { id: string; pricing: Record<string, string> }[] };
  const out: Record<string, Price> = {};
  for (const m of body.data) {
    const p = m.pricing ?? {};
    const input = Number(p.prompt);
    const output = Number(p.completion);
    if (!(input >= 0) || !(output >= 0)) continue;
    out[m.id] = {
      input,
      output,
      ...(p.input_cache_read ? { cacheRead: Number(p.input_cache_read) } : {}),
      ...(p.input_cache_write ? { cacheWrite: Number(p.input_cache_write) } : {}),
    };
  }
  return out;
}

export async function loadPriceBook(opts: { offline?: boolean } = {}): Promise<PriceBook> {
  if (existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as PriceBook;
      if (opts.offline || Date.now() - cached.fetchedAt < DAY) return { ...cached, source: 'cache' };
    } catch {
      // Corrupt cache: refetch.
    }
  }
  if (!opts.offline) {
    try {
      const book: PriceBook = { prices: await fetchOpenRouterPrices(), source: 'live', fetchedAt: Date.now() };
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(book));
      return book;
    } catch {
      // Offline or rate-limited: use the bundled snapshot.
    }
  }
  const { SNAPSHOT, SNAPSHOT_DATE } = await import('./prices-snapshot.ts');
  return { prices: SNAPSHOT, source: 'snapshot', fetchedAt: Date.parse(SNAPSHOT_DATE) };
}

// Agents and gateways log model names in their own spellings: claude-opus-5-5,
// claude-opus-5-pool, FW-GLM-5.2, us.anthropic.claude-sonnet-5-v1:0, gpt-5.6-sol-2026-09-01.
export function canonicalModel(raw: string): string {
  let m = raw.toLowerCase().trim();
  m = m.replace(/^(?:fw|fireworks|litellm|bedrock|vertex|azure|openrouter)[-_/]/, '');
  m = m.replace(/^(?:us|eu|apac|global)\.(?:anthropic\.)?/, '').replace(/^anthropic\./, '');
  m = m.replace(/^[a-z-]+\//, '');
  m = m.replace(/-v\d+(?::\d+)?$/, '').replace(/@.*$/, '');
  m = m.replace(/-(?:pool|latest|preview|exp|fast|thinking)$/, '');
  m = m.replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$|-\d{4}$/, '');
  // claude-opus-5-5 -> claude-opus-5.5 (version digits joined by a dash)
  m = m.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  return m;
}

export class Pricer {
  private cache = new Map<string, { id: string; price: Price } | null>();
  private byName = new Map<string, string>();
  readonly book: PriceBook;
  private overrides: Record<string, string>;
  constructor(book: PriceBook, overrides: Record<string, string> = {}) {
    this.book = book;
    this.overrides = overrides;
    for (const id of Object.keys(book.prices)) {
      if (id.endsWith(':batch') || id.startsWith('~')) continue;
      const name = id.slice(id.indexOf('/') + 1);
      if (!this.byName.has(name)) this.byName.set(name, id);
    }
  }

  /** Resolves a logged model name to a priced OpenRouter id, or null when unknown. */
  resolve(model: string): { id: string; price: Price } | null {
    if (this.cache.has(model)) return this.cache.get(model)!;
    const found = this.lookup(model);
    this.cache.set(model, found);
    return found;
  }

  private lookup(model: string): { id: string; price: Price } | null {
    const direct = this.overrides[model] ?? (this.book.prices[model] ? model : undefined);
    if (direct && this.book.prices[direct]) return { id: direct, price: this.book.prices[direct] };
    const c = canonicalModel(model);
    const exact = this.byName.get(c);
    if (exact) return { id: exact, price: this.book.prices[exact]! };
    // Longest priced name that is a prefix of the logged one (gpt-5.6-sol-mini-x -> gpt-5.6-sol-mini).
    let best: string | undefined;
    for (const name of this.byName.keys()) {
      if (c.startsWith(name) && (!best || name.length > best.length)) best = name;
    }
    if (best) {
      const id = this.byName.get(best)!;
      return { id, price: this.book.prices[id]! };
    }
    return null;
  }

  cost(model: string, u: Usage): number {
    const p = this.resolve(model)?.price;
    return p ? costWith(p, u) : 0;
  }
}

export function costWith(p: Price, u: Usage): number {
  return (
    u.input * p.input +
    u.cacheRead * (p.cacheRead ?? p.input) +
    u.cacheWrite * (p.cacheWrite ?? p.input) +
    u.output * p.output
  );
}
