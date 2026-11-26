import {
  answeredBucket,
  errorType,
  openedFrom,
  openedFromState,
  progressMilestone,
  resetErrorTracking,
  track,
  trackError,
  trackOnce,
  trackUncaughtErrors,
  trackWebVital,
} from "./analytics";

describe("analytics", () => {
  const gtag = vi.fn();
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

  it("answeredBucket is progressMilestone with 0 for under 25%", () => {
    expect(answeredBucket(0, 4)).toBe(0);
    expect(answeredBucket(1, 10)).toBe(0);
    expect(answeredBucket(3, 4)).toBe(75);
    expect(answeredBucket(0, 0)).toBe(0);
  });

  it("openedFrom reads back only the known in-app origins", () => {
    expect(openedFrom(openedFromState("library"))).toBe("library");
    expect(openedFrom(openedFromState("share_dialog"))).toBe("share_dialog");
    expect(openedFrom(null)).toBeUndefined();
    expect(openedFrom(undefined)).toBeUndefined();
    expect(openedFrom("library")).toBeUndefined();
    expect(openedFrom({ openedFrom: "Zqx" })).toBeUndefined();
  });

  describe("web vitals", () => {
    it("sends the metric name and rounded value only (CLS × 1000)", () => {
      trackWebVital({ name: "LCP", value: 1234.56 });
      trackWebVital({ name: "CLS", value: 0.0567 });
      trackWebVital({ name: "INP", value: 87.4 });
      expect(gtag).toHaveBeenNthCalledWith(1, "event", "web_vital", { metric_name: "LCP", metric_value: 1235 });
      expect(gtag).toHaveBeenNthCalledWith(2, "event", "web_vital", { metric_name: "CLS", metric_value: 57 });
      expect(gtag).toHaveBeenNthCalledWith(3, "event", "web_vital", { metric_name: "INP", metric_value: 87 });
    });

    it("drops anything else a metric carries, and unknown metrics", () => {
      const metric = {
        name: "TTFB",
        value: 300,
        id: "v5-123",
        rating: "good",
        navigationType: "navigate",
        entries: [{ name: "https://example.test/menu?encoded=Zqx" }],
      };
      trackWebVital(metric);
      trackWebVital({ name: "Zqx", value: 1 });
      trackWebVital({ name: "FCP", value: NaN });
      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("event", "web_vital", { metric_name: "TTFB", metric_value: 300 });
    });
  });

  describe("app errors", () => {
    beforeEach(() => resetErrorTracking());

    it("errorType gives a fixed name, never the message or a custom name", () => {
      expect(errorType(new TypeError("Zqx secret"))).toBe("TypeError");
      expect(errorType(new Error("Zqx"))).toBe("Error");
      const custom = new Error("x");
      custom.name = "Zqx Ana";
      expect(errorType(custom)).toBe("other_error");
      class ChunkLoadError extends Error {
        name = "ChunkLoadError";
      }
      expect(errorType(new ChunkLoadError())).toBe("ChunkLoadError");
      expect(errorType(new DOMException("Zqx", "QuotaExceededError"))).toBe("QuotaExceededError");
      // Something that isn't an Error, even if it has a name (like a person).
      expect(errorType({ name: "Ana" })).toBe("non_error");
      expect(errorType("Zqx")).toBe("non_error");
      expect(errorType(null)).toBe("unknown");
      expect(errorType(undefined)).toBe("unknown");
      const hostile = new Proxy(new Error("x"), {
        get: () => {
          throw new Error("boom");
        },
      });
      expect(errorType(hostile)).toBe("unknown");
    });

    it("sends the kind and source once per page, and at most five", () => {
      const error = new TypeError("Zqx");
      trackError(error, "error");
      trackError(error, "error");
      trackError(new TypeError("again"), "error");
      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("event", "app_error", { error_type: "TypeError", error_source: "error" });
      trackError(new RangeError(), "error");
      trackError(new Error(), "unhandledrejection");
      trackError("x", "unhandledrejection");
      trackError(null, "error");
      trackError(new SyntaxError(), "react");
      trackError(new URIError(), "react");
      expect(gtag).toHaveBeenCalledTimes(5);
      expect(JSON.stringify(gtag.mock.calls)).not.toContain("Zqx");
    });

    it("doesn't count an error React already reported", () => {
      const error = new Error("render");
      trackError(error, "react");
      trackError(error, "error");
      expect(gtag).toHaveBeenCalledTimes(1);
      expect(gtag).toHaveBeenCalledWith("event", "app_error", { error_type: "Error", error_source: "react" });
    });

    it("listens for uncaught errors and unhandled rejections", () => {
      const target = new EventTarget() as unknown as Window;
      trackUncaughtErrors(target);
      const errorEvent = new Event("error") as Event & { error?: unknown };
      errorEvent.error = new TypeError("Zqx");
      target.dispatchEvent(errorEvent);
      const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
      rejection.reason = { name: "Zqx" };
      target.dispatchEvent(rejection);
      expect(gtag).toHaveBeenNthCalledWith(1, "event", "app_error", { error_type: "TypeError", error_source: "error" });
      expect(gtag).toHaveBeenNthCalledWith(2, "event", "app_error", {
        error_type: "non_error",
        error_source: "unhandledrejection",
      });
    });
  });
});
