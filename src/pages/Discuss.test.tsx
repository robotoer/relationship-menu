import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { compareMenus } from "../data-comparer";
import { buildAgenda, loadDiscussion } from "../discussion";
import { CoachError } from "../coach";
import { DiscussPage } from "./Discuss";

const agenda = buildAgenda(
  compareMenus([
    { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "must-have", note: "two, someday" }, { item: "Pets", value: "like-to-have" }] },
    { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "off-limits" }, { item: "Pets", value: "maybe" }] },
  ])
);
const KEY = "discussion:test";

const renderPage = (coach?: Parameters<typeof DiscussPage>[0]["coach"]) =>
  render(
    <MemoryRouter>
      <DiscussPage agenda={agenda} names={["Ana", "Ben"]} recordKey={KEY} compareLink="/compare?x" coach={coach} />
    </MemoryRouter>
  );

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
    expect(screen.getByText(/Take turns/)).toBeInTheDocument();
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
    expect(screen.getByText(/Ana/).closest("li")).toHaveTextContent('Ana: Must Have"two, someday"');
    expect(screen.getByText("Talk about").nextElementSibling?.querySelectorAll("li").length).toBeGreaterThan(1);

    fireEvent.change(screen.getByRole("textbox", { name: "What came up?" }), { target: { value: "Ben is sure" } });
    fireEvent.click(screen.getByRole("radio", { name: /Boundary/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Next step (optional)" }), { target: { value: "Revisit in a year" } });
    const saved = loadDiscussion(KEY)!;
    expect(Object.values(saved.topics)).toEqual([{ note: "Ben is sure", outcome: "boundary", followUp: "Revisit in a year" }]);

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
      expect(loadDiscussion(KEY)?.coach?.opening).toBe("You both chose to have this talk.");

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
});
