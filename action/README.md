# AgentBill PR cost action

Posts one comment on a pull request summarising the agent spend recorded in its
commits. The numbers come from `Agent-Cost:` trailers that
[`agentbill hook install`](../README.md#commit-trailers-and-pr-cost) writes.

## Usage

```yaml
name: Agent cost
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  cost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # the action reads the commit range
      - uses: Ansh101112/agentbill/action@main
        with:
          base: origin/${{ github.base_ref }}
```

Inputs:

- `base`: base ref for the range. Defaults to the repository's default branch.
- `github-token`: token for posting the comment. Defaults to `${{ github.token }}`.

The action runs the TypeScript directly on Node 24, so it needs no install or build step.