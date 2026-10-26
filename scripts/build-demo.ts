// Builds the public demo: the dashboard plus an anonymised export of real sessions, in site/.
// Usage: node scripts/build-demo.ts   (then deploy site/ to any static host)
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { analyzeSession } from '../src/analyze.ts';
import { exportData } from '../src/export.ts';
import { loadPriceBook, Pricer } from '../src/pricing.ts';
import { loadSessions } from '../src/sources/index.ts';

const out = new URL('../site/', import.meta.url);
mkdirSync(out, { recursive: true });
const pricer = new Pricer(await loadPriceBook());
const reports = (await loadSessions()).map((s) => analyzeSession(s, pricer));
exportData(reports, pricer, new URL('data.json', out).pathname.replace(/^\/([A-Za-z]:)/, '$1'), true);
copyFileSync(new URL('../web/index.html', import.meta.url), new URL('index.html', out));

// Refuse to publish if anything identifying survived anonymisation.
const data = readFileSync(new URL('data.json', out), 'utf8');
const banned = (process.env.AGENTBILL_DEMO_BANNED ?? '').split(',').map((w) => w.trim()).filter(Boolean);
const leaks = [/[A-Za-z]:\\\\/, /\/Users\//i, /\/home\//i, ...banned.map((w) => new RegExp(w, 'i'))].filter((re) => re.test(data));
if (leaks.length) {
  console.error(`Demo data still contains ${leaks.join(', ')}. Not safe to publish.`);
  process.exit(1);
}
console.log(`site/ ready: ${reports.length} sessions, ${(data.length / 1024).toFixed(0)} KB of anonymised data`);
