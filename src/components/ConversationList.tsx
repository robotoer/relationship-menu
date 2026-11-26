import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Conversation,
  conversationAgenda,
  decodedMenus,
  deleteConversation,
  listConversations,
  loadMe,
  loadSeen,
  menuNames,
  unreadComments,
} from "../conversation";
import { track } from "../analytics";

const covered = (c: Conversation) =>
  conversationAgenda(c).filter((t) => {
    const r = c.topics[t.key];
    return !!r && (!!r.outcome || !!r.note?.trim() || !!r.followUp?.trim());
  }).length;

/** Saved conversations, in the Library (spec CV-1). */
export const ConversationList = () => {
  const [conversations, setConversations] = useState(listConversations);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (conversations.length === 0) return null;
  return (
    <section className="library-conversations" aria-labelledby="library-conversations-title">
      <h2 id="library-conversations-title">Your conversations</h2>
      <p>Comparisons you've saved or talked through, with their plans, notes and comments.</p>
      <ul>
        {conversations.map((c) => {
          const total = conversationAgenda(c).length;
          const unread = unreadComments(c, loadMe(c.id), loadSeen(c.id));
          const parts = c.parts.length;
          return (
            <li key={c.id} className="library-conversation">
              <Link to={`/talk?id=${c.id}`} className="library-conversation-title">
                {c.title || menuNames(decodedMenus(c)).join(" & ")}
              </Link>
              <span className="library-conversation-meta">
                {menuNames(decodedMenus(c)).join(", ")} · {covered(c)} of {total} topics talked through
                {parts > 0 && ` · ${c.parts.filter((p) => p.done).length} of ${parts} parts done`} · updated{" "}
                {new Date(c.updatedAt).toLocaleDateString()}
                {unread > 0 && <strong className="conv-new"> · {unread} new comment{unread === 1 ? "" : "s"}</strong>}
              </span>
              {confirming === c.id ? (
                <span className="library-conversation-confirm">
                  Delete this conversation and its notes from this browser?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      deleteConversation(c.id);
                      track("conversation_deleted");
                      setConversations(listConversations());
                      setConfirming(null);
                    }}
                  >
                    Delete
                  </button>{" "}
                  <button type="button" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="delete-menu-button" aria-label={`Delete conversation ${c.title}`} onClick={() => setConfirming(c.id)}>
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
