# Notes for contributors and coding assistants

Relationship Menu is a small, local-first React app. Read [`docs/spec/README.md`](docs/spec/README.md) first: every behaviour has a rule ID (ED-2, CP-10, SV-5, …), and tests and proofs name the rule they check.

## Stack
- React 19 + TypeScript, built with **Vite**, tested with **Vitest** + React Testing Library, and **Playwright** for e2e.
- Yarn 4 (checked in under `.yarn/releases`), Node 22.
- No backend: menus live in `localStorage` and inside share links (`pako`-compressed JSON, see `src/compare-slug.ts` and `public/llms.txt`).
- Hosted on Vercel (`vercel.json`); analytics via GA4, see [`docs/analytics.md`](docs/analytics.md).

## Commands
| Command | What it does |
| --- | --- |
| `yarn start` | Dev server (Vite) |
| `yarn build` | Type-check, then production build into `build/` |
| `yarn test` | Unit, component and property tests (Vitest; `--run` for a single run) |
| `yarn test:e2e` | Playwright end-to-end tests (starts its own dev server on port 3099) |
| `yarn verify` | Formal checks (needs Dafny on your PATH; see `docs/spec/formal/`) |

## Where things live
- `src/menu-editing.ts`: every edit to a menu, as one pure function (proved in Dafny).
- `src/compare-slug.ts`, `data-comparer.ts`, `compare-filters.ts`, `answer-cells.ts`: links, matching and filters (filters proved with LemmaScript).
- `src/autosave.ts`: debounced, ordered saving (modelled in TLA+). `src/storage.ts`: localStorage.
- `src/keyboard.ts`: key bindings; the help overlay is generated from the same table.
- `src/analytics.ts`: the only way to send analytics. Events are typed, and parameters are ids, counts and booleans only.
- `src/pages/`, `src/components/`: UI. `src/__props__/`: fast-check property tests.

## Rules that matter
- **Privacy:** never send menu text, titles, names, notes, search text or links anywhere (analytics, logs, errors). The e2e test `e2e/analytics.spec.ts` checks this.
- **Group and title names are user text:** build objects keyed by them with `Object.create(null)` (a group can be called `__proto__`).
- **Edits go through `applyMenuChange`;** an edit that changes nothing must return the same object (that's how undo knows).
- **New behaviour gets a spec rule and a test that names it.** Prefer a pure function plus a property test over logic inside components.
- Keep dependencies minimal: check whether the platform (WebCrypto, `URLSearchParams`, CSS) already does it before adding a package.
