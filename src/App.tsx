import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  Link,
  Navigate,
  Routes,
  Route,
  useLocation,
  useNavigationType,
  useSearchParams,
} from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { LandingPage } from "./pages/Landing";
import { ComparePage } from "./pages/Compare";
import {
  Person,
  RelationshipMenu,
  RelationshipMenuDocument,
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData, encodeData } from "./data-encoder";
import { MenuComparison } from "./model/compare";
import { SavedDocument, useStorage } from "./providers/Storage";
import { newMenuId } from "./menu-id";
import { compareMenus } from "./data-comparer";
import { MenuChange, applyMenuChange } from "./menu-editing";
import { useAutosave } from "./autosave";
import { GROUP_TEMPLATES, templateMenu } from "./templates";
import {
  MenuEditKind,
  answeredBucket,
  openedFrom,
  progressMilestone,
  track,
  trackOnce,
} from "./analytics";
import { SupportPage } from "./pages/Support";
import { platform } from "./platform";
import { TalkRoute } from "./pages/Talk";
import { SaveComparison } from "./components/SaveComparison";
import { SyncSettingsRoute } from "./pages/SyncSettingsRoute";
import { PairPage } from "./pages/Pair";
import { createCoachClient } from "./coach";
import { sameMenuContent } from "./storage";
import { isSupporter, useSync } from "./sync/context";
import { useSyncRuntime } from "./providers/Sync";
import { countByFilter } from "./compare-filters";
import { uniqueTitle } from "./unique-title";
import {
  DecodedCompareSlug,
  decodeCompareSlug,
  encodeMenuSlug,
  expandCompareEntry,
  sanitizePerson,
  normalizeCompareEntry,
} from "./compare-slug";

/** Counter for generating unique item IDs within a page session. */
let _nextItemId = 0;
const generateItemId = (): string => `item_${++_nextItemId}`;

/** Assigns stable IDs to any menu items that don't already have one. */
const ensureItemIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = Object.create(null);
  for (const group of Object.keys(menu)) {
    result[group] = menu[group].map((item) => ({
      ...item,
      id: item.id || generateItemId(),
    }));
  }
  return result;
};

/** Strips `id` fields from every item so encoded data stays backward-compatible. */
const stripMenuIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = Object.create(null);
  for (const group of Object.keys(menu)) {
    result[group] = menu[group].map(({ id: _, ...rest }) => rest);
  }
  return result;
};

/** Which kind of structural edit `change` made to `prev`, for analytics (if any). */
const editKind = (prev: RelationshipMenu, change: MenuChange): MenuEditKind | null => {
  switch (change.kind) {
    case "item": {
      if (!change.value) return "item_deleted";
      const items = Object.prototype.hasOwnProperty.call(prev, change.group) ? prev[change.group] : [];
      if (change.itemIndex >= items.length) return "item_added";
      return "item" in change.value ? "item_edited" : null;
    }
    case "group":
      if (change.oldGroup === undefined) return change.newGroup !== undefined ? "group_added" : null;
      return change.newGroup === undefined ? "group_deleted" : "group_renamed";
    case "move-item":
    case "move-group":
      return "reordered";
    default:
      return null;
  }
};

/**
 * A component that wraps the LibraryPage component and provides the necessary data.
 * @returns The wrapped LibraryPage component.
 */
const WrappedLibraryPage = () => {
  const { documents: documentsMap, deleteDocument } = useStorage();
  const documents = useMemo(
    () =>
      Object.values(documentsMap).map((doc) => ({
        ...doc,
        link: encodeMenuSlug(doc.title, doc.encoded, doc.person),
      })),
    [documentsMap]
  );
  return <LibraryPage menus={documents} onDelete={deleteDocument} />;
};

/** The document the editor saves for this title, menu and person. */
const editorDoc = (title: string, menu: RelationshipMenu, person: Person): RelationshipMenuDocument => ({
  title,
  encoded: encodeData(stripMenuIds(menu)),
  ...(sanitizePerson(person) ? { person: sanitizePerson(person) } : {}),
});

