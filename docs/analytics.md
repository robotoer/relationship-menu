# Analytics

The app reports to Google Analytics 4 (property `G-JGP1J62LL4`, loaded in `public/index.html`). This page lists what's sent, and the one-time setup in GA that turns it into useful reports.

## What's sent, and what never is

Menus live inside their links, answers included, so the app never sends:
- the address bar (only the path, like `/menu`);
- anything a person typed: titles, groups, items, notes, names, search text;
- error messages or stacks (they can quote menu text): only a fixed error name.

Events carry only fixed values: template ids, link kinds, filter ids, counts and true/false. The types in [`src/analytics.ts`](../src/analytics.ts) enforce this, and [`e2e/analytics.spec.ts`](../e2e/analytics.spec.ts) drives the app with marker text and checks that none of it reaches GA (spec rule PR-2).

### Only production reports

Google Analytics is loaded only on `wantsandwonts.com` (until November 2026, `relationship-menu.vercel.app`, which now serves only a hand-off page without analytics), and not in automated browsers (`navigator.webdriver`). Localhost, preview URLs, other copies of the site and the e2e tests (in CI and locally) never send anything: their events only queue up in `window.dataLayer`, which is where `e2e/analytics.spec.ts` reads them, and that test also fails if any request reaches Google. Until November 2026 the e2e runs did report, as one new "user" per test on `localhost`; filter on Hostname = `relationship-menu.vercel.app` when looking at older data. DebugView (step 6 below) therefore only works on the production site, with the `analytics_debug` flag set.

## Events

