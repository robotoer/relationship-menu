/**
 * Product analytics (Google Analytics 4 via gtag.js, loaded in public/index.html).
 *
 * Privacy rule (spec PR-2): menus live inside links, answers included, so nothing
 * typed by a person is ever sent: no titles, group or item text, notes, names, link
 * contents or search queries. Events carry only the fixed values typed below
 * (template ids, link kinds, counts, booleans), so that rule is enforced by the
 * compiler rather than by review.
 */

import { FocusFilter } from "./compare-focus";
import { LibrarySort } from "./library-info";

type LinkKind = "menu" | "template" | "invite" | "menu_slug" | "template_slug";
/** Where someone opened the Support page from. */
export type SupportFrom =
  | "nav"
  | "share"
  | "compare"
  | "landing"
  | "live"
  | "coach"
  | "direct";
export type SupportPlan = "yearly" | "lifetime";
/** The Support page's amounts, in US dollars. */
export type SupportAmount = 6 | 12 | 24 | 30;

/** Core Web Vitals reported by `web-vitals` (see reportWebVitals.ts). */
export type WebVitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";

/** Where an uncaught error was caught. */
export type ErrorSource = "error" | "unhandledrejection" | "react";

/**
 * Error names that may be reported. Only these fixed names are sent, so nothing an
 * error carries (its message, stack, or a name some code set from data) can leak.
 */
const KNOWN_ERROR_NAMES = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
  "ChunkLoadError",
  "AbortError",
  "TimeoutError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "NotReadableError",
  "InvalidStateError",
  "InvalidAccessError",
  "InvalidCharacterError",
  "QuotaExceededError",
  "SecurityError",
  "DataCloneError",
  "DataError",
  "ConstraintError",
  "TransactionInactiveError",
  "ReadOnlyError",
  "VersionError",
  "UnknownError",
  "OperationError",
] as const;

/**
 * An error's kind: a known error name, `other_error` for an Error with any other
 * name, `non_error` when something other than an Error was thrown, and `unknown`
 * when the browser hid the error (e.g. a cross-origin script's "Script error.").
 */
export type ErrorType =
  | (typeof KNOWN_ERROR_NAMES)[number]
  | "other_error"
  | "non_error"
  | "unknown";

/** Buttons on the landing page: where they are, and where they go. */
export type LandingButton =
  | "hero_start"
  | "hero_compare"
  | "hero_library"
  | "footer_start"
  | "footer_compare";

/** Kinds of change people make to a menu's structure (not answers). */
export type MenuEditKind =
  | "item_added"
  | "item_edited"
  | "item_deleted"
  | "group_added"
  | "group_renamed"
  | "group_deleted"
  | "reordered";

