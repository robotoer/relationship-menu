import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { CoachError } from "../coach";
import { encodeMenuSlug } from "../compare-slug";
import { Conversation, loadConversation, newConversation, saveConversation } from "../conversation";
import { DiscussPage } from "./Discuss";

const MENUS = [
  encodeMenuSlug(
    "Ana's",
    { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "must-have", note: "two, someday" }, { item: "Pets", value: "like-to-have" }] },
    { name: "Ana" }
  ),
  encodeMenuSlug("Ben's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "off-limits" }, { item: "Pets", value: "maybe" }] }, { name: "Ben" }),
];
const ID = "TestConversationId0000";
const saved = () => loadConversation(ID)!;

/** The page with its state saved like the real route does. */
const Harness = ({ coach, seen = 0 }: { coach?: Parameters<typeof DiscussPage>[0]["coach"]; seen?: number }) => {
  const [c, setC] = useState<Conversation>(() => loadConversation(ID) ?? newConversation(MENUS, 1000, ID));
  const [me, setMe] = useState<number | null>(null);
  return (
    <DiscussPage
      conversation={c}
      onChange={(next) => {
        saveConversation(next);
        setC(next);
      }}
      names={["Ana", "Ben"]}
      compareLink="/compare?x"
      coach={coach}
      me={me}
      onMe={setMe}
      seen={seen}
    />
  );
};

const renderPage = (coach?: Parameters<typeof DiscussPage>[0]["coach"], seen?: number) =>
  render(
    <MemoryRouter>
      <Harness coach={coach} seen={seen} />
    </MemoryRouter>
  );
const answers = () => within(document.querySelector(".discuss-answers") as HTMLElement);

