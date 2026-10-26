import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'test', 'fixtures', 'opencode.db');
if (existsSync(out)) unlinkSync(out);
const db = new DatabaseSync(out);

db.exec(`
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    worktree TEXT NOT NULL,
    vcs TEXT,
    name TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    sandboxes TEXT NOT NULL
  );
  CREATE TABLE workspace (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT DEFAULT '' NOT NULL,
    directory TEXT,
    project_id TEXT NOT NULL,
    time_used INTEGER NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workspace_id TEXT,
    parent_id TEXT,
    slug TEXT NOT NULL,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    cost REAL DEFAULT 0 NOT NULL,
    tokens_input INTEGER DEFAULT 0 NOT NULL,
    tokens_output INTEGER DEFAULT 0 NOT NULL,
    tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
    tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
    tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
    agent TEXT,
    model TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    time_compacting INTEGER,
    time_archived INTEGER
  );
  CREATE TABLE session_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`);

const proj = 'proj_abc123';
const ws = 'ws_def456';
const ses1 = 'ses_aaa111';
const ses2 = 'ses_bbb222';

// Escape single quotes for SQL literals
const esc = (s) => s.replace(/'/g, "''");

db.exec(`INSERT INTO project VALUES ('${proj}', '/home/test/proj', 'git', 'test-proj', 1700000000000, 1700100000000, '[]')`);
db.exec(`INSERT INTO workspace VALUES ('${ws}', 'local', 'test-ws', '/home/test/proj', '${proj}', 1700100000000)`);

// Session 1
db.exec(`INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, cost, parent_id) VALUES ('${ses1}', '${proj}', '${ws}', 'quiet-fox', '/home/test/proj', 'Add a+b to utils', '2.0.0', 'anthropic/claude-sonnet-4.5', 1700000000000, 1700000300000, 12000, 800, 4000, 0, 200, 0.45, NULL)`);

// User msg
db.exec(`INSERT INTO session_message VALUES ('msg_1_1', '${ses1}', 'user', 1, 1700000001000, 1700000001000, '${esc(JSON.stringify({time:{created:1700000001000},text:"add an add(a,b) function to src/utils.ts"}))}')`);

// Assistant: read + text
db.exec(`INSERT INTO session_message VALUES ('msg_1_2', '${ses1}', 'assistant', 2, 1700000100000, 1700000100000, '${esc(JSON.stringify({
  time: {created: 1700000100000},
  agent: 'build',
  model: 'anthropic/claude-sonnet-4.5',
  content: [
    {type: 'tool', id: 'tc_11', name: 'read', state: {status: 'completed', input: {path: 'src/utils.ts'}, content: [{type: 'text', text: 'export {}'}], metadata: {}}, time: {created: 1700000101000}},
    {type: 'text', text: 'I see the file is empty. adding function.'}
  ]
}))}')`);

// Assistant: edit + shell + text
db.exec(`INSERT INTO session_message VALUES ('msg_1_3', '${ses1}', 'assistant', 4, 1700000140000, 1700000140000, '${esc(JSON.stringify({
  time: {created: 1700000140000},
  agent: 'build',
  model: 'anthropic/claude-sonnet-4.5',
  content: [
    {type: 'tool', id: 'tc_12', name: 'edit', state: {status: 'completed', input: {path: 'src/utils.ts', oldString: 'export {}', newString: 'export function add(a: number, b: number): number { return a + b; }'}, content: [{type: 'text', text: 'edit applied'}], metadata: {}}, time: {created: 1700000141000}},
    {type: 'tool', id: 'tc_13', name: 'shell', state: {status: 'completed', input: {command: 'npm test'}, content: [{type: 'text', text: '2 passed, 0 failed'}], metadata: {exit: 0}}, time: {created: 1700000142000}},
    {type: 'text', text: 'Added add() and tests pass.'}
  ]
}))}')`);

// Compaction
db.exec(`INSERT INTO session_message VALUES ('msg_1_4', '${ses1}', 'compaction', 6, 1700000200000, 1700000200000, '${esc(JSON.stringify({time: {created: 1700000200000}, summary: 'Added add() to utils.ts'}))}')`);

// User prompt post-compaction
db.exec(`INSERT INTO session_message VALUES ('msg_1_5', '${ses1}', 'user', 7, 1700000220000, 1700000220000, '${esc(JSON.stringify({time:{created:1700000220000},text:"now add subtract too"}))}')`);

// Assistant: write tool
db.exec(`INSERT INTO session_message VALUES ('msg_1_6', '${ses1}', 'assistant', 8, 1700000260000, 1700000260000, '${esc(JSON.stringify({
  time: {created: 1700000260000},
  agent: 'build',
  model: 'anthropic/claude-sonnet-4.5',
  content: [
    {type: 'tool', id: 'tc_14', name: 'write', state: {status: 'completed', input: {path: 'src/utils.ts', content: 'export function add(a,b){return a+b}\nexport function sub(a,b){return a-b}'}, content: [{type: 'text', text: 'file written'}], metadata: {}}, time: {created: 1700000261000}},
    {type: 'text', text: 'Updated utils.ts with add and subtract.'}
  ]
}))}')`);

// Assistant: shell with error
db.exec(`INSERT INTO session_message VALUES ('msg_1_7', '${ses1}', 'assistant', 10, 1700000270000, 1700000270000, '${esc(JSON.stringify({
  time: {created: 1700000270000},
  agent: 'build',
  model: 'anthropic/claude-sonnet-4.5',
  content: [
    {type: 'tool', id: 'tc_15', name: 'shell', state: {status: 'completed', input: {command: 'npm run bad-script'}, content: [{type: 'text', text: 'Error: command not found'}], metadata: {exit: 1}}, time: {created: 1700000271000}},
    {type: 'text', text: 'That script doesnt exist.'}
  ]
}))}')`);

// Session 2: subagent
db.exec(`INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, model, time_created, time_updated, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, cost, parent_id) VALUES ('${ses2}', '${proj}', '${ws}', 'brave-duck', '/home/test/proj', 'subagent run', '2.0.0', 'anthropic/claude-sonnet-4.5', 1700000280000, 1700000300000, 3000, 200, 1000, 0, 0, 0.12, '${ses1}')`);

db.exec(`INSERT INTO session_message VALUES ('msg_2_1', '${ses2}', 'user', 1, 1700000281000, 1700000281000, '${esc(JSON.stringify({time:{created:1700000281000},text:"run the linter"}))}')`);

db.exec(`INSERT INTO session_message VALUES ('msg_2_2', '${ses2}', 'assistant', 2, 1700000290000, 1700000290000, '${esc(JSON.stringify({
  time: {created: 1700000290000},
  agent: 'build',
  model: 'anthropic/claude-sonnet-4.5',
  content: [
    {type: 'tool', id: 'tc_21', name: 'shell', state: {status: 'completed', input: {command: './lint.sh'}, content: [{type: 'text', text: 'no issues'}], metadata: {exit: 0}}, time: {created: 1700000291000}},
    {type: 'text', text: 'Linter passed.'}
  ]
}))}')`);

db.close();
console.log('Fixture written to ' + out);