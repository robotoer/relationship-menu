# Relationship Menu

A small web app for making and comparing relationship menus.

A relationship menu is a list of things a relationship could include: how often you talk, affection, living together, marriage, kids, other partners, and so on. Each person marks every item as Must have, Like to have, Maybe or Off limits, and then you compare answers to see where you line up and what's worth talking about. The idea comes from the non-escalator / relationship anarchy community (see [Inspiration](#inspiration)).

Live at **https://relationship-menu.vercel.app**.

## Using it

1. **Start a menu.** Pick one of the templates (romantic starter, relationship anarchy smorgasbord, polyamory agreements, close friendship, early dating, co-living) or start blank. Rename, reorder or delete anything, and add ready-made groups as you go.
2. **Answer each item.** Click the colored picker, or use the keyboard: arrow keys or `j`/`k` to move, `1`–`4` to answer, `?` for the full list of shortcuts. Add a note to any item (✎) for nuance like "weekends only". If an item turns out to need more detail, make it into a group (⤴) and add items under it.
3. **Share.** The Share button explains each link:
   - the *template link* has your items but none of your answers, for someone to fill in fresh;
   - the *menu link* includes your answers (and your name, if you added one), so only send it to the people you're comparing with;
   - *slugs* are the same data without the web address.
4. **Compare.** Paste two or more menu links into Compare. Items are matched by their text, so the menus don't have to be identical. An overview shows how much you agree, alignment per group, the biggest differences and each person's answers. Filter, search, or sort by biggest difference.
5. **Talk it through.** A guided conversation goes through the differences one at a time, easiest first: prompts for each, a place for notes, where you landed (agreed, compromise, revisit later…) and next steps. At the end there's a summary to copy, download or print. Notes stay in your browser.

There are no accounts and no server database. Menus are saved in your browser (localStorage), and a link carries the whole menu inside it. Opening someone else's link saves a copy to your Library without overwriting anything of yours.

The link format is documented in [`public/llms.txt`](public/llms.txt), which is also served at `/llms.txt` for tools and agents that want to read or build menus.

## Development

You need Node 22 (see `.nvmrc`). Yarn 4 is checked into `.yarn/releases`, so any `yarn` on your path will hand off to it.

```bash
git clone https://github.com/robotoer/relationship-menu.git
cd relationship-menu
yarn install
yarn start            # dev server (Vite) on http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `yarn test` | Unit, component and property tests (Vitest + React Testing Library), in watch mode; `yarn test --run` for one run |
| `yarn test:e2e` | End-to-end tests (Playwright, Chromium). Starts its own dev server on port 3099 |
| `yarn build` | Production build into `build/` |
| `yarn verify` | Formal checks: LemmaScript and Dafny proofs (needs Dafny; see `docs/spec/formal/`) |

Usage analytics (Google Analytics) and exactly what is and isn't sent are described in [`docs/analytics.md`](docs/analytics.md). No menu text, names or link contents ever leave the browser.

CI (GitHub Actions) runs the build, unit tests and the full end-to-end suite on every push. Vercel deploys every branch as a preview and `main` to production.

### Code layout

```
src/
  App.tsx              routes, and the state/loading/saving around each page
  pages/               Landing, Menu (editor), Library, Compare, Discuss, Support
  components/          share dialog, keyboard help, menu rows, compare grid, ...
  model/               types for menus, items and comparisons
  menu-editing.ts      pure functions for every edit to a menu (used for undo/redo)
  keyboard.ts          editor key bindings, also used to render the help dialog
  autosave.ts          debounced, ordered saving
  compare-slug.ts      reading and writing menu links/slugs
  data-comparer.ts     matching items across menus
  compare-filters.ts   the compare view's filters
  compare-insights.ts  the overview: alignment, biggest differences, per person
  discussion.ts        the guided discussion: agenda, prompts, notes, summary
  templates.ts         template menus and ready-made groups
  storage.ts           browser storage (localStorage)
  analytics.ts         the typed analytics events (no menu data)
e2e/                   Playwright tests
public/                icons, manifest, llms.txt, robots.txt, sitemap.xml
```

Most logic lives in small pure modules with their own tests, so a change to menu editing, matching, filtering or link parsing can usually be tested without rendering anything.

## Contributing

Issues and pull requests are welcome. Please add or update tests with your change: a unit test for logic, and an end-to-end test if it changes how a page behaves. `copilot-instructions.md` has notes on the codebase's conventions.

## Inspiration

- [v3 Relationship Components Menu](https://www.reddit.com/r/polyamory/comments/pwkdxp/v3_relationship_components_menu_last_update_for/) on r/polyamory
- The Relationship Anarchy Smorgasbord by Lyrica Lawrence and Heather Orr
- Amy Gahran, *Stepping Off the Relationship Escalator*

The templates in this app are written from scratch; they follow the topics these resources cover but don't copy them.

## License

MIT. See [LICENSE](LICENSE).
