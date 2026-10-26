// Cost analysis tests with an offline, fixed price book.
import * as assert from 'node:assert';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeSession } from '../src/analyze.ts';
import { Pricer, type PriceBook } from '../src/pricing.ts';
import { parseClaudeSession } from '../src/sources/claude.ts';

const here = dirname(fileURLToPath(import.meta.url));
const claudeFixture = join(here, 'fixtures', 'claude-session.jsonl');

// USD per token; no network, no snapshot lookup.
const book: PriceBook = {
  prices: {
    'test/fixture-model': { input: 3e-6, output: 15e-6, cacheRead: 3e-7, cacheWrite: 3.75e-6 },
  },
  source: 'snapshot',
  fetchedAt: 0,
};
const pricer = new Pricer(book);

describe('analyzeSession', () => {
  it('prices the session with the fixed book', async () => {
    const report = analyzeSession(await parseClaudeSession(claudeFixture), pricer);
    // 8 calls × (1200 input, 600 cache read, 150 output).
    assert.ok(Math.abs(report.cost - 8 * (1200 * 3e-6 + 600 * 3e-7 + 150 * 15e-6)) < 1e-12);
    assert.equal(report.byModel['fixture-model']?.pricedAs, 'test/fixture-model');
  });

  it('finds the unchanged re-read', async () => {
    const report = analyzeSession(await parseClaudeSession(claudeFixture), pricer);
    const reread = report.findings.filter((f) => f.kind === 'reread');
    assert.equal(reread.length, 1);
    assert.match(reread[0]!.title, /Re-read unchanged src\/session\.ts/);
    assert.ok(reread[0]!.cost > 0);
  });

  it('finds the three failing Bash calls in a row', async () => {
    const report = analyzeSession(await parseClaudeSession(claudeFixture), pricer);
    const loop = report.findings.filter((f) => f.kind === 'retry-loop');
    assert.equal(loop.length, 1);
    assert.equal(loop[0]!.title, '3 failed Bash calls in a row');
    assert.ok(loop[0]!.cost > 0);
    assert.ok(loop[0]!.tokens > 0);
  });

  it('stops carry cost at the compaction boundary', async () => {
    const session = await parseClaudeSession(claudeFixture);
    const report = analyzeSession(session, pricer);
    const read = report.tools.find((t) => t.toolId === 'toolu_read_1');
    assert.ok(read);
    // Re-sent on msg_2..msg_6; msg_7 and msg_8 come after the compaction.
    assert.equal(read.carriedBy, 5);
    assert.ok(read.carryCost > 0);

    const unbounded = analyzeSession({ ...session, compactions: [] }, pricer);
    const sameRead = unbounded.tools.find((t) => t.toolId === 'toolu_read_1');
    assert.ok(sameRead);
    assert.equal(sameRead.carriedBy, 7);
    assert.ok(sameRead.carryCost > read.carryCost);
  });
});