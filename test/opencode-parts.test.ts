// OpenCode message + part layout: per-message token usage must be used as-is, not split.
import * as assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { listOpenCodeFiles, parseOpenCodeSession } from '../src/sources/opencode.ts';

const dir = mkdtempSync(join(tmpdir(), 'agentbill-oc-'));
const dbPath = join(dir, 'opencode.db');

before(() => {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `);
  const t0 = 1_790_000_000_000;
  db.prepare(`INSERT INTO session VALUES (?, NULL, ?, ?, NULL, ?, ?)`).run('ses_1', 'D:/proj', 'Fix the parser', t0, t0 + 60_000);
  const msg = db.prepare(`INSERT INTO message VALUES (?, 'ses_1', ?, ?, ?)`);
  const part = db.prepare(`INSERT INTO part VALUES (?, ?, 'ses_1', ?, ?, ?)`);
  msg.run('msg_u1', t0, t0, JSON.stringify({ role: 'user', time: { created: t0 } }));
  part.run('prt_u1', 'msg_u1', t0, t0, JSON.stringify({ type: 'text', text: 'Fix the parser please' }));
  msg.run('msg_a1', t0 + 1000, t0 + 2000, JSON.stringify({
    role: 'assistant', providerID: 'deepseek', modelID: 'deepseek-v4-pro', time: { created: t0 + 1000 },
    tokens: { input: 1200, output: 300, reasoning: 50, cache: { read: 8000, write: 400 } },
  }));
  part.run('prt_a1', 'msg_a1', t0 + 1500, t0 + 1500, JSON.stringify({
    type: 'tool', tool: 'read', callID: 'call_1',
    state: { status: 'completed', input: { filePath: 'src/a.ts', path: 'src/a.ts' }, output: 'x'.repeat(900) },
  }));
  msg.run('msg_a2', t0 + 3000, t0 + 4000, JSON.stringify({
    role: 'assistant', providerID: 'deepseek', modelID: 'deepseek-v4-pro', time: { created: t0 + 3000 },
    tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 9500, write: 0 } },
  }));
  part.run('prt_a2', 'msg_a2', t0 + 3500, t0 + 3500, JSON.stringify({
    type: 'tool', tool: 'bash', callID: 'call_2',
    state: { status: 'error', input: { command: 'npm test' }, error: 'exit 1' },
  }));
  db.close();
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe('OpenCode message + part layout', () => {
  it('lists the session', () => {
    assert.deepEqual(listOpenCodeFiles(dbPath).map((f) => f.path.split('::')[1]), ['ses_1']);
  });

  it('keeps each message’s own token usage', async () => {
    const s = await parseOpenCodeSession(`${dbPath}::ses_1`);
    assert.equal(s.calls.length, 2);
    assert.deepEqual(s.calls[0]!.usage, { input: 1200, cacheRead: 8000, cacheWrite: 400, output: 350, reasoning: 50 });
    assert.equal(s.calls[1]!.usage.cacheRead, 9500);
    assert.equal(s.calls[0]!.model, 'deepseek/deepseek-v4-pro');
    assert.equal(s.userPrompts, 1);
  });

  it('attaches tool parts with result size and errors', async () => {
    const s = await parseOpenCodeSession(`${dbPath}::ses_1`);
    assert.equal(s.toolCalls.length, 2);
    const [read, bash] = s.toolCalls;
    assert.equal(read!.kind, 'read');
    assert.equal(read!.resultChars, 900);
    assert.equal(read!.callId, 'msg_a1');
    assert.equal(bash!.isError, true);
  });
});
