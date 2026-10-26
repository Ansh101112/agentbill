// Parser tests on small hand-written transcripts.
import * as assert from 'node:assert';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseClaudeSession } from '../src/sources/claude.ts';
import { parseCodexSession } from '../src/sources/codex.ts';

const here = dirname(fileURLToPath(import.meta.url));
const claudeFixture = join(here, 'fixtures', 'claude-session.jsonl');
const codexFixture = join(here, 'fixtures', 'codex-session.jsonl');

// Every assistant line in the Claude fixture repeats the same usage for its message.
const repeatedUsage = { input: 1200, cacheRead: 600, cacheWrite: 0, output: 150, reasoning: 40 };

describe('parseClaudeSession', () => {
  it('counts a response split across thinking/text/tool_use lines once', async () => {
    const s = await parseClaudeSession(claudeFixture);

    const split = s.calls.filter((c) => c.id === 'msg_1');
    assert.equal(split.length, 1, 'msg_1 is one response, not three');
    assert.deepEqual(split[0]!.usage, repeatedUsage, 'usage is not tripled');
    assert.deepEqual(split[0]!.toolCallIds, ['toolu_read_1'], 'tool_use on the last line joins the response');

    assert.equal(s.calls.length, 8);
    assert.equal(
      s.calls.reduce((n, c) => n + c.usage.input, 0),
      8 * repeatedUsage.input,
      'session input is billed once per response id',
    );
  });

  it('records tool result size and error state', async () => {
    const s = await parseClaudeSession(claudeFixture);

    const firstRead = s.toolCalls.find((t) => t.id === 'toolu_read_1');
    assert.ok(firstRead);
    assert.equal(firstRead.kind, 'read');
    assert.equal(firstRead.path, 'src/session.ts');
    assert.equal(firstRead.isError, false);
    assert.ok(firstRead.resultChars > 1100, `expected a sizeable read, got ${firstRead.resultChars}`);

    const failed = s.toolCalls.filter((t) => t.name === 'Bash');
    assert.equal(failed.length, 3);
    for (const t of failed) {
      assert.equal(t.isError, true);
      assert.ok(t.resultChars > 0, 'failed results still have content');
    }
  });

  it('records the compaction boundary timestamp', async () => {
    const s = await parseClaudeSession(claudeFixture);
    assert.deepEqual(s.compactions, [Date.parse('2026-05-01T10:02:00.000Z')]);
  });
});

describe('parseCodexSession', () => {
  it('subtracts cached tokens from input and attaches the tool call', async () => {
    const s = await parseCodexSession(codexFixture);

    assert.equal(s.agent, 'codex');
    assert.equal(s.id, 'fixture-codex-session');
    assert.equal(s.cwd, 'D:/proj/agentbill');
    assert.equal(s.userPrompts, 1);
    assert.equal(s.calls.length, 1);

    const call = s.calls[0]!;
    assert.equal(call.id, 'resp_1');
    assert.equal(call.model, 'gpt-5-codex');
    // input_tokens (1000) includes cache read (400) and cache write (50).
    assert.deepEqual(call.usage, { input: 550, cacheRead: 400, cacheWrite: 50, output: 100, reasoning: 20 });
    assert.deepEqual(call.toolCallIds, ['call_exec_1']);

    const tool = s.toolCalls[0]!;
    assert.equal(tool.callId, 'resp_1');
    assert.equal(tool.kind, 'exec');
    assert.equal(tool.target, 'npm test -- test/parsers.test.ts');
    assert.equal(tool.isError, false);
    assert.equal(tool.resultChars, 'Exit code: 0\nWall time: 1.2 seconds\nOutput:\n# tests 6\n# pass 6\n# fail 0\n'.length);
  });
});