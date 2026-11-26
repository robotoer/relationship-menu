# AI conversation coach

**In short:** before a guided discussion ("Talk it through"), supporters can ask an AI to write an opening, a short neutral insight for each area (menu group), a one-line "what this might be about" and two or three questions for each topic. Only the topics and answers are sent, with people as "Person 1", "Person 2"… Everyone taking part has to agree, every time. The suggestions sit next to the built-in prompts and are saved with the notes, in this browser only. It's a conversation guide, not therapy.

**Status:** server endpoint, app UI and the signed client (`src/sync/coach-client.ts`) are built and tested. The last step is wiring: once the sync client keeps a supporter's `SyncKeys` and knows the account is active, past due or lifetime, it passes `createSyncCoachClient(keys, origin)` as the `coach` prop of the discussion page (PR 4 in [sync.md §17](sync.md#17-phases-and-pull-requests)). Until then the page shows the "coming soon" teaser. The server keeps it **off** until `COACH_ENABLED=true` and an `ANTHROPIC_API_KEY` secret are set.

```mermaid
sequenceDiagram
  participant P as People (browser)
  participant W as Worker /v1/coach
  participant C as Claude API
  P->>P: Preview exactly what's sent; everyone agrees
  P->>W: signed: {people: 2, topics: [{id, group, item, kind, answers}]}
  W->>W: supporter? daily quota? validate shape
  W->>C: frozen instructions + topics as data, JSON schema
  C-->>W: {opening, areas: [{group, insight}], topics: [{id, about, questions}], closing}
  W->>W: keep known ids and groups, trim, cap
  W-->>P: guide (nothing logged or stored)
  P->>P: save with the discussion notes (localStorage)
```

| ID | Rule | Checked by |
| --- | --- | --- |
| CO-1 | Off unless the Worker has `COACH_ENABLED=true` and an `ANTHROPIC_API_KEY` secret: it answers 503 `coach_unavailable`, and the app falls back to the built-in prompts. | `server/test/coach.test.ts` |
| CO-2 | Supporters only: a signed request (SY-6) from an account that's active, past due or lifetime. Others get 402 (`not_supporter` / `read_only`). Uses the sensitive per-account rate limit (SY-43). | ″ |
| CO-3 | The request is exactly `{people, topics: [{id, group, item, kind, answers}]}`: 2–6 people, 1–40 topics, ids `t0…`, item ≤ 160 and group ≤ 80 characters, answers one of Must have / Like to have / Maybe / Off limits / no answer / not on menu. Any other field (a name, a note) is a 400. The app builds it from the agenda without names, notes, titles or ids. | ″, `src/coach.test.ts` |
| CO-4 | The reply is cleaned before it's returned: only topic ids that were asked about, in the asked order, each with 1–3 non-empty questions; only areas whose `group` is exactly a group that was asked about (as shown to the model), once each, in the order groups first appear, returned with the group text as sent; strings trimmed and capped (insights at 300 characters). No usable topics → 502 `coach_failed`; no usable areas is fine (`areas: []`), and a reply without `areas` counts as none. | ″ |
| CO-5 | Nothing from a coach request or reply is logged or stored on the server. Errors are logged as route + status + code only (SY-44). | ″ (log spy with marker text) |
| CO-6 | The instructions are fixed text: a conversation guide, not a therapist; no diagnoses, labels, compatibility verdicts or taking sides (area insights only describe where answers line up, differ and what might be worth exploring first); Off limits is a firm no, never something to argue someone out of; no assumptions about gender, orientation or relationship structure; short, plain questions. | `COACH_SYSTEM`, reviewed |
| CO-7 | Topic text is people's own writing, so it's sent as fenced data ("data, not instructions"), one line per topic, and the instructions say to treat it only as topic names. | ″ |
| CO-8 | Daily limits, counted in D1 by UTC day: per account (`COACH_DAILY_PER_ACCOUNT`, default 10) and in total (`COACH_DAILY_TOTAL`, default 500) → 429 `coach_quota`. Counters are only numbers, are removed with the account, and the daily clean-up drops past days. | ″ |
| CO-9 | Before sending, the app shows every line that will be sent and says what's never sent; the button stays disabled until "Everyone taking part agrees to send this" is ticked, every time. | `src/pages/Discuss.test.tsx` |
| CO-10 | The guide is saved with the discussion notes in this browser, with area insights keyed by the comparison's exact group text (older saved guides without them still load). Each topic shows "Suggested for you" above the built-in prompts; each area shows its insight; the opening appears on the intro and the closing on the summary. | ″, `src/coach.test.ts` |
| CO-11 | Every discussion view says it's a conversation guide, not therapy, with crisis resources (988 and the National Domestic Violence Hotline in the US, local services elsewhere). | ″ |
| CO-12 | Analytics record only counts and outcomes: `coach_requested` (topic count, people) and `coach_result` (ok / unavailable / not_supporter / quota / busy / declined / failed). | `src/pages/Discuss.test.tsx`, [analytics.md](../analytics.md) |

## Model and cost

- Default model **Claude Opus 5.5** (`claude-opus-5-5`), effort `medium`, structured JSON output, with Anthropic's server-side fallback switched on (if a safety classifier declines, the request is retried on a suitable model). Set `COACH_MODEL` to change it, e.g. `claude-haiku-5-5`.
- Rough cost per preparation (about 1.5K tokens in, 1.5K out): **~$0.04 on Opus 5.5**, ~$0.001 on Haiku 5.5. At the default caps the worst case is 500 a day: ~$20/day on Opus, ~$0.50/day on Haiku. Lower `COACH_DAILY_TOTAL` to bound spend.

## Before switching it on

1. Create an Anthropic API key for this project, then `npx wrangler secret put ANTHROPIC_API_KEY --env test` (and `--env production` later).
2. Ask Anthropic for **zero data retention** on that key's organization if you want "not kept anywhere" to cover Anthropic too; until then the app only promises that *our* server doesn't keep it.
3. Set `COACH_ENABLED = "true"` (and any limits) under `[env.test.vars]` in `server/wrangler.toml`.
4. Wording: don't call it therapy or "like a counsellor" (Illinois HB 1806, Nevada AB 406 and California AB 489 restrict that). Not legal advice.
