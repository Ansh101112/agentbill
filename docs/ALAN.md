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

| Task | Alan session | Agent / model | Result |
|---|---|---|---|
| T1 | | | |
| T2 | | | |
| T3 | | | |
| T4 | | | |
| T5 | | | |
