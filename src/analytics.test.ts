import { progressMilestone, track, trackOnce } from "./analytics";

describe("analytics", () => {
  const gtag = jest.fn();
  beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
  });
  afterAll(() => {
    delete (window as unknown as { gtag?: typeof gtag }).gtag;
  });

  it("sends events with their parameters", () => {
    track("link_copied", { link_type: "template" });
    track("note_added");
    expect(gtag).toHaveBeenNthCalledWith(1, "event", "link_copied", { link_type: "template" });
    expect(gtag).toHaveBeenNthCalledWith(2, "event", "note_added", {});
  });

  it("trackOnce sends each key once", () => {
    trackOnce("k", "library_searched");
    trackOnce("k", "library_searched");
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("never throws, with or without gtag", () => {
    gtag.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => track("note_added")).not.toThrow();
    delete (window as unknown as { gtag?: typeof gtag }).gtag;
    expect(() => track("note_added")).not.toThrow();
  });

  it("progressMilestone buckets answered share into 25/50/75/100", () => {
    expect(progressMilestone(0, 4)).toBeNull();
    expect(progressMilestone(1, 10)).toBeNull();
    expect(progressMilestone(1, 4)).toBe(25);
    expect(progressMilestone(2, 4)).toBe(50);
    expect(progressMilestone(3, 4)).toBe(75);
    expect(progressMilestone(4, 4)).toBe(100);
    expect(progressMilestone(3, 0)).toBeNull();
  });
});
