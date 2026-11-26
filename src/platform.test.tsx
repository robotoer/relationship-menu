import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { platform, resetPlatform, setPlatform } from "./platform";
import { ShareDialog } from "./components/ShareDialog";
import { LandingPage } from "./pages/Landing";
import { DiscussPage } from "./pages/Discuss";
import { newConversation } from "./conversation";
import { encodeMenuSlug } from "./compare-slug";
import { exportMenus } from "./export-menus";
import { homeScreenDevice } from "./persistence";

const IPHONE_SAFARI = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5,
  displayModeStandalone: false,
};

const shareDialog = () =>
  render(
    <MemoryRouter>
      <ShareDialog
        title="Ours"
        menuUrl="https://x/menu?encoded=MINE"
        menuEncoded="MINE"
        templateUrl="https://x/menu?encoded=TPL"
        templateEncoded="TPL"
        onClose={() => {}}
      />
    </MemoryRouter>
  );

describe("platform (hooks for hosts that embed the app)", () => {
  afterEach(() => resetPlatform());

  it("on the website: this site's address, every feature shown", () => {
    expect(platform()).toMatchObject({
      kind: "web",
      publicOrigin: window.location.origin,
      support: true,
      aiTeaser: true,
      homeScreenHint: true,
    });
  });

  it("setPlatform replaces only what it's given", () => {
    setPlatform({ kind: "test", publicOrigin: "https://example.test" });
    expect(platform()).toMatchObject({ kind: "test", publicOrigin: "https://example.test", support: true });
    resetPlatform();
    expect(platform().kind).toBe("web");
  });

  it("the share dialog copies and shares through the platform", async () => {
    const copyText = vi.fn(async () => {});
    const shareText = vi.fn(async () => true);
    setPlatform({ copyText, shareText });
    shareDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy invite message" }));
    await screen.findByRole("button", { name: "Copied!" });
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("https://x/menu?encoded=TPL"));
    fireEvent.click(screen.getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(shareText).toHaveBeenCalledTimes(1));
    expect(shareText.mock.calls[0]).toEqual([expect.objectContaining({ text: expect.stringContaining("TPL") })]);
  });

  it("no Share… button where there's no share sheet", () => {
    setPlatform({ shareText: null });
    shareDialog();
    expect(screen.queryByRole("button", { name: "Share…" })).not.toBeInTheDocument();
  });

  it("support: false hides the support nudge after sharing, and the landing section", async () => {
    setPlatform({ support: false, copyText: async () => {} });
    shareDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy invite message" }));
    await screen.findByRole("button", { name: "Copied!" });
    expect(screen.queryByRole("link", { name: /Support the project/ })).not.toBeInTheDocument();

    document.body.innerHTML = "";
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: /support the project/i })).not.toBeInTheDocument();
  });

  it("aiTeaser: false hides the AI teaser in the discussion", () => {
    setPlatform({ aiTeaser: false });
    const conversation = newConversation([
      encodeMenuSlug("A", { G: [{ item: "Kids", value: "must-have" }] }),
      encodeMenuSlug("B", { G: [{ item: "Kids", value: "off-limits" }] }),
    ]);
    render(
      <MemoryRouter>
        <DiscussPage
          conversation={conversation}
          onChange={() => {}}
          names={["A", "B"]}
          compareLink="/compare"
          me={null}
          onMe={() => {}}
          seen={0}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Talk it through" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prepare this conversation with AI/ })).not.toBeInTheDocument();
  });

  it("homeScreenHint: false turns the Home Screen tip off", () => {
    expect(homeScreenDevice(IPHONE_SAFARI)).toBe("iPhone");
    setPlatform({ homeScreenHint: false });
    expect(homeScreenDevice(IPHONE_SAFARI)).toBeNull();
  });

  it("export uses the public address in links and the platform's way of saving", async () => {
    const saveFile = vi.fn(async (_file: File) => "shared" as const);
    setPlatform({ kind: "test", publicOrigin: "https://example.test", saveFile });
    const outcome = await exportMenus([{ title: "Ours", encoded: "E" } as never], { browser: IPHONE_SAFARI });
    expect(outcome).toBe("shared");
    const file = saveFile.mock.calls[0][0] as File;
    expect(file.name).toMatch(/^relationship-menus-.*\.txt$/);
    expect(await file.text()).toContain("https://example.test/menu?encoded=");
  });
});
