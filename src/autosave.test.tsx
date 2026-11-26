import { act, renderHook } from "@testing-library/react";
import { AUTOSAVE_DELAY_MS, useAutosave } from "./autosave";
import { RelationshipMenuDocument } from "./model/menu";

const doc = (title: string, encoded = "e"): RelationshipMenuDocument => ({
  title,
  encoded,
});

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const flushPromises = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("saves once after edits stop, with the latest document", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(
      ({ d }) => useAutosave(d, save),
      { initialProps: { d: doc("M") as RelationshipMenuDocument | null } }
    );
    rerender({ d: doc("Me") });
    rerender({ d: doc("Menu") });
    expect(save).not.toHaveBeenCalled();
    expect(result.current).toBe("pending");

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(doc("Menu"));
    expect(result.current).toBe("saved");
  });

  it("SY-33: after a synced change is shown, it isn't saved again, but changing back to the old version is", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const A = doc("Ours", "a");
    const B = doc("Ours", "b");
    const { rerender } = renderHook(({ d, stored }) => useAutosave(d, save, stored), {
      initialProps: { d: A as RelationshipMenuDocument | null, stored: null as RelationshipMenuDocument | null },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenLastCalledWith(A);
    // Sync replaced A with B in storage, and the editor now shows B.
    rerender({ d: B, stored: B });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    // Changing it back to A is an edit: storage holds B.
    rerender({ d: A, stored: B });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(A);
  });

  it("SY-33: changing back to the old version straight away, before the save delay is up, is saved too", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const A = doc("Ours", "a");
    const B = doc("Ours", "b");
    const { rerender } = renderHook(({ d, stored }) => useAutosave(d, save, stored), {
      initialProps: { d: A as RelationshipMenuDocument | null, stored: null as RelationshipMenuDocument | null },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    // Sync shows B, and within the save delay the person goes back to A.
    rerender({ d: B, stored: B });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS / 2);
      await flushPromises();
    });
    rerender({ d: A, stored: B });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(A);
  });

  it("saves title-only changes (the menu title is part of the document)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("Old", "same") },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    rerender({ d: doc("New", "same") });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenLastCalledWith(doc("New", "same"));
  });

  it("runs saves one at a time, in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const save = vi.fn((d: RelationshipMenuDocument) => {
      order.push(`start ${d.title}`);
      return d.title === "A"
        ? new Promise<void>((r) => {
            release = () => {
              order.push("end A");
              r();
            };
          })
        : Promise.resolve().then(() => {
            order.push(`end ${d.title}`);
          });
    });
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    rerender({ d: doc("B") });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(order).toEqual(["start A"]);
    await act(async () => {
      release();
      await flushPromises();
    });
    expect(order).toEqual(["start A", "end A", "start B", "end B"]);
  });

  it("does not save when the document is null", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave(null, save));
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
      await flushPromises();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes a pending save on unmount", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave(doc("Draft"), save));
    await act(async () => {
      unmount();
      await flushPromises();
    });
    expect(save).toHaveBeenCalledWith(doc("Draft"));
  });

  it("reverting an edit before it saves keeps the reverted version (undo)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    rerender({ d: doc("B") });
    rerender({ d: doc("A") }); // undo within the debounce window
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalledWith(doc("B"));
  });

  it("reports an error and keeps going when a save fails", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender, result } = renderHook(({ d }) => useAutosave(d, save), {
      initialProps: { d: doc("A") },
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(result.current).toBe("error");
    rerender({ d: doc("B") });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
    expect(result.current).toBe("saved");
    errorSpy.mockRestore();
  });
});
