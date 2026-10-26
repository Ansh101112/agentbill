// Local dashboard: serves web/index.html and a small JSON API over the analysed sessions.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { SessionReport } from './analyze.ts';
import type { Pricer } from './pricing.ts';
import { buildSummary, sessionDetail } from './summary.ts';

interface ServeOptions {
  port: number;
  load: () => Promise<{ reports: SessionReport[]; pricer: Pricer }>;
}

const webDir = new URL('../web/', import.meta.url);

export async function serve({ port, load }: ServeOptions) {
  let state = await load();
  let summary = buildSummary(state.reports, state.pricer);
  const page = () => readFileSync(fileURLToPath(new URL('index.html', webDir)));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page());
      } else if (url.pathname === '/api/summary') {
        json(summary);
      } else if (url.pathname.startsWith('/api/session/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/session/'.length));
        const r = state.reports.find((x) => x.session.id === id);
        if (r) json(sessionDetail(r));
        else json({ error: `No session ${id}` }, 404);
      } else if (url.pathname === '/api/refresh' && req.method === 'POST') {
        state = await load();
        summary = buildSummary(state.reports, state.pricer);
        json({ ok: true, sessions: state.reports.length });
      } else {
        res.writeHead(404).end('Not found');
      }
    } catch (e) {
      json({ error: (e as Error).message }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`AgentBill dashboard on http://localhost:${port}  (${state.reports.length} sessions, Ctrl+C to stop)`);
  });
}
