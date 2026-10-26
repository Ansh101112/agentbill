---
name: agentbill-budget
description: Keep the cost of the coding session you are running under a budget the user sets. Use when the user says to stay under a dollar limit, asks what this session has cost so far, or when a long task is getting expensive.
---

# AgentBill budget guard

AgentBill prices the session from the agent's own logs, so you can see what this
run has cost without a proxy, an account or any data leaving the machine.

## Find the budget

- If the user stated one in the conversation ("keep it under $2"), use that number.
- Otherwise read the `AGENTBILL_BUDGET` environment variable.
- If neither exists and the work will be long, ask for a budget before starting.

## Check the spend

Run:

```bash
agentbill session --json
```

This prints the most recent session (the one you are in) as JSON. If `agentbill`
is not on `PATH`, use the repo copy:

```bash
node <repo>/dist/cli.js session --json     # built
node <repo>/src/cli.ts session --json      # TypeScript, Node 22.18+
```

Add `--offline` to skip the live price fetch and use the cached or bundled prices.

Useful fields:

- `row.cost`: spend so far in USD.
- `row.calls`: model calls in the session.
- `row.peakContext`: largest context the model saw.
- `findings`: leaks, each with a `kind`, `title` and `cost`.

## Act on the number

- **At or above the budget:** stop making model calls. Summarise what is done and
  what remains, and tell the user the session reached its budget. Do not continue
  unless they raise it.
- **At or above 80% of the budget:** compact before the next big step, read files
  with a line range instead of whole files, run large searches and noisy commands
  in a subagent, and do not re-read files that have not changed.
- **Below 80%:** continue normally.

## Report it

When you check, say one line: spend, budget, and the biggest leak if there is one.

> Spent $1.42 of $2.00. The heaviest leak is a 40k-token install log re-sent on
> every call; trimming it would recover most of the rest.