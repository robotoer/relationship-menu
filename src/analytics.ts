/**
 * Product analytics (Google Analytics 4 via gtag.js, loaded in public/index.html).
 *
 * Privacy rule (spec PR-2): menus live inside links, answers included, so nothing
 * typed by a person is ever sent: no titles, group or item text, notes, names, link
 * contents or search queries. Events carry only the fixed values typed below
 * (template ids, link kinds, counts, booleans), so that rule is enforced by the
 * compiler rather than by review.
 */

import { CompareFilter } from "./compare-filters";
import { LibrarySort } from "./library-info";

type LinkKind = "menu" | "template" | "invite" | "menu_slug" | "template_slug";
/** Where someone opened the Support page from. */
export type SupportFrom = "nav" | "share" | "compare" | "landing" | "direct";
export type SupportPlan = "yearly" | "lifetime";

/** Every event the app sends, with its allowed parameters. */
export type AnalyticsEvent =
  // Starting a menu
  | { name: "template_chosen"; params: { template_id: string } }
  | { name: "blank_menu_started"; params?: undefined }
  | { name: "ready_made_group_added"; params: { group_name: string } }
  // Filling it in
  | { name: "menu_progress"; params: { percent_answered: 25 | 50 | 75 | 100; item_count: number } }
  | { name: "note_added"; params?: undefined }
  | { name: "item_made_group"; params?: undefined }
  | { name: "person_info_added"; params?: undefined }
  | { name: "keyboard_help_opened"; params?: undefined }
  // Sharing
  | { name: "share_dialog_opened"; params?: undefined }
  | { name: "link_copied"; params: { link_type: LinkKind } }
  | { name: "native_share_used"; params?: undefined }
  // Arriving from a shared link
  | {
      name: "shared_link_opened";
      params: {
        link_type: "menu" | "template";
        has_person: boolean;
        own_menu: boolean;
        opened_as_copy: boolean;
        item_count: number;
      };
    }
  | { name: "link_open_failed"; params: { reason: "unreadable" | "not_found" } }
  // Comparing
  | { name: "comparison_shown"; params: { menu_count: number; source: "link" | "button"; item_count: number; conflict_count: number } }
  | { name: "compare_filter_used"; params: { filter: CompareFilter } }
  // Library
  | { name: "library_searched"; params?: undefined }
  | { name: "library_sorted"; params: { sort: LibrarySort } }
  | { name: "menu_deleted"; params?: undefined }
  // Supporting the project
  | { name: "support_viewed"; params: { from: SupportFrom } }
  | { name: "support_option_chosen"; params: { amount_usd: 6 | 12 | 24 | 30; plan: SupportPlan } }
  // Problems
  | { name: "save_failed"; params?: undefined };

type EventName = AnalyticsEvent["name"];
type ParamsOf<N extends EventName> = Extract<AnalyticsEvent, { name: N }>["params"];
/** Events without parameters take none; the others require exactly theirs. */
type ParamArgs<N extends EventName> = undefined extends ParamsOf<N> ? [] : [ParamsOf<N>];

/** Sends one event to Google Analytics, if it's loaded. Never throws. */
export const track = <N extends EventName>(name: N, ...params: ParamArgs<N>) => {
  try {
    const gtag = (window as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.("event", name, params[0] ?? {});
  } catch {
    // Analytics must never break the app.
  }
};

/** Like `track`, but at most once per `key` per page load (e.g. once per menu). */
const sent = new Set<string>();
export const trackOnce = <N extends EventName>(key: string, name: N, ...params: ParamArgs<N>) => {
  if (sent.has(key)) return;
  sent.add(key);
  track(name, ...params);
};

/** The 25/50/75/100% milestone reached by `answered` of `total` items, if any. */
export const progressMilestone = (answered: number, total: number): 25 | 50 | 75 | 100 | null => {
  if (total <= 0 || answered <= 0) return null;
  const share = answered / total;
  if (share >= 1) return 100;
  if (share >= 0.75) return 75;
  if (share >= 0.5) return 50;
  if (share >= 0.25) return 25;
  return null;
};