| Event | When | Parameters |
| --- | --- | --- |
| `page_view` | Each page (path only) | `page_path` |
| `landing_button_clicked` | A landing page button is used | `button_id`: `hero_start`, `hero_compare`, `hero_library` (My menus), `footer_start`, `footer_compare` |
| `template_chosen` | A template is picked for a new menu | `template_id` (`romantic-starter`, `relationship-anarchy-smorgasbord`, `polyamory-agreements`, `off-the-escalator`, `close-friendship`, `early-dating`, `co-living-partnership`) |
| `blank_menu_started` | "Blank menu" is picked | |
| `ready_made_group_added` | A ready-made group is added | `group_name` (the built-in group's name) |
| `menu_progress` | A menu passes 25 / 50 / 75 / 100 % answered while being edited | `percent_answered`, `item_count` |
| `note_added` | A note is added to an item | |
| `item_made_group` | "Make into group" is used | |
| `person_info_added` | Name/pronouns/note filled in (once per visit) | |
| `keyboard_help_opened` | The shortcut help is opened | |
| `menu_customized` | A menu's structure is changed, not just answered (once per kind per visit) | `edit_kind`: `item_added`, `item_edited` (an existing item reworded), `item_deleted`, `group_added`, `group_renamed`, `group_deleted`, `reordered` |
| `share_dialog_opened` | The Share dialog is opened | |
| `link_copied` | A link is copied | `link_type`: `template`, `menu`, `invite`, `menu_slug`, `template_slug` |
| `native_share_used` | The phone's share sheet is used | |
| `shared_link_opened` | Someone opens a menu link (not from their Library) | `link_type` (`menu` = has answers, `template` = none), `has_person`, `own_menu`, `opened_as_copy`, `item_count` |
| `link_open_failed` | A link couldn't be opened | `reason`: `unreadable` (cut off) or `not_found` |
| `library_menu_opened` | A saved menu is reopened from the Library | `item_count`, `percent_answered` (`0`, `25`, `50`, `75`, `100`) |
| `comparison_shown` | A comparison appears | `menu_count`, `source` (`link` = a compare link, `share_dialog` = pasted into the Share dialog, `button` = the Compare page's button), `item_count`, `conflict_count` |
| `compare_filter_used` | A compare filter is picked (from the filter bar or a zone in "Where you stand") | `filter`: `all`, `conflict`, `talk`, `open`, `quick`, `aligned`, `notes`. Before 27 November 2026 the values were `agree`, `both-want`, `conflict`, `differ`, `unanswered`, `missing`, `all` |
| `compare_searched` | The comparison is searched (never the text) | |
| `compare_sorted` | The comparison's order is changed | `sort`: `menu`, `difference` |
| `discussion_started` | "Start" or "Continue" in a guided discussion | `topic_count`, `menu_count`, `resumed` |
| `discussion_summary_viewed` | The discussion summary is opened | `topic_count`, `covered_count`, and a count per outcome: `agreed`, `compromise`, `revisit`, `agree_to_disagree`, `boundary` |
| `discussion_summary_exported` | The summary is copied, downloaded or printed | `method`: `copy`, `download`, `print` |
| `coach_requested` | Everyone agreed and "Prepare questions" was pressed (AI coach) | `topic_count`, `people` |
| `coach_result` | The AI coach answered | `outcome`: `ok`, `unavailable`, `not_supporter`, `quota`, `busy`, `declined`, `failed` |
| `conversation_saved` | A conversation was saved to the Library | `source`: `compare`, `talk` |
| `conversation_shared` | Someone sent a conversation link | `method`: `share`, `copy` |
| `conversation_merged` | A conversation link was opened and merged into this browser's copy | `comments`, `notes`, `menus`: how many were new |
| `conversation_comment_added` | A comment was left for later | `target`: `topic`, `area` |
| `conversation_part_done` | A part of a conversation was marked done | `part_count` |
| `conversation_tips_opened` | The conversation tips were opened | — |
| `conversation_deleted` | A conversation was deleted from the Library | — |
| `live_shared` | A supporter started sharing a conversation live | — |
| `live_joined` | Someone opened a live invite | `outcome`: `ok`, `expired`, `full`, `gone`, `offline`, `failed` |
| `live_left` | A member left a live conversation | — |
| `live_stopped` | The host stopped sharing live | — |
| `notifications_enabled` | "Notify me" was turned on for a live conversation on this device | `channel`: `webpush` |
| `notifications_disabled` | "Notify me" was turned off | — |
| `notification_opened` | A notification was tapped (the page opened with `from=notification`) | — |
| `ai_prep_interest` | "Prepare this conversation with AI (coming soon)" is clicked: measures interest, nothing is sent | |
| `library_searched` | The Library is searched (once per visit; never the text) | |
| `library_sorted` | The Library sort is changed | `sort`: `edited`, `created`, `title` |
| `menu_deleted` | A menu is deleted from the Library | |
| `menus_exported` | Export all menus is used in the Library (never the file, its titles or how many) | |
| `menus_imported` | Import menus in the Library read at least one menu from pasted links or a backup file, whether or not any were new (spec SV-14; never the links, the file, its titles, how many, or whether it was pasted or a file) | |
| `persistent_storage_granted` / `persistent_storage_denied` | The browser's answer to keeping this site's storage, asked once per browser after the first save (spec SV-11). Read with GA's own Browser and OS dimensions | |
| `home_screen_hint_shown` | The Home Screen tip appears (iPhone/iPad Safari only; once per page load) | |
| `home_screen_hint_dismissed` | The Home Screen tip is dismissed (it then stays hidden in that browser) | |
| `save_failed` | A save fails | |
| `support_viewed` | The Support page is opened | `from`: `nav`, `share` (after sharing), `compare` (under results), `landing`, `live` (the Share live panel), `direct` |
| `checkout_started` | Leaving for Stripe Checkout from the Support page | `amount_usd` (6, 12, 24, 30), `plan` (`yearly`, `lifetime`) |
| `checkout_completed` | Back from Checkout, once the server confirms the supporter status | `amount_usd`, `plan` |
| `checkout_cancelled` | Back from Checkout without paying | `amount_usd`, `plan` |
| `sync_enabled` | Sync is turned on on this device | `how`: `new` (a new sync code) or `restored` (an existing code, typed or from a pairing link) |
| `device_paired` | A device joins an existing sync account | `method`: `qr` (pairing link) or `words` (typed sync code) |
| `app_error` | An uncaught error (at most 5 per page load, each kind once) | `error_type`: a fixed error name (`TypeError`, `ChunkLoadError`, `QuotaExceededError`…; see `KNOWN_ERROR_NAMES` in `src/analytics.ts`), `other_error`, `non_error` (something other than an Error was thrown) or `unknown` (hidden by the browser); `error_source`: `error`, `unhandledrejection` or `react` (a render crash that blanked the page) |
| `web_vital` | A Core Web Vital is measured (about once per page load each) | `metric_name` (`CLS`, `FCP`, `INP`, `LCP`, `TTFB`), `metric_value` (milliseconds, rounded; CLS × 1000) |

Until late November 2026, opening a menu from the Library was counted as `shared_link_opened` with `own_menu` = true; filter on `own_menu` = false to compare older data.

Before the Support page opened Stripe Checkout (late November 2026), picking an amount there sent `support_option_chosen` (`amount_usd`, `plan`) to measure interest, and nothing was charged. `checkout_started` replaces it.

## One-time setup in Google Analytics (about 10 minutes)

GA only shows event parameters in reports after they're registered.

1. **Register the parameters.** In **Admin → Data display → Custom definitions**, click **Create custom dimension** and add each of these with scope **Event**, using the parameter name as the dimension name:
   - `template_id`, `link_type`, `source`, `filter`, `group_name`, `sort`, `reason`, `has_person`, `own_menu`, `opened_as_copy`, `percent_answered`
   - `button_id`, `edit_kind`, `error_type`, `error_source`, `metric_name`, `from`, `plan`
   - `how`, `method` (supporter sync: how sync was turned on, and how a device joined)

   Then, on the **Custom metrics** tab, add `item_count`, `menu_count`, `conflict_count`, `metric_value` and `amount_usd` (unit: Standard).

   To read Core Web Vitals, build a free-form exploration with dimension `metric_name` and metrics **Event count** and `metric_value`: the average is `metric_value` ÷ Event count (CLS is × 1000, so 100 = 0.1).

2. **Mark key events.** In **Admin → Data display → Events**, star these as key events. They're the moments the app is actually used, not just visited:
   - `link_copied`: someone shared a menu.
   - `shared_link_opened`: someone arrived from a shared link.
   - `comparison_shown`: two or more people compared.
   - `checkout_completed`: someone became a supporter (and at what amount).

3. **Keep data longer.** In **Admin → Data collection and modification → Data retention**, set event data retention to **14 months**. The default of 2 months limits explorations.

4. **Build two funnels.** In **Explore → Funnel exploration**:
   - *Making and sharing a menu:* `page_view` (page path = `/menu`) → `template_chosen` → `menu_progress` (`percent_answered` = 100) → `share_dialog_opened` → `link_copied`.
   - *The other person's side:* `shared_link_opened` (`link_type` = `template`) → `menu_progress` (100) → `link_copied` (`link_type` = `menu`) → `comparison_shown`.

5. **Answer "where are all these users coming from?"** In **Reports → Acquisition → Traffic acquisition**, look at *Session source / medium*. Then compare that with `shared_link_opened` in **Reports → Engagement → Events**. A big share of `shared_link_opened` means growth is word of mouth (people sending links). Sudden traffic from one referrer usually means the site was posted somewhere.

6. **Check events as they arrive.** On https://wantsandwonts.com (the only site that reports), in your own browser's console, run `localStorage.analytics_debug = "1"` and reload. Your events then show up live in **Admin → Data display → DebugView**. Remove the flag with `localStorage.removeItem("analytics_debug")`.

Registered dimensions only fill in from the moment they're created, so do step 1 first.
