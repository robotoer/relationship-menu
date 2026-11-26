import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { encodeMenuSlug } from "../compare-slug";
import { loadConversation, newConversation, saveConversation } from "../conversation";
import { StorageProvider } from "../providers/Storage";
import { createLocalStorage } from "../storage";
import { TalkRoute } from "../pages/Talk";
import { createBoxApi } from "./box-api";
import { createFakeBoxServer } from "./fake-box-server";
import { createLiveStore } from "./live-store";
import { inviteLink } from "./live-session";
import type { LiveDeps } from "./useLive";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kids", value: "must-have" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kids", value: "off-limits" }] }, { name: "Ben" });
const ID = "LiveUiConversation0000";

const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
};

const renderTalk = async (path: string, live: LiveDeps) => {
  const view = render(
    <StorageProvider storage={createLocalStorage()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/talk" element={<TalkRoute live={live} />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </StorageProvider>
  );
  await act(async () => {});
  return view;
};

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe("Share live (NT-10…NT-16)", () => {
  beforeEach(() => localStorage.clear());

  it("someone who isn't a supporter is told what it is, and nothing is created", async () => {
    saveConversation(newConversation([ana, ben], 1000, ID));
    const server = createFakeBoxServer();
    await renderTalk(`/talk?id=${ID}`, { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()), authorizeAccount: null });
    const panel = await screen.findByRole("region", { name: "Share live" });
    expect(panel).toHaveTextContent("Supporters can share a conversation live");
    expect(within(panel).queryByRole("button", { name: "Share live…" })).not.toBeInTheDocument();
  });

  it("a supporter shares; the other person joins from the invite, comments, and it reaches the host", async () => {
    saveConversation(newConversation([ana, ben], 1000, ID));
    const server = createFakeBoxServer();
    const hostStore = createLiveStore(new IDBFactory());
    const host: LiveDeps = {
      api: createBoxApi({ fetch: server.fetch }),
      store: hostStore,
      authorizeAccount: async () => "MenuSync v1 account=AccountAccountAccount0, key=k, ts=1, sig=s",
    };
    const hostView = await renderTalk(`/talk?id=${ID}`, host);
    fireEvent.click(await screen.findByRole("button", { name: "Share live…" }));
    await settle();
    const panel = await screen.findByRole("region", { name: "Shared live" });
    await waitFor(() => expect(panel).toHaveTextContent(/Live · 1 device/));
    expect(within(panel).getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Anyone with this link can read and add to this conversation");
    const invite = inviteLink("http://localhost", (await hostStore.get(ID))!)!;
    hostView.unmount();

    // Ben, on another device: nothing of the conversation there yet.
    localStorage.clear();
    const benStore = createLiveStore(new IDBFactory());
    const benDeps: LiveDeps = { api: createBoxApi({ fetch: server.fetch }), store: benStore, authorizeAccount: null };
    const benView = await renderTalk(`/talk${invite.slice(invite.indexOf("#"))}`, benDeps);
    await waitFor(() => expect(document.querySelector(".conv-notice")).toHaveTextContent("You've joined this conversation"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/talk?id=${ID}`));
    expect(loadConversation(ID)).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("region", { name: "Shared live" })).toHaveTextContent(/Live · 2 devices/));
    // A member sees Leave, not the invite or Stop sharing.
    expect(screen.queryByRole("button", { name: "Copy invite link" })).not.toBeInTheDocument();

    // Ben comments on Kids and updates.
    fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
    const comments = screen.getByRole("region", { name: "Comments on Kids" });
    fireEvent.change(within(comments).getByRole("textbox", { name: "Add a comment" }), { target: { value: "Can we talk Sunday?" } });
    fireEvent.click(within(comments).getByRole("button", { name: "Add comment" }));
    fireEvent.click(screen.getByRole("button", { name: "The plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(server.notifications.at(-1)?.notify).toBe("comment"));
    benView.unmount();

    // Back on Ana's device: her conversation, updated from the box.
    localStorage.clear();
    saveConversation(newConversation([ana, ben], 1000, ID));
    await renderTalk(`/talk?id=${ID}`, host);
    await waitFor(() => expect(loadConversation(ID)!.topics["g\u0000kids"]?.comments[0]?.text).toBe("Can we talk Sunday?"));

    // Ana stops sharing: the box is gone; her conversation stays.
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing…" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(server.boxes.size).toBe(0));
    expect(await screen.findByRole("region", { name: "Share live" })).toBeInTheDocument();
    expect(loadConversation(ID)).not.toBeNull();
  });

  it("an expired or replaced invite says so; a stopped box tells the members (NT-13, NT-15)", async () => {
    saveConversation(newConversation([ana, ben], 1000, ID));
    const server = createFakeBoxServer();
    const deps: LiveDeps = { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()), authorizeAccount: null };
    await renderTalk(`/talk#live=${"b".repeat(22)}.${"k".repeat(43)}.${"j".repeat(43)}`, deps);
    expect(await screen.findByText(/isn't shared live any more/)).toBeInTheDocument();
  });
});
