/**
 * The route for conversations (spec §7c):
 * - `/talk?id=<id>`: a conversation saved in this browser;
 * - `/talk#c=<conversation>`: someone's link, merged into this browser's copy (CV-6, CV-8);
 * - `/discuss?encoded=…&encoded=…`: "Talk it through" from the Compare page, which
 *   opens the saved conversation for those menus or starts a new one (CV-2).
 * A new conversation is saved the first time anything is written in it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CoachClient } from "../coach";
import { DecodedCompareSlug, decodeCompareSlug, encodeMenuSlug, normalizeCompareEntry } from "../compare-slug";
import {
  Conversation,
  adoptOldDiscussion,
  conversationFromLink,
  decodedMenus,
  findConversation,
  loadConversation,
  loadMe,
  loadSeen,
  menuNames,
  mergeConversations,
  mergeNews,
  newConversation,
  replaceMenu,
  saveConversation,
  saveMe,
  saveSeen,
} from "../conversation";
import { useStorage } from "../providers/Storage";
import { track } from "../analytics";
import { DiscussPage, MenuUpdate } from "./Discuss";

type Loaded =
  | { kind: "ok"; conversation: Conversation; saved: boolean; notice?: string; linkMenus?: string[] }
  | { kind: "missing" }
  | { kind: "broken" }
  | { kind: "too-few" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Works out which conversation the address is about. */
const resolve = (hash: string, id: string | null, entries: string[]): Loaded => {
  if (hash.includes("c=")) {
    const shared = conversationFromLink(hash);
    if (!shared) return { kind: "broken" };
    const local = loadConversation(shared.id);
    const merged = local ? mergeConversations(local, shared) : shared;
    saveConversation(merged);
    const news = local ? mergeNews(local, merged) : null;
    track("conversation_merged", news ?? { comments: 0, notes: 0, menus: 0 });
    const notice = !local
      ? "This conversation is now saved in this browser. Add your notes and comments, then send it back."
      : news && news.comments + news.notes + news.menus > 0
        ? `Brought up to date: ${[
            news.comments && plural(news.comments, "new comment"),
            news.notes && plural(news.notes, "changed note"),
            news.menus && plural(news.menus, "newer menu"),
          ]
            .filter(Boolean)
            .join(", ")}.`
        : "You already had everything in this link.";
    return { kind: "ok", conversation: merged, saved: true, notice };
  }
  if (id) {
    const c = loadConversation(id);
    return c ? { kind: "ok", conversation: c, saved: true } : { kind: "missing" };
  }
  const valid = entries
    .map((e) => normalizeCompareEntry(e))
    .filter((e) => decodeCompareSlug(e) !== null);
  if (valid.length < 2) return { kind: "too-few" };
  const decoded = valid.map((e) => decodeCompareSlug(e)!);
  const existing = findConversation(decoded);
  if (existing) return { kind: "ok", conversation: existing, saved: true, linkMenus: valid };
  // Notes from before conversations existed move in (and the conversation is saved then).
  const fresh = newConversation(valid);
  const adopted = adoptOldDiscussion(fresh);
  return { kind: "ok", conversation: adopted, saved: adopted !== fresh };
};

/** Library menus (or the link's menus) that are newer versions of the compared ones (CV-7). */
const findMenuUpdates = (
  conversation: Conversation,
  library: { title: string; encoded: string; person?: DecodedCompareSlug["person"] }[],
  linkMenus: string[] = []
): MenuUpdate[] => {
  const slots = conversation.menus.map((m) => ({ slug: m.slug, d: decodeCompareSlug(m.slug) }));
  const same = (a?: DecodedCompareSlug | null, b?: DecodedCompareSlug | null) =>
    !!a && !!b && a.title === b.title && (a.person?.name ?? "") === (b.person?.name ?? "");
  const names = menuNames(decodedMenus(conversation));
  const candidates = [
    ...linkMenus,
    ...library.map((doc) => encodeMenuSlug(doc.title, doc.encoded, doc.person)),
  ];
  const updates: MenuUpdate[] = [];
  for (const slug of candidates) {
    const d = decodeCompareSlug(slug);
    const matching = slots.map((s, i) => (same(s.d, d) ? i : -1)).filter((i) => i !== -1);
    // Only when it clearly belongs to one person's slot, and differs from it.
    if (matching.length !== 1) continue;
    const index = matching[0];
    if (slots[index].slug === slug || updates.some((u) => u.index === index)) continue;
    updates.push({ index, name: names[index], slug });
  }
  return updates;
};

