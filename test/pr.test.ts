// Tests for "Agent-Cost:" trailer parsing and the PR comment.
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  parseCostTrailer,
  extractCommitCosts,
  summariseCosts,
  renderComment,
} from '../src/pr.ts';

describe('parseCostTrailer', () => {
  it('parses a well-formed trailer', () => {
    assert.deepEqual(parseCostTrailer('Agent-Cost: $1.23 (deepseek/deepseek-v4.1-flash, 12 calls)'), {
      amount: 1.23,
      model: 'deepseek/deepseek-v4.1-flash',
      calls: 12,
    });
  });

  it('accepts a missing dollar sign, lower-case key and singular "call"', () => {
    assert.deepEqual(parseCostTrailer('agent-cost: 0.50 (glm-5.3, 1 call)'), {
      amount: 0.5,
      model: 'glm-5.3',
      calls: 1,
    });
  });

  it('tolerates surrounding whitespace', () => {
    assert.deepEqual(parseCostTrailer('   Agent-Cost:   $2 (m, 3 calls)  '), {
      amount: 2,
      model: 'm',
      calls: 3,
    });
  });

  it('rejects malformed trailers and unrelated lines', () => {
    assert.equal(parseCostTrailer('Agent-Cost: see the notes'), null);
    assert.equal(parseCostTrailer('Agent-Cost: $abc (m, 2 calls)'), null);
    assert.equal(parseCostTrailer('Agent-Cost: $1.00 (m, two calls)'), null);
    assert.equal(parseCostTrailer('Signed-off-by: A <a@b>'), null);
    assert.equal(parseCostTrailer(''), null);
  });
});

describe('extractCommitCosts', () => {
  it('collects trailers from commit bodies', () => {
    const costs = extractCommitCosts([
      {
        sha: 'aaaaaaaaaaaaaaaa',
        subject: 'Add parser',
        body: 'Add parser\n\nAgent-Cost: $0.50 (deepseek/deepseek-v4.1-flash, 5 calls)\n',
      },
      {
        sha: 'bbbbbbbbbbbbbbbb',
        subject: 'Add tests',
        body: 'Add tests\n\nAgent-Cost: $0.25 (deepseek/deepseek-v4.1-flash, 2 calls)\nAgent-Cost: $0.10 (z-ai/glm-5.3, 1 call)\n',
      },
      { sha: 'cccccccccccccccc', subject: 'Docs', body: 'Docs only' },
    ]);
    assert.equal(costs.length, 3);
    assert.deepEqual(costs[0], {
      sha: 'aaaaaaaaaaaaaaaa',
      subject: 'Add parser',
      amount: 0.5,
      model: 'deepseek/deepseek-v4.1-flash',
      calls: 5,
    });
    assert.equal(costs[2]!.model, 'z-ai/glm-5.3');
  });
});

describe('summariseCosts', () => {
  it('totals spend, calls and per-model lines', () => {
    const summary = summariseCosts([
      { sha: 'a', subject: 'A', amount: 0.5, model: 'deepseek/deepseek-v4.1-flash', calls: 5 },
      { sha: 'a', subject: 'A', amount: 0.1, model: 'z-ai/glm-5.3', calls: 1 },
      { sha: 'b', subject: 'B', amount: 0.25, model: 'deepseek/deepseek-v4.1-flash', calls: 2 },
    ]);
    assert.ok(Math.abs(summary.total - 0.85) < 1e-9);
    assert.equal(summary.calls, 8);
    assert.equal(summary.commits, 2, 'duplicate sha counts once');
    assert.equal(summary.byModel[0]!.model, 'deepseek/deepseek-v4.1-flash');
    assert.ok(Math.abs(summary.byModel[0]!.amount - 0.75) < 1e-9);
    assert.equal(summary.byModel[0]!.calls, 7);
    assert.equal(summary.byModel[1]!.model, 'z-ai/glm-5.3');
  });
});

describe('renderComment', () => {
  it('renders a markdown table with the total', () => {
    const body = renderComment(
      summariseCosts([
        { sha: 'abcdef1234', subject: 'Add parser', amount: 0.5, model: 'deepseek/deepseek-v4.1-flash', calls: 5 },
        { sha: '1234567890', subject: 'Add tests', amount: 0.25, model: 'z-ai/glm-5.3', calls: 2 },
      ]),
    );
    assert.match(body, /### Agent cost/);
    assert.match(body, /\$0\.75/);
    assert.match(body, /2 commits/);
    assert.match(body, /7 model calls/);
    assert.match(body, /`abcdef1` Add parser/);
    assert.match(body, /\| Commit \| Cost \| Model \| Calls \|/);
  });

  it('explains when there are no trailers', () => {
    const body = renderComment(summariseCosts([]));
    assert.match(body, /No `Agent-Cost:` trailers/);
    assert.doesNotMatch(body, /### Agent cost\n\n\*\*/);
  });
});