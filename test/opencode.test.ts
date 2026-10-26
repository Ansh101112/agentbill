// OpenCode parser tests
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDb = join(__dirname, 'fixtures', 'opencode.db');

// The parseOpenCodeSession expects a path like "dbPath::sessionId"
const sessionPath = (sessionId: string) => `${fixtureDb}::${sessionId}`;

async function loadParser() {
  const mod = await import('../src/sources/opencode.ts');
  return mod;
}

describe('listOpenCodeFiles', () => {
  it('lists sessions from the fixture DB', async () => {
    const { listOpenCodeFiles } = await loadParser();
    const files = listOpenCodeFiles(fixtureDb);
    assert.ok(files.length >= 2, `expected at least 2 sessions, got ${files.length}`);
    // The path should encode dbPath::sessionId
    for (const f of files) {
      assert.ok(f.path.includes('::'), `path ${f.path} should contain :: separator`);
    }
  });
});

describe('parseOpenCodeSession', () => {
  it('parses the main session with correct metadata', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_aaa111'));

    assert.equal(s.agent, 'opencode');
    assert.equal(s.title, 'Add a+b to utils');
    assert.equal(s.cwd, '/home/test/proj');
    assert.ok(s.startedAt > 0);
    assert.ok(s.endedAt >= s.startedAt);
    // 2 user prompts: the initial one and the post-compaction one
    assert.equal(s.userPrompts, 2);
  });

  it('records compactions', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_aaa111'));

    assert.ok(s.compactions.length >= 1, 'should have at least 1 compaction');
  });

  it('parses model calls and tool calls', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_aaa111'));

    // Should have assistant messages: msg_1_2 (read), msg_1_3 (edit+shell), msg_1_6 (write), msg_1_7 (shell error)
    assert.ok(s.calls.length >= 4, `expected at least 4 calls, got ${s.calls.length}`);
    assert.ok(s.toolCalls.length >= 5, `expected at least 5 tool calls, got ${s.toolCalls.length}`);

    // Find the read tool call
    const readTc = s.toolCalls.find((t) => t.name === 'read');
    assert.ok(readTc, 'should have a read tool call');
    assert.equal(readTc.kind, 'read');
    assert.equal(readTc.path, 'src/utils.ts');
    assert.equal(readTc.isError, false);
    assert.ok(readTc.resultChars > 0, 'read should have result chars');

    // Find the edit tool call
    const editTc = s.toolCalls.find((t) => t.name === 'edit');
    assert.ok(editTc, 'should have an edit tool call');
    assert.equal(editTc.kind, 'write');

    // Find the write tool call
    const writeTc = s.toolCalls.find((t) => t.name === 'write');
    assert.ok(writeTc, 'should have a write tool call');
    assert.equal(writeTc.kind, 'write');
    assert.equal(writeTc.path, 'src/utils.ts');

    // All toolCalls should have a callId linking to a Call
    for (const tc of s.toolCalls) {
      assert.ok(tc.callId, `tool call ${tc.id} missing callId`);
      const linked = s.calls.find((c) => c.id === tc.callId);
      assert.ok(linked, `tool call ${tc.id} links to missing call ${tc.callId}`);
    }
  });

  it('detects shell errors', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_aaa111'));

    const shellCalls = s.toolCalls.filter((t) => t.name === 'shell');
    assert.ok(shellCalls.length >= 2, `expected at least 2 shell calls, got ${shellCalls.length}`);

    // tc_15 is "npm run bad-script" with exit 1
    const errorShell = shellCalls.find((t) => t.isError);
    assert.ok(errorShell, 'should have an error shell call');
    assert.ok(errorShell.target.includes('bad-script'), `target should mention bad-script: ${errorShell.target}`);
  });

  it('parses a subagent session as sidechain', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_bbb222'));

    assert.equal(s.agent, 'opencode');
    assert.equal(s.title, 'subagent run');
    assert.equal(s.userPrompts, 1);
    assert.ok(s.calls.length >= 1, `expected at least 1 call, got ${s.calls.length}`);
  });

  it('splits aggregate tokens across calls', async () => {
    const { parseOpenCodeSession } = await loadParser();
    const s = await parseOpenCodeSession(sessionPath('ses_aaa111'));

    // Aggregate: tokens_input=12000, split across 4 assistant msgs → ~3000 each
    const totalInput = s.calls.reduce((sum, c) => sum + c.usage.input, 0);
    assert.ok(totalInput >= 11900 && totalInput <= 12000, `total input should be ~12000, got ${totalInput}`);
  });
});