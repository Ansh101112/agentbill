// Writes the dashboard data to one JSON file, optionally anonymised so it can be shared or deployed as a demo.
import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { SessionReport } from './analyze.ts';
import type { Pricer } from './pricing.ts';
import { buildSummary, sessionDetail, type SessionDetail, type Summary } from './summary.ts';
import { loadLatestReplay, type ReplayResult } from './replay/run.ts';

export interface ExportFile {
  summary: Summary;
  details: Record<string, SessionDetail>;
  replay: ReplayResult | null;
  anonymized: boolean;
}

const DETAIL_SESSIONS = 16;

export function exportData(reports: SessionReport[], pricer: Pricer, file: string, anonymize: boolean) {
  const summary = buildSummary(reports, pricer);
  const top = [...reports].sort((a, b) => b.cost - a.cost).slice(0, DETAIL_SESSIONS);
  const details: Record<string, SessionDetail> = {};
  for (const r of top) details[r.session.id] = sessionDetail(r);
  const out: ExportFile = { summary, details, replay: loadLatestReplay(), anonymized: anonymize };
  writeFileSync(file, JSON.stringify(anonymize ? scrub(out) : out));
}

// Keeps numbers, models, tool names and file types; drops titles, paths, commands and project names.
function scrub(data: ExportFile): ExportFile {
  const projects = new Map<string, string>();
  const project = (p: string) => {
    if (!projects.has(p)) projects.set(p, `project-${String.fromCharCode(97 + (projects.size % 26))}${projects.size >= 26 ? projects.size : ''}`);
    return projects.get(p)!;
  };
  const sessionNames = new Map<string, string>();
  data.summary.sessions.forEach((s, i) => sessionNames.set(s.id, `Session ${data.summary.sessions.length - i}`));
  const target = (t: string) => {
    const ext = extname(t.split(/[\s[]/)[0] ?? '');
    return ext && ext.length <= 6 ? `a ${ext} file` : 'a command';
  };
  const ids = new Map<string, string>();
  const id = (x: string) => {
    if (!ids.has(x)) ids.set(x, `s${ids.size.toString(36).padStart(3, '0')}`);
    return ids.get(x)!;
  };

  const summary: Summary = {
    ...data.summary,
    byProject: data.summary.byProject.map((p) => ({ ...p, project: project(p.project) })),
    topFindings: data.summary.topFindings.map((f) => ({
      ...f,
      sessionId: id(f.sessionId),
      sessionTitle: sessionNames.get(f.sessionId) ?? 'Session',
      title: f.title.replace(/ [A-Za-z]:?[\\/][^\s]+|\S+\/\S+/g, ' a file'),
      detail: f.detail.replace(/^[^—]+—/, `${target(f.detail)} —`).replace(/[A-Za-z]:\\[^\s]+/g, 'a file'),
    })),
    sessions: data.summary.sessions.map((s) => ({
      ...s,
      id: id(s.id),
      title: sessionNames.get(s.id) ?? 'Session',
      project: project(s.project),
      cwd: project(s.project),
      branch: undefined,
    })),
  };
  const details: Record<string, SessionDetail> = {};
  for (const [sid, d] of Object.entries(data.details)) {
    details[id(sid)] = {
      ...d,
      row: { ...d.row, id: id(sid), title: sessionNames.get(sid) ?? 'Session', project: project(d.row.project), cwd: project(d.row.project), branch: undefined },
      topCarried: d.topCarried.map((t) => ({ ...t, target: target(t.target) })),
      bands: d.bands.map((b) => ({ ...b, label: target(b.label) })),
      findings: d.findings.map((f) => ({
        ...f,
        sessionId: id(sid),
        title: f.title.replace(/ [A-Za-z]:?[\\/][^\s]+|\S+\/\S+/g, ' a file'),
        detail: f.detail.replace(/^[^—]+—/, `${target(f.detail)} —`).replace(/[A-Za-z]:\\[^\s]+/g, 'a file'),
      })),
      markers: d.markers.map((m) => ({ ...m, title: m.title.replace(/ [A-Za-z]:?[\\/][^\s]+|\S+\/\S+/g, ' a file') })),
    };
  }
  const replay = data.replay && {
    ...data.replay,
    cases: data.replay.cases.map((c) => ({
      ...c,
      sessionId: id(c.sessionId),
      sessionTitle: sessionNames.get(c.sessionId) ?? 'Session',
      lastRequest: '',
      actual: c.actual.map((a) => ({ ...a, target: target(a.target), input: '' })),
      proposed: c.proposed && { ...c.proposed, target: target(c.proposed.target), why: '' },
      reason: '',
    })),
  };
  return { summary, details, replay, anonymized: true };
}
