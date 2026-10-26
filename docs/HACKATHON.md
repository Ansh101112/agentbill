# OpenFire requirements checklist

Every rule from the OpenFire Luma page, the Alan Discord FAQ and the town hall recap, with where AgentBill meets it. Tick each box before submitting.

## Eligibility and rules

- [x] **Solo build.** Only Anshuman commits to this repo.
- [x] **Built during OpenFire.** First commit after Mon Oct 26, 1:00 PM IST. `git log --reverse` proves it.
- [x] **Built using Alan.** Five tickets (tests + CI, OpenCode parser, Alan Code parser, PR cost + hook + Action, Alan skill + automation) ran as Alan Code sessions on DeepSeek V4 Pro / V4.1 Flash in the Alan desktop app and were reviewed before merging. Evidence: `docs/ALAN.md` (prompts, run ids, usage) and AgentBill's own `sessions --agent alan-code`. Still to add: a screenshot of the Alan app with these sessions.
- [x] **Open models (preferred).** The replay judge runs on DeepSeek V4.1 Flash, GLM-5.3 and Kimi. Alan sessions use open models from the Alan model picker. Both are named in the README.
- [x] **Not a basic CRUD app.** Log parsing across agents, a cost model with prompt-cache economics, carry-cost analysis, and an open-model replay agent.
- [ ] **Open source.** MIT license added; repo goes public at submission.

## What judges score

| Criterion | Where it shows |
|---|---|
| Usefulness | Works on your own logs with one command; no account, no proxy, nothing leaves the machine unless you run `replay` |
| Complexity | Four log formats normalised into one model; carry-cost and cache-expiry analysis; replay agent with an equivalence judge |
| Engineering depth | Tests on fixtures, CI, typed core, live price feed with offline fallback, MCP server |
| Thought process | `docs/DECISIONS.md` written as the build goes; README "How it works" section |
| Regular commits | Small commits every block; build-in-public posts link to them |
| Good README | Problem, screenshots, quick start, how it works, architecture diagram, limitations, Built with Alan |

## Submission

- [ ] Public GitHub repo with detailed README (README done; repo still private, flip at submission)
- [x] Working link: https://agentbill-topaz.vercel.app (dashboard on 137 anonymised real sessions)
- [ ] 1–2 minute demo video: problem, working product, architecture
- [ ] X quote-post of the official @tryAlanAI launch post (goes live Tue ~7:30 PM IST) with the video attached
- [ ] Submission form: name, project name, contact, GitHub repo, X quote-post link, demo video link
- [ ] Form submitted between Tue 8:00 PM and 10:00 PM IST

## Extra credit

- [x] Build in public: progress posts tagging @prasad_pilla and @tryAlanAI (posts 1–3 in `docs/PLAN.md`)
- [x] Bug reports and UX feedback in the Alan Discord `#bug-report` channel
- [ ] Multiple submissions are allowed, but one strong project beats two thin ones

## Status (Mon Oct 26, evening)

Done: four parsers, live pricing, waste detectors, CLI, dashboard, replay agent, MCP server, PR cost + hook + Action, Alan skill + automation, 26 tests + CI, anonymised demo build, README, CHANGELOG, 5 Alan tickets run and reviewed, 10 build-in-public posts scheduled, Alan bug report.

Left: deploy the demo (working link), run the replay with an API key, record the video, make the repo public, quote post + form on Tue. See [SUBMISSION.md](SUBMISSION.md).
