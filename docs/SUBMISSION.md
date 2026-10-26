# OpenFire submission kit

Everything needed on Tue Oct 27. Building ends 8:00 PM IST; the form closes 10:00 PM IST.

## Before 7:30 PM

- [ ] Run the replay once with a key so the dashboard shows real agreement numbers: `OPENROUTER_API_KEY=... node src/cli.ts replay --steps 24`
- [ ] Rebuild the demo with the replay included: `node scripts/build-demo.ts`, then `cd site && vercel deploy --prod --yes`
- [ ] Record the demo video (script below), 1–2 minutes, 1080p
- [ ] Make the GitHub repo public
- [x] Demo link at the top of the README
- [ ] Video link at the top of the README

## At 7:30 PM: the quote post

Quote the official @tryAlanAI launch post with the video attached. Draft, in the same voice as the build-in-public posts:

```
built agentbill for openfire.
it reads ur coding agent logs (claude code, codex, opencode, alan code), prices every call, and shows where the money leaked.
then it has an open model redo ur expensive steps to see if u even needed the frontier one.
repo: github.com/Ansh101112/agentbill
demo: agentbill-topaz.vercel.app
@tryAlanAI @prasad_pilla
```

## The form

| Field | Value |
|---|---|
| Name | Anshuman Tiwari |
| Project name | AgentBill |
| Contact | tanshuman145@gmail.com |
| GitHub repository | https://github.com/Ansh101112/agentbill |
| X quote-post link | _paste after posting_ |
| Demo video link | _paste after uploading_ |
| Working link | https://agentbill-topaz.vercel.app |

## Demo video script (about 90 seconds)

| Time | Show | Say |
|---|---|---|
| 0:00–0:10 | Terminal | "Agent runs look cheap one call at a time. Nobody sees where the bill actually goes." |
| 0:10–0:25 | `node src/cli.ts` report | "AgentBill reads the logs my agents already write. 137 sessions, about $4.8k at list prices, and 23% of it leaked to patterns I can avoid." |
| 0:25–0:50 | Dashboard, then one session | "This is one session. The curve is the context on every call. These bars are file reads that rode along for 500 calls each. And here the prompt cache expired during a break and the whole context got rewritten." |
| 0:50–1:10 | `agentbill replay` output | "The open-model number is only a ceiling, so the replay agent checks it: DeepSeek redoes my expensive steps and GLM judges if it made the same move." |
| 1:10–1:25 | Alan app + `sessions --agent alan-code` | "Part of this was built by Alan Code agents on DeepSeek, and AgentBill priced those sessions too. It also runs as an MCP server, so an agent can check its own bill." |
| 1:25–1:30 | README | "Open source, MIT. Link below." |

## Already done

- Public demo data is anonymised and leak-scanned (`scripts/build-demo.ts`).
- Build-in-public posts: 10 scheduled on Oct 26, 6:30–11:15 PM IST, tagging @tryAlanAI and @prasad_pilla.
- Bug report with diagnostics posted in the Alan Discord `#bug-report` ("AlanCode Engine error" thread).
