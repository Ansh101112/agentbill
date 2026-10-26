# AgentBill: 30-hour build plan

Built for **OpenFire by Alan AI**. The clock starts Mon Oct 26, 1:00 PM IST. Building ends Tue Oct 27, 8:00 PM IST, and the submission form closes at 10:00 PM.

The goal is a tool people can use on their own machine in under a minute, a dashboard that explains itself in a 90-second demo, and an open-model agent that proves which agent steps could run on DeepSeek, GLM or Kimi.

## Scope

| Must ship | Should ship | Nice to have |
|---|---|---|
| Parsers: Claude Code, Codex | Parsers: OpenCode, Alan Code | Cursor / Copilot parsers |
| Live prices (OpenRouter) + cost per call, session, project, day | Git attribution: cost per commit | Team roll-ups |
| Waste detectors: carry cost, cache expiry, retry loops, re-reads, context bloat | Model "what-if" repricing | Budget alerts on Slack |
| CLI report | Web dashboard with session timeline | |
| Replay judge agent (open models) | MCP server so agents can check their own spend | GitHub Action PR cost comment |
| Demo mode with bundled sample data | Alan skill + Alan automation | |
| Public demo link, README, 90s video | | |

## Timeline (IST)

| Block | When | What | Done when |
|---|---|---|---|
| B1 | Mon 14:00–18:00 | Repo scaffold, Claude Code + Codex parsers, live pricing, cost engine, waste detectors, `agentbill report` | Report runs on real local sessions; first commit pushed; build-in-public post 1 |
| B2 | Mon 18:00–22:00 | Web dashboard: overview, sessions table, session timeline, waste list, model what-if | `agentbill serve` opens a dashboard that reads well in a screenshot; post 2 with screenshot |
| B3 | Mon 22:00–01:00 | **In Alan:** OpenCode + Alan Code parsers, unit tests, CI workflow (task pack in `docs/ALAN.md`) | Alan sessions produce merged PRs; tests green |
| — | Mon 01:00–07:00 | Sleep | |
| B4 | Tue 07:00–11:00 | Replay judge agent: pick expensive steps, rebuild context, ask open models for the next action, judge equivalence, compute routability and projected savings | `agentbill replay` prints "X% of steps routable, $Y saved"; results show in the dashboard; post 3 |
| B5 | Tue 11:00–14:00 | MCP server (`agentbill mcp`), Alan skill, Alan automation, commit-trailer hook | An agent inside Alan can call `agentbill_session_cost` |
| B6 | Tue 14:00–16:30 | Demo mode with anonymised fixture, static dashboard build, deploy to Vercel, README with architecture diagram and screenshots | Public link works on a phone with no install |
| B7 | Tue 16:30–19:00 | Record a 90-second demo, file Alan bug reports, final README pass, tag v0.1.0 | Video exported; repo public |
| Submit | Tue 19:30–22:00 | Quote the official @tryAlanAI launch post with the demo; fill the form | Form submitted with repo, quote-post link, demo link |

## Cut lines

If a block slips, cut in this order: Nice-to-have column, GitHub Action, Alan Code parser, model what-if. Never cut: replay judge, dashboard, demo mode, README.

## Demo script (90 seconds)

1. **Problem (10s):** "Agent runs look cheap. Nobody can see where the money goes, and everyone pays frontier prices for steps a cheap open model could do."
2. **Report (15s):** `npx agentbill report` on real sessions. Total spend, top sessions, top waste.
3. **Dashboard (30s):** Open a session timeline. Show one tool output that rode along in 60 later calls and cost more than the code change itself. Show a cache that expired during a coffee break.
4. **Replay agent (25s):** `agentbill replay`. DeepSeek V4.1 Flash matches the frontier model's next action on most routine steps. Projected savings on screen.
5. **Alan (10s):** The agent asks AgentBill for its own spend via MCP inside Alan; the Alan automation posts a weekly cost report. Close on the repo link.
