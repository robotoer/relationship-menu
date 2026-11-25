# Analytics

The app reports to Google Analytics 4 (property `G-JGP1J62LL4`, loaded in `public/index.html`). This page lists what's sent, and the one-time setup in GA that turns it into useful reports.

## What's sent, and what never is

Menus live inside their links, answers included, so the app never sends:
- the address bar (only the path, like `/menu`);
- anything a person typed: titles, groups, items, notes, names, search text.

Events carry only fixed values: template ids, link kinds, filter ids, counts and true/false. The types in [`src/analytics.ts`](../src/analytics.ts) enforce this, and [`e2e/analytics.spec.ts`](../e2e/analytics.spec.ts) drives the app with marker text and checks that none of it reaches GA (spec rule PR-2).

## Events

| Event | When | Parameters |
| --- | --- | --- |
| `page_view` | Each page (path only) | `page_path` |
| `template_chosen` | A template is picked for a new menu | `template_id` (`romantic-starter`, `relationship-anarchy-smorgasbord`, `polyamory-agreements`, `close-friendship`, `early-dating`, `co-living-partnership`) |
| `blank_menu_started` | "Blank menu" is picked | |
| `ready_made_group_added` | A ready-made group is added | `group_name` (the built-in group's name) |
| `menu_progress` | A menu passes 25 / 50 / 75 / 100 % answered while being edited | `percent_answered`, `item_count` |
| `note_added` | A note is added to an item | |
| `item_made_group` | "Make into group" is used | |
| `person_info_added` | Name/pronouns/note filled in (once per visit) | |
| `keyboard_help_opened` | The shortcut help is opened | |
| `share_dialog_opened` | The Share dialog is opened | |
| `link_copied` | A link is copied | `link_type`: `template`, `menu`, `invite`, `menu_slug`, `template_slug` |
| `native_share_used` | The phone's share sheet is used | |
| `shared_link_opened` | Someone opens a menu link (not from their Library) | `link_type` (`menu` = has answers, `template` = none), `has_person`, `own_menu`, `opened_as_copy`, `item_count` |
| `link_open_failed` | A link couldn't be opened | `reason`: `unreadable` (cut off) or `not_found` |
| `comparison_shown` | A comparison appears | `menu_count`, `source` (`link` or `button`), `item_count`, `conflict_count` |
| `compare_filter_used` | A compare filter is picked | `filter`: `agree`, `both-want`, `conflict`, `differ`, `unanswered`, `missing`, `all` |
| `library_searched` | The Library is searched (once per visit; never the text) | |
| `library_sorted` | The Library sort is changed | `sort`: `edited`, `created`, `title` |
| `menu_deleted` | A menu is deleted from the Library | |
| `save_failed` | A save fails | |
| `support_viewed` | The Support page is opened | `from`: `nav`, `share` (after sharing), `compare` (under results), `landing`, `direct` |
| `support_option_chosen` | An amount is picked on the Support page (checkout isn't open yet, so this measures interest) | `amount_usd` (6, 12, 24, 30), `plan` (`yearly`, `lifetime`) |

## One-time setup in Google Analytics (about 10 minutes)

GA only shows event parameters in reports after they're registered.

1. **Register the parameters.** In **Admin → Data display → Custom definitions**, click **Create custom dimension** and add each of these with scope **Event**, using the parameter name as the dimension name:
   - `template_id`, `link_type`, `source`, `filter`, `group_name`, `sort`, `reason`, `has_person`, `own_menu`, `opened_as_copy`, `percent_answered`

   Then, on the **Custom metrics** tab, add `item_count`, `menu_count` and `conflict_count` (unit: Standard).

2. **Mark key events.** In **Admin → Data display → Events**, star these as key events. They're the moments the app is actually used, not just visited:
   - `link_copied`: someone shared a menu.
   - `shared_link_opened`: someone arrived from a shared link.
   - `comparison_shown`: two or more people compared.
   - `support_option_chosen`: someone wanted to support the project (and at what amount).

3. **Keep data longer.** In **Admin → Data collection and modification → Data retention**, set event data retention to **14 months**. The default of 2 months limits explorations.

4. **Build two funnels.** In **Explore → Funnel exploration**:
   - *Making and sharing a menu:* `page_view` (page path = `/menu`) → `template_chosen` → `menu_progress` (`percent_answered` = 100) → `share_dialog_opened` → `link_copied`.
   - *The other person's side:* `shared_link_opened` (`link_type` = `template`) → `menu_progress` (100) → `link_copied` (`link_type` = `menu`) → `comparison_shown`.

5. **Answer "where are all these users coming from?"** In **Reports → Acquisition → Traffic acquisition**, look at *Session source / medium*. Then compare that with `shared_link_opened` in **Reports → Engagement → Events**. A big share of `shared_link_opened` means growth is word of mouth (people sending links). Sudden traffic from one referrer usually means the site was posted somewhere.

6. **Check events as they arrive.** In your own browser's console, run `localStorage.analytics_debug = "1"` and reload. Your events then show up live in **Admin → Data display → DebugView**. Remove the flag with `localStorage.removeItem("analytics_debug")`.

Registered dimensions only fill in from the moment they're created, so do step 1 first.
