import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { encodeMenuSlug } from "../compare-slug";
import { addComment, listConversations, newConversation, saveConversation, updateTopic } from "../conversation";
import { ConversationList } from "./ConversationList";
import { SaveComparison } from "./SaveComparison";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kids", value: "must-have" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kids", value: "off-limits" }] }, { name: "Ben" });

describe("saved conversations (CV-1)", () => {
  beforeEach(() => localStorage.clear());

  it("the Compare page saves the comparison, then links to it", () => {
    render(
      <MemoryRouter>
        <SaveComparison entries={[ana, ben]} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "💾 Save this comparison" }));
    const [c] = listConversations();
    expect(c.title).toBe("Ana & Ben");
    expect(screen.getByRole("link", { name: "Open the conversation" })).toHaveAttribute("href", `/talk?id=${c.id}`);
  });

  it("the Library lists conversations with progress and new comments, and can delete them", () => {
    let c = newConversation([ana, ben], 1000, "LibraryConversation000");
    c = updateTopic(c, "g\u0000kids", { outcome: "boundary" }, 2000);
    c = addComment(c, { topic: "g\u0000kids" }, 1, "Thanks for saying it", 3000, "c".repeat(22));
    saveConversation(c);
    render(
      <MemoryRouter>
        <ConversationList />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Ana & Ben" })).toHaveAttribute("href", "/talk?id=LibraryConversation000");
    expect(screen.getByText(/1 of 1 topics talked through/)).toBeInTheDocument();
    expect(screen.getByText(/1 new comment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete conversation Ana & Ben" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(listConversations()).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Your conversations" })).not.toBeInTheDocument();
  });
});