/** Every event the app sends, with its allowed parameters. */
export type AnalyticsEvent =
  // Landing page
  | { name: "landing_button_clicked"; params: { button_id: LandingButton } }
  // Starting a menu
  | { name: "template_chosen"; params: { template_id: string } }
  | { name: "blank_menu_started"; params?: undefined }
  | { name: "reorder_mode_opened"; params?: undefined }
  | { name: "ready_made_group_added"; params: { group_name: string } }
  // Filling it in
  | {
      name: "menu_progress";
      params: { percent_answered: 25 | 50 | 75 | 100; item_count: number };
    }
  | { name: "note_added"; params?: undefined }
  | { name: "item_made_group"; params?: undefined }
  | { name: "person_info_added"; params?: undefined }
  | { name: "keyboard_help_opened"; params?: undefined }
  | { name: "menu_customized"; params: { edit_kind: MenuEditKind } }
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
  | {
      name: "library_menu_opened";
      params: { item_count: number; percent_answered: 0 | 25 | 50 | 75 | 100 };
    }
  // Comparing
  | {
      name: "comparison_shown";
      params: {
        menu_count: number;
        source: "link" | "button" | "share_dialog";
        item_count: number;
        conflict_count: number;
      };
    }
  | { name: "compare_filter_used"; params: { filter: FocusFilter } }
  | { name: "compare_searched"; params?: undefined }
  | { name: "compare_sorted"; params: { sort: "menu" | "difference" } }
  // Guided discussion
  | {
      name: "discussion_started";
      params: { topic_count: number; menu_count: number; resumed: boolean };
    }
  | {
      name: "discussion_summary_viewed";
      params: {
        topic_count: number;
        covered_count: number;
        agreed: number;
        compromise: number;
        revisit: number;
        agree_to_disagree: number;
        boundary: number;
      };
    }
  | {
      name: "discussion_summary_exported";
      params: { method: "copy" | "download" | "print" };
    }
  | { name: "ai_prep_interest"; params?: undefined }
  // AI coach: never the topics or questions, only counts and outcomes
  | { name: "coach_requested"; params: { topic_count: number; people: number } }
  | {
      name: "coach_result";
      params: {
        outcome:
          | "ok"
          | "unavailable"
          | "not_supporter"
          | "quota"
          | "busy"
          | "declined"
          | "failed";
      };
    }
  // Conversations (spec §7c): counts and choices only, never what anyone wrote
  | { name: "conversation_saved"; params: { source: "compare" | "talk" } }
  | { name: "conversation_shared"; params: { method: "share" | "copy" } }
  | {
      name: "conversation_merged";
      params: { comments: number; notes: number; menus: number };
    }
  | { name: "conversation_comment_added"; params: { target: "topic" | "area" } }
  | { name: "conversation_part_done"; params: { part_count: number } }
  | { name: "conversation_tips_opened"; params?: undefined }
  | {
      name: "conversation_settings_changed";
      params: { setting: "include" | "order" | "menu_notes" | "prompts" };
    }
  | { name: "conversation_deleted"; params?: undefined }
  // Live sharing (docs/spec/notifications.md): counts only, never ids
  | { name: "live_shared"; params?: undefined }
  | {
      name: "live_joined";
      params: {
        outcome: "ok" | "expired" | "full" | "gone" | "offline" | "failed";
      };
    }
  | { name: "live_left"; params?: undefined }
  | { name: "live_stopped"; params?: undefined }
  | { name: "notifications_enabled"; params: { channel: "webpush" } }
  | { name: "notifications_disabled"; params?: undefined }
  | { name: "notification_opened"; params?: undefined }
  // Library
  | { name: "library_searched"; params?: undefined }
  | { name: "library_sorted"; params: { sort: LibrarySort } }
  | { name: "menu_deleted"; params?: undefined }
  | { name: "menus_exported"; params?: undefined }
  | { name: "menus_imported"; params?: undefined }
  // Keeping menus (spec SV-11, SV-12)
  | { name: "persistent_storage_granted"; params?: undefined }
  | { name: "persistent_storage_denied"; params?: undefined }
  | { name: "home_screen_hint_shown"; params?: undefined }
  | { name: "home_screen_hint_dismissed"; params?: undefined }
  // Supporting the project
  | { name: "support_viewed"; params: { from: SupportFrom } }
  // Supporter sync (docs/spec/sync.md §9). Never account ids, codes, words, menu ids, Stripe ids or URLs (SY-75).
  | {
      name: "checkout_started";
      params: { amount_usd: SupportAmount; plan: SupportPlan };
    }
  | {
      name: "checkout_completed";
      params: { amount_usd: SupportAmount; plan: SupportPlan };
    }
  | {
      name: "checkout_cancelled";
      params: { amount_usd: SupportAmount; plan: SupportPlan };
    }
  | { name: "sync_enabled"; params: { how: "new" | "restored" } }
  | { name: "device_paired"; params: { method: "qr" | "words" } }
  // Problems
  | { name: "save_failed"; params?: undefined }
  | {
      name: "app_error";
      params: { error_type: ErrorType; error_source: ErrorSource };
    }
  // Performance
  | {
      name: "web_vital";
      params: { metric_name: WebVitalName; metric_value: number };
    };

type EventName = AnalyticsEvent["name"];
type ParamsOf<N extends EventName> = Extract<
  AnalyticsEvent,
  { name: N }
>["params"];
/** Events without parameters take none; the others require exactly theirs. */
type ParamArgs<N extends EventName> =
  undefined extends ParamsOf<N> ? [] : [ParamsOf<N>];

