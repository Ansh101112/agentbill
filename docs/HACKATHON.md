# OpenFire requirements checklist

Every rule from the OpenFire Luma page, the Alan Discord FAQ and the town hall recap, with where AgentBill meets it. Tick each box before submitting.

## Eligibility and rules

- [ ] **Solo build.** Only Anshuman commits to this repo.
- [ ] **Built during OpenFire.** First commit after Mon Oct 26, 1:00 PM IST. `git log --reverse` proves it.
- [ ] **Built using Alan.** Planning on the Alan task board, implementation tasks run as Alan sessions, PRs reviewed by Alan's Review Agent. Evidence: `docs/ALAN.md` (task pack and session log) and screenshots in `docs/img/alan-*.png`.
- [ ] **Open models (preferred).** The replay judge runs on DeepSeek V4.1 Flash, GLM-5.3 and Kimi. Alan sessions use open models from the Alan model picker. Both are named in the README.
- [ ] **Not a basic CRUD app.** Log parsing across agents, a cost model with prompt-cache economics, carry-cost analysis, and an open-model replay agent.
- [ ] **Open source.** MIT license, public repo at submission.

## What judges score

| Criterion | Where it shows |
|---|---|
| Usefulness | Works on your own logs with one command; no account, no proxy, nothing leaves the machine unless you run `replay` |
| Complexity | Four log formats normalised into one model; carry-cost and cache-expiry analysis; replay agent with an equivalence judge |
| Engineering depth | Tests on fixtures, CI, typed core, live price feed with offline fallback, MCP server |
| Thought process | `docs/DECISIONS.md` written as the build goes; README "How it works" section |
| Regular commits | Small commits every block; build-in-public posts link to them |
| Good README | Problem, demo GIF, quick start, how it works, architecture diagram, limitations |

## Submission

- [ ] Public GitHub repo with detailed README
- [ ] Working link: dashboard demo deployed to Vercel (demo mode, sample data)
- [ ] 1–2 minute demo video: problem, working product, architecture
- [ ] X quote-post of the official @tryAlanAI launch post (goes live Tue ~7:30 PM IST) with the video attached
- [ ] Submission form: name, project name, contact, GitHub repo, X quote-post link, demo video link
- [ ] Form submitted between Tue 8:00 PM and 10:00 PM IST

## Extra credit

- [ ] Build in public: progress posts tagging @prasad_pilla and @tryAlanAI (posts 1–3 in `docs/PLAN.md`)
- [ ] Bug reports and UX feedback in the Alan Discord `#bug-report` channel
- [ ] Multiple submissions are allowed, but one strong project beats two thin ones
