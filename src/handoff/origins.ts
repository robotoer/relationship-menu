/**
 * The two addresses in the move off Vercel (spec §12, HO-3…HO-8): the old one now
 * serves only the hand-off page, which brings saved menus over to the new one.
 *
 * Both are fixed when the app is built and never read from a URL: the hand-off
 * sends every saved menu to NEW_ORIGIN, and the importer replies to OLD_ORIGIN, so
 * a link that could choose either could collect someone's menus.
 *
 * Production builds use the real addresses. The dev servers default to a local
 * pair on two different origins (`localhost` and `127.0.0.1` don't share
 * storage), which the e2e tests use. VITE_NEW_ORIGIN and VITE_OLD_ORIGIN, set
 * when starting a dev server or a build, override them.
 */

// Written out in full each time: Vite only replaces `import.meta.env.…` it can
// see, which also leaves the local addresses out of production builds.

/** Where the app lives: wantsandwonts.com. */
export const NEW_ORIGIN: string =
  import.meta.env.VITE_NEW_ORIGIN ||
  (import.meta.env.DEV ? "http://localhost:3099" : "https://wantsandwonts.com");

/** The old address, which now serves only the hand-off page. */
export const OLD_ORIGIN: string =
  import.meta.env.VITE_OLD_ORIGIN ||
  (import.meta.env.DEV ? "http://127.0.0.1:3098" : "https://relationship-menu.vercel.app");