describe("DiscussPage (DS-1..DS-8)", () => {
  const gtag = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    gtag.mockReset();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
  });
  afterAll(() => {
    delete (window as unknown as { gtag?: typeof gtag }).gtag;
  });

  it("starts with the plan and ground rules (DS-1)", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Talk it through" })).toBeInTheDocument();
    expect(screen.getByText(/Ana & Ben: 3 topics/)).toBeInTheDocument();
    expect(within(document.querySelector(".discuss-rules") as HTMLElement).getByText(/Take turns/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the comparison" })).toHaveAttribute("href", "/compare?x");
  });

  it("goes through topics with answers, prompts, notes and an outcome, saved as you go (DS-4, DS-5)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
    expect(gtag).toHaveBeenCalledWith("event", "discussion_started", { topic_count: 3, menu_count: 2, resumed: false });

    // Shared ground first.
    expect(screen.getByRole("heading", { level: 1, name: "Kissing" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    // Then the difference, then the conflict.
    expect(screen.getByRole("heading", { level: 1, name: "Pets" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Kids" })).toBeInTheDocument();
    expect(answers().getByText(/Ana/).closest("li")).toHaveTextContent('Ana: Must Have"two, someday"');
    expect(screen.getByText("Talk about").nextElementSibling?.querySelectorAll("li").length).toBeGreaterThan(1);

    fireEvent.change(screen.getByRole("textbox", { name: "What came up?" }), { target: { value: "Ben is sure" } });
    fireEvent.click(screen.getByRole("radio", { name: /Boundary/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Next step (optional)" }), { target: { value: "Revisit in a year" } });
    expect(Object.values(saved().topics)).toEqual([
      expect.objectContaining({ note: "Ben is sure", outcome: "boundary", followUp: "Revisit in a year", comments: [] }),
    ]);

    // Finish shows the summary, grouped by outcome.
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Your discussion" })).toBeInTheDocument();
    const boundary = screen.getByRole("heading", { name: /Boundary/ }).closest("section")!;
    expect(within(boundary).getByText("Kids")).toBeInTheDocument();
    expect(within(boundary).getByText("Ben is sure")).toBeInTheDocument();
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "discussion_summary_viewed",
      expect.objectContaining({ topic_count: 3, covered_count: 1, boundary: 1 })
    );
  });

  it("copies the summary as text (DS-7)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
    fireEvent.click(screen.getByRole("radio", { name: /Agreed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await screen.findByRole("button", { name: "Copied!" });
    expect(writeText.mock.calls[0][0]).toContain("## Agreed");
    expect(writeText.mock.calls[0][0]).toContain("**Kissing**");
  });

  it("offers to continue where you left off (DS-6)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
    fireEvent.click(screen.getByRole("radio", { name: /Agreed/ }));
    // Come back later: a fresh page load reads the saved notes.
    document.body.innerHTML = "";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Continue \(1 of 3 done\)/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Pets" })).toBeInTheDocument();
  });

  it("the AI teaser records interest and says nothing was sent (DS-8)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Prepare this conversation with AI/ }));
    expect(gtag).toHaveBeenCalledWith("event", "ai_prep_interest", {});
    expect(screen.getByRole("status")).toHaveTextContent("Nothing about your menus was sent");
  });

  it("always shows that it isn't therapy, with crisis resources (CO-11)", () => {
    renderPage();
    expect(screen.getByRole("complementary", { name: "Not therapy" })).toHaveTextContent("988");
  });

  describe("AI coach (CO-9, CO-10)", () => {
    const guide = {
      opening: "You both chose to have this talk.",
      closing: "Thank you both.",
      topics: [{ id: "t2", about: "A firm difference about kids.", questions: ["What's behind your answer?", "What would respecting the no look like?"] }],
    };

    it("shows exactly what's sent and needs everyone's agreement before sending", async () => {
      const coach = vi.fn(async () => guide);
      renderPage(coach);
      fireEvent.click(screen.getByRole("button", { name: /Prepare this conversation with AI/ }));
      const consent = screen.getByRole("region", { name: "AI coach" });
      expect(within(consent).getByText("Kids (G): Person 1 Must have, Person 2 Off limits")).toBeInTheDocument();
      // Names and menu notes are never part of what's sent.
      expect(consent.querySelector(".discuss-consent-list")?.textContent).not.toMatch(/Ana|Ben|someday/);
      const send = within(consent).getByRole("button", { name: "Prepare questions" });
      expect(send).toBeDisabled();
      fireEvent.click(within(consent).getByRole("checkbox", { name: /Everyone taking part agrees/ }));
      fireEvent.click(send);
      await screen.findByText("You both chose to have this talk.");
      expect(coach).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(coach.mock.calls[0])).not.toMatch(/Ana|Ben|someday/);
      expect(gtag).toHaveBeenCalledWith("event", "coach_requested", { topic_count: 3, people: 2 });
      expect(gtag).toHaveBeenCalledWith("event", "coach_result", { outcome: "ok" });
    });

    it("shows the suggestions on their topic, and keeps them with the notes", async () => {
      renderPage(async () => guide);
      fireEvent.click(screen.getByRole("button", { name: /Prepare this conversation with AI/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Everyone taking part agrees/ }));
      fireEvent.click(screen.getByRole("button", { name: "Prepare questions" }));
      await screen.findByText("You both chose to have this talk.");
      expect(saved().coach?.opening).toBe("You both chose to have this talk.");

      fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
      fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
      fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
      expect(screen.getByRole("heading", { level: 1, name: "Kids" })).toBeInTheDocument();
      const suggested = screen.getByRole("region", { name: "Suggested by the AI coach" });
      expect(suggested).toHaveTextContent("A firm difference about kids.");
      expect(suggested).toHaveTextContent("What would respecting the no look like?");
      expect(screen.getByRole("heading", { name: "More to talk about" })).toBeInTheDocument();

      // Other topics just show the built-in prompts.
      fireEvent.click(screen.getByRole("button", { name: /Back/ }));
      expect(screen.queryByRole("region", { name: "Suggested by the AI coach" })).not.toBeInTheDocument();
    });

    it("explains failures and lets you try again", async () => {
      renderPage(async () => {
        throw new CoachError("quota");
      });
      fireEvent.click(screen.getByRole("button", { name: /Prepare this conversation with AI/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Everyone taking part agrees/ }));
      fireEvent.click(screen.getByRole("button", { name: "Prepare questions" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("You've used today's AI preparations");
      expect(gtag).toHaveBeenCalledWith("event", "coach_result", { outcome: "quota" });
      expect(screen.getByRole("button", { name: "Prepare questions" })).toBeEnabled();
    });
  });

  it("shapes the agenda: what you agree on, menu notes hidden until revealed, prompts off (CV-15…CV-17)", () => {
    renderPage();
    expect(screen.getByText(/Ana & Ben: 3 topics/)).toBeInTheDocument();
    const panel = within(screen.getByRole("group", { name: "What's on the agenda" }).closest("details")!);
    // Pets is a difference (Like vs Maybe); taking differences off leaves 2 topics.
    fireEvent.click(panel.getByRole("checkbox", { name: /Talk about it/ }));
    expect(screen.getByText(/Ana & Ben: 2 topics/)).toBeInTheDocument();
    expect(gtag).toHaveBeenCalledWith("event", "conversation_settings_changed", { setting: "include" });
    expect(saved().settings?.include.talk).toBe(false);

    fireEvent.click(panel.getByRole("radio", { name: /Hardest first/ }));
    expect(screen.getByText(/Start with the hardest, while you're fresh/)).toBeInTheDocument();
    fireEvent.click(panel.getByRole("radio", { name: /Easiest first/ }));
    fireEvent.click(panel.getByRole("radio", { name: /Hide until revealed/ }));
    fireEvent.click(panel.getByRole("checkbox", { name: /Show them on each topic/ }));
    fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Kids" })).toBeInTheDocument();
    expect(document.querySelector(".discuss-card")).not.toHaveTextContent("two, someday");
    expect(screen.queryByRole("heading", { name: "Talk about" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show what Ana wrote on their menu" }));
    expect(screen.getByRole("region", { name: "From your menus" })).toHaveTextContent("Ana: “two, someday”");
  });

  describe("conversations (CV-3, CV-4, CV-5, CV-11, CV-13, CV-14)", () => {
    it("shows the plan in parts and saves it with the first change", () => {
      renderPage();
      const plan = screen.getByRole("heading", { name: "The plan" }).nextElementSibling!.nextElementSibling as HTMLElement;
      expect(within(plan).getByRole("textbox", { name: "Name of part 1" })).toHaveValue("G");
      expect(within(plan).getByText(/3 topics · about 12 min · 0 done/)).toBeInTheDocument();
      expect(loadConversation(ID)).toBeNull(); // nothing written yet
      fireEvent.change(within(plan).getByRole("textbox", { name: "Name of part 1" }), { target: { value: "Saturday" } });
      expect(saved().parts.map((p) => p.title)).toEqual(["Saturday"]);
      expect(saved().parts[0].topicKeys).toHaveLength(3);
    });

    it("each area shows insights and takes notes from each person", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
      const area = screen.getByRole("region", { name: "About G" });
      expect(area).toHaveTextContent("You agree on 1 of the 3 items everyone answered here.");
      expect(area).toHaveTextContent(/1 conflict \(someone marked it Off limits\): Kids/);
      expect(area).toHaveTextContent(/Off limits is a complete answer/);
      fireEvent.change(within(area).getByRole("textbox", { name: "Ben: What matters most to me here" }), {
        target: { value: "Being heard" },
      });
      expect(saved().areas.G.people["1"].matters).toBe("Being heard");
      expect(area.closest("details")!.querySelector("summary")).toHaveTextContent("notes from 1 of 2");
      expect(area).toHaveTextContent(/dictat/);
    });

    it("comments are signed by the person using this device and marked new for the others", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
      const comments = screen.getByRole("region", { name: "Comments on Kissing" });
      fireEvent.change(within(comments).getByRole("textbox", { name: "Add a comment" }), { target: { value: "Love this one" } });
      fireEvent.change(within(comments).getByRole("combobox", { name: "Posting as" }), { target: { value: "0" } });
      fireEvent.click(within(comments).getByRole("button", { name: "Add comment" }));
      expect(within(comments).getByText("Love this one")).toBeInTheDocument();
      expect(within(comments).getByText("Ana", { selector: "strong" })).toBeInTheDocument();
      expect(saved().topics[Object.keys(saved().topics)[0]].comments[0]).toMatchObject({ by: 0, text: "Love this one" });
      expect(gtag).toHaveBeenCalledWith("event", "conversation_comment_added", { target: "topic" });
      // Ana can delete her own comment.
      fireEvent.click(within(comments).getByRole("button", { name: /Delete your comment/ }));
      expect(within(comments).queryByText("Love this one")).not.toBeInTheDocument();

      // Ben, on his phone, sees Ana's newer comments as new.
      document.body.innerHTML = "";
      localStorage.clear();
      const c = newConversation(MENUS, 1000, ID);
      saveConversation({ ...c, areas: Object.assign(Object.create(null), { G: { people: Object.create(null), comments: [{ id: "c".repeat(22), by: 0, text: "Can we talk Sunday?", at: 5000 }] } }) });
      renderPage(undefined, 2000);
      expect(screen.getByText(/1 new comment since you last looked/)).toBeInTheDocument();
    });

    it("has tips for hard conversations, with their sources, and one fitting each topic", () => {
      renderPage();
      const tips = screen.getByText("💡 Tips for hard conversations").closest("details")!;
      for (const stage of ["Before you start", "Opening", "Listening", "When it gets heated", "Off limits and boundaries", "Closing", "Between conversations"]) {
        expect(within(tips).getByRole("region", { name: stage })).toBeInTheDocument();
      }
      expect(within(tips).getAllByRole("link").length).toBeGreaterThan(20);
      fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
      expect(document.querySelector(".discuss-card .conv-tip")).toHaveTextContent(/Tip:/);
    });

    it("says how to dictate with the device's own dictation", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "▶ Start" }));
      expect(document.querySelector(".discuss-card")).toHaveTextContent(/To dictate|dictation/);
    });

    it("sends the conversation as a link with everything in its #hash (CV-6)", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
      await screen.findByRole("button", { name: "Copied!" });
      expect(writeText.mock.calls[0][0]).toMatch(/^http:\/\/localhost(:\d+)?\/talk#c=/);
      expect(gtag).toHaveBeenCalledWith("event", "conversation_shared", { method: "copy" });
    });
  });
});
