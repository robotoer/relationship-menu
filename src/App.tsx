import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
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
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData, encodeData } from "./data-encoder";
import { MenuComparison } from "./model/compare";
import { useStorage } from "./providers/Storage";
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
import { countByFilter } from "./compare-filters";
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
        id: encodeMenuSlug(doc.title, doc.encoded, doc.person),
      })),
    [documentsMap]
  );
  return <LibraryPage menus={documents} onDelete={deleteDocument} />;
};

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

/** "Title (2)", "Title (3)", ... — the first that isn't already a saved menu's title. */
const uniqueTitle = (title: string, saved: { [title: string]: unknown }) => {
  for (let n = 2; ; n++) {
    const candidate = `${title || "Untitled"} (${n})`;
    if (!Object.prototype.hasOwnProperty.call(saved, candidate)) return candidate;
  }
};

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
  // The title this editor's menu is saved under (set when a menu is loaded or first
  // saved). Renaming saves under the new title and removes this entry.
  const ownedTitle = useRef<string | null>(null);
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();

  // The link this page was opened with. Captured once: the URL is rewritten as the
  // menu is edited, and must not be read back as a new menu to load.
  const initialEncoded = useRef(params.get("encoded"));
  // Whether an in-app link (the Library) opened it, for analytics. Also captured once.
  const location = useLocation();
  const fromLibrary = useRef(openedFrom(location.state) === "library");
  // False until the opened link (if any) has been loaded.
  const [loaded, setLoaded] = useState(!initialEncoded.current);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the menu from the link. Two formats:
  // 1. "titleEncoded:menuEncoded" — self-contained link (all data in URL)
  // 2. A document ID (the title) — looked up in this browser's storage
  // The "loaded" guard is only set once the menu has actually been applied, so a load
  // cancelled by React StrictMode is retried rather than lost.
  useEffect(() => {
    const raw = initialEncoded.current;
    if (!raw || loadedFromUrl.current) return;
    let cancelled = false;
    (async () => {
      let opened: DecodedCompareSlug | null = null;
      let notFound = false;
      try {
        if (raw.includes(":")) {
          opened = decodeCompareSlug(raw);
        } else {
          const doc = (await storage.getDocuments(raw))[raw];
          notFound = !doc;
          opened = doc
            ? decodeCompareSlug(encodeMenuSlug(doc.title, doc.encoded, doc.person))
            : null;
        }
      } catch (e) {
        console.error("Failed to open menu link:", e);
      }
      if (cancelled) return;
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
      // open it as a copy with a free title instead.
      const saved = await storage.getDocuments();
      if (cancelled) return;
      loadedFromUrl.current = true;
      const existing = Object.prototype.hasOwnProperty.call(saved, opened.title)
        ? saved[opened.title]
        : undefined;
      let openedTitle = opened.title;
      if (existing && !sameMenu(existing.encoded, opened.menu)) {
        openedTitle = uniqueTitle(opened.title, saved);
        setNotice(
          `You already have a menu called "${opened.title}", so this link was opened as "${openedTitle}". Rename it any time.`
        );
        ownedTitle.current = null;
      } else {
        setNotice(null);
        ownedTitle.current = opened.title;
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
          own_menu: !!existing && openedTitle === opened.title,
          opened_as_copy: openedTitle !== opened.title,
          item_count: items.length,
        });
      }
      setPerson(opened.person ?? (openedTitle === opened.title ? existing?.person : undefined) ?? {});
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
  const titleTaken =
    title !== ownedTitle.current &&
    Object.prototype.hasOwnProperty.call(documents, title);
  const docToSave = useMemo(
    () =>
      !loaded || titleTaken || (title === "" && Object.keys(menu).length === 0)
        ? null
        : {
            title,
            encoded: encodeData(stripMenuIds(menu)),
            ...(sanitizePerson(person) ? { person: sanitizePerson(person) } : {}),
          },
    [title, menu, person, titleTaken, loaded]
  );
  const saveState = useAutosave(docToSave, async (doc) => {
    // The storage provider reports failures by returning no IDs; treat that as an
    // error so a failed rename never goes on to delete the menu's old entry.
    const now = Date.now();
    createdAt.current ??= now;
    const ids = await storage.saveDocuments({
      ...doc,
      createdAt: createdAt.current,
      updatedAt: now,
    });
    if (ids.length === 0) throw new Error("Saving the menu failed");
    const previous = ownedTitle.current;
    ownedTitle.current = doc.title;
    if (previous !== null && previous !== doc.title) {
      await storage.deleteDocument(previous);
    }
  });

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
          const taken = Object.prototype.hasOwnProperty.call(documents, template.name);
          setTitle(taken ? uniqueTitle(template.name, documents) : template.name);
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
    />
  );
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
          { to: "/support", text: "Support", state: { supportFrom: "nav" } },
        ]}
      />
      <Routes>
        <Route path="/" element={landingPage} />
        <Route path="/library" element={libraryPage} />
        <Route path="/menu" element={menuPage} />
        <Route path="/compare" element={comparePage} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/about" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};
