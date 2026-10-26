# Building AgentBill with Alan

OpenFire requires building with Alan. This file is the task pack used on the Alan board and the log of what Alan sessions did. Every task below runs as an Alan session on **This computer** in `D:\ansh\agentbill`, using an open model from the Alan model picker (DeepSeek, GLM or Kimi) wherever it can do the job.

## How the work is split

| Who | Owns | Why |
|---|---|---|
| Alan sessions | Tests and fixtures, CI, OpenCode parser, Alan Code parser, GitHub Action, Alan skill + automation | Well-specified tickets with clear checks: a good fit for an agent on an open model |
| Anshuman (with a coding assistant) | Cost model, waste detectors, dashboard design, replay judge design | Judgement-heavy parts where the design is still moving |

Files are split so Alan sessions and hand-written work never edit the same file at the same time.

## Task pack

Paste each task into Alan as written. Each one says what to touch, what not to touch, and how to check it.

### T1: Tests and CI for the parsers and analyser

```
Repo: D:\ansh\agentbill (TypeScript, Node 24 runs .ts directly, no build step needed for tests).

Add unit tests with small hand-written fixtures:
1. test/fixtures/claude-session.jsonl: a tiny Claude Code transcript with
   - one assistant response split over three lines (thinking, text, tool_use) that all repeat the same message.id and usage
   - a Read tool_use and its tool_result, then the same file read again with no edit in between
   - a system record with subtype "compact_boundary"
   - three failing Bash tool calls in a row (tool_result is_error: true)
2. test/fixtures/codex-session.jsonl: a tiny Codex rollout with session_meta, turn_context (model), a function_call exec_command, its function_call_output, and a token_usage_record.
3. test/parsers.test.ts using node:test and node:assert:
   - parseClaudeSession counts the split response ONCE (usage not tripled)
   - tool results get resultChars and isError
   - the compaction timestamp is recorded
   - parseCodexSession maps usage so input excludes cached tokens, and attaches the tool call to the call
4. test/analyze.test.ts: analyzeSession with a Pricer built from a fixed PriceBook (no network) finds the re-read and the 3-call retry loop, and carry cost stops at the compaction.
5. .github/workflows/ci.yml: on push and pull_request, Node 24, npm ci, npm run typecheck, npm test.

Do not edit anything under src/ except to fix a real bug a test exposes (explain it in the PR description).
Check: npm test passes and npm run typecheck passes. Commit on a branch named alan/tests-ci.
```

### T2: OpenCode parser

```
Add src/sources/opencode.ts that reads OpenCode session storage (find the current on-disk format from OpenCode's docs or source: message and part files or the SQLite db under ~/.local/share/opencode).
Map it to the Session/Call/ToolCall types in src/types.ts, using classifyTool and toolKey from src/sources/tools.ts.
Register it in src/sources/index.ts. Add a fixture and a test in test/opencode.test.ts.
Check: npm test passes; node src/cli.ts sessions --agent opencode lists OpenCode sessions if any exist.
```

### T3: Alan Code parser

```
Alan stores local conversations under %LOCALAPPDATA%\Alan\production\conversations.
Inspect the format of the sessions created while building this project, then add src/sources/alan.ts mapped to the same types and register it as agent "alan-code".
Never read credential.json, local-api.json or anything under s/.
Check: node src/cli.ts sessions --agent alan-code shows the Alan sessions that built AgentBill, with token counts.
```

### T4: GitHub Action that comments the agent cost on a PR

```
Add action/ with a composite GitHub Action and a CLI command `agentbill pr-cost` that reads "Agent-Cost:" commit trailers in the PR range and posts one summary comment.
Add `agentbill hook install` that installs a prepare-commit-msg hook adding "Agent-Cost: $x.xx (model, n calls)" for the agent session active in this repo.
Check: tests for trailer parsing; README section with a usage example.
```

### T5: Alan skill and automation

```
Add alan/skill/SKILL.md: a skill that tells an agent to run `agentbill session --json` for the current session and keep its spend under a budget the user sets.
Add alan/automation.md: instructions for a weekly Alan automation (schedule trigger) that runs `agentbill report --days 7` and posts the summary to Slack.
Check: install the skill in Alan (Skills → Import) and screenshot it working.
```

## Session log

Usage comes from Alan's own run logs (`%LOCALAPPDATA%\Alan\production\runs\<run>\log.jsonl`, last `_alan/turn_usage` of each run).

| Task | Alan run | Agent / model | Usage | Result |
|---|---|---|---|---|
| Setup | 4 runs, 26 Oct 14:59–15:13 | Alan Code | — | Failed with "opencode serve did not open a session within 60000 ms". Diagnosed and reported in the Alan Discord #bug-report; fixed by fully restarting Alan |
| T1 (first try) | `fc9bb920`, 15:30 | Alan Code, DeepSeek V4 Pro | 5 calls, 30k input, 98k cache read, 1k output | Surveyed the repo and asked which task to start; no code written. Re-run pending |
| T2 | `59c61712`, 15:46–16:03 | Alan Code, DeepSeek V4 Pro | 47 calls, 103k input, 2.68M cache read, 32k output (≈ $0.37 at list price) | OpenCode parser, SQLite fixture, 7 tests. Follow-up in the same session swapped `better-sqlite3`/`sql.js` for built-in `node:sqlite`. Reviewed and merged in `07b373a` with fixes: read-only access, per-message tokens for the message + part layout, lazy load |
| T3, T4, T5 | `ade7fb74`, 16:08–16:23 (status check `a8b40461`, 16:40) | Alan Code, DeepSeek V4.1 Flash | 56 calls, 173k input, 6.83M cache read, 61k output (≈ $0.17 at list price) | One run: Alan Code parser (cumulative turn usage turned into per-call deltas), `pr-cost` + commit hook + GitHub Action with tests, Alan skill + automation. The run itself ended on a network error ("self signed certificate in certificate chain") after the work was done; a follow-up confirmed status. Reviewed and merged in `e1c1d23` with one fix (compactions counted once) |
| T1 (re-run) | `002dae7d`, 17:22–17:25 | Alan Code, DeepSeek V4.1 Flash | 18 calls, 64k input, 883k cache read, 22k output (≈ $0.04) | Claude/Codex fixtures, parser and analyser tests, CI workflow. Committed by the agent on `alan/tests-ci`; fast-forwarded into `main` (`707ca44`) after all 26 tests passed |

Total Alan Code work on this repo: 127 model calls across 4 productive runs, about $0.60 at OpenRouter list prices. AgentBill's own Alan Code parser reports these runs too (`node src/cli.ts sessions --agent alan-code`).
