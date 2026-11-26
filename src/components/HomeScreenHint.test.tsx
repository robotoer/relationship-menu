import { fireEvent, render, screen } from "@testing-library/react";
import { HomeScreenHint } from "./HomeScreenHint";
import { BrowserInfo, HOME_SCREEN_HINT_DISMISSED_KEY } from "../persistence";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const browser = (userAgent: string, more: Partial<BrowserInfo> = {}): BrowserInfo => ({
  userAgent,
  maxTouchPoints: 0,
  displayModeStandalone: false,
  ...more,
});

describe("HomeScreenHint (SV-12)", () => {
  let gtag: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
  });
  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("SV-12: on iPhone Safari, explains why and how to add the site to the Home Screen", () => {
    render(<HomeScreenHint browser={browser(IPHONE_SAFARI)} />);
    const tip = screen.getByRole("complementary", { name: "Tip: keep your menus" });
    expect(tip).toHaveTextContent("Keep your menus on this iPhone.");
    expect(tip).toHaveTextContent("Safari may delete menus from sites you haven't opened in a week.");
    expect(tip).toHaveTextContent("tap Safari's Share button, then Add to Home Screen.");
    expect(tip).toHaveTextContent("It has its own Library, separate from Safari's");
    expect(tip).not.toHaveTextContent("Export all menus");
    // Only that it was shown: no parameters.
    expect(gtag).toHaveBeenCalledWith("event", "home_screen_hint_shown", {});
  });

  it("SV-12: with menus already saved, points to the backup (they stay in Safari)", () => {
    render(<HomeScreenHint browser={browser(IPHONE_SAFARI)} hasMenus />);
    expect(screen.getByRole("complementary")).toHaveTextContent(
      "Menus you've already made stay in Safari: keep a copy with Export all menus in your Library."
    );
  });

  it("SV-12: dismissing it hides it, for good in this browser", () => {
    const { unmount } = render(<HomeScreenHint browser={browser(IPHONE_SAFARI)} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip about the Home Screen" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(localStorage.getItem(HOME_SCREEN_HINT_DISMISSED_KEY)).toBe("1");
    expect(gtag).toHaveBeenCalledWith("event", "home_screen_hint_dismissed", {});
    unmount();
    render(<HomeScreenHint browser={browser(IPHONE_SAFARI)} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("SV-12: never shown in other browsers or in a Home Screen app", () => {
    render(<HomeScreenHint browser={browser(DESKTOP_CHROME)} />);
    render(<HomeScreenHint browser={browser(IPHONE_SAFARI, { standalone: true })} />);
    render(<HomeScreenHint browser={browser(IPHONE_SAFARI, { displayModeStandalone: true })} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(gtag).not.toHaveBeenCalled();
  });
});
