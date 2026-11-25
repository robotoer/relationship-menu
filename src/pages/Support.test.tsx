import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SupportPage, SUPPORT_OPTIONS } from "./Support";

const renderAt = (state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/support", state }]}>
      <SupportPage />
    </MemoryRouter>
  );

describe("SupportPage", () => {
  const gtag = vi.fn();
  beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
  });
  afterAll(() => {
    delete (window as unknown as { gtag?: typeof gtag }).gtag;
  });

  it("says everything stays free and lists the supporter perks", () => {
    renderAt();
    expect(screen.getByRole("heading", { level: 1, name: "Support Relationship Menu" })).toBeInTheDocument();
    expect(screen.getByText(/everything here stays free/)).toBeInTheDocument();
    expect(screen.getByText("Sync across your devices")).toBeInTheDocument();
    expect(screen.getByText("Encrypted backup")).toBeInTheDocument();
  });

  it("offers each amount, with $12/year marked as suggested", () => {
    renderAt();
    const group = screen.getByRole("group", { name: "Pay what you like" });
    for (const option of SUPPORT_OPTIONS) {
      expect(group).toHaveTextContent(option.label);
    }
    expect(screen.getByRole("button", { name: /\$12 \/ year/ })).toHaveTextContent("Suggested");
  });

  it("records where the visit came from, defaulting to direct", () => {
    renderAt({ supportFrom: "share" });
    expect(gtag).toHaveBeenCalledWith("event", "support_viewed", { from: "share" });
    gtag.mockReset();
    renderAt({ supportFrom: "something-else" });
    expect(gtag).toHaveBeenCalledWith("event", "support_viewed", { from: "direct" });
  });

  it("choosing an amount records it and says plainly that nothing was charged", () => {
    renderAt();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /\$30 once/ });
    fireEvent.click(button);
    expect(gtag).toHaveBeenCalledWith("event", "support_option_chosen", { amount_usd: 30, plan: "lifetime" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("checkout isn't open yet");
    expect(notice).toHaveTextContent("hasn't charged you anything");
    expect(notice).toHaveFocus();
  });
});
