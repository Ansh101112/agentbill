# Changelog

All notable changes to AgentBill. Built during OpenFire by Alan AI, Oct 26–27, 2026 (IST).

## 0.1.0 (unreleased)

### Added

- **Parsers** for Claude Code (`~/.claude/projects`, subagents folded into their session), Codex (`~/.codex/sessions`), OpenCode (SQLite, read-only) and Alan Code (Alan's run logs).
- **Live pricing** from OpenRouter's public model list, cached for a day, with a bundled offline snapshot. Gateway spellings such as `claude-opus-5-pool`, `FW-GLM-5.2` and `alan/deepseek/...` resolve to priced models.
- **Waste detectors:** carry cost of heavy tool outputs, prompt cache expiry vs invalidation, re-reads of unchanged files, retry loops, and very long contexts (advice only, never counted as a leak).
- **CLI:** `report`, `sessions`, `session <id>`, `export --anonymize`, all with `--json`.
- **Dashboard** (`agentbill serve`): the statement, spend vs leak by day, leaks by pattern and by model, sortable sessions, and a session page showing what every call carried.
- **Replay agent** (`agentbill replay`): an open model redoes expensive steps from rebuilt context and a judge model rules same, equivalent or different; reports agreement per step kind and routable spend. `--dry-run` works without a key.
- **MCP server** (`agentbill mcp`) with `agentbill_current_session`, `agentbill_budget_check` and `agentbill_report`.
- **PR cost:** `agentbill hook install` adds an `Agent-Cost:` commit trailer; `agentbill pr-cost` totals trailers and comments on the PR; composite GitHub Action in `action/`.
- **Alan integration:** budget-guard skill (`alan/skill/SKILL.md`) and a weekly report automation (`alan/automation.md`).
- **Demo build:** `scripts/build-demo.ts` writes an anonymised static demo to `site/` and refuses to publish if paths or banned words survive.
- 26 tests and CI on Node 24.

### Fixed during review

- Claude Code responses split over several log lines are counted once.
- OpenCode database opened read-only; per-message tokens used instead of an even split.
- Alan Code compactions counted once.
- Cache rebuilds after 5+ idle minutes reported as expiry, others as invalidation.
