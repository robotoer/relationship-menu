import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { encodeMenuSlug } from "../compare-slug";
import {
  addComment,
  conversationLink,
  listConversations,
  loadConversation,
  newConversation,
  saveConversation,
  updateTopic,
} from "../conversation";
import { discussionKey } from "../discussion";
import { decodeCompareSlug } from "../compare-slug";
import { StorageProvider } from "../providers/Storage";
import { createLocalStorage } from "../storage";
import { TalkRoute } from "./Talk";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "must-have" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "off-limits" }] }, { name: "Ben" });
const ID = "TalkTestConversation00";

const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
};
const open = async (path: string) => {
  render(
    <StorageProvider storage={createLocalStorage()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/talk" element={<TalkRoute />} />
          <Route path="/discuss" element={<TalkRoute />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </StorageProvider>
  );
  await act(async () => {});
};

describe("conversation route (spec §7c)", () => {
  beforeEach(() => localStorage.clear());

  it("CV-2: Talk it through from Compare starts a conversation, saved with the first note", async () => {
    await open(`/discuss?encoded=${encodeURIComponent(ana)}&encoded=${encodeURIComponent(ben)}`);
    expect(screen.getByRole("heading", { level: 1, name: "Talk it through" })).toBeInTheDocument();
    expect(listConversations()).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Conversation name" }), { target: { value: "Our talk" } });
    const [c] = listConversations();
    expect(c.title).toBe("Our talk");
    expect(screen.getByTestId("where")).toHaveTextContent(`/talk?id=${c.id}`);
  });

  it("CV-2: the same menus open the same saved conversation", async () => {
    saveConversation({ ...newConversation([ana, ben], 1000, ID), title: "Saved one" });
    await open(`/discuss?encoded=${encodeURIComponent(ana)}&encoded=${encodeURIComponent(ben)}`);
    expect(screen.getByRole("textbox", { name: "Conversation name" })).toHaveValue("Saved one");
    expect(screen.getByTestId("where")).toHaveTextContent(`/talk?id=${ID}`);
  });

  it("CV-10: notes from before conversations existed move in, then the old entry goes", async () => {
    const key = discussionKey([decodeCompareSlug(ana)!, decodeCompareSlug(ben)!]);
    const topicKey = "g\u0000kids";
    localStorage.setItem(key, JSON.stringify({ version: 1, startedAt: 1, updatedAt: 2, topics: { [topicKey]: { note: "old note", outcome: "revisit" } } }));
    await open(`/discuss?encoded=${encodeURIComponent(ana)}&encoded=${encodeURIComponent(ben)}`);
    const [c] = listConversations();
    expect(c.topics[topicKey]).toMatchObject({ note: "old note", outcome: "revisit" });
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByRole("button", { name: /Continue \(1 of 2 done\)/ })).toBeInTheDocument();
  });

  it("CV-6, CV-8: someone's link is saved, or merged into the copy here, and leaves the address", async () => {
    const mine = updateTopic(newConversation([ana, ben], 1000, ID), "g\u0000kissing", { note: "mine" }, 2000);
    saveConversation(mine);
    const theirs = addComment(newConversation([ana, ben], 1000, ID), { topic: "g\u0000kids" }, 1, "Can we talk Sunday?", 3000, "c".repeat(22));
    await open(conversationLink("", theirs).replace(/^\//, "/"));
    expect(document.querySelector(".conv-notice")).toHaveTextContent("Brought up to date: 1 new comment.");
    expect(screen.getByText(/1 new comment since you last looked/)).toBeInTheDocument();
    const merged = loadConversation(ID)!;
    expect(merged.topics["g\u0000kissing"].note).toBe("mine");
    expect(merged.topics["g\u0000kids"].comments[0].text).toBe("Can we talk Sunday?");
    expect(screen.getByTestId("where")).toHaveTextContent(`/talk?id=${ID}`);
    expect(screen.getByTestId("where")).not.toHaveTextContent("#c=");
  });

  it("CV-6: a link to a conversation this browser doesn't have is saved here", async () => {
    await open(conversationLink("", newConversation([ana, ben], 1000, ID)));
    expect(document.querySelector(".conv-notice")).toHaveTextContent("now saved in this browser");
    expect(loadConversation(ID)).not.toBeNull();
  });

  it("CV-9: a damaged link, or an unknown id, says so", async () => {
    await open("/talk#c=garbage");
    expect(screen.getByText(/damaged or incomplete/)).toBeInTheDocument();
    document.body.innerHTML = "";
    await open("/talk?id=NotSavedHere0000000000");
    expect(screen.getByText(/isn't saved in this browser/)).toBeInTheDocument();
  });

  it("CV-7: offers a newer version of a compared menu saved in this browser", async () => {
    saveConversation(newConversation([ana, ben], 1000, ID));
    // Ben's newer menu, saved in this browser's Library.
    const storage = createLocalStorage();
    const newer = encodeMenuSlug("Ben's", { G: [{ item: "Kids", value: "maybe" }] }).split(":")[1];
    await storage.saveDocuments({ title: "Ben's", encoded: newer, person: { name: "Ben" } });
    await open(`/talk?id=${ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Use the latest version" }));
    expect(decodeCompareSlug(loadConversation(ID)!.menus[1].slug)!.menu.G[0]).toMatchObject({ item: "Kids", value: "maybe" });
  });
});
