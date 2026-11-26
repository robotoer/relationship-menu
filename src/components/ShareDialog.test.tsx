import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ShareDialog } from "./ShareDialog";

const CompareSpy = () => {
  const location = useLocation();
  return <output data-testid="compare">{location.search}</output>;
};

const renderDialog = (props: Partial<Parameters<typeof ShareDialog>[0]> = {}) => {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={["/menu"]}>
      <Routes>
        <Route
          path="/menu"
          element={
            <ShareDialog
              title="Ours"
              menuUrl="https://x/menu?encoded=MINE"
              menuEncoded="MINE"
              templateUrl="https://x/menu?encoded=TPL"
              templateEncoded="TPL"
              onClose={onClose}
              {...props}
            />
          }
        />
        <Route path="/compare" element={<CompareSpy />} />
      </Routes>
    </MemoryRouter>
  );
  return { onClose };
};

describe("ShareDialog", () => {
  it("lays out invite, share and compare steps with labelled links", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: 'Share "Ours"' })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1 Invite someone to fill it in",
      "2 Share your answers",
      "3 Compare",
    ]);
    expect(screen.getByRole("textbox", { name: "Template link" })).toHaveValue(
      "https://x/menu?encoded=TPL"
    );
    expect(screen.getByRole("textbox", { name: "Menu link" })).toHaveValue(
      "https://x/menu?encoded=MINE"
    );
    // Slugs are under "Advanced".
    expect(screen.getByRole("textbox", { name: "Menu slug", hidden: true })).toHaveValue("MINE");
    expect(screen.getByRole("textbox", { name: "Template slug", hidden: true })).toHaveValue(
      "TPL"
    );
  });

  it("warns that the menu link includes answers and the person's name", () => {
    renderDialog({ personName: "Sam" });
    expect(screen.getByText(/Includes your answers and notes, and your name \(Sam\)/)).toBeInTheDocument();
  });

  it("copies an invite message containing the template link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Copy invite message" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://x/menu?encoded=TPL"));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("mentions supporting the project only after something was shared", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDialog();
    expect(screen.queryByRole("link", { name: "Support the project" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy template link" }));
    expect(screen.getByRole("link", { name: "Support the project" })).toHaveAttribute("href", "/support");
  });

  it("compares with a pasted link", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/Paste it to compare/), "THEIRS");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("compare")).toHaveTextContent("?encoded=MINE&encoded=THEIRS");
  });

  it("closes on Escape and on the close button", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close share dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
