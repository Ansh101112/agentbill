# Decisions log

Short notes on why AgentBill is built the way it is, written during the hackathon.

## 1. Read local session logs instead of running a proxy (Mon 14:20)

A proxy in front of the model API would see exact requests, but every agent would need its base URL changed, and many people run agents through subscriptions where no proxy can sit. Claude Code (`~/.claude/projects/**.jsonl`) and Codex (`~/.codex/sessions/**.jsonl`) already write every response's token usage to disk. Reading those files means zero setup and works on history from before you installed the tool.

Trade-off: logs don't contain the full system prompt or tool schemas, so the replay agent rebuilds context approximately. The README says so.

## 2. Count each API response once (Mon 14:25)

Claude Code writes one JSONL line per content block (thinking, text, tool_use), and every line repeats the same `usage` object. Summing lines triple-counts. AgentBill groups by `message.id` and takes usage once. Codex writes a `token_usage_record` per response, which is used directly.

## 3. Prices come from OpenRouter's public model list (Mon 14:30)

Hard-coded price tables go stale within weeks. `https://openrouter.ai/api/v1/models` is public, needs no key, and includes cache read and cache write prices. AgentBill caches it for 24 hours in `~/.agentbill/prices.json` and falls back to a bundled snapshot when offline.

## 4. Carry cost is the headline metric (Mon 14:35)

A tool output does not cost money once. It stays in the context and is re-sent (usually as cached input) on every later call until the context is compacted. A 40,000-character install log read early in a long session can cost more than the code change it was for. AgentBill charges each tool output for every later call that carried it. No agent dashboard shows this today.