export const TalkRoute = ({ coach }: { coach?: CoachClient }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { documents } = useStorage();
  const entries = useMemo(() => params.getAll("encoded"), [params]);
  const id = params.get("id");

  const [loaded, setLoaded] = useState<Loaded>(() => resolve(location.hash, id, entries));
  // Re-resolve when the address changes from outside (a link, back/forward).
  const lastKey = useRef(location.key);
  const selfNavigation = useRef(false);
  useEffect(() => {
    if (lastKey.current === location.key) return;
    lastKey.current = location.key;
    if (selfNavigation.current) {
      selfNavigation.current = false;
      return;
    }
    setLoaded(resolve(location.hash, id, entries));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const conversationId = loaded.kind === "ok" ? loaded.conversation.id : null;
  const [me, setMe] = useState<number | null>(() => (conversationId ? loadMe(conversationId) : null));
  // When this device last looked, read once per conversation (before it's updated below).
  const seenFor = useRef<{ id: string; at: number } | null>(null);
  if (conversationId && seenFor.current?.id !== conversationId) {
    seenFor.current = { id: conversationId, at: loadSeen(conversationId) };
  }
  const seen = seenFor.current?.at ?? 0;
  useEffect(() => {
    if (!conversationId) return;
    setMe(loadMe(conversationId));
    // What's here now counts as seen next time.
    saveSeen(conversationId, Date.now());
  }, [conversationId]);

  // A link's conversation is saved now: show it at its own address (and drop the
  // payload from the address bar and history).
  useEffect(() => {
    if (loaded.kind === "ok" && loaded.saved && !id) {
      selfNavigation.current = true;
      navigate(`/talk?id=${loaded.conversation.id}`, { replace: true, state: location.state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (loaded.kind !== "ok") {
    const message = {
      missing: "This conversation isn't saved in this browser. It may have been deleted, or saved in another browser.",
      broken: "This conversation link is damaged or incomplete. Ask for it to be sent again.",
      "too-few": "A conversation needs two or more menus. Add them on the Compare page first.",
    }[loaded.kind];
    return (
      <div className="discuss-page">
        <h1>Talk it through</h1>
        <p>{message}</p>
        <div className="discuss-actions">
          <Link className="button" to="/compare">
            Go to Compare
          </Link>
          <Link className="button" to="/library">
            Your Library
          </Link>
        </div>
      </div>
    );
  }

  const { conversation } = loaded;
  const names = menuNames(decodedMenus(conversation));
  const compareParams = new URLSearchParams();
  conversation.menus.forEach((m) => compareParams.append("encoded", m.slug));
  const compareLink = `/compare?${compareParams.toString()}`;

  const onChange = (next: Conversation) => {
    if (!saveConversation(next)) return;
    if (!loaded.saved) track("conversation_saved", { source: "talk" });
    setLoaded({ ...loaded, conversation: next, saved: true });
  };

  return (
    <DiscussPage
      key={conversation.id}
      conversation={conversation}
      onChange={onChange}
      names={names}
      compareLink={compareLink}
      coach={coach}
      me={me}
      onMe={(person) => {
        setMe(person);
        saveMe(conversation.id, person);
      }}
      seen={seen}
      notice={loaded.notice}
      menuUpdates={findMenuUpdates(conversation, Object.values(documents), loaded.linkMenus)}
      onUseMenu={(u) => onChange(replaceMenu(conversation, u.index, u.slug))}
    />
  );
};
