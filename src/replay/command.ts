// `agentbill replay`: terminal front end for the replay judge.
import { fmtTokens, usd, type SessionReport } from '../analyze.ts';
import type { Pricer } from '../pricing.ts';
import { llmConfigFromEnv } from './llm.ts';
import { pickSteps, runReplay, saveReplay, type ReplayCase } from './run.ts';
import { claudeStep } from './transcript.ts';

interface Options {
  model: string;
  judgeModel: string;
  steps: number;
  threshold: number;
  dryRun: boolean;
  json: boolean;
}

const mark: Record<ReplayCase['verdict'], string> = { same: '=', equivalent: '≈', different: '≠', error: '!' };

export async function runReplayCommand(reports: SessionReport[], pricer: Pricer, o: Options) {
  if (o.dryRun) {
    const picked = pickSteps(reports, o.steps);
    console.log(`\nWould replay ${picked.length} steps on ${o.model} (judge: ${o.judgeModel}):\n`);
    for (const { r, call } of picked) {
      const step = await claudeStep(r.session.file, call.id);
      const ctx = step ? step.turns.reduce((n, t) => n + t.text.length, 0) : 0;
      const a = step?.actual[0];
      console.log(`  ${usd(call.cost ?? 0).padStart(7)}  ${(r.session.title ?? '').slice(0, 34).padEnd(34)}  ${step ? `${fmtTokens(ctx / 3.6).padStart(5)} ctx  ${a?.tool}: ${a?.target.slice(0, 60)}` : 'could not rebuild'}`);
    }
    console.log('\nRun without --dry-run to call the models. Needs OPENROUTER_API_KEY in the environment or a .env file.\n');
    return;
  }

  const llm = llmConfigFromEnv();
  if (!llm.apiKey && llm.baseUrl.includes('openrouter.ai')) {
    throw new Error('Set OPENROUTER_API_KEY (or AGENTBILL_BASE_URL and AGENTBILL_API_KEY for another OpenAI-compatible API, like a local Ollama).');
  }
  if (!o.json) console.log(`\nReplaying ${o.steps} expensive steps on ${o.model}, judged by ${o.judgeModel}…\n`);
  const result = await runReplay(reports, pricer, {
    model: o.model,
    judgeModel: o.judgeModel,
    steps: o.steps,
    threshold: o.threshold,
    concurrency: 4,
    llm,
    onProgress: o.json
      ? undefined
      : (done, total, c) => {
          const actual = c.actual[0] ? `${c.actual[0].tool} ${c.actual[0].target}` : '—';
          const prop = c.proposed ? `${c.proposed.tool} ${c.proposed.target}` : c.reason;
          console.log(`  ${String(done).padStart(2)}/${total} ${mark[c.verdict]} ${c.verdict.padEnd(10)} ${actual.slice(0, 48).padEnd(48)} | ${prop.slice(0, 48)}`);
        },
  });
  saveReplay(result);
  if (o.json) return void console.log(JSON.stringify(result, null, 2));

  console.log(`\n  ${o.model} matched the original move on ${Math.round(result.agreement * 100)}% of steps.\n`);
  for (const k of result.byKind) {
    console.log(`    ${k.kind.padEnd(8)} ${String(Math.round(k.agreement * 100)).padStart(3)}% of ${k.n} steps   spend on these steps ${usd(k.spend).padStart(9)} → ${usd(k.openCost)} on ${o.model.split('/')[1]}`);
  }
  const rt = result.routable;
  console.log(
    rt.spend > 0
      ? `\n  Routable at ≥${Math.round(rt.threshold * 100)}% agreement: ${usd(rt.spend)} (${Math.round(rt.shareOfSpend * 100)}% of spend) → ${usd(rt.openCost)}. Saves ${usd(rt.saved)}.`
      : `\n  No step kind reached ${Math.round(rt.threshold * 100)}% agreement with at least 3 samples. Try more --steps, or a stronger open model.`,
  );
  console.log(`  This replay cost ${usd(result.replaySpend)}. Saved to ~/.agentbill/replay/latest.json; the dashboard shows it.\n`);
}