/** Sends one event to Google Analytics, if it's loaded. Never throws. */
export const track = <N extends EventName>(
  name: N,
  ...params: ParamArgs<N>
) => {
  try {
    const gtag = (window as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.("event", name, params[0] ?? {});
  } catch {
    // Analytics must never break the app.
  }
};

/** Like `track`, but at most once per `key` per page load (e.g. once per menu). */
const sent = new Set<string>();
export const trackOnce = <N extends EventName>(
  key: string,
  name: N,
  ...params: ParamArgs<N>
) => {
  if (sent.has(key)) return;
  sent.add(key);
  track(name, ...params);
};

/** The 25/50/75/100% milestone reached by `answered` of `total` items, if any. */
export const progressMilestone = (
  answered: number,
  total: number,
): 25 | 50 | 75 | 100 | null => {
  if (total <= 0 || answered <= 0) return null;
  const share = answered / total;
  if (share >= 1) return 100;
  if (share >= 0.75) return 75;
  if (share >= 0.5) return 50;
  if (share >= 0.25) return 25;
  return null;
};

// ---- Where a page was opened from ----

/** In-app links that open a page carry router state saying where they came from. */
export type OpenedFrom = "library" | "share_dialog";

/** Router state for a link opened from `from` (read back with `openedFrom`). */
export const openedFromState = (from: OpenedFrom) => ({ openedFrom: from });

/** Where the current page was opened from, if an in-app link said so. */
export const openedFrom = (state: unknown): OpenedFrom | undefined => {
  const from = (state as { openedFrom?: unknown } | null)?.openedFrom;
  return from === "library" || from === "share_dialog" ? from : undefined;
};

/** Like `progressMilestone`, but 0 below 25% (for events that report every open). */
export const answeredBucket = (
  answered: number,
  total: number,
): 0 | 25 | 50 | 75 | 100 => progressMilestone(answered, total) ?? 0;

// ---- Core Web Vitals ----

const WEB_VITALS: readonly WebVitalName[] = [
  "CLS",
  "FCP",
  "INP",
  "LCP",
  "TTFB",
];

/**
 * Reports one Core Web Vital: its name and rounded value only (milliseconds, or CLS
 * × 1000), never its id, attribution or the page it was measured on.
 */
export const trackWebVital = (metric: { name: string; value: number }) => {
  try {
    if (!(WEB_VITALS as readonly string[]).includes(metric.name)) return;
    if (!Number.isFinite(metric.value)) return;
    const name = metric.name as WebVitalName;
    track("web_vital", {
      metric_name: name,
      metric_value: Math.round(
        name === "CLS" ? metric.value * 1000 : metric.value,
      ),
    });
  } catch {
    // Analytics must never break the app.
  }
};

// ---- Uncaught errors ----

/** The fixed kind of a thrown value (see `ErrorType`). Never reads its message. */
export const errorType = (error: unknown): ErrorType => {
  try {
    if (error === null || error === undefined) return "unknown";
    const isError =
      error instanceof Error ||
      (typeof DOMException !== "undefined" && error instanceof DOMException);
    if (!isError) return "non_error";
    const name = (error as Error).name;
    return (KNOWN_ERROR_NAMES as readonly unknown[]).includes(name)
      ? (name as ErrorType)
      : "other_error";
  } catch {
    return "unknown";
  }
};

/** At most this many `app_error` events per page load, so an error loop can't flood GA. */
const MAX_ERRORS_PER_PAGE = 5;
let errorsSent = 0;
const errorsSeen = new Set<string>();
// Errors already reported, so one passed on by React to `reportError` isn't counted twice.
const reported = new WeakSet<object>();

/**
 * Reports an uncaught error as `app_error`: only its kind and where it was caught,
 * once per kind and place per page load, and at most a few times per page load.
 */
export const trackError = (error: unknown, source: ErrorSource) => {
  try {
    if (error !== null && typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const type = errorType(error);
    const key = `${source}:${type}`;
    if (errorsSeen.has(key) || errorsSent >= MAX_ERRORS_PER_PAGE) return;
    errorsSeen.add(key);
    errorsSent++;
    track("app_error", { error_type: type, error_source: source });
  } catch {
    // Analytics must never break the app.
  }
};

/** Reports uncaught errors and unhandled promise rejections (see `trackError`). */
export const trackUncaughtErrors = (target: Window = window) => {
  target.addEventListener("error", (e) => trackError(e.error, "error"));
  target.addEventListener("unhandledrejection", (e) =>
    trackError(e.reason, "unhandledrejection"),
  );
};

/** For tests: forget which errors were reported. */
export const resetErrorTracking = () => {
  errorsSent = 0;
  errorsSeen.clear();
};
