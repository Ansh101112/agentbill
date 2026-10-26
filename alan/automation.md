# Weekly Alan automation: agent spend digest

A schedule-triggered Alan automation that runs every Monday and posts the last
seven days of agent spend to Slack. This is the pattern behind the "watch your
own spend" part of AgentBill: the same numbers the dashboard shows, delivered
where the team already reads them.

## 1. Trigger

- **Kind:** schedule
- **Cron:** `0 9 * * 1` (Mondays at 09:00 in the automation's timezone)

## 2. Steps

**Step 1: run the weekly report**

```bash
agentbill report --days 7 --json
```

`--json` returns the summary object: `totals`, `byAgent`, `byModel`,
`findingsByKind`, `whatIf` and `sessions`. Add `--offline` if the machine may be
off the network; it uses the cached or bundled price list.

**Step 2: shape the message**

Take these fields from the JSON and format one Slack message:

- header: total spend and how much leaked
  (`totals.cost`, `totals.waste`)
- the three biggest leak patterns (`findingsByKind`, highest `cost`)
- the top two sessions by cost (`sessions`, sorted by `cost`)
- what an open model would have cost (`whatIf[0]`)

Example:

```
*Agent spend, last 7 days*
$312.40 total · $71.10 leaked (23%)

Where it leaked
• Prompt cache rebuilt after idle gaps   $48.20  22×
• Heavy outputs re-sent on later calls   $19.60  31×
• Unchanged files read again              $3.30  40×

Top sessions
• 02e6a77a  Add parser tests        $84.10
• aa86123e  Dashboard polish        $61.30

Same tokens on deepseek-v4.1-flash: $28.70 (−$283.70)
```

**Step 3: post to Slack**

- Use the Slack connector (`chat.postMessage`) to the chosen channel, or POST the
  message to an incoming webhook URL.
- Keep the message as plain text with `*bold*` Slack formatting; do not send
  Markdown tables.

## 3. Notes

- Keep the automation read-only: it should never edit a repo or create tasks.
- If `totals.calls` is zero, post nothing (or a one-line "no agent activity this
  week") so quiet weeks stay quiet.
- To change the window, pass `--days <n>`; to scope to one project, add
  `--project <path>`.
- The report reads local logs only. If the automation runs on a different machine
  than the agents, point it at that machine and not a shared home directory.