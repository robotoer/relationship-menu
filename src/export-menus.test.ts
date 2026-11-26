import { decodeCompareSlug } from "./compare-slug";
import { encodeData } from "./data-encoder";
import { exportFileName, exportMenus, exportText } from "./export-menus";
import { RelationshipMenuDocument } from "./model/menu";
import { BrowserInfo } from "./persistence";

const ORIGIN = "https://relationship-menu.vercel.app";
// 25 November 2026, midday local time.
const NOW = new Date(2026, 10, 25, 12).getTime();

const MENUS: RelationshipMenuDocument[] = [
  {
    title: "Zed's menu",
    encoded: encodeData({ Fun: [{ item: "Dancing", value: "maybe", note: "slow ones" }] }),
    person: { name: "Zed", pronouns: "he/him" },
  },
  { title: "", encoded: encodeData({ Home: [{ item: "Moving in" }] }) },
  { title: "__proto__", encoded: encodeData({ "Commitment": [{ item: "Kids", value: "off-limits" }] }) },
];

const DESKTOP: BrowserInfo = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  maxTouchPoints: 0,
  displayModeStandalone: false,
};
const IPHONE: BrowserInfo = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5,
  standalone: true,
  displayModeStandalone: true,
};

/** The links in an export, in order. */
const linksIn = (text: string) => text.split("\n").filter((line) => line.startsWith(ORIGIN));

describe("Export all menus (SV-13)", () => {
  it("SV-13: one file listing every menu by title, each with a link that brings it back", () => {
    const text = exportText(MENUS, ORIGIN, NOW);
    expect(text).toContain("3 menus saved in this browser, exported 2026-11-25.");
    expect(text).toContain("keep this file private");
    expect(text).toMatch(/1\. __proto__\n.+\n\n2\. Untitled menu\n.+\n\n3\. Zed's menu\n/);
    const links = linksIn(text);
    expect(links).toHaveLength(3);
    const opened = links.map((link) => decodeCompareSlug(link));
    expect(opened.map((m) => m?.title)).toEqual(["__proto__", "", "Zed's menu"]);
    // Answers, notes and person info all come back, as with the Share dialog's menu link.
    expect(opened[2]?.menu).toEqual({ Fun: [{ item: "Dancing", value: "maybe", note: "slow ones" }] });
    expect(opened[2]?.person).toEqual({ name: "Zed", pronouns: "he/him" });
    expect(opened[0]?.menu.Commitment).toEqual([{ item: "Kids", value: "off-limits" }]);
    expect(exportFileName(NOW)).toBe("relationship-menus-2026-11-25.txt");
  });

  it("SV-13: a single menu reads naturally", () => {
    expect(exportText([MENUS[0]], ORIGIN, NOW)).toContain("1 menu saved in this browser");
  });

  describe("delivering the file", () => {
    let created: Blob[];
    let clicked: HTMLAnchorElement[];
    const fetchSpy = vi.fn();
    beforeEach(() => {
      created = [];
      clicked = [];
      URL.createObjectURL = vi.fn((blob: Blob) => {
        created.push(blob);
        return "blob:local-file";
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
      vi.stubGlobal("fetch", fetchSpy);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("SV-13: downloads it on computers and other phones, and sends nothing anywhere", async () => {
      const outcome = await exportMenus(MENUS, { origin: ORIGIN, now: NOW, browser: DESKTOP });
      expect(outcome).toBe("downloaded");
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe("relationship-menus-2026-11-25.txt");
      expect(clicked[0].href).toBe("blob:local-file");
      expect(await created[0].text()).toBe(exportText(MENUS, ORIGIN, NOW));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("SV-13: on iPhone and iPad, offers the share sheet (Save to Files)", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      const nav = { canShare: () => true, share } as unknown as Navigator;
      const outcome = await exportMenus(MENUS, { origin: ORIGIN, now: NOW, browser: IPHONE, nav });
      expect(outcome).toBe("shared");
      const file: File = share.mock.calls[0][0].files[0];
      expect(file.name).toBe("relationship-menus-2026-11-25.txt");
      expect(await file.text()).toBe(exportText(MENUS, ORIGIN, NOW));
      expect(clicked).toHaveLength(0);
    });

    it("SV-13: closing the share sheet does nothing; a failing one falls back to a download", async () => {
      const cancel = Object.assign(new Error("cancelled"), { name: "AbortError" });
      const cancelled = { canShare: () => true, share: vi.fn().mockRejectedValue(cancel) } as unknown as Navigator;
      expect(await exportMenus(MENUS, { origin: ORIGIN, browser: IPHONE, nav: cancelled })).toBe("cancelled");
      expect(clicked).toHaveLength(0);

      const failing = {
        canShare: () => true,
        share: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })),
      } as unknown as Navigator;
      expect(await exportMenus(MENUS, { origin: ORIGIN, browser: IPHONE, nav: failing })).toBe("downloaded");
      expect(clicked).toHaveLength(1);

      const noFiles = { canShare: () => false, share: vi.fn() } as unknown as Navigator;
      expect(await exportMenus(MENUS, { origin: ORIGIN, browser: IPHONE, nav: noFiles })).toBe("downloaded");
      expect(noFiles.share).not.toHaveBeenCalled();
    });
  });
});
