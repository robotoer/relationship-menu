/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides where the hand-off sends menus (src/handoff/origins.ts). Build time only. */
  readonly VITE_NEW_ORIGIN?: string;
  /** Overrides where the importer replies (src/handoff/origins.ts). Build time only. */
  readonly VITE_OLD_ORIGIN?: string;
}
