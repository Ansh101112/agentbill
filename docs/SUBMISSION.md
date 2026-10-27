# OpenFire submission kit

Everything needed on Tue Oct 27. Building ends 8:00 PM IST; the form closes 10:00 PM IST.

## Checklist

- [ ] Run the replay once with a key so the dashboard shows real agreement numbers: `OPENROUTER_API_KEY=... node src/cli.ts replay --steps 24`
- [ ] Rebuild the demo with the replay included: `node scripts/build-demo.ts`, then `cd site && vercel deploy --prod --yes`
- [x] Demo video, 1:31 at 1080p, narrated (built in Remotion; see "Demo video" below)
- [x] GitHub repo public (Oct 27)
- [x] Demo link at the top of the README
- [x] Video link at the top of the README
- [x] Following @prasad_pilla on X
- [x] Quote post of the official launch post, with the video: https://x.com/Realthugus/status/2115086753489092613
- [x] Repo and demo links in a reply under the quote post
- [ ] Submission form (opens 8 PM, closes 10 PM)

## The quote post

The organisers' email named the post to quote: Prasad Pilla's launch post, https://x.com/prasad_pilla/status/2115081039970463783. Posted at about 7:52 PM IST with the demo video attached:

```
built agentbill for #OpenFire @tryAlanAI @prasad_pilla

problem: coding agents bill per call, nobody sees where it goes. mine: $4.8k, 23% leaked

it reads agent logs, prices each call, shows the leaks

built w alan code agents on deepseek: 5 tickets, $0.62, priced by agentbill
```

Reply under it:

```
repo: github.com/Ansh101112/agentbill
live demo: agentbill-topaz.vercel.app
@tryAlanAI @prasad_pilla
```

Follow-up posts scheduled in X: Oct 27 at 8:30 PM (quotes the submission post), 9:15 PM (what it does, statement screenshot), 10:15 PM (how to try it, session screenshot), and Oct 28 at 10:00 AM (the Alan loop).

## The form

| Field | Value |
|---|---|
| Full name | Anshuman Tiwari |
| Email | tanshuman145@gmail.com |
| Mobile number | _fill in_ |
| Public GitHub repository | https://github.com/Ansh101112/agentbill |
| Live project link | https://agentbill-topaz.vercel.app |
| X quote-post link | https://x.com/Realthugus/status/2115086753489092613 |

**What does your project do?**

> AgentBill shows what your AI coding agents actually cost and where the money leaks. It reads the logs Claude Code, Codex, OpenCode and Alan Code already write, prices every model call at live list prices, and flags avoidable waste (tool outputs carried through every call, prompt-cache rebuilds, repeated file reads, retry loops) in a CLI report and a bill-style dashboard. A replay agent has an open model (DeepSeek) redo your priciest steps while GLM judges the result, an MCP server lets agents check their own spend mid-task, and a PR bot adds agent cost to pull requests. Built with Alan: Alan Code agents on DeepSeek did 5 tickets, and AgentBill priced those 128 calls at $0.62. Open source (MIT), no account, no proxy.

## Demo video

1:31, 1920×1080, Andrew (Microsoft neural) narration over soft music. Made with Remotion in a separate project (`D:\ansh\agentbill-launch-video`) from captures of the anonymised demo site.

| Time | Shows |
|---|---|
| 0:00–0:16 | The problem: $4,800 across 137 sessions, 23% leaked, and the three biggest leak patterns |
| 0:16–0:30 | Introducing AgentBill; four agents' logs become one bill |
| 0:30–0:55 | The statement page, a tour of one session, the replay agent, the MCP budget check |
| 0:55–1:16 | How Alan was used: 5 tickets, Alan's own runs priced at $0.62, and the build → price → guard loop |
| 1:16–1:31 | Three commands to try it; logo with the repo and demo links |

## Already done

- Public demo data is anonymised and leak-scanned (`scripts/build-demo.ts`).
- Build-in-public posts: 10 scheduled on Oct 26, 6:30–11:15 PM IST, tagging @tryAlanAI and @prasad_pilla.
- Bug report with diagnostics posted in the Alan Discord `#bug-report` ("AlanCode Engine error" thread).