/** Whether a stored encoded menu has the same groups, items and answers as `menu`. */
const sameMenu = (encoded: string, menu: RelationshipMenu): boolean => {
  try {
    return (
      JSON.stringify(stripMenuIds(decodeData(encoded))) ===
      JSON.stringify(stripMenuIds(menu))
    );
  } catch {
    return false;
  }
};

/** The titles of saved menus. */
const savedTitles = (saved: { [id: string]: SavedDocument }) => new Set(Object.values(saved).map((d) => d.title));

/**
 * A wrapped version of the MenuPage component that handles state management and data encoding/decoding.
 * It uses react-router-dom to get path parameters and syncs the encoded data with the menu state.
 * The menu is saved to the browser's local storage and query parameters are updated as the menu or title changes.
 * @returns The wrapped MenuPage component.
 */
const WrappedMenuPage = () => {
  const { storage, documents } = useStorage();
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState<Person>({});
  // When this menu was first saved here; kept across saves and renames.
  const createdAt = useRef<number | null>(null);
  const [menu, setMenuState] = useState<RelationshipMenu>({});
  // Latest menu, updated synchronously so rapid edits always build on each other.
  const menuRef = useRef<RelationshipMenu>({});
  const undoStack = useRef<RelationshipMenu[]>([]);
  const redoStack = useRef<RelationshipMenu[]>([]);
  // The text field last edited, so a run of keystrokes in one field is one undo step.
  const lastTextEdit = useRef<string | null>(null);
  // Items and groups added in this editor (analytics: see editMenu).
  const createdHere = useRef(new Set<string>());
  /** Replaces the menu (e.g. when loading) without recording an undo step. */
  const setMenu = (next: RelationshipMenu) => {
    menuRef.current = next;
    undoStack.current = [];
    redoStack.current = [];
    lastTextEdit.current = null;
    setMenuState(next);
  };
  const editMenu = (change: MenuChange) => {
    // Analytics: which editing features get used (never what was typed).
    if (change.kind === "item-to-group") track("item_made_group");
    if (change.kind === "insert-group") {
      const known = GROUP_TEMPLATES.some((g) => g.name === change.group);
      track("ready_made_group_added", { group_name: known ? change.group : "other" });
    }
    if (change.kind === "item" && change.value?.note && !menuRef.current[change.group]?.[change.itemIndex]?.note) {
      track("note_added");
    }
    const prev = menuRef.current;
    const next = applyMenuChange(prev, change, generateItemId);
    if (next === prev) return;
    // Analytics: whether people reshape menus or only answer them (once per kind per
    // visit). Typing into an item or group just added here is part of adding it.
    let kind = editKind(prev, change);
    const created = createdHere.current;
    if (kind === "item_added" && change.kind === "item" && change.value?.id) {
      created.add(`item:${change.value.id}`);
    } else if (kind === "item_edited" && change.kind === "item") {
      const id = prev[change.group]?.[change.itemIndex]?.id;
      if (id && created.has(`item:${id}`)) kind = null;
    } else if (kind === "group_added" && change.kind === "group") {
      created.add(`group:${change.newGroup}`);
    } else if (kind === "group_renamed" && change.kind === "group") {
      if (created.delete(`group:${change.oldGroup}`)) {
        created.add(`group:${change.newGroup}`);
        kind = null;
      }
    }
    if (kind) trackOnce(`menu_customized:${kind}`, "menu_customized", { edit_kind: kind });
    const textEdit =
      change.kind === "item" && change.value && "item" in change.value
        ? `item:${change.group}:${change.itemIndex}`
        : change.kind === "group" && change.oldGroup !== undefined && change.newGroup !== undefined
        ? `group:${Object.keys(prev).indexOf(change.oldGroup)}`
        : null;
    if (!textEdit || textEdit !== lastTextEdit.current) {
      undoStack.current = [...undoStack.current.slice(-99), prev];
    }
    lastTextEdit.current = textEdit;
    redoStack.current = [];
    menuRef.current = next;
    setMenuState(next);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(menuRef.current);
    lastTextEdit.current = null;
    menuRef.current = prev;
    setMenuState(prev);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(menuRef.current);
    lastTextEdit.current = null;
    menuRef.current = next;
    setMenuState(next);
  };
  const loadedFromUrl = useRef(false);
  // The id this editor's menu is saved under (SY-20): set when a saved menu is opened,
  // or made up on its first save. Renaming keeps it, so a rename is an ordinary save.
  const menuId = useRef<string | null>(null);
  // With sync on, the stored menu's revision this editor last loaded or saved (SY-24):
  // a save from an older one keeps the synced version too (SY-35).
  const revision = useRef<number | null>(null);
  // What this editor last loaded or saved (the stored menu as of `revision`): the
  // editor has unsaved edits whenever it shows something else (SY-33).
  const committed = useRef<RelationshipMenuDocument | null>(null);
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();

  // The link this page was opened with. Captured once: the URL is rewritten as the
  // menu is edited, and must not be read back as a new menu to load.
  const initialEncoded = useRef(params.get("encoded"));
  // Whether an in-app link (the Library) opened it, for analytics. Also captured once.
  const location = useLocation();
  const fromLibrary = useRef(openedFrom(location.state) === "library");
  // The Library says exactly which menu to open, since two menus may share a title.
  const openedMenuId = useRef(
    typeof (location.state as { menuId?: unknown } | null)?.menuId === "string"
      ? ((location.state as { menuId: string }).menuId)
      : null
  );
  // False until the opened link (if any) has been loaded.
  const [loaded, setLoaded] = useState(!initialEncoded.current);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the menu from the link. Formats:
  // 1. "titleEncoded:menuEncoded" — self-contained link (all data in URL)
  // 2. Older Library links: a title (or a menu id) — looked up in this browser
  // When the Library opened it, its menu id (in the navigation state) says which one.
  // The "loaded" guard is only set once the menu has actually been applied, so a load
  // cancelled by React StrictMode is retried rather than lost.
  useEffect(() => {
    const raw = initialEncoded.current;
    if (!raw || loadedFromUrl.current) return;
    let cancelled = false;
    (async () => {
      let opened: DecodedCompareSlug | null = null;
      let notFound = false;
      // The saved menu this link is, when known for sure.
      let openedDoc: SavedDocument | undefined;
      const saved = await storage.getDocuments();
      if (cancelled) return;
      try {
        const fromId = openedMenuId.current !== null ? saved[openedMenuId.current] : undefined;
        if (fromId) {
          openedDoc = fromId;
          opened = decodeCompareSlug(encodeMenuSlug(fromId.title, fromId.encoded, fromId.person));
        } else if (raw.includes(":")) {
          opened = decodeCompareSlug(raw);
        } else {
          openedDoc = saved[raw] ?? Object.values(saved).find((d) => d.title === raw);
          notFound = !openedDoc;
          opened = openedDoc
            ? decodeCompareSlug(encodeMenuSlug(openedDoc.title, openedDoc.encoded, openedDoc.person))
            : null;
        }
      } catch (e) {
        console.error("Failed to open menu link:", e);
      }
      if (!opened) {
        track("link_open_failed", { reason: notFound ? "not_found" : "unreadable" });
        setNotice(
          notFound
            ? "This menu wasn't found in this browser. If it was shared with you, ask for the full link."
            : "This link couldn't be opened. It may have been cut off when it was copied; ask for it again."
        );
        setLoaded(true);
        loadedFromUrl.current = true;
        return;
      }
      // Opening a link must never replace a different menu you already saved under
      // the same title (e.g. your partner's menu, or a template of your own menu):
      // open it as a copy with a free title instead. A link to a menu you already
      // have, unchanged, opens that menu (LK-6).
      loadedFromUrl.current = true;
      const decoded = opened;
      const sameTitle = Object.values(saved).filter((d) => d.title === decoded.title);
      const existing = openedDoc ?? sameTitle.find((d) => sameMenu(d.encoded, decoded.menu));
      let openedTitle = opened.title;
      if (!existing && sameTitle.length > 0) {
        openedTitle = uniqueTitle(opened.title, savedTitles(saved));
        setNotice(
          `You already have a menu called "${opened.title}", so this link was opened as "${openedTitle}". Rename it any time.`
        );
        menuId.current = null;
      } else {
        setNotice(null);
        menuId.current = existing?.id ?? null;
        revision.current = existing?.revision ?? null;
        committed.current = existing ?? null;
        createdAt.current = existing?.createdAt ?? null;
      }
      const items = Object.values(opened.menu).flat();
      if (fromLibrary.current) {
        // Reopened from the Library: coming back to a saved menu.
        track("library_menu_opened", {
          item_count: items.length,
          percent_answered: answeredBucket(items.filter((i) => i.value).length, items.length),
        });
      } else if (raw.includes(":")) {
        // A full link (not a Library ID): someone shared it, or it's a bookmark.
        track("shared_link_opened", {
          link_type: items.some((i) => i.value) ? "menu" : "template",
          has_person: !!opened.person,
          own_menu: !!existing,
          opened_as_copy: openedTitle !== opened.title,
          item_count: items.length,
        });
      }
      setPerson(opened.person ?? existing?.person ?? {});
      setTitle(openedTitle);
      setMenu(ensureItemIds(opened.menu));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);
  // Save the menu (and its title) to storage, debounced, one save at a time.
  // SV-7: a title you type can't be one a *different* saved menu already has. (Two
  // menus may share a title, e.g. after syncing; that doesn't stop either saving.)
  const savedTitle = menuId.current !== null ? documents[menuId.current]?.title : undefined;
  const titleTaken =
    title !== savedTitle &&
    Object.values(documents).some((d) => d.title === title && d.id !== menuId.current);
  const docToSave = useMemo(
    () =>
      !loaded || titleTaken || (title === "" && Object.keys(menu).length === 0) ? null : editorDoc(title, menu, person),
    [title, menu, person, titleTaken, loaded]
  );
  // What storage holds after a synced change was shown in the editor (SY-33), so
  // autosave knows it needn't save that, but must save a change back to the old one.
  const [syncedDoc, setSyncedDoc] = useState<RelationshipMenuDocument | null>(null);
  const saveState = useAutosave(docToSave, async (doc) => {
    // Saved under the menu's id, whatever its title: a rename is just a save (SY-21).
    // The storage provider reports failures by returning no ids.
    const now = Date.now();
    createdAt.current ??= now;
    const id = (menuId.current ??= newMenuId());
    revision.current = await storage.saveMenu(
      { ...doc, id, createdAt: createdAt.current, updatedAt: now },
      revision.current
    );
    committed.current = doc;
  }, syncedDoc);

  // A menu that sync moved to a new id (its first upload's answer was lost) carries on there.
  useEffect(
    () =>
      storage.subscribe(({ moved }) => {
        for (const { from, to } of moved) if (menuId.current === from) menuId.current = to;
      }),
    [storage]
  );

  // SY-33: a synced change to the open menu, with no unsaved edits here, replaces it
  // in place. With unsaved edits, the next save keeps both versions (SY-35).
  const openDoc = menuId.current !== null ? documents[menuId.current] : undefined;
  useEffect(() => {
    if (!loaded || !openDoc || openDoc.revision === undefined) return;
    // Null: opened before sync was on here; any revision is news.
    if (revision.current !== null && openDoc.revision <= revision.current) return;
    const shown = editorDoc(title, menuRef.current, person);
    if (sameMenuContent(openDoc, shown)) {
      // Already showing it (say, sync was just turned on): just note the revision.
      revision.current = openDoc.revision;
      committed.current = openDoc;
      return;
    }
    // Unsaved edits: waiting or being saved, a failed save, or edits that can't be
    // saved yet (a title another menu has). Whatever autosave's status says.
    const unsaved =
      saveState === "pending" ||
      saveState === "saving" ||
      saveState === "error" ||
      committed.current === null ||
      !sameMenuContent(committed.current, shown);
    if (unsaved) return;
    const decoded = decodeCompareSlug(encodeMenuSlug(openDoc.title, openDoc.encoded, openDoc.person));
    if (!decoded) return;
    revision.current = openDoc.revision;
    committed.current = openDoc;
    const synced = ensureItemIds(decoded.menu);
    setTitle(decoded.title);
    setMenu(synced);
    setPerson(decoded.person ?? {});
    setSyncedDoc(editorDoc(decoded.title, synced, decoded.person ?? {}));
    setNotice("Updated on another device.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDoc, saveState, loaded, title, menu, person]);

  // Analytics: how far people get answering a menu. Milestones already reached when
  // the editor opened (e.g. reopening a finished menu) aren't counted again.
  const progressBaseline = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const items = Object.values(menu).flat().filter((i) => i.item.trim());
    const answered = items.filter((i) => i.value).length;
    const milestone = progressMilestone(answered, items.length) ?? 0;
    if (progressBaseline.current === null) {
      progressBaseline.current = milestone;
      return;
    }
    if (milestone > progressBaseline.current) {
      progressBaseline.current = milestone;
      track("menu_progress", {
        percent_answered: milestone as 25 | 50 | 75 | 100,
        item_count: items.length,
      });
    }
  }, [menu, loaded]);

  useEffect(() => {
    if (saveState === "error") track("save_failed");
  }, [saveState]);

  // Keep the URL in sync with the menu so it can be bookmarked or reloaded. Replace
  // the history entry rather than pushing one per edit, so Back leaves the editor.
  useEffect(() => {
    if (!loaded) return;
    const encoded = encodeMenuSlug(title, stripMenuIds(menu), person);
    if (params.get("encoded") !== encoded) {
      setParams({ encoded }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, title, person, loaded]);

  // The menu link carries person info; the template link (for others to fill in)
  // never does.
  const menuEncoded = useMemo(
    () => encodeMenuSlug(title, stripMenuIds(menu), person),
    [menu, title, person]
  );
  const template = useMemo(() => {
    // Strip all values from the menu to create a template:
    const template: RelationshipMenu = Object.create(null);
    for (const group in menu) {
      template[group] = menu[group].map((item) => ({ item: item.item }));
    }
    return template;
  }, [menu]);
  const templateEncoded = useMemo(
    () => encodeMenuSlug(title, template),
    [title, template]
  );

  return (
    <MenuPage
      title={title}
      menu={menu}
      menuEncoded={menuEncoded}
      templateEncoded={templateEncoded}
      onChange={editMenu}
      onUndo={undo}
      onRedo={redo}
      onChangeTitle={setTitle}
      person={person}
      onChangePerson={(next) => {
        if (Object.values(next).some((v) => typeof v === "string" && v.trim())) {
          trackOnce("person_info_added", "person_info_added");
        }
        setPerson(next);
      }}
      onUseTemplate={(template) => {
        track("template_chosen", { template_id: template.id });
        editMenu({ kind: "replace", menu: ensureItemIds(templateMenu(template)) });
        if (title === "") {
          const titles = savedTitles(documents);
          setTitle(titles.has(template.name) ? uniqueTitle(template.name, titles) : template.name);
        }
      }}
      saveStatus={titleTaken ? "title-taken" : saveState}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    />
  );
};

/** Whether a list of compare entries contains at least two valid menus. */
const opensCompared = (entries: string[]) =>
  entries.filter((entry) => decodeCompareSlug(entry) !== null).length >= 2;

/** Landing page with the number of saved menus (for a "My menus" shortcut). */
const WrappedLandingPage = () => {
  const { documents } = useStorage();
  return <LandingPage savedCount={Object.keys(documents).length} />;
};

/**
 * The menu editor route. Opening /menu by a link, the navbar or Back/Forward starts a
 * fresh editor for that URL; the editor's own URL updates (history replaces) don't.
 */
const MenuRoute = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const editorKey = useRef(location.key);
  if (navigationType !== "REPLACE") {
    editorKey.current = location.key;
  }
  return <WrappedMenuPage key={editorKey.current} />;
};

/**
 * A wrapped component for the ComparePage.
 *
 * Decodes self-contained slugs (titleEncoded:menuEncoded format) directly
 * rather than looking them up from storage, so compare links work across
 * browsers without needing shared storage.
 *
 * The entries being edited live in local state so typing is applied synchronously
 * (React Router applies search param updates as a deferred transition, which makes a
 * URL-controlled input drop keystrokes). Edits are mirrored into the URL with
 * `history.replaceState` so the page stays shareable; navigations from elsewhere
 * (links, back/forward) still reset the entries from the URL.
 *
 * @returns The wrapped ComparePage component.
 */
const WrappedComparePage = () => {
  const [params] = useSearchParams();
  // Changes on every router navigation (but not on our own replaceState calls).
  const { key: navigationKey, state: navigationState } = useLocation();
  const paramEntries = useMemo(
    () => params.getAll("encoded").filter((e) => e.trim().length > 0),
    [params]
  );

  // Every entry the user has typed, including ones that don't decode (yet), so that
  // inputs never disappear while being typed or edited.
  const [encodedList, setEncodedList] = useState(paramEntries);

  // The comparison is shown when the user clicks Compare. A compare link that already
  // contains 2+ valid menus (e.g. a shared link) opens straight to the comparison.
  const [compareClicked, setCompareClicked] = useState(() =>
    opensCompared(paramEntries)
  );
  /**
   * Analytics: whether the comparison about to appear was opened by a link, and
   * whether that was the Share dialog's Compare form or a compare link.
   */
  const linkSource = () =>
    opensCompared(paramEntries)
      ? openedFrom(navigationState) === "share_dialog"
        ? ("share_dialog" as const)
        : ("link" as const)
      : null;
  const openedFromLink = useRef(linkSource());

  useEffect(() => {
    setEncodedList(paramEntries);
    setCompareClicked(opensCompared(paramEntries));
    openedFromLink.current = linkSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramEntries, navigationKey]);

  const updateEntries = (entries: string[]) => {
    const normalized = entries.flatMap(expandCompareEntry).map((entry) =>
      // Store pasted share links as plain slugs once they decode.
      decodeCompareSlug(entry) ? normalizeCompareEntry(entry) : entry
    );
    setEncodedList(normalized);
    const newParams = new URLSearchParams();
    normalized.forEach((entry) => newParams.append("encoded", entry));
    const query = newParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  };

  // Decode each entry; null for entries that aren't a valid slug or share link.
  const decoded = useMemo(
    () => encodedList.map((entry) => decodeCompareSlug(entry)),
    [encodedList]
  );

  const valid = useMemo(
    () => decoded.filter((d): d is DecodedCompareSlug => d !== null),
    [decoded]
  );

  // Label for each input: the decoded menu title, if any.
  const inputTitles = useMemo(
    () =>
      decoded.map((d) =>
        d ? [d.person?.name, d.title].filter(Boolean).join(" — ") : ""
      ),
    [decoded]
  );

  const errors = useMemo(
    () =>
      decoded.map((d) =>
        d ? undefined : "Not a valid menu slug or share link"
      ),
    [decoded]
  );

  // One column per successfully decoded menu, in input order.
  // Column headings: the person's name when the link has one, else the menu title.
  const legendTitles = useMemo(
    () => valid.map((d) => d.person?.name || d.title),
    [valid]
  );

  const comparison = useMemo(() => {
    if (valid.length === 0) return {} as MenuComparison;
    return compareMenus(valid.map((d) => d.menu));
  }, [valid]);

  const canCompare = valid.length >= 2;
  const showComparison = compareClicked && canCompare;

  // Analytics: each time a comparison appears (from a shared compare link or the
  // Compare button), with its size and how many conflicts it has.
  useEffect(() => {
    if (!showComparison) return;
    const items = Object.values(comparison).flat();
    track("comparison_shown", {
      menu_count: valid.length,
      source: openedFromLink.current ?? "button",
      item_count: items.length,
      conflict_count: countByFilter(comparison).conflict,
    });
    openedFromLink.current = null;
    // Only when it appears, not on every edit of the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComparison]);

  return (
    <ComparePage
      comparison={comparison}
      titles={inputTitles}
      encoded={encodedList}
      errors={errors}
      legendTitles={legendTitles}
      showComparison={showComparison}
      canCompare={canCompare}
      onChangeCompared={updateEntries}
      onCompare={() => setCompareClicked(true)}
      discussLink={canCompare ? `/discuss?${menuParams(encodedList)}` : undefined}
      saveControls={canCompare ? <SaveComparison entries={encodedList} /> : undefined}
    />
  );
};

/** `encoded=…&encoded=…` for every entry that decodes (for compare/discuss links). */
const menuParams = (entries: string[]) => {
  const params = new URLSearchParams();
  for (const entry of entries) {
    if (decodeCompareSlug(entry)) params.append("encoded", normalizeCompareEntry(entry));
  }
  return params.toString();
};

/**
 * Conversations and "Talk it through" (spec §7b, §7c), with the AI coach for
 * supporters (docs/spec/coach.md): it signs its requests with sync's keys.
 */
const WrappedTalkRoute = () => {
  const { state } = useSync();
  const runtime = useSyncRuntime();
  // Recomputed whenever sync's state changes, which includes the moment the runtime
  // has its keys (the status can be known from storage before then).
  const coach = useMemo(() => {
    const authorize = isSupporter(state) ? runtime?.authorizer() : null;
    return authorize ? createCoachClient({ origin: "", authorize }) : undefined;
  }, [state, runtime]);
  return <TalkRoute coach={coach} />;
};

/**
 * Main application component.
 *
 * Contains the main nav bar and routes to the various pages.
 *
 * This component also handles storage/retrieval from browser local storage of stored
 * relationship menu documents.
 */
export const App = () => {
  const landingPage = useMemo(() => <WrappedLandingPage />, []);
  const libraryPage = useMemo(() => <WrappedLibraryPage />, []);
  const menuPage = useMemo(() => <MenuRoute />, []);
  const comparePage = useMemo(() => <WrappedComparePage />, []);

  const location = useLocation();

  // The page before this one (origin + path), reported as this page's referrer.
  const previousPage = useRef<string | null>(null);
  useEffect(() => {
    // Report the page path only. The query string holds the menu itself (including
    // the person's answers) and must never be sent to analytics.
    const page = window.location.origin + location.pathname;
    // Every later event reports this page, not the one the app was first loaded on
    // (index.html's config). The first page keeps the referrer index.html set.
    const referrer = previousPage.current;
    window.gtag?.("set", {
      page_location: page,
      ...(referrer && referrer !== page ? { page_referrer: referrer } : {}),
    });
    window.gtag?.("event", "page_view", {
      page_path: location.pathname,
      page_location: page,
    });
    previousPage.current = page;
  }, [location.pathname]);

  return (
    <div className="app">
      <Navbar
        title="Relationship Menu"
        links={[
          { to: "/library", text: "Library" },
          { to: "/menu", text: "New menu" },
          { to: "/compare", text: "Compare" },
          ...(platform().support ? [{ to: "/support", text: "Support", state: { supportFrom: "nav" } }] : []),
        ]}
      />
      <Routes>
        <Route path="/" element={landingPage} />
        <Route path="/library" element={libraryPage} />
        <Route path="/menu" element={menuPage} />
        <Route path="/compare" element={comparePage} />
        <Route path="/discuss" element={<WrappedTalkRoute />} />
        <Route path="/talk" element={<WrappedTalkRoute />} />
        {platform().support && <Route path="/support" element={<SupportPage />} />}
        <Route path="/sync" element={<SyncSettingsRoute />} />
        <Route path="/pair" element={<PairPage />} />
        <Route path="/about" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};
